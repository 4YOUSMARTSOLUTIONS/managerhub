-- O saldo de férias, calculado e nunca materializado.
--
-- O período aquisitivo nasce da data de admissão (`memberships.admission_date`)
-- e anda sozinho com o calendário: materializar viraria uma tabela para manter
-- em dia por trigger e cron. Aqui é uma função que gera as janelas on-the-fly e
-- soma as previsões vivas de cada uma.
--
-- SOLICITADA RESERVA SALDO. Se só a efetivada contasse, duas solicitações em
-- paralelo estourariam os 30 dias e o gestor aprovaria as duas.

create or replace function public.ferias_periodos_aquisitivos(
  p_tenant uuid, p_user uuid, p_hoje date default current_date, p_excluir uuid default null)
returns table (
  aq_inicio date,
  aq_fim date,
  concessivo_fim date,
  dias_direito int,
  dias_usados int,
  abono_usado int,
  saldo int,
  qtd_periodos int,
  situacao text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_adm date;
begin
  if p_user <> (select auth.uid())
     and not public.manages_user(p_user, p_tenant)
     and not public.has_tenant_role(p_tenant, '{owner,admin,hr,manager}'::public.member_role[]) then
    raise exception 'Sem alçada para ver o saldo de férias deste colaborador.';
  end if;

  select m.admission_date into v_adm
    from public.memberships m
   where m.tenant_id = p_tenant and m.user_id = p_user;
  if v_adm is null then
    return; -- sem data de admissão não há aquisitivo; a tela explica
  end if;

  aq_inicio := v_adm;
  while aq_inicio <= p_hoje loop
    aq_fim := (aq_inicio + interval '1 year' - interval '1 day')::date;
    concessivo_fim := (aq_fim + interval '1 year')::date; -- art. 134; depois disso é dobro (art. 137)
    dias_direito := 30; -- a redução por faltas (art. 130) é informativa ao DP, decisão de produto

    select coalesce(sum(f.dias + f.abono_dias), 0), coalesce(sum(f.abono_dias), 0), count(*)::int
      into dias_usados, abono_usado, qtd_periodos
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
$$;

revoke execute on function public.ferias_periodos_aquisitivos(uuid, uuid, date, uuid) from public, anon;
grant execute on function public.ferias_periodos_aquisitivos(uuid, uuid, date, uuid) to authenticated;

-- ============================================================================
-- A validação CLT do conjunto de períodos
-- ============================================================================
--
-- Helper INTERNO (revogado até de authenticated): só as RPCs de solicitar,
-- lançar, reenviar e reagendar chamam, e elas rodam como o dono. Recebe os
-- períodos em jsonb [{inicio, fim, abono, decimo}] e devolve o mesmo conjunto
-- com o aquisitivo de referência resolvido por FIFO; qualquer infração sai como
-- exceção em português.
--
-- `p_excluir` tira UMA linha das contas (e a ausência dela em
-- employee_absences): é o reenvio revalidando a própria linha e o reagendamento
-- ignorando a original que vai substituir.
create or replace function public.ferias_validar_periodos(
  p_tenant uuid, p_user uuid, p_periodos jsonb, p_hoje date, p_excluir uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_n int;
  v_ini date[] := '{}'; v_fim date[] := '{}';
  v_abono int[] := '{}'; v_decimo boolean[] := '{}'; v_dias int[] := '{}';
  aq record;
  aq_ini date[] := '{}'; aq_fim date[] := '{}';
  aq_saldo int[] := '{}'; aq_qtd int[] := '{}'; aq_abono int[] := '{}';
  aq_tem14 boolean[] := '{}'; aq_usado boolean[] := '{}';
  v_excl_abs uuid;
  v_dow int;
  v_choque record;
  v_k int;
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

  -- ordena por início; as regras de vizinhança dependem disso
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

    -- art. 134 §3º: o início não pode cair no descanso nem nos 2 dias que o
    -- antecedem. Com DSR no domingo, sobram segunda a quinta "limpas".
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

  -- FIFO: o aquisitivo aberto mais antigo com saldo paga primeiro. Sem
  -- transbordo automático entre aquisitivos: confundiria a folha.
  for aq in
    select * from public.ferias_periodos_aquisitivos(p_tenant, p_user, p_hoje, p_excluir)
  loop
    aq_ini := aq_ini || aq.aq_inicio; aq_fim := aq_fim || aq.aq_fim;
    aq_saldo := aq_saldo || aq.saldo; aq_qtd := aq_qtd || aq.qtd_periodos;
    aq_abono := aq_abono || aq.abono_usado; aq_usado := aq_usado || false;
    aq_tem14 := aq_tem14 || exists(
      select 1 from public.ferias_solicitacoes f
       where f.tenant_id = p_tenant and f.user_id = p_user
         and f.aquisitivo_inicio = aq.aq_inicio
         and f.status in ('solicitada', 'aprovada', 'efetivada')
         and (p_excluir is null or f.id <> p_excluir)
         and f.dias >= 14);
  end loop;

  if coalesce(array_length(aq_ini, 1), 0) = 0 then
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
      raise exception 'O aquisitivo %/% já tem 3 períodos previstos (art. 134).',
        extract(year from aq_ini[v_k])::int, extract(year from aq_fim[v_k])::int;
    end if;
    if aq_abono[v_k] + v_abono[i] > 10 then
      raise exception 'O abono pecuniário do aquisitivo %/% passaria de 10 dias (art. 143).',
        extract(year from aq_ini[v_k])::int, extract(year from aq_fim[v_k])::int;
    end if;

    aq_saldo[v_k] := aq_saldo[v_k] - v_dias[i] - v_abono[i];
    aq_qtd[v_k] := aq_qtd[v_k] + 1;
    aq_abono[v_k] := aq_abono[v_k] + v_abono[i];
    aq_usado[v_k] := true;
    if v_dias[i] >= 14 then aq_tem14[v_k] := true; end if;

    v_res := v_res || jsonb_build_object(
      'inicio', v_ini[i], 'fim', v_fim[i], 'abono', v_abono[i], 'decimo', v_decimo[i],
      'aquisitivo_inicio', aq_ini[v_k], 'aquisitivo_fim', aq_fim[v_k]);
  end loop;

  -- Invariante do art. 134 §1º: em todo aquisitivo tocado, ou já existe (ou
  -- entrou) um período de 14 dias, ou o saldo restante ainda comporta um.
  for k in 1..array_length(aq_ini, 1) loop
    if aq_usado[k] and not aq_tem14[k] and aq_saldo[k] < 14 then
      raise exception 'Um dos períodos do aquisitivo %/% precisa ter ao menos 14 dias corridos (art. 134): com este pedido restariam só % dias para isso.',
        extract(year from aq_ini[k])::int, extract(year from aq_fim[k])::int, aq_saldo[k];
    end if;
  end loop;

  return v_res;
end;
$$;

revoke execute on function public.ferias_validar_periodos(uuid, uuid, jsonb, date, uuid)
  from public, anon, authenticated;

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
