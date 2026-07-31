alter table sdpo_pilares add column active boolean not null default true;
alter table sdpo_blocos  add column active boolean not null default true;
alter table sdpo_itens   add column active boolean not null default true;

create index sdpo_pilares_active_idx on sdpo_pilares (tenant_id, active);
create index sdpo_blocos_active_idx  on sdpo_blocos  (tenant_id, active);
create index sdpo_itens_active_idx   on sdpo_itens   (tenant_id, active);
