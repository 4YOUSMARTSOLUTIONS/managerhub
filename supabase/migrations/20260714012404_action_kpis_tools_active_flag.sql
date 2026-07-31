alter table action_kpis  add column active boolean not null default true;
alter table action_tools add column active boolean not null default true;
create index action_kpis_active_idx  on action_kpis  (tenant_id, active);
create index action_tools_active_idx on action_tools (tenant_id, active);
