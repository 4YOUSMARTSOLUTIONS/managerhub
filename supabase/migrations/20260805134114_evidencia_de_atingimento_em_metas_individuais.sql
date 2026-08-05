-- Evidência do atingimento em metas individuais.
--
-- O anexo pende do LANÇAMENTO (goal_id + competência), não da meta: a prova é do
-- resultado daquele mês, e a mesma meta tem uma evidência por competência.
--
-- `evidence_required` nasce false, então as metas já cadastradas continuam
-- opcionais, que é o combinado.

alter table public.individual_goals
  add column if not exists evidence_required boolean not null default false;

comment on column public.individual_goals.evidence_required is
  'true = não aceita gravar o realizado desta meta sem pelo menos um anexo de evidência';

create table if not exists public.individual_goal_entry_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entry_id uuid not null references public.individual_goal_entries(id) on delete cascade,
  path text not null,
  filename text not null,
  size bigint,
  content_type text,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_iga_att_entry on public.individual_goal_entry_attachments(entry_id);

alter table public.individual_goal_entry_attachments enable row level security;

-- Quem enxerga/mexe no LANÇAMENTO enxerga/mexe no anexo dele. A subconsulta
-- respeita a RLS de `individual_goal_entries`, então a regra de dono/gestor/admin
-- que já existe lá vale aqui sem ser reescrita — e não pode divergir depois.
drop policy if exists iga_att_select on public.individual_goal_entry_attachments;
create policy iga_att_select on public.individual_goal_entry_attachments
  for select using (
    exists (select 1 from public.individual_goal_entries e where e.id = entry_id)
  );

drop policy if exists iga_att_insert on public.individual_goal_entry_attachments;
create policy iga_att_insert on public.individual_goal_entry_attachments
  for insert with check (
    exists (
      select 1 from public.individual_goal_entries e
      where e.id = entry_id and e.approval_status <> 'aprovada'
    )
  );

-- Competência aprovada = registro. Dá para baixar, não dá para apagar; quem
-- precisar corrigir reabre a competência, que já exige senha de admin.
drop policy if exists iga_att_delete on public.individual_goal_entry_attachments;
create policy iga_att_delete on public.individual_goal_entry_attachments
  for delete using (
    exists (
      select 1 from public.individual_goal_entries e
      where e.id = entry_id and e.approval_status <> 'aprovada'
    )
  );

-- ---------- bucket ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'goal-evidence', 'goal-evidence', false, 10485760,
  array[
    'image/jpeg','image/png','image/webp','image/gif','image/heic',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain','text/csv'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- primeira pasta do caminho = tenant_id, igual aos demais buckets do sistema
drop policy if exists goal_evidence_select on storage.objects;
create policy goal_evidence_select on storage.objects
  for select using (bucket_id = 'goal-evidence' and public.is_tenant_member(((storage.foldername(name))[1])::uuid));

drop policy if exists goal_evidence_insert on storage.objects;
create policy goal_evidence_insert on storage.objects
  for insert with check (bucket_id = 'goal-evidence' and public.is_tenant_member(((storage.foldername(name))[1])::uuid));

drop policy if exists goal_evidence_delete on storage.objects;
create policy goal_evidence_delete on storage.objects
  for delete using (bucket_id = 'goal-evidence' and public.is_tenant_member(((storage.foldername(name))[1])::uuid));
