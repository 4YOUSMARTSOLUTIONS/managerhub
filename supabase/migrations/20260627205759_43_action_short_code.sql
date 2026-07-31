
alter table public.actions add column if not exists code bigint;

-- backfill sequencial por empresa (ordem de criação)
with ranked as (
  select id, row_number() over (partition by tenant_id order by created_at, id) as rn
  from public.actions
)
update public.actions a set code = r.rn from ranked r where r.id = a.id and a.code is null;

-- trigger: atribui o próximo código por empresa no insert (serializado por advisory lock)
create or replace function public.assign_action_code()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.code is null then
    perform pg_advisory_xact_lock(hashtext(NEW.tenant_id::text));
    select coalesce(max(code), 0) + 1 into NEW.code from public.actions where tenant_id = NEW.tenant_id;
  end if;
  return NEW;
end; $$;

drop trigger if exists actions_assign_code on public.actions;
create trigger actions_assign_code before insert on public.actions
  for each row execute function public.assign_action_code();

alter table public.actions alter column code set not null;

notify pgrst, 'reload schema';

