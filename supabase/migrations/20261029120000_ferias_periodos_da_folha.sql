-- Férias: os períodos aquisitivos passam a vir da FOLHA.
--
-- Até aqui o saldo era calculado a partir da data de admissão, supondo 30 dias
-- por ano e nenhum dia gozado antes do sistema. Para quem tem anos de casa isso
-- produzia uma fileira de aquisitivos "vencidos" de 30 dias, e o FIFO prendia o
-- pedido ao mais antigo (2009, 2003...). Além disso a folha sabe o que a
-- admissão não sabe: aquisitivo deslocado por afastamento (art. 133), direito
-- reduzido por faltas (art. 130), dias já gozados e a data-limite de concessão.
--
-- O DP importa o relatório "Programação de Férias" da folha. Para quem veio no
-- relatório, o saldo passa a ser:
--
--   direito da folha − gozados na folha − previsões do sistema que começam
--   DEPOIS da data de emissão do relatório
--
-- A data de emissão é a fronteira: o que começou antes dela a folha já contou
-- como gozado; o que começa depois, ela ainda não viu. Reimportar move a
-- fronteira, e nada é contado duas vezes.
--
-- Decisões do LUIZ (29/10/2026):
--   - gozo que termina depois do prazo de concessão é recusado; só o DP lança
--     férias em dobro, e com justificativa;
--   - o registro direto (Configurações) passa a aceitar só histórico anterior ao
--     relatório; dali em diante, férias só pelo módulo;
--   - empresa que importa da folha: quem não veio no relatório não tem saldo
--     até o DP importar (a admissão sozinha não diz a verdade).

-- ---------------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------------
create table if not exists public.ferias_importacoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- data de emissão do relatório: o que a folha sabia naquele dia
  referencia date not null,
  -- "data base" do relatório (até onde os avos proporcionais foram projetados)
  data_base date,
  arquivo text,
  pessoas integer not null default 0,
  periodos integer not null default 0,
  -- linhas do relatório que não casaram com ninguém, para a tela mostrar
  recusadas jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists ferias_importacoes_tenant_idx
  on public.ferias_importacoes (tenant_id, referencia desc, created_at desc);

create table if not exists public.ferias_aquisitivos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  importacao_id uuid not null references public.ferias_importacoes(id) on delete cascade,
  referencia date not null,
  aq_inicio date not null,
  aq_fim date not null,
  -- direito integral do aquisitivo: gozados + restantes (30, ou menos pelo art. 130)
  dias_direito integer not null,
  dias_gozados integer not null default 0,
  -- avos já adquiridos na data base (só informativo, para aquisitivo em curso)
  dias_proporcionais numeric(4, 1),
  -- "Limite p/ gozo" da folha: último dia para COMEÇAR o saldo restante
  limite_gozo date,
  -- último dia em que o gozo pode cair sem virar dobra (limite + restantes − 1)
  concessivo_fim date not null,
  dias_afastamento integer,
  dias_faltas integer,
  created_at timestamptz not null default now(),
  constraint ferias_aquisitivos_periodo check (aq_fim >= aq_inicio),
  constraint ferias_aquisitivos_dias check (
    dias_direito between 0 and 30 and dias_gozados between 0 and dias_direito),
  constraint ferias_aquisitivos_unico unique (tenant_id, user_id, aq_inicio)
);
create index if not exists ferias_aquisitivos_importacao_idx
  on public.ferias_aquisitivos (importacao_id);

comment on table public.ferias_aquisitivos is
  'Períodos aquisitivos importados do relatório de programação de férias da folha. Fonte do saldo de férias de quem veio no relatório.';

-- Ninguém lê nem escreve direto: leitura por `ferias_periodos_aquisitivos` e
-- `ferias_situacao_importacao` (security definer com guarda), escrita só por
-- `ferias_importar_aquisitivos`. RLS ligada como segunda camada.
alter table public.ferias_importacoes enable row level security;
alter table public.ferias_aquisitivos enable row level security;
revoke all on table public.ferias_importacoes from public, anon, authenticated;
revoke all on table public.ferias_aquisitivos from public, anon, authenticated;

-- Férias em dobro: só o DP lança, e o porquê fica gravado na linha
alter table public.ferias_solicitacoes
  add column if not exists em_dobro boolean not null default false,
  add column if not exists justificativa_dobro text;

comment on column public.ferias_solicitacoes.em_dobro is
  'O gozo termina depois do prazo de concessão (art. 137). Só o DP lança assim, com justificativa.';

-- ---------------------------------------------------------------------------
-- 2. Aquisitivos: da folha quando há, da admissão só em empresa que não importa
-- ---------------------------------------------------------------------------
drop function if exists public.ferias_periodos_aquisitivos(uuid, uuid, date, uuid);

create function public.ferias_periodos_aquisitivos(
  p_tenant uuid, p_user uuid, p_hoje date default current_date, p_excluir uuid default null)
returns table(
  aq_inicio date, aq_fim date, concessivo_fim date,
  dias_direito integer, dias_usados integer, abono_usado integer, saldo integer,
  qtd_periodos integer, situacao text,
  origem text, referencia date, gozados_folha integer, limite_gozo date, tem14 boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_adm date;
  v_min14 int;
  r record;
begin
  if p_user <> (select auth.uid())
     and not public.manages_user(p_user, p_tenant)
     and not public.has_tenant_role(p_tenant, '{owner,admin,hr,manager}'::public.member_role[]) then
    raise exception 'Sem alçada para ver o saldo de férias deste colaborador.';
  end if;

  -- 1) a folha disse quais são os aquisitivos desta pessoa
  if exists (select 1 from public.ferias_aquisitivos a
              where a.tenant_id = p_tenant and a.user_id = p_user) then
    for r in
      select a.* from public.ferias_aquisitivos a
       where a.tenant_id = p_tenant and a.user_id = p_user
       order by a.aq_inicio
    loop
      aq_inicio := r.aq_inicio;
      aq_fim := r.aq_fim;
      concessivo_fim := r.concessivo_fim;
      dias_direito := r.dias_direito;
      origem := 'folha';
      referencia := r.referencia;
      gozados_folha := r.dias_gozados;
      limite_gozo := r.limite_gozo;
      -- quem tem direito menor que 14 (art. 130) só pode tirar tudo de uma vez
      v_min14 := least(14, r.dias_direito);

      -- só o que a folha ainda não viu: previsões que começam depois do relatório
      select coalesce(sum(f.dias + f.abono_dias), 0)::int,
             coalesce(sum(f.abono_dias), 0)::int,
             count(*)::int,
             coalesce(bool_or(f.dias >= v_min14), false)
        into dias_usados, abono_usado, qtd_periodos, tem14
        from public.ferias_solicitacoes f
       where f.tenant_id = p_tenant and f.user_id = p_user
         and f.aquisitivo_inicio = r.aq_inicio
         and f.status in ('solicitada', 'aprovada', 'efetivada')
         and f.start_date > r.referencia
         and (p_excluir is null or f.id <> p_excluir);

      dias_usados := dias_usados + r.dias_gozados;
      -- a folha informa o TOTAL gozado, não em quantos períodos: conta como um,
      -- e um gozo de 14 dias ou mais já cumpre o período mínimo do art. 134
      if r.dias_gozados > 0 then
        qtd_periodos := qtd_periodos + 1;
      end if;
      tem14 := tem14 or (r.dias_gozados > 0 and r.dias_gozados >= v_min14);

      saldo := greatest(dias_direito - dias_usados, 0);
      situacao := case
        when aq_fim >= p_hoje then 'em_curso'
        when saldo <= 0 then 'quitada'
        when p_hoje > concessivo_fim then 'vencida'
        when concessivo_fim - p_hoje <= 90 then 'a_vencer'
        else 'aberta'
      end;
      return next;
    end loop;
    return;
  end if;

  -- 2) a empresa importa da folha e esta pessoa não veio no relatório: sem
  -- os dados da folha não há saldo confiável, e calcular pela admissão seria
  -- justamente o erro que a importação veio corrigir
  if exists (select 1 from public.ferias_importacoes i where i.tenant_id = p_tenant) then
    return;
  end if;

  -- 3) empresa que nunca importou: o cálculo antigo, pela admissão
  select m.admission_date into v_adm
    from public.memberships m
   where m.tenant_id = p_tenant and m.user_id = p_user;
  if v_adm is null then
    return;
  end if;

  origem := 'admissao';
  referencia := null;
  gozados_folha := 0;
  limite_gozo := null;
  aq_inicio := v_adm;
  while aq_inicio <= p_hoje loop
    aq_fim := (aq_inicio + interval '1 year' - interval '1 day')::date;
    concessivo_fim := (aq_fim + interval '1 year')::date;
    dias_direito := 30;

    select coalesce(sum(f.dias + f.abono_dias), 0)::int,
           coalesce(sum(f.abono_dias), 0)::int,
           count(*)::int,
           coalesce(bool_or(f.dias >= 14), false)
      into dias_usados, abono_usado, qtd_periodos, tem14
      from public.ferias_solicitacoes f
     where f.tenant_id = p_tenant and f.user_id = p_user
       and f.aquisitivo_inicio = aq_inicio
       and f.status in ('solicitada', 'aprovada', 'efetivada')
       and (p_excluir is null or f.id <> p_excluir);

    saldo := greatest(dias_direito - dias_usados, 0);
    situacao := case
      when aq_fim >= p_hoje then 'em_curso'
      when saldo <= 0 then 'quitada'
      when p_hoje > concessivo_fim then 'vencida'
      when concessivo_fim - p_hoje <= 90 then 'a_vencer'
      else 'aberta'
    end;

    return next;
    aq_inicio := (aq_inicio + interval '1 year')::date;
  end loop;
end;
$function$;

revoke execute on function public.ferias_periodos_aquisitivos(uuid, uuid, date, uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- 3. Validação: prazo de concessão, abono de 1/3 e o mínimo proporcional
-- ---------------------------------------------------------------------------
drop function if exists public.ferias_validar_periodos(uuid, uuid, jsonb, date, uuid);

create function public.ferias_validar_periodos(
  p_tenant uuid, p_user uuid, p_periodos jsonb, p_hoje date,
  p_excluir uuid default null, p_dobro_ok boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n int;
  v_ini date[] := '{}'; v_fim date[] := '{}';
  v_abono int[] := '{}'; v_decimo boolean[] := '{}'; v_dias int[] := '{}';
  aq record;
  aq_ini date[] := '{}'; aq_fim date[] := '{}'; aq_conc date[] := '{}';
  aq_direito int[] := '{}';
  aq_saldo int[] := '{}'; aq_qtd int[] := '{}'; aq_abono int[] := '{}';
  aq_tem14 boolean[] := '{}'; aq_usado boolean[] := '{}';
  v_excl_abs uuid;
  v_dow int;
  v_choque record;
  v_k int;
  v_min14 int;
  v_dobro boolean;
  v_res jsonb := '[]'::jsonb;
  r record;
  i int;
begin
  v_n := coalesce(jsonb_array_length(p_periodos), 0);
  if v_n = 0 then
    raise exception 'Informe ao menos um período de férias.';
  end if;
  if v_n > 3 then
    raise exception 'As férias podem ser divididas em no máximo 3 períodos (art. 134).';
  end if;

  for r in
    select (e->>'inicio')::date as ini, (e->>'fim')::date as fim,
           coalesce((e->>'abono')::int, 0) as abono,
           coalesce((e->>'decimo')::boolean, false) as decimo
      from jsonb_array_elements(p_periodos) e
     order by (e->>'inicio')::date
  loop
    if r.ini is null or r.fim is null then
      raise exception 'Informe o início e o término de cada período.';
    end if;
    if r.fim < r.ini then
      raise exception 'O término não pode ser antes do início.';
    end if;
    if r.fim - r.ini + 1 < 5 then
      raise exception 'Nenhum período pode ter menos de 5 dias corridos (art. 134).';
    end if;
    if r.abono < 0 or r.abono > 10 then
      raise exception 'O abono pecuniário vai de 0 a 10 dias (art. 143).';
    end if;
    if r.fim - r.ini + 1 + r.abono > 30 then
      raise exception 'Período mais abono não podem passar de 30 dias.';
    end if;
    if r.ini <= p_hoje then
      raise exception 'A previsão precisa começar depois de hoje. Férias já ocorridas entram pelo registro direto do DP, em Configurações.';
    end if;

    v_dow := extract(dow from r.ini)::int;
    if v_dow in (0, 5, 6) then
      raise exception 'As férias não podem começar %: o início não pode cair no descanso semanal nem nos 2 dias anteriores (art. 134). Escolha de segunda a quinta.',
        case v_dow when 0 then 'num domingo' when 5 then 'numa sexta-feira' else 'num sábado' end;
    end if;
    if public.is_holiday(p_tenant, r.ini) then
      raise exception 'O início em % cai num feriado (art. 134).', to_char(r.ini, 'DD/MM/YYYY');
    end if;
    if public.is_holiday(p_tenant, r.ini + 1) or public.is_holiday(p_tenant, r.ini + 2) then
      raise exception 'O início em % cai nos 2 dias que antecedem um feriado (art. 134).', to_char(r.ini, 'DD/MM/YYYY');
    end if;

    v_ini := v_ini || r.ini; v_fim := v_fim || r.fim;
    v_abono := v_abono || r.abono; v_decimo := v_decimo || r.decimo;
    v_dias := v_dias || (r.fim - r.ini + 1);
  end loop;

  for i in 2..v_n loop
    if v_ini[i] <= v_fim[i-1] then
      raise exception 'Os períodos solicitados se cruzam entre si.';
    end if;
  end loop;

  if p_excluir is not null then
    select f.absence_id into v_excl_abs from public.ferias_solicitacoes f where f.id = p_excluir;
  end if;

  for i in 1..v_n loop
    select f.start_date, f.end_date into v_choque
      from public.ferias_solicitacoes f
     where f.tenant_id = p_tenant and f.user_id = p_user
       and f.status in ('solicitada', 'aprovada', 'efetivada')
       and (p_excluir is null or f.id <> p_excluir)
       and daterange(f.start_date, f.end_date, '[]') && daterange(v_ini[i], v_fim[i], '[]')
     limit 1;
    if found then
      raise exception 'O período de % a % cruza com férias já previstas de % a %.',
        to_char(v_ini[i], 'DD/MM/YYYY'), to_char(v_fim[i], 'DD/MM/YYYY'),
        to_char(v_choque.start_date, 'DD/MM/YYYY'), to_char(v_choque.end_date, 'DD/MM/YYYY');
    end if;

    select e.start_date, e.end_date into v_choque
      from public.employee_absences e
     where e.tenant_id = p_tenant and e.user_id = p_user
       and (v_excl_abs is null or e.id <> v_excl_abs)
       and daterange(e.start_date, e.end_date, '[]') && daterange(v_ini[i], v_fim[i], '[]')
     limit 1;
    if found then
      raise exception 'O período de % a % cruza com uma ausência já registrada de % a %.',
        to_char(v_ini[i], 'DD/MM/YYYY'), to_char(v_fim[i], 'DD/MM/YYYY'),
        to_char(v_choque.start_date, 'DD/MM/YYYY'), to_char(v_choque.end_date, 'DD/MM/YYYY');
    end if;
  end loop;

  for aq in
    select * from public.ferias_periodos_aquisitivos(p_tenant, p_user, p_hoje, p_excluir)
  loop
    aq_ini := aq_ini || aq.aq_inicio; aq_fim := aq_fim || aq.aq_fim;
    aq_conc := aq_conc || aq.concessivo_fim; aq_direito := aq_direito || aq.dias_direito;
    aq_saldo := aq_saldo || aq.saldo; aq_qtd := aq_qtd || aq.qtd_periodos;
    aq_abono := aq_abono || aq.abono_usado; aq_usado := aq_usado || false;
    aq_tem14 := aq_tem14 || aq.tem14;
  end loop;

  if coalesce(array_length(aq_ini, 1), 0) = 0 then
    if exists (select 1 from public.ferias_importacoes fi where fi.tenant_id = p_tenant) then
      raise exception 'Os períodos aquisitivos deste colaborador ainda não foram carregados da folha de pagamento, então o saldo não pode ser conferido. Peça ao departamento pessoal.';
    end if;
    raise exception 'A data de admissão deste colaborador não está cadastrada. Peça ao departamento pessoal.';
  end if;

  for i in 1..v_n loop
    v_k := null;
    for k in 1..array_length(aq_ini, 1) loop
      if aq_saldo[k] > 0 then v_k := k; exit; end if;
    end loop;
    if v_k is null then
      raise exception 'Não há saldo de férias disponível: todos os períodos aquisitivos estão quitados ou reservados.';
    end if;
    if aq_fim[v_k] >= v_ini[i] then
      raise exception 'O período aquisitivo de % a % só se completa em %. Férias deste saldo podem começar a partir de %.',
        to_char(aq_ini[v_k], 'DD/MM/YYYY'), to_char(aq_fim[v_k], 'DD/MM/YYYY'),
        to_char(aq_fim[v_k], 'DD/MM/YYYY'), to_char(aq_fim[v_k] + 1, 'DD/MM/YYYY');
    end if;
    if v_dias[i] + v_abono[i] > aq_saldo[v_k] then
      raise exception 'O período de % dias% excede o saldo de % dias do aquisitivo %/%.',
        v_dias[i],
        case when v_abono[i] > 0 then ' (mais ' || v_abono[i] || ' de abono)' else '' end,
        aq_saldo[v_k],
        extract(year from aq_ini[v_k])::int, extract(year from aq_fim[v_k])::int;
    end if;
    if aq_qtd[v_k] + 1 > 3 then
      raise exception 'O aquisitivo %/% já tem 3 períodos (art. 134).',
        extract(year from aq_ini[v_k])::int, extract(year from aq_fim[v_k])::int;
    end if;
    -- art. 143: o abono é de até um terço do direito (30 dias → 10; 18 → 6)
    if aq_abono[v_k] + v_abono[i] > aq_direito[v_k] / 3 then
      raise exception 'O abono pecuniário do aquisitivo %/% passaria de % dias, um terço do direito (art. 143).',
        extract(year from aq_ini[v_k])::int, extract(year from aq_fim[v_k])::int, aq_direito[v_k] / 3;
    end if;
    -- art. 134 e 137: o gozo cabe no prazo de concessão; o que passa vira dobra
    v_dobro := v_fim[i] > aq_conc[v_k];
    if v_dobro and not coalesce(p_dobro_ok, false) then
      raise exception 'As férias do aquisitivo %/% precisam terminar até % (fim do prazo de concessão). Depois disso elas viram férias em dobro (art. 137), e só o departamento pessoal pode lançar, com justificativa.',
        extract(year from aq_ini[v_k])::int, extract(year from aq_fim[v_k])::int,
        to_char(aq_conc[v_k], 'DD/MM/YYYY');
    end if;

    aq_saldo[v_k] := aq_saldo[v_k] - v_dias[i] - v_abono[i];
    aq_qtd[v_k] := aq_qtd[v_k] + 1;
    aq_abono[v_k] := aq_abono[v_k] + v_abono[i];
    aq_usado[v_k] := true;
    if v_dias[i] >= least(14, aq_direito[v_k]) then aq_tem14[v_k] := true; end if;

    v_res := v_res || jsonb_build_object(
      'inicio', v_ini[i], 'fim', v_fim[i], 'abono', v_abono[i], 'decimo', v_decimo[i],
      'aquisitivo_inicio', aq_ini[v_k], 'aquisitivo_fim', aq_fim[v_k],
      'em_dobro', v_dobro);
  end loop;

  -- art. 134 §1º: um dos períodos tem ao menos 14 dias. Quem tem direito menor
  -- (art. 130) não tem como fracionar: o mínimo vira o próprio direito.
  for k in 1..array_length(aq_ini, 1) loop
    v_min14 := least(14, aq_direito[k]);
    if aq_usado[k] and not aq_tem14[k] and aq_saldo[k] < v_min14 then
      raise exception 'Um dos períodos do aquisitivo %/% precisa ter ao menos % dias corridos (art. 134): com este pedido restariam só % dias para isso.',
        extract(year from aq_ini[k])::int, extract(year from aq_fim[k])::int, v_min14, aq_saldo[k];
    end if;
  end loop;

  return v_res;
end;
$function$;

revoke execute on function public.ferias_validar_periodos(uuid, uuid, jsonb, date, uuid, boolean)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Criação das linhas: carrega a marca de dobra e a justificativa
-- ---------------------------------------------------------------------------
create or replace function public.ferias_criar_linhas(
  p_tenant uuid, p_user uuid, p_validado jsonb, p_snaps jsonb,
  p_status public.ferias_status, p_lancada boolean)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  e jsonb;
  v_n int := 0;
begin
  for e in select * from jsonb_array_elements(p_validado) loop
    insert into public.ferias_solicitacoes (
      tenant_id, user_id, status,
      start_date, end_date, abono_dias, adiantar_decimo_terceiro,
      aquisitivo_inicio, aquisitivo_fim, snap_admission_date,
      snap_full_name, snap_employee_code,
      snap_department_id, snap_department_name,
      snap_subdepartment_id, snap_subdepartment_name,
      snap_position_id, snap_position_name,
      snap_manager_id, snap_manager_name,
      snap_unit_id, snap_unit_name, snap_hierarchy_name,
      created_by, lancada_pelo_gestor,
      decided_at, decided_by,
      em_dobro, justificativa_dobro)
    values (
      p_tenant, p_user, p_status,
      (e->>'inicio')::date, (e->>'fim')::date,
      coalesce((e->>'abono')::int, 0), coalesce((e->>'decimo')::boolean, false),
      (e->>'aquisitivo_inicio')::date, (e->>'aquisitivo_fim')::date,
      (p_snaps->>'admission_date')::date,
      p_snaps->>'full_name', p_snaps->>'employee_code',
      (p_snaps->>'department_id')::uuid, p_snaps->>'department_name',
      (p_snaps->>'subdepartment_id')::uuid, p_snaps->>'subdepartment_name',
      (p_snaps->>'position_id')::uuid, p_snaps->>'position_name',
      (p_snaps->>'manager_id')::uuid, p_snaps->>'manager_name',
      (p_snaps->>'unit_id')::uuid, p_snaps->>'unit_name', p_snaps->>'hierarchy_name',
      (select auth.uid()), p_lancada,
      case when p_status = 'aprovada' then now() end,
      case when p_status = 'aprovada' then (select auth.uid()) end,
      coalesce((e->>'em_dobro')::boolean, false),
      case when coalesce((e->>'em_dobro')::boolean, false) then e->>'justificativa_dobro' end);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

revoke execute on function public.ferias_criar_linhas(uuid, uuid, jsonb, jsonb, public.ferias_status, boolean)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Lançar: o DP pode lançar férias em dobro, com justificativa
-- ---------------------------------------------------------------------------
drop function if exists public.ferias_lancar(uuid, uuid, jsonb, date);

create function public.ferias_lancar(
  p_tenant uuid, p_user uuid, p_periodos jsonb, p_hoje date default current_date,
  p_justificativa_dobro text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_s jsonb;
  v_val jsonb;
  v_n int;
  v_dp uuid[];
  v_eh_dp boolean;
  v_just text := nullif(btrim(coalesce(p_justificativa_dobro, '')), '');
begin
  v_eh_dp := public.has_tenant_role(p_tenant, '{owner,admin,hr}'::public.member_role[]);
  if not public.manages_user(p_user, p_tenant) and not v_eh_dp then
    raise exception 'Apenas o gestor do colaborador ou o departamento pessoal lançam a previsão de férias.';
  end if;
  if v_just is not null and not v_eh_dp then
    raise exception 'Só o departamento pessoal lança férias em dobro.';
  end if;

  v_s := public.ferias_montar_snaps(p_tenant, p_user);
  if v_s is null or not coalesce((v_s->>'is_active')::boolean, false) then
    raise exception 'Vínculo não encontrado nesta empresa.';
  end if;
  if v_s->>'admission_date' is null then
    raise exception 'A data de admissão deste colaborador não está cadastrada. Peça ao departamento pessoal.';
  end if;

  v_val := public.ferias_validar_periodos(p_tenant, p_user, p_periodos, p_hoje, null, v_just is not null);

  -- a justificativa vai só nos períodos que de fato passam do prazo
  if v_just is not null then
    select coalesce(jsonb_agg(
             case when coalesce((t.e->>'em_dobro')::boolean, false)
                  then t.e || jsonb_build_object('justificativa_dobro', v_just)
                  else t.e end
             order by t.o), '[]'::jsonb)
      into v_val
      from jsonb_array_elements(v_val) with ordinality as t(e, o);
  end if;

  v_n := public.ferias_criar_linhas(p_tenant, p_user, v_val, v_s, 'aprovada', true);

  if p_user is distinct from (select auth.uid()) then
    perform public.notify_users_sistema(
      p_tenant, array[p_user], 'ferias_lancada',
      'Suas férias foram programadas',
      v_n || ' período(s) a partir de ' ||
      to_char((v_val->0->>'inicio')::date, 'DD/MM/YYYY') ||
      ', aguardando a efetivação do departamento pessoal.');
  end if;

  v_dp := array_remove(public.ferias_destinatarios_dp(p_tenant), (select auth.uid()));
  if v_dp is not null and array_length(v_dp, 1) > 0 then
    perform public.notify_users_sistema(
      p_tenant, v_dp, 'ferias_aguardando_efetivacao',
      'Férias aguardando efetivação',
      coalesce(v_s->>'full_name', 'Colaborador') || ': previsão lançada pelo gestor a partir de ' ||
      to_char((v_val->0->>'inicio')::date, 'DD/MM/YYYY') || '.');
  end if;
end;
$function$;

revoke execute on function public.ferias_lancar(uuid, uuid, jsonb, date, text) from public, anon;

-- ---------------------------------------------------------------------------
-- 6. Efetivar: a regra vale até a última etapa
-- ---------------------------------------------------------------------------
-- Entre a aprovação e a efetivação pode ter chegado um relatório novo da folha
-- (mais dias gozados, aquisitivo deslocado). Efetivar é o que transforma a
-- previsão em fato, então saldo e prazo são conferidos de novo aqui.
create or replace function public.ferias_efetivar(
  p_id uuid, p_desconta_rv boolean default true, p_nota text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_l record;
  v_o record;
  v_c record;
  v_aq record;
  v_extra int := 0;
  v_aus uuid;
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
  v_avisar uuid[];
begin
  select f.* into v_l from public.ferias_solicitacoes f where f.id = p_id;
  if v_l.id is null then
    raise exception 'Previsão não encontrada.';
  end if;
  if not public.has_tenant_role(v_l.tenant_id, '{owner,admin,hr}'::public.member_role[]) then
    raise exception 'Apenas o departamento pessoal efetiva férias.';
  end if;
  if v_l.status <> 'aprovada' then
    raise exception 'Esta previsão não está aguardando efetivação.';
  end if;

  select a.* into v_aq
    from public.ferias_periodos_aquisitivos(v_l.tenant_id, v_l.user_id, current_date, p_id) a
   where a.aq_inicio = v_l.aquisitivo_inicio;
  if v_aq.aq_inicio is null then
    raise exception 'O período aquisitivo desta previsão (% a %) não consta nos dados da folha. Devolva a previsão para ser lançada de novo.',
      to_char(v_l.aquisitivo_inicio, 'DD/MM/YYYY'), to_char(v_l.aquisitivo_fim, 'DD/MM/YYYY');
  end if;
  -- no reagendamento, a original efetivada ainda ocupa o saldo até a troca
  if v_l.reagendada_de is not null then
    select coalesce(sum(o.dias + o.abono_dias), 0)::int into v_extra
      from public.ferias_solicitacoes o
     where o.id = v_l.reagendada_de and o.status = 'efetivada'
       and o.aquisitivo_inicio = v_l.aquisitivo_inicio
       and (v_aq.referencia is null or o.start_date > v_aq.referencia);
  end if;
  if v_l.dias + v_l.abono_dias > v_aq.saldo + v_extra then
    raise exception 'O aquisitivo %/% tem % dia(s) de saldo, menos que os % desta previsão. Os dados da folha mudaram depois da aprovação: devolva a previsão para correção.',
      extract(year from v_aq.aq_inicio)::int, extract(year from v_aq.aq_fim)::int,
      v_aq.saldo + v_extra, v_l.dias + v_l.abono_dias;
  end if;
  if v_l.end_date > v_aq.concessivo_fim and not v_l.em_dobro then
    raise exception 'Esta previsão termina depois do prazo de concessão do aquisitivo (%). Devolva para correção, ou cancele e lance de novo como férias em dobro.',
      to_char(v_aq.concessivo_fim, 'DD/MM/YYYY');
  end if;

  -- daqui em diante a escrita em employee_absences é do módulo, e a trava do
  -- registro direto (que só aceita histórico) deixa passar
  perform set_config('ferias.via_modulo', '1', true);

  if v_l.reagendada_de is not null then
    select f.* into v_o from public.ferias_solicitacoes f where f.id = v_l.reagendada_de;
    if v_o.id is not null and v_o.status = 'efetivada' then
      v_aus := v_o.absence_id;
      update public.ferias_solicitacoes
         set status = 'reagendada', absence_id = null, updated_at = now()
       where id = v_o.id;
      if v_aus is not null then
        delete from public.employee_absences where id = v_aus;
      end if;
      v_aus := null;
    end if;
  end if;

  select e.start_date, e.end_date into v_c
    from public.employee_absences e
   where e.tenant_id = v_l.tenant_id
     and e.user_id = v_l.user_id
     and daterange(e.start_date, e.end_date, '[]')
      && daterange(v_l.start_date, v_l.end_date, '[]')
   limit 1;
  if found then
    raise exception 'O período de % a % cruza com uma ausência já lançada de % a %. Ajuste as datas ou corrija o período em Configurações, na aba Colaboradores.',
      to_char(v_l.start_date, 'DD/MM/YYYY'), to_char(v_l.end_date, 'DD/MM/YYYY'),
      to_char(v_c.start_date, 'DD/MM/YYYY'), to_char(v_c.end_date, 'DD/MM/YYYY');
  end if;

  begin
    insert into public.employee_absences (
      tenant_id, user_id, kind, start_date, end_date, discounts_rv, note, created_by)
    values (
      v_l.tenant_id, v_l.user_id, 'ferias', v_l.start_date, v_l.end_date,
      coalesce(p_desconta_rv, true),
      case when v_l.em_dobro then 'Férias (em dobro)' else 'Férias' end,
      (select auth.uid()))
    returning id into v_aus;
  exception when exclusion_violation then
    select e.start_date, e.end_date into v_c
      from public.employee_absences e
     where e.tenant_id = v_l.tenant_id
       and e.user_id = v_l.user_id
       and daterange(e.start_date, e.end_date, '[]')
        && daterange(v_l.start_date, v_l.end_date, '[]')
     limit 1;
    raise exception 'O período de % a % cruza com uma ausência já lançada de % a %.',
      to_char(v_l.start_date, 'DD/MM/YYYY'), to_char(v_l.end_date, 'DD/MM/YYYY'),
      to_char(v_c.start_date, 'DD/MM/YYYY'), to_char(v_c.end_date, 'DD/MM/YYYY');
  end;

  perform set_config('ferias.via_modulo', '', true);

  update public.ferias_solicitacoes
     set status = 'efetivada', absence_id = v_aus,
         efetivada_at = now(), efetivada_by = (select auth.uid()),
         efetivacao_note = v_nota, updated_at = now()
   where id = p_id;

  v_avisar := array_remove(
    array[v_l.user_id, v_l.created_by, v_l.snap_manager_id], (select auth.uid()));
  if array_length(v_avisar, 1) > 0 then
    perform public.notify_users_sistema(
      v_l.tenant_id, v_avisar, 'ferias_efetivada',
      'Férias efetivadas',
      coalesce(v_l.snap_full_name, 'Colaborador') || ': ' ||
      to_char(v_l.start_date, 'DD/MM/YYYY') || ' a ' || to_char(v_l.end_date, 'DD/MM/YYYY') ||
      ' confirmadas pelo departamento pessoal.');
  end if;
end;
$function$;

revoke execute on function public.ferias_efetivar(uuid, boolean, text) from public, anon;

-- ---------------------------------------------------------------------------
-- 7. Guarda das transições: a importação reatribui aquisitivos
-- ---------------------------------------------------------------------------
create or replace function public.guard_ferias_solicitacao()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_dp     boolean;
  v_adm    boolean;
  v_gestor boolean;
  v_dono   boolean;
begin
  -- A importação da folha reatribui o aquisitivo das previsões que começam
  -- depois do relatório (o aquisitivo da folha pode não ser o que a admissão
  -- sugeria). É a única escrita que entra aqui sem ser transição de status, e
  -- ela não toca em mais nada além do par de datas do aquisitivo.
  if coalesce(current_setting('ferias.reconciliando', true), '') = '1'
     and new.status = old.status
     and new.start_date = old.start_date and new.end_date = old.end_date
     and new.user_id = old.user_id then
    return new;
  end if;

  v_dp     := public.has_tenant_role(old.tenant_id, '{owner,admin,hr}'::public.member_role[]);
  v_adm    := public.has_tenant_role(old.tenant_id, '{owner,admin}'::public.member_role[]);
  v_gestor := public.manages_user(old.user_id, old.tenant_id);
  v_dono   := old.created_by = (select auth.uid());

  if old.status not in ('solicitada', 'reprovada') and (
       new.user_id is distinct from old.user_id
       or new.start_date is distinct from old.start_date
       or new.end_date is distinct from old.end_date
       or new.abono_dias is distinct from old.abono_dias
       or new.adiantar_decimo_terceiro is distinct from old.adiantar_decimo_terceiro
       or new.aquisitivo_inicio is distinct from old.aquisitivo_inicio
       or new.aquisitivo_fim is distinct from old.aquisitivo_fim
       or new.snap_admission_date is distinct from old.snap_admission_date
       or new.reagendada_de is distinct from old.reagendada_de
       or new.snap_full_name is distinct from old.snap_full_name
       or new.snap_department_name is distinct from old.snap_department_name
       or new.snap_manager_id is distinct from old.snap_manager_id
       or new.snap_unit_id is distinct from old.snap_unit_id
       or new.em_dobro is distinct from old.em_dobro
       or new.justificativa_dobro is distinct from old.justificativa_dobro)
  then
    raise exception 'Esta previsão já está em trâmite. Peça a devolução para corrigir.';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'solicitada' and new.status = 'aprovada'  and (v_gestor or v_dp))
      or (old.status = 'solicitada' and new.status = 'reprovada' and (v_gestor or v_dp))
      or (old.status = 'solicitada' and new.status = 'cancelada' and (v_dono or v_gestor or v_dp))
      or (old.status = 'reprovada'  and new.status = 'solicitada' and v_dono)
      or (old.status = 'reprovada'  and new.status = 'cancelada'  and (v_dono or v_gestor or v_dp))
      or (old.status = 'aprovada'   and new.status = 'efetivada'  and v_dp)
      or (old.status = 'aprovada'   and new.status = 'reprovada'  and v_dp)
      or (old.status = 'aprovada'   and new.status = 'cancelada'  and (v_gestor or v_dp))
      or (old.status = 'efetivada'  and new.status = 'reagendada' and v_dp)
      or (old.status = 'efetivada'  and new.status = 'cancelada'  and v_adm)
    ) then
      raise exception 'Transição de status inválida.';
    end if;
  elsif old.status in ('reagendada', 'cancelada') then
    raise exception 'Esta previsão já foi encerrada. Não é possível alterá-la.';
  end if;

  return new;
end;
$function$;

revoke execute on function public.guard_ferias_solicitacao() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Importação do relatório da folha
-- ---------------------------------------------------------------------------
-- p_pessoas: [{ user_id, nome, periodos: [{ aq_inicio, aq_fim, gozados,
--   restantes, proporcionais, limite, afastamento, faltas }] }]
--
-- Quem vem no relatório tem os aquisitivos SUBSTITUÍDOS; quem não vem fica com
-- o que foi importado antes. Relatório mais velho que o último importado é
-- recusado: ele apagaria dias gozados que a folha já conhece.
create or replace function public.ferias_importar_aquisitivos(
  p_tenant uuid, p_referencia date, p_data_base date, p_arquivo text,
  p_pessoas jsonb, p_recusadas jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_imp uuid;
  v_mais_nova date;
  v_p jsonb;
  v_q jsonb;
  v_user uuid;
  v_nome text;
  v_ini date; v_fim date; v_lim date; v_conc date;
  v_goz int; v_rest int;
  v_n_pessoas int := 0;
  v_n_periodos int := 0;
  v_reatribuidas int := 0;
  v_conflitos jsonb := '[]'::jsonb;
  k_ini date[]; k_fim date[]; k_saldo int[];
  v_k int;
  v_cabe boolean;
  f record;
begin
  if not public.has_tenant_role(p_tenant, '{owner,admin,hr}'::public.member_role[]) then
    raise exception 'Apenas o departamento pessoal importa os períodos aquisitivos da folha.';
  end if;
  if p_referencia is null or p_referencia > current_date + 1 then
    raise exception 'A data de emissão do relatório não foi reconhecida.';
  end if;
  if p_pessoas is null or jsonb_typeof(p_pessoas) <> 'array' or jsonb_array_length(p_pessoas) = 0 then
    raise exception 'Nenhum colaborador para importar.';
  end if;

  select max(i.referencia) into v_mais_nova
    from public.ferias_importacoes i where i.tenant_id = p_tenant;
  if v_mais_nova is not null and p_referencia < v_mais_nova then
    raise exception 'Já foi importado um relatório mais recente, emitido em %. Importe um relatório emitido nessa data ou depois.',
      to_char(v_mais_nova, 'DD/MM/YYYY');
  end if;

  insert into public.ferias_importacoes (tenant_id, referencia, data_base, arquivo, recusadas, created_by)
  values (p_tenant, p_referencia, p_data_base, left(coalesce(p_arquivo, ''), 200),
          coalesce(p_recusadas, '[]'::jsonb), (select auth.uid()))
  returning id into v_imp;

  for v_p in select * from jsonb_array_elements(p_pessoas) loop
    v_user := (v_p->>'user_id')::uuid;
    v_nome := coalesce(v_p->>'nome', 'Colaborador');
    if v_user is null or not exists (
      select 1 from public.memberships m where m.tenant_id = p_tenant and m.user_id = v_user) then
      raise exception '% não pertence a esta empresa.', v_nome;
    end if;
    if jsonb_typeof(v_p->'periodos') <> 'array' or jsonb_array_length(v_p->'periodos') = 0 then
      raise exception '% veio sem período aquisitivo no relatório.', v_nome;
    end if;

    delete from public.ferias_aquisitivos a where a.tenant_id = p_tenant and a.user_id = v_user;

    for v_q in select * from jsonb_array_elements(v_p->'periodos') loop
      v_ini := (v_q->>'aq_inicio')::date;
      v_fim := (v_q->>'aq_fim')::date;
      v_goz := coalesce((v_q->>'gozados')::int, 0);
      v_rest := (v_q->>'restantes')::int;
      v_lim := (v_q->>'limite')::date;
      if v_ini is null or v_fim is null or v_fim < v_ini
         or v_rest is null or v_rest < 0 or v_goz < 0 or v_goz + v_rest > 30 then
        raise exception 'O período aquisitivo de % não foi reconhecido (% a %). Confira o relatório.',
          v_nome, coalesce(to_char(v_ini, 'DD/MM/YYYY'), '?'), coalesce(to_char(v_fim, 'DD/MM/YYYY'), '?');
      end if;
      -- o limite da folha é o último dia para COMEÇAR o saldo restante; o
      -- último dia de gozo é ele mais os restantes
      v_conc := case
        when v_lim is not null and v_rest > 0 then v_lim + v_rest - 1
        else (v_fim + interval '1 year')::date
      end;

      insert into public.ferias_aquisitivos (
        tenant_id, user_id, importacao_id, referencia, aq_inicio, aq_fim,
        dias_direito, dias_gozados, dias_proporcionais, limite_gozo, concessivo_fim,
        dias_afastamento, dias_faltas)
      values (
        p_tenant, v_user, v_imp, p_referencia, v_ini, v_fim,
        v_goz + v_rest, v_goz, (v_q->>'proporcionais')::numeric, v_lim, v_conc,
        (v_q->>'afastamento')::int, (v_q->>'faltas')::int);
      v_n_periodos := v_n_periodos + 1;
    end loop;
    v_n_pessoas := v_n_pessoas + 1;

    -- Reatribui as previsões que a folha ainda não viu ao aquisitivo da folha,
    -- no mesmo FIFO da validação. O que não couber continua contando (para o
    -- saldo nunca ficar maior do que é) e volta na lista de conflitos.
    select array_agg(a.aq_inicio order by a.aq_inicio),
           array_agg(a.aq_fim order by a.aq_inicio),
           array_agg(a.dias_direito - a.dias_gozados order by a.aq_inicio)
      into k_ini, k_fim, k_saldo
      from public.ferias_aquisitivos a
     where a.tenant_id = p_tenant and a.user_id = v_user;

    perform set_config('ferias.reconciliando', '1', true);
    for f in
      select s.id, s.start_date, s.end_date, s.dias, s.abono_dias, s.aquisitivo_inicio, s.snap_full_name
        from public.ferias_solicitacoes s
       where s.tenant_id = p_tenant and s.user_id = v_user
         and s.status in ('solicitada', 'aprovada', 'efetivada')
         and s.start_date > p_referencia
       order by s.start_date, s.created_at
    loop
      v_k := null;
      for k in 1..array_length(k_ini, 1) loop
        if k_saldo[k] > 0 then v_k := k; exit; end if;
      end loop;
      v_cabe := v_k is not null
        and k_fim[v_k] < f.start_date
        and k_saldo[v_k] >= f.dias + f.abono_dias;
      if v_k is null then
        v_k := array_length(k_ini, 1);
      end if;
      k_saldo[v_k] := k_saldo[v_k] - (f.dias + f.abono_dias);
      if f.aquisitivo_inicio is distinct from k_ini[v_k] then
        update public.ferias_solicitacoes
           set aquisitivo_inicio = k_ini[v_k], aquisitivo_fim = k_fim[v_k], updated_at = now()
         where id = f.id;
        v_reatribuidas := v_reatribuidas + 1;
      end if;
      if not v_cabe then
        v_conflitos := v_conflitos || jsonb_build_object(
          'id', f.id, 'nome', coalesce(f.snap_full_name, v_nome),
          'inicio', f.start_date, 'fim', f.end_date);
      end if;
    end loop;
    perform set_config('ferias.reconciliando', '', true);
  end loop;

  update public.ferias_importacoes
     set pessoas = v_n_pessoas, periodos = v_n_periodos
   where id = v_imp;

  return jsonb_build_object(
    'pessoas', v_n_pessoas,
    'periodos', v_n_periodos,
    'reatribuidas', v_reatribuidas,
    'conflitos', v_conflitos);
end;
$function$;

revoke execute on function public.ferias_importar_aquisitivos(uuid, date, date, text, jsonb, jsonb) from public, anon;

-- O que a tela precisa saber: se a empresa usa a folha (todo membro) e, para o
-- DP, quando e por quem foi a última importação.
create or replace function public.ferias_situacao_importacao(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_i record;
begin
  if not public.is_tenant_member(p_tenant) then
    raise exception 'Você não é membro desta empresa.';
  end if;

  select i.*, p.full_name as por
    into v_i
    from public.ferias_importacoes i
    left join public.profiles p on p.id = i.created_by
   where i.tenant_id = p_tenant
   order by i.referencia desc, i.created_at desc
   limit 1;

  if v_i.id is null then
    return jsonb_build_object('usaFolha', false, 'ultima', null);
  end if;
  if not public.has_tenant_role(p_tenant, '{owner,admin,hr}'::public.member_role[]) then
    return jsonb_build_object('usaFolha', true, 'ultima', null);
  end if;
  return jsonb_build_object(
    'usaFolha', true,
    'ultima', jsonb_build_object(
      'referencia', v_i.referencia,
      'dataBase', v_i.data_base,
      'importadoEm', v_i.created_at,
      'importadoPor', v_i.por,
      'pessoas', v_i.pessoas,
      'periodos', v_i.periodos));
end;
$function$;

revoke execute on function public.ferias_situacao_importacao(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- 9. Registro direto (Configurações): só histórico
-- ---------------------------------------------------------------------------
-- A data de corte de uma pessoa é a emissão do relatório em que ela veio; quem
-- não veio em nenhum usa o relatório mais recente da empresa. Empresa que nunca
-- importou não tem corte (nada muda para ela).
create or replace function public.ferias_corte_historico(p_tenant uuid, p_user uuid)
returns date
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select max(a.referencia) from public.ferias_aquisitivos a
      where a.tenant_id = p_tenant and a.user_id = p_user),
    (select max(i.referencia) from public.ferias_importacoes i
      where i.tenant_id = p_tenant));
$function$;

revoke execute on function public.ferias_corte_historico(uuid, uuid) from public, anon, authenticated;

-- O mesmo corte em lote, para a importação de ausências avisar linha a linha
-- em vez de cair inteira no gatilho.
create or replace function public.ferias_cortes_historico(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_padrao date;
  v_pessoas jsonb;
begin
  if not public.has_tenant_role(p_tenant, '{owner,admin,hr}'::public.member_role[]) then
    raise exception 'Apenas o departamento pessoal consulta o corte do histórico de férias.';
  end if;
  select max(i.referencia) into v_padrao from public.ferias_importacoes i where i.tenant_id = p_tenant;
  select coalesce(jsonb_object_agg(x.user_id, x.ref), '{}'::jsonb) into v_pessoas
    from (select a.user_id, max(a.referencia) as ref
            from public.ferias_aquisitivos a
           where a.tenant_id = p_tenant
           group by a.user_id) x;
  return jsonb_build_object('padrao', v_padrao, 'pessoas', v_pessoas);
end;
$function$;

revoke execute on function public.ferias_cortes_historico(uuid) from public, anon;

create or replace function public.guard_ferias_registro_direto()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_corte date;
begin
  -- escrita do servidor (chave de serviço, migração, rotina) e do próprio
  -- módulo Férias passam: a trava é para o registro feito à mão
  if (select auth.uid()) is null
     or coalesce(current_setting('ferias.via_modulo', true), '') = '1' then
    return coalesce(new, old);
  end if;

  -- férias que nasceram no módulo só mudam pelo módulo
  if tg_op in ('UPDATE', 'DELETE') and old.kind = 'ferias'
     and exists (select 1 from public.ferias_solicitacoes f where f.absence_id = old.id) then
    if tg_op = 'DELETE'
       or new.kind is distinct from old.kind
       or new.user_id is distinct from old.user_id
       or new.start_date is distinct from old.start_date
       or new.end_date is distinct from old.end_date then
      raise exception 'Estas férias vieram do módulo Férias e só se alteram por lá.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.kind <> 'ferias' then
    return new;
  end if;
  -- só a mudança que interessa: editar a observação de uma férias antiga não
  -- passa pela trava
  if tg_op = 'UPDATE' and old.kind = 'ferias'
     and new.start_date = old.start_date and new.end_date = old.end_date
     and new.user_id = old.user_id then
    return new;
  end if;

  v_corte := public.ferias_corte_historico(new.tenant_id, new.user_id);
  if v_corte is not null and new.start_date >= v_corte then
    raise exception 'Férias a partir de % só entram pelo módulo Férias, que confere o saldo e o prazo da folha. O registro direto aceita apenas férias anteriores ao último relatório importado da folha.',
      to_char(v_corte, 'DD/MM/YYYY');
  end if;
  return new;
end;
$function$;

revoke execute on function public.guard_ferias_registro_direto() from public, anon, authenticated;

drop trigger if exists employee_absences_ferias_so_historico on public.employee_absences;
create trigger employee_absences_ferias_so_historico
  before insert or update or delete on public.employee_absences
  for each row execute function public.guard_ferias_registro_direto();

-- ---------------------------------------------------------------------------
-- 10. Informativo da efetivação e painel: o que veio da folha
-- ---------------------------------------------------------------------------
create or replace function public.ferias_contexto_efetivacao(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_l record;
  v_faltas_qtd int;
  v_faltas_dias int;
  v_direito int;
  v_saldo record;
  v_irmas jsonb;
begin
  select f.* into v_l from public.ferias_solicitacoes f where f.id = p_id;
  if v_l.id is null then
    raise exception 'Previsão não encontrada.';
  end if;
  if not public.has_tenant_role(v_l.tenant_id, '{owner,admin,hr}'::public.member_role[]) then
    raise exception 'Apenas o departamento pessoal consulta o contexto de efetivação.';
  end if;

  select count(*)::int, coalesce(sum(e.end_date - e.start_date + 1), 0)::int
    into v_faltas_qtd, v_faltas_dias
    from public.employee_absences e
   where e.tenant_id = v_l.tenant_id
     and e.user_id = v_l.user_id
     and e.kind = 'falta'
     and not e.waived
     and daterange(e.start_date, e.end_date, '[]')
      && daterange(v_l.aquisitivo_inicio, v_l.aquisitivo_fim, '[]');

  v_direito := case
    when v_faltas_dias <= 5 then 30
    when v_faltas_dias <= 14 then 24
    when v_faltas_dias <= 23 then 18
    when v_faltas_dias <= 32 then 12
    else 0
  end;

  select a.saldo, a.abono_usado, a.qtd_periodos, a.situacao, a.concessivo_fim,
         a.dias_direito, a.origem, a.referencia, a.gozados_folha
    into v_saldo
    from public.ferias_periodos_aquisitivos(v_l.tenant_id, v_l.user_id) a
   where a.aq_inicio = v_l.aquisitivo_inicio;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id, 'inicio', f.start_date, 'fim', f.end_date,
           'dias', f.dias, 'abono', f.abono_dias, 'status', f.status)
           order by f.start_date), '[]'::jsonb)
    into v_irmas
    from public.ferias_solicitacoes f
   where f.tenant_id = v_l.tenant_id and f.user_id = v_l.user_id
     and f.aquisitivo_inicio = v_l.aquisitivo_inicio
     and f.id <> p_id
     and f.status in ('solicitada', 'aprovada', 'efetivada');

  return jsonb_build_object(
    'faltasQtd', v_faltas_qtd,
    'faltasDias', v_faltas_dias,
    'direitoArt130', v_direito,
    'saldo', v_saldo.saldo,
    'abonoUsado', v_saldo.abono_usado,
    'qtdPeriodos', v_saldo.qtd_periodos,
    'situacao', v_saldo.situacao,
    'concessivoFim', v_saldo.concessivo_fim,
    'origem', v_saldo.origem,
    'direitoFolha', case when v_saldo.origem = 'folha' then v_saldo.dias_direito end,
    'gozadosFolha', case when v_saldo.origem = 'folha' then v_saldo.gozados_folha end,
    'referencia', v_saldo.referencia,
    'irmas', v_irmas);
end;
$function$;

revoke execute on function public.ferias_contexto_efetivacao(uuid) from public, anon;

create or replace function public.ferias_painel(
  p_tenant uuid, p_hoje date default current_date, p_unit_ids uuid[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_ids uuid[];
  v_janela_ini date;
  v_janela_fim date;
  v_agora jsonb;
  v_proximas jsonb;
  v_timeline jsonb;
  v_saldos jsonb;
  v_usa_folha boolean;
begin
  if not public.is_tenant_member(p_tenant) then
    raise exception 'Você não é membro desta empresa.';
  end if;

  if public.has_tenant_role(p_tenant, '{owner,admin,hr,manager}'::public.member_role[]) then
    select array_agg(m.user_id) into v_ids
      from public.memberships m
     where m.tenant_id = p_tenant and m.is_active;
  else
    select array_agg(distinct x.user_id) into v_ids
      from (
        select mm.user_id from public.my_managed_memberships() mm where mm.tenant_id = p_tenant
        union select v_uid
      ) x;
  end if;

  if p_unit_ids is not null then
    select array_agg(distinct m.user_id) into v_ids
      from public.memberships m
      join public.membership_units mu on mu.membership_id = m.id
     where m.tenant_id = p_tenant
       and m.user_id = any(coalesce(v_ids, '{}'))
       and mu.unit_id = any(p_unit_ids);
  end if;
  v_ids := coalesce(v_ids, '{}');

  v_usa_folha := exists (select 1 from public.ferias_importacoes i where i.tenant_id = p_tenant);

  v_janela_ini := date_trunc('month', p_hoje)::date;
  v_janela_fim := (date_trunc('month', p_hoje) + interval '6 months' - interval '1 day')::date;

  select coalesce(jsonb_agg(jsonb_build_object(
           'userId', x.user_id, 'nome', x.nome, 'setor', x.setor,
           'inicio', x.start_date, 'fim', x.end_date) order by x.end_date), '[]'::jsonb)
    into v_agora
    from (
      select e.user_id, p.full_name as nome, d.name as setor, e.start_date, e.end_date
        from public.employee_absences e
        join public.memberships m on m.tenant_id = e.tenant_id and m.user_id = e.user_id
        join public.profiles p on p.id = e.user_id
        left join public.departments d on d.id = m.department_id
       where e.tenant_id = p_tenant and e.kind = 'ferias'
         and e.user_id = any(v_ids)
         and p_hoje between e.start_date and e.end_date
    ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'userId', x.user_id, 'nome', x.nome, 'inicio', x.inicio, 'fim', x.fim,
           'origem', x.origem) order by x.inicio), '[]'::jsonb)
    into v_proximas
    from (
      select e.user_id, p.full_name as nome, e.start_date as inicio, e.end_date as fim,
             'efetivada' as origem
        from public.employee_absences e
        join public.profiles p on p.id = e.user_id
       where e.tenant_id = p_tenant and e.kind = 'ferias' and e.user_id = any(v_ids)
         and e.start_date > p_hoje and e.start_date <= p_hoje + 60
      union all
      select f.user_id, p.full_name, f.start_date, f.end_date, 'prevista'
        from public.ferias_solicitacoes f
        join public.profiles p on p.id = f.user_id
       where f.tenant_id = p_tenant and f.status = 'aprovada' and f.user_id = any(v_ids)
         and f.start_date > p_hoje and f.start_date <= p_hoje + 60
    ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'userId', g.user_id, 'nome', g.nome, 'itens', g.itens) order by g.nome), '[]'::jsonb)
    into v_timeline
    from (
      select y.user_id, y.nome,
             jsonb_agg(jsonb_build_object('inicio', y.inicio, 'fim', y.fim, 'tipo', y.tipo)
                       order by y.inicio) as itens
        from (
          select e.user_id, p.full_name as nome, e.start_date as inicio, e.end_date as fim,
                 'efetivada' as tipo
            from public.employee_absences e
            join public.profiles p on p.id = e.user_id
           where e.tenant_id = p_tenant and e.kind = 'ferias' and e.user_id = any(v_ids)
             and daterange(e.start_date, e.end_date, '[]')
              && daterange(v_janela_ini, v_janela_fim, '[]')
          union all
          select f.user_id, p.full_name, f.start_date, f.end_date, 'prevista'
            from public.ferias_solicitacoes f
            join public.profiles p on p.id = f.user_id
           where f.tenant_id = p_tenant and f.status in ('solicitada', 'aprovada')
             and f.user_id = any(v_ids)
             and daterange(f.start_date, f.end_date, '[]')
              && daterange(v_janela_ini, v_janela_fim, '[]')
        ) y
       group by y.user_id, y.nome
    ) g;

  -- Saldo por pessoa: o AQUISITIVO FIFO (o mais antigo com saldo), que é o
  -- próximo a programar. `semFolha`: a empresa importa da folha e esta pessoa
  -- não veio no relatório, então não há saldo confiável (não é "em dia").
  select coalesce(jsonb_agg(jsonb_build_object(
           'userId', z.user_id, 'nome', z.full_name, 'setor', z.setor,
           'saldo', coalesce(z.saldo, 0), 'situacao', z.situacao,
           'aquisitivoInicio', z.aq_inicio, 'aquisitivoFim', z.aq_fim,
           'gozarAte', z.concessivo_fim, 'semFolha', z.sem_folha)
           order by (z.situacao = 'vencida') desc nulls last,
                    (z.situacao = 'a_vencer') desc nulls last,
                    z.sem_folha desc, z.full_name), '[]'::jsonb)
    into v_saldos
    from (
      select m.user_id, p.full_name, d.name as setor,
             s.saldo, s.situacao, s.aq_inicio, s.aq_fim, s.concessivo_fim,
             (v_usa_folha and not exists (
                select 1 from public.ferias_aquisitivos a
                 where a.tenant_id = p_tenant and a.user_id = m.user_id)) as sem_folha
        from public.memberships m
        join public.profiles p on p.id = m.user_id
        left join public.departments d on d.id = m.department_id
        left join lateral (
          select a.aq_inicio, a.aq_fim, a.saldo, a.concessivo_fim, a.situacao
            from public.ferias_periodos_aquisitivos(p_tenant, m.user_id, p_hoje) a
           where a.saldo > 0 and a.situacao in ('aberta', 'a_vencer', 'vencida')
           order by a.aq_inicio
           limit 1
        ) s on true
       where m.tenant_id = p_tenant and m.is_active
         and m.user_id = any(v_ids)
         and m.admission_date is not null
    ) z;

  return jsonb_build_object(
    'agora', v_agora,
    'proximas', v_proximas,
    'timeline', v_timeline,
    'saldos', v_saldos,
    'usaFolha', v_usa_folha,
    'janelaInicio', v_janela_ini,
    'janelaFim', v_janela_fim);
end;
$function$;

revoke execute on function public.ferias_painel(uuid, date, uuid[]) from public, anon;

-- ---------------------------------------------------------------------------
-- Conferência das regras do AGENTS.md
-- ---------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_n <> 0 then
    raise exception 'ha % funcoes SECURITY DEFINER alcancaveis por anon', v_n;
  end if;
end $$;

notify pgrst, 'reload schema';
