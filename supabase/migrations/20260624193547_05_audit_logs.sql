
-- =============================================================
-- MANAGERHUB · Migration 05 · Log de auditoria
-- =============================================================
create table public.audit_logs (
  id           bigint generated always as identity primary key,
  tenant_id    uuid references public.tenants(id) on delete cascade,
  actor_id     uuid,
  action       text not null,          -- INSERT | UPDATE | DELETE
  entity_type  text not null,          -- nome da tabela
  entity_id    text,
  summary      text,
  changes      jsonb,
  created_at   timestamptz not null default now()
);
create index idx_audit_tenant on public.audit_logs(tenant_id);
create index idx_audit_entity on public.audit_logs(entity_type, entity_id);
create index idx_audit_created on public.audit_logs(created_at desc);

-- trigger genérico de auditoria
create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_entity text;
  v_changes jsonb;
begin
  if (tg_op = 'DELETE') then
    v_tenant := old.tenant_id;
    v_entity := old.id::text;
    v_changes := to_jsonb(old);
  else
    v_tenant := new.tenant_id;
    v_entity := new.id::text;
    if (tg_op = 'UPDATE') then
      v_changes := jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new));
    else
      v_changes := to_jsonb(new);
    end if;
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, changes)
  values (v_tenant, auth.uid(), tg_op, tg_table_name, v_entity, v_changes);

  if (tg_op = 'DELETE') then return old; else return new; end if;
end;
$$;

-- aplica auditoria nas tabelas de negócio
create trigger audit_rooms        after insert or update or delete on public.rooms        for each row execute function public.audit_trigger();
create trigger audit_meetings     after insert or update or delete on public.meetings     for each row execute function public.audit_trigger();
create trigger audit_action_items after insert or update or delete on public.action_items for each row execute function public.audit_trigger();
create trigger audit_tickets      after insert or update or delete on public.tickets      for each row execute function public.audit_trigger();
create trigger audit_goals        after insert or update or delete on public.goals        for each row execute function public.audit_trigger();
create trigger audit_memberships  after insert or update or delete on public.memberships  for each row execute function public.audit_trigger();

alter table public.audit_logs enable row level security;
-- somente owner/admin/manager visualizam a auditoria do seu tenant
create policy "audit_admin_select" on public.audit_logs
  for select using (public.has_tenant_role(tenant_id, array['owner','admin','manager']::member_role[]));

