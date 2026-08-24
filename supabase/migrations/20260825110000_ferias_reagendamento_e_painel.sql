-- Reagendamento e o painel de férias.
--
-- REAGENDAR É LINHA NOVA: a original efetivada continua de pé enquanto o pedido
-- tramita (o colaborador segue com as férias marcadas), e a troca acontece
-- inteira na transação de `ferias_efetivar` da filha (original -> 'reagendada',
-- ausência antiga morre, nova nasce). O pedido percorre o mesmo caminho da
-- previsão normal: filha do colaborador nasce 'solicitada' (gestor aprova, DP
-- verifica); filha aberta por gestor ou DP nasce 'aprovada' e sobe direto para
-- o DP verificar, que foi o pedido do produto.

create or replace function public.ferias_reagendar(
  p_id uuid, p_inicio date, p_fim date, p_abono int default 0,
  p_decimo boolean default false, p_hoje date default current_date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_o record;
  v_uid uuid := (select auth.uid());
  v_dono boolean;
  v_gestor boolean;
  v_dp boolean;
  v_s jsonb;
  v_val jsonb;
  v_status public.ferias_status;
  v_dp_arr uuid[];
begin
  select f.* into v_o from public.ferias_solicitacoes f where f.id = p_id;
  if v_o.id is null then
    raise exception 'Previsão não encontrada.';
  end if;
  if v_o.status <> 'efetivada' then
    raise exception 'Só férias já efetivadas se reagendam. Antes disso, cancele ou peça a devolução.';
  end if;
  if v_o.start_date <= p_hoje then
    raise exception 'Férias já iniciadas não se reagendam pela tela. Fale com o administrador.';
  end if;
  if exists (
    select 1 from public.ferias_solicitacoes f
     where f.reagendada_de = p_id and f.status in ('solicitada', 'aprovada')) then
    raise exception 'Já existe um reagendamento em andamento para estas férias.';
  end if;

  v_dono := v_o.user_id = v_uid;
  v_gestor := public.manages_user(v_o.user_id, v_o.tenant_id);
  v_dp := public.has_tenant_role(v_o.tenant_id, '{owner,admin,hr}'::public.member_role[]);
  if not (v_dono or v_gestor or v_dp) then
    raise exception 'Previsão não encontrada.';
  end if;
  -- o nível bloqueado também não reagenda sozinho: a mesma regra do solicitar
  if v_dono and not (v_gestor or v_dp) and exists (
    select 1 from public.ferias_niveis_bloqueados b
      join public.memberships m on m.tenant_id = b.tenant_id
       and m.hierarchy_level_id = b.hierarchy_level_id
     where b.tenant_id = v_o.tenant_id and m.user_id = v_uid) then
    raise exception 'As férias do seu nível são programadas pelo gestor. Fale com ele para reagendar.';
  end if;

  v_s := public.ferias_montar_snaps(v_o.tenant_id, v_o.user_id);
  if v_s is null or not coalesce((v_s->>'is_active')::boolean, false) then
    raise exception 'Vínculo não encontrado nesta empresa.';
  end if;

  -- `p_excluir` tira a original das contas: o saldo dela volta para o pedido e
  -- a ausência dela não conta como sobreposição (vai morrer na troca)
  v_val := public.ferias_validar_periodos(
    v_o.tenant_id, v_o.user_id,
    jsonb_build_array(jsonb_build_object(
      'inicio', p_inicio, 'fim', p_fim, 'abono', coalesce(p_abono, 0), 'decimo', p_decimo)),
    p_hoje, p_id);

  v_status := case when v_dono and not (v_gestor or v_dp) then 'solicitada' else 'aprovada' end;

  insert into public.ferias_solicitacoes (
    tenant_id, user_id, status,
    start_date, end_date, abono_dias, adiantar_decimo_terceiro,
    aquisitivo_inicio, aquisitivo_fim, snap_admission_date, reagendada_de,
    snap_full_name, snap_employee_code,
    snap_department_id, snap_department_name,
    snap_subdepartment_id, snap_subdepartment_name,
    snap_position_id, snap_position_name,
    snap_manager_id, snap_manager_name,
    snap_unit_id, snap_unit_name, snap_hierarchy_name,
    created_by, lancada_pelo_gestor, decided_at, decided_by)
  values (
    v_o.tenant_id, v_o.user_id, v_status,
    (v_val->0->>'inicio')::date, (v_val->0->>'fim')::date,
    coalesce((v_val->0->>'abono')::int, 0), coalesce((v_val->0->>'decimo')::boolean, false),
    (v_val->0->>'aquisitivo_inicio')::date, (v_val->0->>'aquisitivo_fim')::date,
    (v_s->>'admission_date')::date, p_id,
    v_s->>'full_name', v_s->>'employee_code',
    (v_s->>'department_id')::uuid, v_s->>'department_name',
    (v_s->>'subdepartment_id')::uuid, v_s->>'subdepartment_name',
    (v_s->>'position_id')::uuid, v_s->>'position_name',
    (v_s->>'manager_id')::uuid, v_s->>'manager_name',
    (v_s->>'unit_id')::uuid, v_s->>'unit_name', v_s->>'hierarchy_name',
    v_uid, not v_dono,
    case when v_status = 'aprovada' then now() end,
    case when v_status = 'aprovada' then v_uid end);

  if v_status = 'solicitada' then
    if (v_s->>'manager_id') is not null then
      perform public.notify_users_sistema(
        v_o.tenant_id, array[(v_s->>'manager_id')::uuid], 'ferias_solicitada',
        'Reagendamento de férias aguardando sua aprovação',
        coalesce(v_s->>'full_name', 'Colaborador') || ': de ' ||
        to_char(v_o.start_date, 'DD/MM') || ' a ' || to_char(v_o.end_date, 'DD/MM') ||
        ' para ' || to_char(p_inicio, 'DD/MM') || ' a ' || to_char(p_fim, 'DD/MM') || '.');
    end if;
  else
    v_dp_arr := array_remove(public.ferias_destinatarios_dp(v_o.tenant_id), v_uid);
    if v_dp_arr is not null and array_length(v_dp_arr, 1) > 0 then
      perform public.notify_users_sistema(
        v_o.tenant_id, v_dp_arr, 'ferias_aguardando_efetivacao',
        'Reagendamento aguardando verificação do DP',
        coalesce(v_s->>'full_name', 'Colaborador') || ': de ' ||
        to_char(v_o.start_date, 'DD/MM') || ' a ' || to_char(v_o.end_date, 'DD/MM') ||
        ' para ' || to_char(p_inicio, 'DD/MM') || ' a ' || to_char(p_fim, 'DD/MM') || '.');
    end if;
    if not v_dono then
      perform public.notify_users_sistema(
        v_o.tenant_id, array[v_o.user_id], 'ferias_lancada',
        'Suas férias estão sendo reagendadas',
        'De ' || to_char(v_o.start_date, 'DD/MM/YYYY') || ' para ' ||
        to_char(p_inicio, 'DD/MM/YYYY') || ', aguardando a verificação do departamento pessoal.');
    end if;
  end if;
end;
$$;

revoke execute on function public.ferias_reagendar(uuid, date, date, int, boolean, date) from public, anon;
grant execute on function public.ferias_reagendar(uuid, date, date, int, boolean, date) to authenticated;

-- ============================================================================
-- O painel
-- ============================================================================
--
-- Uma RPC só, com o ESCOPO decidido dentro (molde seg_blitz_painel): DP,
-- manager e admin veem a empresa; team_lead vê a cadeia dele (mais ele mesmo);
-- member vê só a si. "Quem está de férias" sai de `employee_absences` (o FATO,
-- que inclui o histórico lançado antes do módulo); a previsão aprovada entra
-- como camada clara da timeline.
--
-- `p_hoje` vem do cliente pelo fuso; o resumo numérico é conta do cliente em
-- cima dos arrays (uma passada a menos aqui).
create or replace function public.ferias_painel(
  p_tenant uuid, p_hoje date default current_date, p_unit_ids uuid[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ids uuid[];
  v_janela_ini date;
  v_janela_fim date;
  v_agora jsonb;
  v_proximas jsonb;
  v_timeline jsonb;
  v_saldos jsonb;
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
  -- próximo a programar. Somar todos os aquisitivos abertos enganaria: quem foi
  -- admitido anos antes do sistema mostra saldo gigante até o histórico ser
  -- importado. `situacao` nula = tudo quitado, em dia.
  select coalesce(jsonb_agg(jsonb_build_object(
           'userId', m.user_id, 'nome', p.full_name, 'setor', d.name,
           'saldo', coalesce(s.saldo, 0), 'situacao', s.situacao,
           'aquisitivoInicio', s.aq_inicio, 'aquisitivoFim', s.aq_fim,
           'gozarAte', s.concessivo_fim)
           order by (s.situacao = 'vencida') desc nulls last,
                    (s.situacao = 'a_vencer') desc nulls last, p.full_name), '[]'::jsonb)
    into v_saldos
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
     and m.admission_date is not null;

  return jsonb_build_object(
    'agora', v_agora,
    'proximas', v_proximas,
    'timeline', v_timeline,
    'saldos', v_saldos,
    'janelaInicio', v_janela_ini,
    'janelaFim', v_janela_fim);
end;
$$;

revoke execute on function public.ferias_painel(uuid, date, uuid[]) from public, anon;
grant execute on function public.ferias_painel(uuid, date, uuid[]) to authenticated;

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
