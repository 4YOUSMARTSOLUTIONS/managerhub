alter table departments      add column if not exists active boolean not null default true;
alter table subdepartments   add column if not exists active boolean not null default true;
alter table positions        add column if not exists active boolean not null default true;
alter table position_levels  add column if not exists active boolean not null default true;
alter table ticket_sectors   add column if not exists active boolean not null default true;
alter table ticket_categories add column if not exists active boolean not null default true;
