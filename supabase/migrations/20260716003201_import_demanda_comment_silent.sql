create or replace function public.add_demanda_comment_silent(p_demanda uuid, p_body text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_tenant uuid; v_uid uuid := auth.uid();
begin
  select d.tenant_id into v_tenant from public.action_demandas d where d.id = p_demanda;
  if v_tenant is null then raise exception 'Demanda não encontrada'; end if;
  if not public.is_tenant_member(v_tenant) then raise exception 'Sem permissão'; end if;
  if coalesce(trim(p_body),'') = '' then return; end if;
  insert into public.demanda_events (tenant_id, demanda_id, type, actor_id, body)
  values (v_tenant, p_demanda, 'comment', v_uid, trim(p_body));
end; $function$;
