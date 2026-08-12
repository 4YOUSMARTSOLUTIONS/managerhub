-- Treinamentos, leva 2: turmas, convocação e lista de presença.
--
-- A TURMA é a oferta do curso: data, instrutor, local, vagas. Um curso pode ter
-- quantas quiser ao longo do tempo, e é por isso que ela nasceu separada do
-- catálogo na leva 1. Treinamento auto instrucional segue sem turma nenhuma.
--
-- Duas regras que o usuário pediu e que moram aqui:
--
--   1. Turma conduzida por instrutor não começa sozinha. `released_at` é a
--      liberação: enquanto for nulo, o colaborador vê a turma mas não inicia.
--   2. A presença é registro ESTRUTURADO por participante (presente, ausente,
--      justificado), e não um PDF anexado. Sem isso não há como calcular
--      aderência nem responder "quem faltou" sem abrir arquivo.
--
-- `no_show` (convocado que não apareceu) é diferente de `justificado` (estava de
-- férias ou afastado). O segundo não conta como falha de ninguém e sai do
-- denominador da aderência.

create type public.training_session_status as enum (
  'planejada', 'liberada', 'em_andamento', 'concluida', 'cancelada'
);

create type public.training_attendance_status as enum ('presente', 'ausente', 'justificado');

create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  training_id uuid not null references public.trainings(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  name text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  instructor_id uuid references public.profiles(id) on delete set null,
  -- null = sem limite de vagas
  capacity integer,
  status public.training_session_status not null default 'planejada',
  -- carimbo da liberação do instrutor: sem ele o participante não inicia
  released_at timestamptz,
  released_by uuid references public.profiles(id) on delete set null,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_sessions_intervalo check (ends_at is null or ends_at >= starts_at),
  constraint training_sessions_vagas check (capacity is null or capacity > 0)
);
create index training_sessions_training_idx on public.training_sessions (training_id, starts_at desc);
create index training_sessions_instrutor_idx on public.training_sessions (instructor_id);
create index training_sessions_data_idx on public.training_sessions (tenant_id, starts_at desc);

-- a matrícula aponta para a turma em que a pessoa foi convocada (a coluna
-- nasceu na leva 1 sem FK, porque a tabela ainda não existia)
alter table public.training_enrollments
  add constraint training_enrollments_session_fkey
  foreign key (session_id) references public.training_sessions(id) on delete set null;

create table public.training_session_attendance (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  enrollment_id uuid not null references public.training_enrollments(id) on delete cascade,
  status public.training_attendance_status not null,
  note text,
  checked_by uuid references public.profiles(id) on delete set null,
  checked_at timestamptz not null default now(),
  unique (session_id, enrollment_id)
);
create index training_attendance_session_idx on public.training_session_attendance (session_id);

-- ---------------------------------------------------------------- helper
-- Quem opera a turma: o instrutor, quem responde pelo curso e a administração.
create or replace function public.pode_gerir_turma(p_session uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.training_sessions s
     where s.id = p_session
       and public.is_tenant_member(s.tenant_id)
       and (
         s.instructor_id = (select auth.uid())
         or s.created_by = (select auth.uid())
         or public.pode_gerir_treinamento(s.training_id)
       )
  );
$$;

revoke execute on function public.pode_gerir_turma(uuid) from public, anon;
grant execute on function public.pode_gerir_turma(uuid) to authenticated;

-- ---------------------------------------------------------------- RLS
alter table public.training_sessions enable row level security;
alter table public.training_session_attendance enable row level security;

-- a turma é visível a todo membro: é a agenda de treinamento da empresa, e quem
-- foi convocado precisa ver data, local e instrutor
create policy training_sessions_select on public.training_sessions
  for select using (public.is_tenant_member(tenant_id));
create policy training_sessions_insert on public.training_sessions
  for insert with check (
    public.is_tenant_member(tenant_id) and public.pode_gerir_treinamento(training_id)
  );
create policy training_sessions_update on public.training_sessions
  for update using (public.pode_gerir_turma(id)) with check (public.pode_gerir_turma(id));
create policy training_sessions_delete on public.training_sessions
  for delete using (public.pode_gerir_turma(id));

-- presença: o próprio participante vê a dele; instrutor e administração veem e
-- lançam a de todos
create policy training_attendance_select on public.training_session_attendance
  for select using (
    public.is_tenant_member(tenant_id)
    and (
      public.pode_gerir_turma(session_id)
      or exists (select 1 from public.training_enrollments e
                  where e.id = enrollment_id
                    and (e.user_id = (select auth.uid()) or public.manages_user(e.user_id, e.tenant_id)))
    )
  );
create policy training_attendance_write on public.training_session_attendance
  for all using (public.pode_gerir_turma(session_id))
  with check (public.pode_gerir_turma(session_id));

revoke all on table public.training_sessions from public, anon;
revoke all on table public.training_session_attendance from public, anon;

do $$
declare t text;
begin
  foreach t in array array['training_sessions','training_session_attendance'] loop
    execute format(
      'drop trigger if exists %I on public.%I; create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_trigger();',
      'audit_' || t, t, 'audit_' || t, t);
  end loop;
end $$;

notify pgrst, 'reload schema';

do $$
declare n int;
begin
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if n <> 0 then raise exception 'secdef executável por anon: %', n; end if;
end $$;
