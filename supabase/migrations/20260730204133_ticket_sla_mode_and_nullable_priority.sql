-- modo de SLA por empresa
alter table public.tenants add column if not exists ticket_sla_mode text not null default 'priority';
alter table public.tenants drop constraint if exists tenants_ticket_sla_mode_chk;
alter table public.tenants add constraint tenants_ticket_sla_mode_chk check (ticket_sla_mode in ('priority','category'));

-- SLA pode ser por categoria (priority null) ou por categoria+prioridade
alter table public.ticket_slas alter column priority drop not null;
alter table public.ticket_slas drop constraint if exists ticket_slas_category_id_priority_key;
create unique index if not exists ticket_slas_cat_priority_uq on public.ticket_slas (category_id, priority) where priority is not null;
create unique index if not exists ticket_slas_cat_null_uq on public.ticket_slas (category_id) where priority is null;
