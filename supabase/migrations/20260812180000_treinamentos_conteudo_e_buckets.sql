-- Treinamentos, leva 3: conteúdo (vídeo, arquivo, link, texto), progresso e
-- certificado.
--
-- O NR-1, Anexo II, exige de EAD mais do que "concluído sim ou não": pede
-- monitoramento de acesso e permanência com registro auditável. Por isso o
-- progresso tem duas tabelas: `training_material_progress` guarda o estado
-- atual (quanto já viu) e `training_watch_spans` guarda as JANELAS de
-- visualização, uma por sessão contínua. Sem as janelas, não há como responder
-- a um fiscal "quando e por quanto tempo esta pessoa assistiu".
--
-- `max_position_seconds` é o antiburla básico: guarda o ponto mais distante que
-- a pessoa já alcançou de verdade. Arrastar a barra para o fim aumenta a
-- posição atual, mas não o tempo assistido, e a conclusão olha o tempo.
--
-- LIMITE DE VÍDEO. O bucket tem o teto técnico (1 GB), mas o limite que vale no
-- dia a dia é por EMPRESA, em `tenants.training_video_max_mb`, com padrão de
-- 100 MB. Vídeo de treinamento bem exportado cabe folgado nisso, e um cliente
-- que precise de mais é ajuste de configuração, não de código. O teto do bucket
-- existe porque ele é a única barreira que vale mesmo se alguém chamar a API do
-- Storage por fora.

create type public.training_material_kind as enum (
  'video_upload', 'video_url', 'arquivo', 'link', 'texto'
);

alter table public.tenants
  add column training_video_max_mb integer not null default 100
  constraint tenants_video_mb_valido check (training_video_max_mb between 1 and 1024);

create table public.training_materials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  training_id uuid not null references public.trainings(id) on delete cascade,
  sort integer not null default 0,
  kind public.training_material_kind not null,
  title text not null,
  -- video_upload e arquivo: caminho no Storage
  storage_path text,
  filename text,
  size_bytes bigint,
  content_type text,
  -- video_url e link: endereço externo (YouTube não listado, Vimeo, intranet)
  external_url text,
  -- texto: o conteúdo escrito direto no sistema
  body text,
  duration_seconds integer,
  /**
   * Percentual mínimo assistido para dar o material por concluído.
   * 90 é o padrão de mercado; abaixo disso a evidência fica frágil.
   */
  min_watch_pct smallint not null default 90 check (min_watch_pct between 1 and 100),
  required boolean not null default true,
  deleted_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index training_materials_training_idx
  on public.training_materials (training_id, sort) where deleted_at is null;

create table public.training_material_progress (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  enrollment_id uuid not null references public.training_enrollments(id) on delete cascade,
  material_id uuid not null references public.training_materials(id) on delete cascade,
  /** segundos EFETIVAMENTE assistidos, somados pelos heartbeats */
  watched_seconds integer not null default 0,
  /** ponto mais distante já alcançado; pular para o fim não conta como assistir */
  max_position_seconds integer not null default 0,
  pct smallint not null default 0 check (pct between 0 and 100),
  completed_at timestamptz,
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  unique (enrollment_id, material_id)
);
create index training_progress_enrollment_idx on public.training_material_progress (enrollment_id);

-- append-only: o log de permanência que a NR-1 pede
create table public.training_watch_spans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  enrollment_id uuid not null references public.training_enrollments(id) on delete cascade,
  material_id uuid not null references public.training_materials(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz not null default now(),
  from_seconds integer not null default 0,
  to_seconds integer not null default 0
);
create index training_spans_enrollment_idx on public.training_watch_spans (enrollment_id, material_id);

-- Certificado: registro IMUTÁVEL, com o retrato do que a NR-1 manda constar.
-- Não é uma view da matrícula: se o curso for renomeado ou a carga mudar
-- amanhã, o que foi emitido hoje continua dizendo o que valia hoje.
create table public.training_certificates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  enrollment_id uuid not null references public.training_enrollments(id) on delete cascade,
  code text not null,
  user_name text not null,
  training_name text not null,
  workload_minutes integer not null,
  content_summary text,
  instructor_name text,
  completed_at timestamptz not null,
  expires_at date,
  score numeric(5,2),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (enrollment_id),
  unique (code)
);

alter table public.training_materials enable row level security;
alter table public.training_material_progress enable row level security;
alter table public.training_watch_spans enable row level security;
alter table public.training_certificates enable row level security;

-- material é o conteúdo do curso: todo membro vê, quem gere o curso edita
create policy training_materials_select on public.training_materials
  for select using (public.is_tenant_member(tenant_id));
create policy training_materials_write on public.training_materials
  for all using (public.pode_gerir_treinamento(training_id))
  with check (public.pode_gerir_treinamento(training_id));

-- progresso e janelas: o próprio, a cadeia de gestão, quem responde pelo curso
-- e a administração. Escrita é do próprio (é ele que assiste).
create policy training_progress_select on public.training_material_progress
  for select using (
    exists (select 1 from public.training_enrollments e
             where e.id = enrollment_id
               and (e.user_id = (select auth.uid())
                    or public.manages_user(e.user_id, e.tenant_id)
                    or public.pode_gerir_treinamento(e.training_id)))
  );
create policy training_progress_write on public.training_material_progress
  for all using (
    exists (select 1 from public.training_enrollments e
             where e.id = enrollment_id and e.user_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.training_enrollments e
             where e.id = enrollment_id and e.user_id = (select auth.uid()))
  );

create policy training_spans_select on public.training_watch_spans
  for select using (
    exists (select 1 from public.training_enrollments e
             where e.id = enrollment_id
               and (e.user_id = (select auth.uid())
                    or public.manages_user(e.user_id, e.tenant_id)
                    or public.pode_gerir_treinamento(e.training_id)))
  );
-- só INSERT: janela de visualização é evidência, não se edita nem se apaga
create policy training_spans_insert on public.training_watch_spans
  for insert with check (
    exists (select 1 from public.training_enrollments e
             where e.id = enrollment_id and e.user_id = (select auth.uid()))
  );

create policy training_certificates_select on public.training_certificates
  for select using (
    exists (select 1 from public.training_enrollments e
             where e.id = enrollment_id
               and (e.user_id = (select auth.uid())
                    or public.manages_user(e.user_id, e.tenant_id)
                    or public.has_tenant_role(e.tenant_id, '{owner,admin,hr}'::public.member_role[])
                    or public.pode_gerir_treinamento(e.training_id)))
  );
-- sem policy de update nem de delete: certificado emitido não se altera

revoke all on table public.training_materials from public, anon;
revoke all on table public.training_material_progress from public, anon;
revoke all on table public.training_watch_spans from public, anon;
revoke all on table public.training_certificates from public, anon;
revoke update, delete on table public.training_watch_spans from authenticated;
revoke update, delete on table public.training_certificates from authenticated;

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('training-videos', 'training-videos', false, 1073741824,
   array['video/mp4','video/webm','video/quicktime','video/x-m4v']),
  ('training-files', 'training-files', false, 52428800,
   array['application/pdf','image/jpeg','image/png','image/webp',
         'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- mesmo padrão dos demais buckets privados: o tenant é o primeiro segmento do
-- caminho, e a policy confere a associação
do $$
declare b text;
begin
  foreach b in array array['training-videos','training-files'] loop
    execute format($f$
      drop policy if exists %I on storage.objects;
      create policy %I on storage.objects for all
        using (bucket_id = %L and public.is_tenant_member(((storage.foldername(name))[1])::uuid))
        with check (bucket_id = %L and public.is_tenant_member(((storage.foldername(name))[1])::uuid));
    $f$, b || '_tenant', b || '_tenant', b, b);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['training_materials','training_certificates'] loop
    execute format(
      'drop trigger if exists %I on public.%I; create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_trigger();',
      'audit_' || t, t, 'audit_' || t, t);
  end loop;
end $$;

notify pgrst, 'reload schema';
