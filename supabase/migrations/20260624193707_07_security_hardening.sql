
-- =============================================================
-- MANAGERHUB · Migration 07 · Endurecimento de segurança
-- =============================================================

-- 1) search_path fixo nas funções de trigger restantes
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.tickets_before_insert()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.code is null then
    new.code := 'CH-' || lpad(nextval('public.ticket_code_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

-- 2) Funções de trigger não devem ser expostas como RPC (rodam via trigger como owner)
revoke all on function public.set_updated_at()        from public, anon, authenticated;
revoke all on function public.tickets_before_insert() from public, anon, authenticated;
revoke all on function public.apply_goal_update()     from public, anon, authenticated;
revoke all on function public.audit_trigger()         from public, anon, authenticated;
revoke all on function public.handle_new_user()       from public, anon, authenticated;

-- 3) Helpers de RLS: não precisam ser chamados pelo anon (apenas autenticado)
revoke all on function public.current_tenant_ids()                       from public, anon;
revoke all on function public.is_tenant_member(uuid)                     from public, anon;
revoke all on function public.has_tenant_role(uuid, public.member_role[]) from public, anon;
revoke all on function public.dashboard_stats(uuid)                      from public, anon;
revoke all on function public.create_tenant_with_owner(text, text)       from public, anon;

