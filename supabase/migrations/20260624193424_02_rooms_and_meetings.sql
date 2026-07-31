
-- =============================================================
-- MANAGERHUB · Migration 02 · Salas e Reuniões
-- =============================================================
create extension if not exists "btree_gist";

create type meeting_status as enum ('scheduled', 'in_progress', 'done', 'cancelled');
create type participant_response as enum ('invited', 'accepted', 'declined', 'tentative');

-- ---------- Salas ----------
create table public.rooms (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  location    text,
  capacity    int  not null default 1 check (capacity > 0),
  color       text not null default '#2563eb',
  resources   text[] not null default '{}',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_rooms_tenant on public.rooms(tenant_id);
create trigger trg_rooms_updated before update on public.rooms
  for each row execute function public.set_updated_at();

-- ---------- Reuniões ----------
create table public.meetings (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  title        text not null,
  description  text,
  room_id      uuid references public.rooms(id) on delete set null,
  organizer_id uuid references public.profiles(id) on delete set null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  status       meeting_status not null default 'scheduled',
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint meetings_time_valid check (ends_at > starts_at),
  -- impede duas reuniões ativas na mesma sala com horários sobrepostos
  constraint meetings_no_overlap exclude using gist (
    room_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status <> 'cancelled' and room_id is not null)
);
create index idx_meetings_tenant on public.meetings(tenant_id);
create index idx_meetings_room on public.meetings(room_id);
create index idx_meetings_starts on public.meetings(starts_at);
create trigger trg_meetings_updated before update on public.meetings
  for each row execute function public.set_updated_at();

-- ---------- Participantes ----------
create table public.meeting_participants (
  meeting_id  uuid not null references public.meetings(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  response    participant_response not null default 'invited',
  created_at  timestamptz not null default now(),
  primary key (meeting_id, user_id)
);
create index idx_participants_user on public.meeting_participants(user_id);

-- ---------- RLS ----------
alter table public.rooms                enable row level security;
alter table public.meetings             enable row level security;
alter table public.meeting_participants enable row level security;

create policy "rooms_member_select" on public.rooms
  for select using (public.is_tenant_member(tenant_id));
create policy "rooms_admin_write" on public.rooms
  for all using (public.has_tenant_role(tenant_id, array['owner','admin','manager']::member_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner','admin','manager']::member_role[]));

create policy "meetings_member_select" on public.meetings
  for select using (public.is_tenant_member(tenant_id));
create policy "meetings_member_write" on public.meetings
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

create policy "participants_member_select" on public.meeting_participants
  for select using (
    exists (select 1 from public.meetings mt
            where mt.id = meeting_id and public.is_tenant_member(mt.tenant_id))
  );
create policy "participants_member_write" on public.meeting_participants
  for all using (
    exists (select 1 from public.meetings mt
            where mt.id = meeting_id and public.is_tenant_member(mt.tenant_id))
  ) with check (
    exists (select 1 from public.meetings mt
            where mt.id = meeting_id and public.is_tenant_member(mt.tenant_id))
  );

