-- Edição de ação: até aqui uma ação criada era imutável (só o "tratamento"
-- mexia nela). Agora quem GERE a ação (criador/owner/admin) pode corrigi-la,
-- enquanto ela não estiver concluída.
--
-- Regras que a função garante, e não a tela:
--   - só quem gere edita, e só ação não finalizada;
--   - a Seção é DERIVADA do item/bloco, como no create_action;
--   - demanda sem responsável é recusada, como no create_action;
--   - demanda removida some junto com o histórico dela (é o que "editar tudo"
--     significa); demanda mantida preserva id, status e histórico;
--   - `created_at` nunca é tocado (e o trigger da 20260811160000 garante).
create or replace function public.update_action(p_id uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_action public.actions;
  v_tenant uuid;
  v_uid uuid := auth.uid();
  v_sdpo boolean := coalesce((p_data->>'is_sdpo')::boolean, false);
  v_due date := nullif(p_data->>'due_date','')::date;
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
  -- que já foi prestado como resultado. "Finalizada" = nenhuma demanda em aberto.
  if not exists (
    select 1 from public.action_demandas d2
     where d2.action_id = p_id and d2.status not in ('done','cancelled')
  ) then
    raise exception 'Esta ação já foi finalizada e não pode mais ser editada';
  end if;

  if jsonb_array_length(coalesce(p_data->'demandas','[]'::jsonb)) = 0 then
    raise exception 'Informe ao menos uma demanda';
  end if;

  update public.actions set
    is_sdpo = v_sdpo,
    pilar_id = case when v_sdpo then (select id from public.sdpo_pilares where id = nullif(p_data->>'pilar_id','')::uuid and tenant_id = v_tenant) end,
    secao_id = case when v_sdpo then coalesce(
        (select i.secao_id from public.sdpo_itens i where i.id = nullif(p_data->>'item_id','')::uuid and i.tenant_id = v_tenant),
        (select b.secao_id from public.sdpo_blocos b where b.id = nullif(p_data->>'bloco_id','')::uuid and b.tenant_id = v_tenant)
      ) end,
    bloco_id = case when v_sdpo then (select id from public.sdpo_blocos where id = nullif(p_data->>'bloco_id','')::uuid and tenant_id = v_tenant) end,
    item_id = case when v_sdpo then (select id from public.sdpo_itens where id = nullif(p_data->>'item_id','')::uuid and tenant_id = v_tenant) end,
    programa_id = case when v_sdpo then coalesce(
        (select i.programa_id from public.sdpo_itens i where i.id = nullif(p_data->>'item_id','')::uuid and i.tenant_id = v_tenant),
        (select b.programa_id from public.sdpo_blocos b where b.id = nullif(p_data->>'bloco_id','')::uuid and b.tenant_id = v_tenant)
      ) end,
    meeting_series_id = (select id from public.meeting_series where id = nullif(p_data->>'meeting_series_id','')::uuid and tenant_id = v_tenant),
    occurrence_id = (select id from public.meeting_occurrences where id = nullif(p_data->>'occurrence_id','')::uuid and tenant_id = v_tenant),
    kpi_id = (select id from public.action_kpis where id = nullif(p_data->>'kpi_id','')::uuid and tenant_id = v_tenant),
    tool_id = (select id from public.action_tools where id = nullif(p_data->>'tool_id','')::uuid and tenant_id = v_tenant),
    unit_id = (select id from public.units where id = nullif(p_data->>'unit_id','')::uuid and tenant_id = v_tenant),
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
      update public.action_demandas
         set description = trim(d->>'description'), due_date = v_due
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
end;
$$;

revoke execute on function public.update_action(uuid, jsonb) from public, anon;
grant execute on function public.update_action(uuid, jsonb) to authenticated;
