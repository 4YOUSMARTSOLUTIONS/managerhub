-- Edição de ação sem perder dado e aprovação de ação sem solicitante (LUIZ, 23/11/2026).
--
-- 1. Aprovar, reabrir, cancelar e editar o problema comparavam `auth.uid()` com o
--    solicitante. Com solicitante NULL a comparação dá NULL, o IF não dispara e
--    qualquer usuário logado passava. Sem solicitante, quem responde é quem criou.
-- 2. Prorrogação aprovada mudava só a demanda; a edição lia o prazo do cabeçalho e
--    devolvia o antigo. Agora o cabeçalho acompanha, e editar só mexe no prazo das
--    demandas quando o prazo foi de fato alterado.
-- 3. "Em cópia" vinha no formulário e não era gravado.
-- 4. Ação importada como SDPO sem item perdia o Programa ao salvar. Classificação
--    que não foi tocada na edição fica como está.
-- 5. A função devolve os ids das demandas, para os anexos da edição irem para a
--    demanda certa.

do $migracao$
declare
  v_nome text;
  v_def text;
  v_antes text;
begin
  foreach v_nome in array array[
    'demanda_assignee_decide(uuid,uuid,boolean,text)',
    'demanda_assignee_submit(uuid)',
    'demanda_assignee_reopen(uuid,uuid,text)',
    'demanda_cancel(uuid,text)',
    'demanda_reopen(uuid,text)',
    'demanda_set_problem(uuid,text)'
  ] loop
    v_def := pg_get_functiondef(('public.' || v_nome)::regprocedure);

    if (length(v_def) - length(replace(v_def, 'a.requester_id', ''))) / length('a.requester_id') <> 1 then
      raise exception '%: esperava uma leitura do solicitante', v_nome;
    end if;
    v_def := replace(v_def, 'a.requester_id', 'coalesce(a.requester_id, a.created_by)');

    v_antes := v_def;
    v_def := replace(v_def, 'if v_uid <> v_requester then', 'if v_uid is distinct from v_requester then');
    v_def := replace(v_def, 'if not (v_uid = v_requester', 'if not (coalesce(v_uid = v_requester, false)');
    if v_nome <> 'demanda_assignee_submit(uuid)' and v_def = v_antes then
      raise exception '%: guarda não encontrada', v_nome;
    end if;

    execute v_def;
  end loop;

  -- prorrogação aprovada: o cabeçalho acompanha a demanda
  v_def := pg_get_functiondef('public.demanda_decide(uuid,boolean,text)'::regprocedure);
  v_antes := 'update action_demandas set due_date = v_new_due where id = v_demanda;';
  if position(v_antes in v_def) = 0 then
    raise exception 'demanda_decide: trecho do prazo não encontrado';
  end if;
  execute replace(v_def, v_antes, v_antes || $novo$
    update public.actions a
       set due_date = (select max(d.due_date) from public.action_demandas d where d.action_id = a.id)
     where a.id = v_action.id;$novo$);
end
$migracao$;

-- o tipo de retorno muda (void -> jsonb), e isso exige recriar
drop function public.update_action(uuid, jsonb);

create function public.update_action(p_id uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_action public.actions;
  v_tenant uuid;
  v_uid uuid := auth.uid();
  v_sdpo boolean := coalesce((p_data->>'is_sdpo')::boolean, false);
  v_due date := nullif(p_data->>'due_date','')::date;
  v_prazo_mudou boolean;
  v_classificacao_intacta boolean;
  d jsonb;
  v_keep uuid[] := '{}';
  v_dem uuid;
  v_dem_n int := 0;
begin
  select * into v_action from public.actions where id = p_id;
  if v_action.id is null then raise exception 'Ação não encontrada'; end if;
  if not public.pode_gerir_acao(v_action) then
    raise exception 'Apenas quem criou a ação, um administrador ou o proprietário pode editá-la';
  end if;
  v_tenant := v_action.tenant_id;

  -- ação finalizada é história: corrigir depois de concluída reescreveria o
  -- que já foi prestado como resultado
  if not exists (
    select 1 from public.action_demandas d2
     where d2.action_id = p_id and d2.status not in ('done','cancelled')
  ) then
    raise exception 'Esta ação já foi finalizada e não pode mais ser editada';
  end if;

  if jsonb_array_length(coalesce(p_data->'demandas','[]'::jsonb)) = 0 then
    raise exception 'Informe ao menos uma demanda';
  end if;

  v_prazo_mudou := v_due is distinct from v_action.due_date;
  v_classificacao_intacta := v_sdpo = v_action.is_sdpo
    and nullif(p_data->>'pilar_id','')::uuid is not distinct from v_action.pilar_id
    and nullif(p_data->>'bloco_id','')::uuid is not distinct from v_action.bloco_id
    and nullif(p_data->>'item_id','')::uuid is not distinct from v_action.item_id;

  update public.actions set
    is_sdpo = v_sdpo,
    pilar_id = case
      when v_classificacao_intacta then v_action.pilar_id
      when v_sdpo then (select id from public.sdpo_pilares where id = nullif(p_data->>'pilar_id','')::uuid and tenant_id = v_tenant)
    end,
    secao_id = case
      when v_classificacao_intacta then v_action.secao_id
      when v_sdpo then coalesce(
        (select i.secao_id from public.sdpo_itens i where i.id = nullif(p_data->>'item_id','')::uuid and i.tenant_id = v_tenant),
        (select b.secao_id from public.sdpo_blocos b where b.id = nullif(p_data->>'bloco_id','')::uuid and b.tenant_id = v_tenant)
      )
    end,
    bloco_id = case
      when v_classificacao_intacta then v_action.bloco_id
      when v_sdpo then (select id from public.sdpo_blocos where id = nullif(p_data->>'bloco_id','')::uuid and tenant_id = v_tenant)
    end,
    item_id = case
      when v_classificacao_intacta then v_action.item_id
      when v_sdpo then (select id from public.sdpo_itens where id = nullif(p_data->>'item_id','')::uuid and tenant_id = v_tenant)
    end,
    programa_id = case
      when v_classificacao_intacta then v_action.programa_id
      when v_sdpo then coalesce(
        (select i.programa_id from public.sdpo_itens i where i.id = nullif(p_data->>'item_id','')::uuid and i.tenant_id = v_tenant),
        (select b.programa_id from public.sdpo_blocos b where b.id = nullif(p_data->>'bloco_id','')::uuid and b.tenant_id = v_tenant)
      )
    end,
    meeting_series_id = (select id from public.meeting_series where id = nullif(p_data->>'meeting_series_id','')::uuid and tenant_id = v_tenant),
    occurrence_id = (select id from public.meeting_occurrences where id = nullif(p_data->>'occurrence_id','')::uuid and tenant_id = v_tenant),
    kpi_id = (select id from public.action_kpis where id = nullif(p_data->>'kpi_id','')::uuid and tenant_id = v_tenant),
    tool_id = (select id from public.action_tools where id = nullif(p_data->>'tool_id','')::uuid and tenant_id = v_tenant),
    unit_id = (select id from public.units where id = nullif(p_data->>'unit_id','')::uuid and tenant_id = v_tenant),
    department_id = (select id from public.departments where id = nullif(p_data->>'department_id','')::uuid and tenant_id = v_tenant),
    subdepartment_id = (select id from public.subdepartments where id = nullif(p_data->>'subdepartment_id','')::uuid and tenant_id = v_tenant),
    requester_id = (select m.user_id from public.memberships m where m.user_id = nullif(p_data->>'requester_id','')::uuid and m.tenant_id = v_tenant),
    problem_statement = nullif(trim(p_data->>'problem_statement'), ''),
    due_date = v_due,
    priority = coalesce((p_data->>'priority')::public.priority_level, 'medium')
  where id = p_id;

  for d in select * from jsonb_array_elements(p_data->'demandas')
  loop
    if coalesce(trim(d->>'description'),'') = '' then continue; end if;
    v_dem_n := v_dem_n + 1;
    if (select count(*) from jsonb_array_elements_text(coalesce(d->'assignees','[]'::jsonb)) x
         where exists (select 1 from public.memberships m where m.tenant_id = v_tenant and m.user_id = x::uuid)) = 0 then
      raise exception 'Informe ao menos um responsável na demanda %', v_dem_n;
    end if;

    v_dem := nullif(d->>'id','')::uuid;
    if v_dem is not null and exists (select 1 from public.action_demandas where id = v_dem and action_id = p_id) then
      -- prazo igual ao do cabeçalho não sobrescreve a prorrogação de cada demanda
      update public.action_demandas
         set description = trim(d->>'description'),
             due_date = case when v_prazo_mudou then v_due else due_date end
       where id = v_dem;
    else
      insert into public.action_demandas (action_id, tenant_id, description, due_date)
      values (p_id, v_tenant, trim(d->>'description'), v_due)
      returning id into v_dem;
      insert into public.demanda_events (tenant_id, demanda_id, type, actor_id, body)
      values (v_tenant, v_dem, 'created', v_uid, trim(d->>'description'));
    end if;
    v_keep := array_append(v_keep, v_dem);

    -- responsáveis: acerta a lista sem derrubar quem permanece (a conclusão
    -- individual de quem fica não pode ser perdida por uma edição de texto)
    delete from public.action_demanda_assignees a
     where a.demanda_id = v_dem
       and a.user_id not in (select x::uuid from jsonb_array_elements_text(coalesce(d->'assignees','[]'::jsonb)) x);
    insert into public.action_demanda_assignees (demanda_id, user_id)
    select v_dem, x::uuid from jsonb_array_elements_text(coalesce(d->'assignees','[]'::jsonb)) x
     where exists (select 1 from public.memberships m where m.tenant_id = v_tenant and m.user_id = x::uuid)
    on conflict do nothing;
  end loop;

  delete from public.action_demandas where action_id = p_id and id <> all(v_keep);

  -- em cópia: só quando o formulário mandou a lista
  if p_data ? 'cc' then
    delete from public.action_cc c
     where c.action_id = p_id
       and c.user_id not in (select x::uuid from jsonb_array_elements_text(coalesce(p_data->'cc','[]'::jsonb)) x);
    insert into public.action_cc (action_id, user_id)
    select p_id, x::uuid from jsonb_array_elements_text(coalesce(p_data->'cc','[]'::jsonb)) x
     where exists (select 1 from public.memberships m where m.tenant_id = v_tenant and m.user_id = x::uuid)
    on conflict do nothing;
  end if;

  return jsonb_build_object('action_id', p_id, 'demanda_ids', to_jsonb(v_keep));
end;
$function$;

revoke execute on function public.update_action(uuid, jsonb) from public, anon;
grant execute on function public.update_action(uuid, jsonb) to authenticated;

-- quem pode editar a ação pode anexar nela: antes era só quem criou, e o
-- administrador que editava perderia o arquivo
create or replace function public.pode_gravar_arquivo_de_acao(p_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from regexp_match(
      p_name,
      '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[^/]+$'
    ) as m
    join public.actions a on a.id = m[2]::uuid and a.tenant_id = m[1]::uuid
    where public.pode_gerir_acao(a.*)
      and public.can_view_action(a.*)
  );
$function$;

revoke execute on function public.pode_gravar_arquivo_de_acao(text) from public, anon;
grant execute on function public.pode_gravar_arquivo_de_acao(text) to authenticated;

revoke execute on function public.demanda_assignee_decide(uuid, uuid, boolean, text) from public, anon;
revoke execute on function public.demanda_assignee_submit(uuid) from public, anon;
revoke execute on function public.demanda_assignee_reopen(uuid, uuid, text) from public, anon;
revoke execute on function public.demanda_cancel(uuid, text) from public, anon;
revoke execute on function public.demanda_reopen(uuid, text) from public, anon;
revoke execute on function public.demanda_set_problem(uuid, text) from public, anon;
revoke execute on function public.demanda_decide(uuid, boolean, text) from public, anon;

notify pgrst, 'reload schema';
