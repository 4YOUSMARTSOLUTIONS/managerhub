-- As portas do processo de férias (molde 20260815102000_absenteismo_rpcs.sql):
-- cada transição em função, porque cada uma tem efeito colateral que precisa
-- acontecer na MESMA transação, e os avisos usam `notify_users_sistema` pelo
-- mesmo motivo de lá (o super admin opera sem membership).

-- ============================================================================
-- O carimbo do vínculo, montado no banco
-- ============================================================================
--
-- Helper interno (revogado até de authenticated). Diferente do absenteísmo, que
-- monta o carimbo no TypeScript com seis consultas, aqui é UMA consulta do lado
-- de quem já está com a transação aberta. Sem CPF, como manda o AGENTS.md.
create or replace function public.ferias_montar_snaps(p_tenant uuid, p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'full_name', p.full_name,
    'employee_code', m.employee_code,
    'department_id', m.department_id,
    'department_name', d.name,
    'subdepartment_id', m.subdepartment_id,
    'subdepartment_name', sd.name,
    'position_id', m.position_id,
    'position_name', pos.name,
    'manager_id', m.manager_id,
    'manager_name', gp.full_name,
    'unit_id', mu.unit_id,
    'unit_name', un.name,
    'hierarchy_level_id', m.hierarchy_level_id,
    'hierarchy_name', h.name,
    'admission_date', m.admission_date,
    'is_active', m.is_active)
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  left join public.departments d on d.id = m.department_id
  left join public.subdepartments sd on sd.id = m.subdepartment_id
  left join public.positions pos on pos.id = m.position_id
  left join public.profiles gp on gp.id = m.manager_id
  left join lateral (
    select u.unit_id from public.membership_units u
     where u.membership_id = m.id limit 1) mu on true
  left join public.units un on un.id = mu.unit_id
  left join public.hierarchy_levels h on h.id = m.hierarchy_level_id
  where m.tenant_id = p_tenant and m.user_id = p_user;
$$;

revoke execute on function public.ferias_montar_snaps(uuid, uuid)
  from public, anon, authenticated;

-- Os destinatários do departamento pessoal, no recorte padrão da casa.
create or replace function public.ferias_destinatarios_dp(p_tenant uuid)
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select array_agg(m.user_id)
    from public.memberships m
   where m.tenant_id = p_tenant
     and m.role in ('owner', 'admin', 'hr')
     and m.is_active;
$$;

revoke execute on function public.ferias_destinatarios_dp(uuid)
  from public, anon, authenticated;

-- Insere as linhas de um conjunto já validado. Interno: quem valida e decide o
-- status são as portas públicas abaixo.
create or replace function public.ferias_criar_linhas(
  p_tenant uuid, p_user uuid, p_validado jsonb, p_snaps jsonb,
  p_status public.ferias_status, p_lancada boolean)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
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
      decided_at, decided_by)
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
      case when p_status = 'aprovada' then (select auth.uid()) end);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke execute on function public.ferias_criar_linhas(uuid, uuid, jsonb, jsonb, public.ferias_status, boolean)
  from public, anon, authenticated;

-- ============================================================================
-- A solicitação do colaborador
-- ============================================================================
create or replace function public.ferias_solicitar(
  p_tenant uuid, p_periodos jsonb, p_hoje date default current_date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_s jsonb;
  v_val jsonb;
  v_n int;
  v_gestor uuid;
  v_dp uuid[];
begin
  v_s := public.ferias_montar_snaps(p_tenant, v_uid);
  if v_s is null or not coalesce((v_s->>'is_active')::boolean, false) then
    raise exception 'Vínculo não encontrado nesta empresa.';
  end if;
  if v_s->>'admission_date' is null then
    raise exception 'Sua data de admissão não está cadastrada. Peça ao departamento pessoal para completar o seu cadastro.';
  end if;
  if exists (
    select 1 from public.ferias_niveis_bloqueados b
     where b.tenant_id = p_tenant
       and b.hierarchy_level_id = (v_s->>'hierarchy_level_id')::uuid) then
    raise exception 'As férias do seu nível são programadas pelo gestor. Fale com ele para incluir a previsão.';
  end if;

  v_val := public.ferias_validar_periodos(p_tenant, v_uid, p_periodos, p_hoje);
  v_n := public.ferias_criar_linhas(p_tenant, v_uid, v_val, v_s, 'solicitada', false);

  v_gestor := (v_s->>'manager_id')::uuid;
  if v_gestor is not null then
    perform public.notify_users_sistema(
      p_tenant, array[v_gestor], 'ferias_solicitada',
      'Férias aguardando sua aprovação',
      coalesce(v_s->>'full_name', 'Colaborador') || ' solicitou ' || v_n ||
      ' período(s) de férias a partir de ' ||
      to_char((v_val->0->>'inicio')::date, 'DD/MM/YYYY') || '.');
  else
    v_dp := public.ferias_destinatarios_dp(p_tenant);
    if v_dp is not null then
      perform public.notify_users_sistema(
        p_tenant, v_dp, 'ferias_solicitada',
        'Férias aguardando aprovação',
        coalesce(v_s->>'full_name', 'Colaborador') ||
        ' solicitou férias e não tem gestor cadastrado.');
    end if;
  end if;
end;
$$;

revoke execute on function public.ferias_solicitar(uuid, jsonb, date) from public, anon;
grant execute on function public.ferias_solicitar(uuid, jsonb, date) to authenticated;

-- ============================================================================
-- O lançamento do gestor (o caminho do operacional)
-- ============================================================================
--
-- Nasce APROVADA: a aprovação do gestor É o lançamento. Vale para qualquer
-- subordinado, e é o único caminho para os níveis marcados em
-- `ferias_niveis_bloqueados`.
create or replace function public.ferias_lancar(
  p_tenant uuid, p_user uuid, p_periodos jsonb, p_hoje date default current_date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_s jsonb;
  v_val jsonb;
  v_n int;
  v_dp uuid[];
begin
  if not public.manages_user(p_user, p_tenant)
     and not public.has_tenant_role(p_tenant, '{owner,admin,hr}'::public.member_role[]) then
    raise exception 'Apenas o gestor do colaborador ou o departamento pessoal lançam a previsão de férias.';
  end if;

  v_s := public.ferias_montar_snaps(p_tenant, p_user);
  if v_s is null or not coalesce((v_s->>'is_active')::boolean, false) then
    raise exception 'Vínculo não encontrado nesta empresa.';
  end if;
  if v_s->>'admission_date' is null then
    raise exception 'A data de admissão deste colaborador não está cadastrada. Peça ao departamento pessoal.';
  end if;

  v_val := public.ferias_validar_periodos(p_tenant, p_user, p_periodos, p_hoje);
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
$$;

revoke execute on function public.ferias_lancar(uuid, uuid, jsonb, date) from public, anon;
grant execute on function public.ferias_lancar(uuid, uuid, jsonb, date) to authenticated;

-- ============================================================================
-- A decisão do gestor (e a devolução do DP)
-- ============================================================================
create or replace function public.ferias_decidir(
  p_id uuid, p_aprovar boolean, p_nota text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_l record;
  v_gestor boolean;
  v_dp boolean;
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
  v_avisar uuid[];
  v_dp_arr uuid[];
begin
  select f.* into v_l from public.ferias_solicitacoes f where f.id = p_id;
  if v_l.id is null then
    raise exception 'Previsão não encontrada.';
  end if;
  v_gestor := public.manages_user(v_l.user_id, v_l.tenant_id);
  v_dp := public.has_tenant_role(v_l.tenant_id, '{owner,admin,hr}'::public.member_role[]);

  if v_l.status = 'solicitada' then
    if not (v_gestor or v_dp) then
      raise exception 'Apenas o gestor do colaborador ou o departamento pessoal decidem a previsão.';
    end if;
  elsif v_l.status = 'aprovada' and not p_aprovar then
    -- a devolução do DP: "não bate com a folha", volta para correção
    if not v_dp then
      raise exception 'Apenas o departamento pessoal devolve uma previsão aprovada.';
    end if;
  else
    raise exception 'Esta previsão não está aguardando decisão.';
  end if;

  if not p_aprovar and v_nota is null then
    raise exception 'Informe o motivo da reprovação.';
  end if;

  if p_aprovar then
    update public.ferias_solicitacoes
       set status = 'aprovada',
           decided_at = now(), decided_by = (select auth.uid()),
           decision_note = v_nota, updated_at = now()
     where id = p_id;

    v_avisar := array_remove(array[v_l.user_id, v_l.created_by], (select auth.uid()));
    if array_length(v_avisar, 1) > 0 then
      perform public.notify_users_sistema(
        v_l.tenant_id, v_avisar, 'ferias_aprovada',
        'Férias aprovadas pelo gestor',
        coalesce(v_l.snap_full_name, 'Colaborador') || ': ' ||
        to_char(v_l.start_date, 'DD/MM') || ' a ' || to_char(v_l.end_date, 'DD/MM') ||
        ', aguardando a efetivação do departamento pessoal.');
    end if;

    v_dp_arr := array_remove(public.ferias_destinatarios_dp(v_l.tenant_id), (select auth.uid()));
    if v_dp_arr is not null and array_length(v_dp_arr, 1) > 0 then
      perform public.notify_users_sistema(
        v_l.tenant_id, v_dp_arr, 'ferias_aguardando_efetivacao',
        'Férias aguardando efetivação',
        coalesce(v_l.snap_full_name, 'Colaborador') || ': ' ||
        to_char(v_l.start_date, 'DD/MM/YYYY') || ' a ' || to_char(v_l.end_date, 'DD/MM/YYYY') || '.');
    end if;
  else
    update public.ferias_solicitacoes
       set status = 'reprovada',
           decided_at = now(), decided_by = (select auth.uid()),
           decision_note = v_nota, updated_at = now()
     where id = p_id;

    v_avisar := array_remove(array[v_l.user_id, v_l.created_by], (select auth.uid()));
    if array_length(v_avisar, 1) > 0 then
      perform public.notify_users_sistema(
        v_l.tenant_id, v_avisar, 'ferias_reprovada',
        'Previsão de férias devolvida',
        coalesce(v_l.snap_full_name, 'Colaborador') || ': ' || v_nota);
    end if;
  end if;
end;
$$;

revoke execute on function public.ferias_decidir(uuid, boolean, text) from public, anon;
grant execute on function public.ferias_decidir(uuid, boolean, text) to authenticated;

-- ============================================================================
-- O reenvio de uma previsão devolvida
-- ============================================================================
create or replace function public.ferias_reenviar(
  p_id uuid, p_inicio date, p_fim date, p_abono int default 0,
  p_decimo boolean default false, p_hoje date default current_date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_l record;
  v_val jsonb;
  v_gestor uuid;
  v_dp uuid[];
begin
  select f.* into v_l from public.ferias_solicitacoes f where f.id = p_id;
  if v_l.id is null then
    raise exception 'Previsão não encontrada.';
  end if;
  if v_l.created_by is distinct from (select auth.uid()) then
    raise exception 'Apenas quem abriu a previsão pode corrigi-la e reenviar.';
  end if;
  if v_l.status <> 'reprovada' then
    raise exception 'Só uma previsão devolvida pode ser corrigida e reenviada.';
  end if;

  v_val := public.ferias_validar_periodos(
    v_l.tenant_id, v_l.user_id,
    jsonb_build_array(jsonb_build_object(
      'inicio', p_inicio, 'fim', p_fim, 'abono', coalesce(p_abono, 0), 'decimo', p_decimo)),
    p_hoje, p_id);

  update public.ferias_solicitacoes
     set status = 'solicitada',
         start_date = (v_val->0->>'inicio')::date,
         end_date = (v_val->0->>'fim')::date,
         abono_dias = coalesce((v_val->0->>'abono')::int, 0),
         adiantar_decimo_terceiro = coalesce((v_val->0->>'decimo')::boolean, false),
         aquisitivo_inicio = (v_val->0->>'aquisitivo_inicio')::date,
         aquisitivo_fim = (v_val->0->>'aquisitivo_fim')::date,
         decided_at = null, decided_by = null, decision_note = null,
         updated_at = now()
   where id = p_id;

  -- lançamento do gestor devolvido pelo DP: a correção do gestor já volta
  -- aprovada (duas transições legais na mesma transação)
  if v_l.lancada_pelo_gestor and (
       public.manages_user(v_l.user_id, v_l.tenant_id)
       or public.has_tenant_role(v_l.tenant_id, '{owner,admin,hr}'::public.member_role[])) then
    update public.ferias_solicitacoes
       set status = 'aprovada',
           decided_at = now(), decided_by = (select auth.uid()),
           updated_at = now()
     where id = p_id;

    v_dp := array_remove(public.ferias_destinatarios_dp(v_l.tenant_id), (select auth.uid()));
    if v_dp is not null and array_length(v_dp, 1) > 0 then
      perform public.notify_users_sistema(
        v_l.tenant_id, v_dp, 'ferias_aguardando_efetivacao',
        'Férias corrigidas aguardando efetivação',
        coalesce(v_l.snap_full_name, 'Colaborador') || ': ' ||
        to_char(p_inicio, 'DD/MM/YYYY') || ' a ' || to_char(p_fim, 'DD/MM/YYYY') || '.');
    end if;
  else
    v_gestor := v_l.snap_manager_id;
    if v_gestor is not null and v_gestor is distinct from (select auth.uid()) then
      perform public.notify_users_sistema(
        v_l.tenant_id, array[v_gestor], 'ferias_solicitada',
        'Férias corrigidas aguardando sua aprovação',
        coalesce(v_l.snap_full_name, 'Colaborador') || ': ' ||
        to_char(p_inicio, 'DD/MM/YYYY') || ' a ' || to_char(p_fim, 'DD/MM/YYYY') || '.');
    end if;
  end if;
end;
$$;

revoke execute on function public.ferias_reenviar(uuid, date, date, int, boolean, date) from public, anon;
grant execute on function public.ferias_reenviar(uuid, date, date, int, boolean, date) to authenticated;

-- ============================================================================
-- Cancelar
-- ============================================================================
--
-- De `efetivada` é operação de administrador: desfaz a ausência real e devolve
-- dias à remuneração variável. A ordem importa (solta o vínculo, depois apaga a
-- ausência), por causa do `on delete restrict`.
create or replace function public.ferias_cancelar(p_id uuid, p_nota text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_l record;
  v_aus uuid;
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
  v_gestor boolean;
  v_dp boolean;
  v_avisar uuid[];
begin
  select f.* into v_l from public.ferias_solicitacoes f where f.id = p_id;
  if v_l.id is null then
    raise exception 'Previsão não encontrada.';
  end if;
  v_gestor := public.manages_user(v_l.user_id, v_l.tenant_id);
  v_dp := public.has_tenant_role(v_l.tenant_id, '{owner,admin,hr}'::public.member_role[]);

  if v_l.status = 'efetivada' then
    if not public.has_tenant_role(v_l.tenant_id, '{owner,admin}'::public.member_role[]) then
      raise exception 'Apenas o administrador ou o proprietário cancelam férias já efetivadas.';
    end if;
  elsif v_l.status = 'aprovada' then
    if not (v_gestor or v_dp) then
      raise exception 'Apenas o gestor do colaborador ou o departamento pessoal cancelam uma previsão aprovada.';
    end if;
  elsif v_l.status in ('solicitada', 'reprovada') then
    if not (v_l.created_by = (select auth.uid()) or v_gestor or v_dp) then
      raise exception 'Previsão não encontrada.';
    end if;
  else
    raise exception 'Esta previsão já foi encerrada.';
  end if;
  if v_nota is null then
    raise exception 'Informe o motivo do cancelamento.';
  end if;

  v_aus := v_l.absence_id;

  update public.ferias_solicitacoes
     set status = 'cancelada', absence_id = null,
         cancelled_at = now(), cancelled_by = (select auth.uid()),
         cancel_note = v_nota, updated_at = now()
   where id = p_id;

  if v_aus is not null then
    delete from public.employee_absences where id = v_aus;
  end if;

  v_avisar := array_remove(array[v_l.user_id, v_l.created_by], (select auth.uid()));
  if array_length(v_avisar, 1) > 0 then
    perform public.notify_users_sistema(
      v_l.tenant_id, v_avisar, 'ferias_cancelada',
      'Previsão de férias cancelada',
      coalesce(v_l.snap_full_name, 'Colaborador') || ' (' ||
      to_char(v_l.start_date, 'DD/MM') || ' a ' || to_char(v_l.end_date, 'DD/MM') || '): ' || v_nota);
  end if;
end;
$$;

revoke execute on function public.ferias_cancelar(uuid, text) from public, anon;
grant execute on function public.ferias_cancelar(uuid, text) to authenticated;

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
