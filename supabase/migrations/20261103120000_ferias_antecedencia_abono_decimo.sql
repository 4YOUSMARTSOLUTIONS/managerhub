-- Férias: antecedência mínima do pedido, abono no primeiro período e 13º uma
-- vez por ano.
--
-- Pedidos do LUIZ (03/11/2026):
--
-- 1. ANTECEDÊNCIA MÍNIMA, configurável pela empresa (ex.: 30 dias). O DP
--    precisa de tempo para calcular e pagar as férias (o pagamento sai até 2
--    dias antes do início, art. 145). Vale para o COLABORADOR: o pedido dele, a
--    correção de um pedido dele que voltou, e o reagendamento que ele mesmo
--    faz. O lançamento do gestor e do DP não passa por aqui. O "hoje" da conta é
--    o do servidor (fuso do Brasil), não o que a tela manda.
--
-- 2. ABONO PECUNIÁRIO só no PRIMEIRO período de gozo do aquisitivo (ou no
--    único, sem fracionamento). Primeiro = o aquisitivo não tem nenhum outro
--    período: nem gozo registrado pela folha, nem previsão no módulo, nem um
--    período anterior do mesmo pedido. E um período novo não pode passar à
--    frente de um que já leva o abono.
--
-- 3. ADIANTAMENTO DO 13º uma vez por ano (Lei 4.749/65: a 1ª parcela). Pedido
--    num período, os outros do mesmo ano ficam sem a opção. O ano é o do início
--    do período: férias em janeiro do ano seguinte adiantam o 13º daquele ano.
--
-- As regras 2 e 3 ficam em `ferias_validar_periodos`, por onde passam todos os
-- caminhos de criação (solicitar, lançar, planilha, reenviar, reagendar). A
-- aprovação e a efetivação não revalidam, então nada do que já está em trâmite
-- trava.

-- ---------------------------------------------------------------------------
-- 1. Configuração por empresa
-- ---------------------------------------------------------------------------
create table if not exists public.ferias_config (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  -- 0 = sem antecedência mínima
  antecedencia_minima_dias integer not null default 0,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ferias_config_antecedencia check (antecedencia_minima_dias between 0 and 180)
);

comment on table public.ferias_config is
  'Parâmetros do módulo Férias por empresa. Sem linha = padrões (sem antecedência mínima).';

alter table public.ferias_config enable row level security;
revoke all on table public.ferias_config from public, anon;

drop policy if exists ferias_config_select on public.ferias_config;
create policy ferias_config_select on public.ferias_config
  for select to authenticated using (public.is_tenant_member(tenant_id));
drop policy if exists ferias_config_write on public.ferias_config;
create policy ferias_config_write on public.ferias_config
  for all to authenticated
  using (public.has_tenant_role(tenant_id, '{owner,admin,hr}'::public.member_role[]))
  with check (public.has_tenant_role(tenant_id, '{owner,admin,hr}'::public.member_role[]));

drop trigger if exists audit_ferias_config on public.ferias_config;
create trigger audit_ferias_config
  after insert or update or delete on public.ferias_config
  for each row execute function public.audit_trigger();

-- Cervantes: 30 dias, o exemplo do pedido (e o aviso de férias do art. 135)
insert into public.ferias_config (tenant_id, antecedencia_minima_dias)
values ('373d5ce2-9c41-4cad-bfe7-24b80616ffa9', 30)
on conflict (tenant_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Checagem da antecedência (interna)
-- ---------------------------------------------------------------------------
create or replace function public.ferias_checar_antecedencia(p_tenant uuid, p_inicio date)
returns void
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_min int;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_inicio is null then
    return; -- a validação dos períodos acusa a data em branco
  end if;
  select c.antecedencia_minima_dias into v_min
    from public.ferias_config c where c.tenant_id = p_tenant;
  if coalesce(v_min, 0) > 0 and p_inicio < v_hoje + v_min then
    raise exception 'As férias precisam ser solicitadas com pelo menos % dias de antecedência, para o departamento pessoal calcular e pagar a tempo. O início mais próximo possível é %.',
      v_min, to_char(v_hoje + v_min, 'DD/MM/YYYY');
  end if;
end;
$$;

revoke execute on function public.ferias_checar_antecedencia(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. As três portas do colaborador chamam a checagem
-- ---------------------------------------------------------------------------
do $migr$
declare
  v_def text;
  v_ancora text;
  v_qtd int;
begin
  -- solicitar: sempre é o próprio colaborador
  v_def := pg_get_functiondef('public.ferias_solicitar(uuid, jsonb, date)'::regprocedure);
  v_ancora := '  v_val := public.ferias_validar_periodos(p_tenant, v_uid, p_periodos, p_hoje);';
  v_qtd := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
  if v_qtd <> 1 then raise exception 'ferias_solicitar: âncora encontrada % vezes', v_qtd; end if;
  execute replace(v_def, v_ancora,
    '  perform public.ferias_checar_antecedencia(p_tenant,' || chr(10) ||
    '    (select min((e->>''inicio'')::date) from jsonb_array_elements(p_periodos) e));' || chr(10) ||
    v_ancora);

  -- reenviar: só o pedido do próprio colaborador (o lançado pelo gestor não)
  v_def := pg_get_functiondef('public.ferias_reenviar(uuid, date, date, integer, boolean, date)'::regprocedure);
  v_ancora := '  v_val := public.ferias_validar_periodos(';
  v_qtd := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
  if v_qtd <> 1 then raise exception 'ferias_reenviar: âncora encontrada % vezes', v_qtd; end if;
  execute replace(v_def, v_ancora,
    '  if not v_l.lancada_pelo_gestor then' || chr(10) ||
    '    perform public.ferias_checar_antecedencia(v_l.tenant_id, p_inicio);' || chr(10) ||
    '  end if;' || chr(10) || chr(10) ||
    v_ancora);

  -- reagendar: quando o próprio dono reagenda (e o pedido vai para aprovação)
  v_def := pg_get_functiondef('public.ferias_reagendar(uuid, date, date, integer, boolean, date)'::regprocedure);
  v_qtd := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
  if v_qtd <> 1 then raise exception 'ferias_reagendar: âncora encontrada % vezes', v_qtd; end if;
  execute replace(v_def, v_ancora,
    '  if v_dono and not (v_gestor or v_dp) then' || chr(10) ||
    '    perform public.ferias_checar_antecedencia(v_o.tenant_id, p_inicio);' || chr(10) ||
    '  end if;' || chr(10) || chr(10) ||
    v_ancora);
end
$migr$;

revoke execute on function public.ferias_solicitar(uuid, jsonb, date) from public, anon;
revoke execute on function public.ferias_reenviar(uuid, date, date, integer, boolean, date) from public, anon;
revoke execute on function public.ferias_reagendar(uuid, date, date, integer, boolean, date) from public, anon;

-- ---------------------------------------------------------------------------
-- 4. Validação central: abono no primeiro período, 13º uma vez por ano
-- ---------------------------------------------------------------------------
create or replace function public.ferias_validar_periodos(
  p_tenant uuid, p_user uuid, p_periodos jsonb, p_hoje date,
  p_excluir uuid default null, p_dobro_ok boolean default false
) returns jsonb
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
  aq_ref date[] := '{}'; aq_goz int[] := '{}';
  v_excl_abs uuid;
  v_dow int;
  v_choque record;
  v_k int;
  v_min14 int;
  v_dobro boolean;
  v_res jsonb := '[]'::jsonb;
  r record;
  i int;
  j int;
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

  -- Lei 4.749/65: a 1ª parcela do 13º se adianta uma vez por ano. Pedida num
  -- período, os demais do mesmo ano já não têm o que adiantar.
  for i in 1..v_n loop
    if v_decimo[i] then
      for j in 1..i - 1 loop
        if v_decimo[j] and extract(year from v_ini[j]) = extract(year from v_ini[i]) then
          raise exception 'O adiantamento da 1ª parcela do 13º só pode ser pedido uma vez por ano: deixe marcado apenas o primeiro período de % deste pedido.',
            extract(year from v_ini[i])::int;
        end if;
      end loop;

      select f.start_date, f.end_date into v_choque
        from public.ferias_solicitacoes f
       where f.tenant_id = p_tenant and f.user_id = p_user
         and f.status in ('solicitada', 'aprovada', 'efetivada')
         and (p_excluir is null or f.id <> p_excluir)
         and f.adiantar_decimo_terceiro
         and extract(year from f.start_date) = extract(year from v_ini[i])
       order by f.start_date
       limit 1;
      if found then
        raise exception 'O adiantamento da 1ª parcela do 13º de % já foi pedido nas férias de % a %. Ele é pago uma vez por ano, então este período fica sem a opção.',
          extract(year from v_ini[i])::int,
          to_char(v_choque.start_date, 'DD/MM/YYYY'), to_char(v_choque.end_date, 'DD/MM/YYYY');
      end if;
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
    aq_ref := aq_ref || aq.referencia; aq_goz := aq_goz || coalesce(aq.gozados_folha, 0);
  end loop;

  if coalesce(array_length(aq_ini, 1), 0) = 0 then
    if exists (select 1 from public.ferias_importacoes fi where fi.tenant_id = p_tenant) then
      raise exception 'Os períodos aquisitivos deste colaborador ainda não foram importados, então o saldo não pode ser conferido. Peça ao departamento pessoal.';
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

    -- art. 143: o abono vai no PRIMEIRO período de gozo do aquisitivo. `aq_qtd`
    -- já conta o gozo da folha, as previsões do módulo e os períodos anteriores
    -- deste pedido (o laço anda em ordem de data).
    if v_abono[i] > 0 and aq_qtd[v_k] > 0 then
      select f.start_date, f.end_date into v_choque
        from public.ferias_solicitacoes f
       where f.tenant_id = p_tenant and f.user_id = p_user
         and f.aquisitivo_inicio = aq_ini[v_k]
         and f.status in ('solicitada', 'aprovada', 'efetivada')
         and (p_excluir is null or f.id <> p_excluir)
         and (aq_ref[v_k] is null or f.start_date > aq_ref[v_k])
       order by f.start_date
       limit 1;
      raise exception 'O abono pecuniário só pode ser pedido no primeiro período de gozo do aquisitivo %/% (art. 143), e este não é o primeiro: %.',
        extract(year from aq_ini[v_k])::int, extract(year from aq_fim[v_k])::int,
        case
          when aq_usado[v_k] then 'coloque o abono no período mais cedo deste pedido'
          when found then 'o aquisitivo já tem férias de ' || to_char(v_choque.start_date, 'DD/MM/YYYY')
                          || ' a ' || to_char(v_choque.end_date, 'DD/MM/YYYY')
          else 'a folha já registra ' || aq_goz[v_k] || ' dia(s) gozados dele'
        end;
    end if;
    -- e um período novo não passa à frente do que já leva o abono
    select f.start_date, f.end_date into v_choque
      from public.ferias_solicitacoes f
     where f.tenant_id = p_tenant and f.user_id = p_user
       and f.aquisitivo_inicio = aq_ini[v_k]
       and f.status in ('solicitada', 'aprovada', 'efetivada')
       and (p_excluir is null or f.id <> p_excluir)
       and f.abono_dias > 0
       and f.start_date > v_ini[i]
     order by f.start_date
     limit 1;
    if found then
      raise exception 'O abono pecuniário do aquisitivo %/% está nas férias de % a %, e ele precisa ficar no primeiro período de gozo. Estas férias começariam antes delas: escolha datas depois de %, ou peça ao departamento pessoal para trocar.',
        extract(year from aq_ini[v_k])::int, extract(year from aq_fim[v_k])::int,
        to_char(v_choque.start_date, 'DD/MM/YYYY'), to_char(v_choque.end_date, 'DD/MM/YYYY'),
        to_char(v_choque.end_date, 'DD/MM/YYYY');
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

-- interna: só as funções de criação chamam (já estava fora do alcance do app)
revoke execute on function public.ferias_validar_periodos(uuid, uuid, jsonb, date, uuid, boolean) from public, anon, authenticated;

notify pgrst, 'reload schema';
