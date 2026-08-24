-- A efetivação do DP: o único caminho que cria o FATO em `employee_absences`.
--
-- "Efetivar" aqui significa o que o produto pediu: o departamento pessoal
-- confirma que a previsão está calculada na folha. Só então a ausência passa a
-- existir para RV, metas e treinamentos.
--
-- Se a linha é um REAGENDAMENTO (`reagendada_de`), a troca acontece inteira
-- nesta transação: a original vira `reagendada`, solta o vínculo e a ausência
-- antiga morre ANTES de a nova nascer, para liberar o range no caso de
-- reagendamento parcialmente sobreposto.

create or replace function public.ferias_efetivar(
  p_id uuid, p_desconta_rv boolean default true, p_nota text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_l record;
  v_o record;
  v_c record;
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

  -- pré-checagem para o caso comum sair em português; o bloco de exceção cobre
  -- a corrida (molde absenteismo_decidir)
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
    -- `note` leva só a palavra Férias: a coluna é lida por service client em
    -- /metas e congelada em rv_period_snapshots
    insert into public.employee_absences (
      tenant_id, user_id, kind, start_date, end_date, discounts_rv, note, created_by)
    values (
      v_l.tenant_id, v_l.user_id, 'ferias', v_l.start_date, v_l.end_date,
      coalesce(p_desconta_rv, true), 'Férias', (select auth.uid()))
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
$$;

revoke execute on function public.ferias_efetivar(uuid, boolean, text) from public, anon;
grant execute on function public.ferias_efetivar(uuid, boolean, text) to authenticated;

-- ============================================================================
-- O informativo da efetivação
-- ============================================================================
--
-- O que o DP olha antes de confirmar: as faltas injustificadas do aquisitivo e
-- a régua do art. 130 (SÓ EXIBIÇÃO, o saldo não muda sozinho, decisão de
-- produto), o saldo do aquisitivo e os períodos irmãos.
--
-- É RPC, e não select, porque a RLS de `employee_absences` é owner/admin: o RH
-- não lê a tabela pelo PostgREST, e esta é a porta com guarda própria.
create or replace function public.ferias_contexto_efetivacao(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
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

  select a.saldo, a.abono_usado, a.qtd_periodos, a.situacao, a.concessivo_fim
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
    'irmas', v_irmas);
end;
$$;

revoke execute on function public.ferias_contexto_efetivacao(uuid) from public, anon;
grant execute on function public.ferias_contexto_efetivacao(uuid) to authenticated;

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
