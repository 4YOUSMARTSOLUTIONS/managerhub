-- Quem "gere" a ação: o CRIADOR dela, owner e admin.
-- Vale para reatribuir, editar e aprovar pedidos. Note que é o criador
-- (created_by), não o solicitante (requester_id): o solicitante é quem pediu a
-- ação no mundo real, o criador é quem a cadastrou e responde por ela aqui.
create or replace function public.pode_gerir_acao(p_action public.actions)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_action.tenant_id in (select public.my_tenant_ids())
     and (p_action.created_by = (select auth.uid())
          or p_action.tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])));
$$;

revoke execute on function public.pode_gerir_acao(public.actions) from public, anon;
grant execute on function public.pode_gerir_acao(public.actions) to authenticated;

-- EXCLUIR: só o proprietário. Antes qualquer um que ENXERGAVA a ação apagava.
drop policy if exists actions_delete on public.actions;
create policy actions_delete on public.actions
  for delete using (
    tenant_id in (select public.my_role_tenant_ids('{owner}'::member_role[]))
  );

-- EDITAR (update direto na tabela): criador/owner/admin. As RPCs de tratamento
-- são security definer e seguem com as guardas próprias delas.
drop policy if exists actions_update on public.actions;
create policy actions_update on public.actions
  for update using (public.pode_gerir_acao(actions.*))
  with check (public.pode_gerir_acao(actions.*));

-- A data de criação é prova de quando a ação nasceu: nunca muda, por ninguém.
create or replace function public.guard_action_created_at()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.created_at is distinct from old.created_at then
    raise exception 'A data de criação da ação não pode ser alterada';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_action_created_at() from public, anon, authenticated;

drop trigger if exists actions_guard_created_at on public.actions;
create trigger actions_guard_created_at
  before update on public.actions
  for each row execute function public.guard_action_created_at();

-- REATRIBUIR passa a ser de quem gere a ação (criador/owner/admin), e não mais
-- do solicitante. O corpo é remendado a partir do banco (molde da 20260807162000).
do $do$
declare
  v_def text;
  v_new text;
  c_decl constant text := $q$declare v_tenant uuid; v_requester uuid; v_uid uuid := auth.uid(); v_desc text; v_status public.action_status;$q$;
  c_decl_novo constant text := $q$declare v_tenant uuid; v_requester uuid; v_creator uuid; v_uid uuid := auth.uid(); v_desc text; v_status public.action_status;$q$;
  c_sel constant text := $q$select d.tenant_id, a.requester_id, d.description, d.status into v_tenant, v_requester, v_desc, v_status$q$;
  c_sel_novo constant text := $q$select d.tenant_id, a.requester_id, a.created_by, d.description, d.status into v_tenant, v_requester, v_creator, v_desc, v_status$q$;
  c_guard constant text := $q$if not (v_uid = v_requester or public.has_tenant_role(v_tenant, array['owner','admin']::public.member_role[])) then
    raise exception 'Apenas o solicitante ou um administrador pode reatribuir';$q$;
  c_guard_novo constant text := $q$if not (v_uid = v_creator or public.has_tenant_role(v_tenant, array['owner','admin']::public.member_role[])) then
    raise exception 'Apenas quem criou a ação, um administrador ou o proprietário pode reatribuir';$q$;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'demanda_reassign';

  v_new := replace(v_def, c_decl, c_decl_novo);
  v_new := replace(v_new, c_sel, c_sel_novo);
  v_new := replace(v_new, c_guard, c_guard_novo);
  if v_new = v_def then raise exception 'demanda_reassign: trechos esperados não encontrados'; end if;
  execute v_new;
end
$do$;

revoke execute on function public.demanda_reassign(uuid, jsonb, text) from public, anon;
