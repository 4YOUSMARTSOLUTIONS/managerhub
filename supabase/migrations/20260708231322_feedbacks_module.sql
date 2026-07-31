-- ---------- enums ----------
create type public.feedback_type as enum ('reconhecimento','construtivo','neutro');
create type public.feedback_visibility as enum ('compartilhado','privado');
create type public.feedback_channel as enum ('presencial','reuniao_1a1','videochamada','mensagem','outro');

-- ---------- catálogo de competências ----------
create table public.feedback_competencies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- feedbacks ----------
create table public.feedbacks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subject_user_id uuid not null references public.profiles(id),
  author_id uuid not null references public.profiles(id),
  feedback_date date not null,
  type public.feedback_type not null,
  channel public.feedback_channel,
  title text,
  situation text,
  behavior text,
  impact text,
  next_steps text,
  notes text,
  visibility public.feedback_visibility not null default 'compartilhado',
  acknowledged_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index feedbacks_subject_idx on public.feedbacks (tenant_id, subject_user_id, feedback_date desc);

create table public.feedback_competency_links (
  feedback_id uuid not null references public.feedbacks(id) on delete cascade,
  competency_id uuid not null references public.feedback_competencies(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  primary key (feedback_id, competency_id)
);

create table public.feedback_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  feedback_id uuid not null references public.feedbacks(id) on delete cascade,
  path text not null,
  filename text not null,
  size bigint,
  content_type text,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);

-- ---------- RLS ----------
alter table public.feedback_competencies enable row level security;
alter table public.feedbacks enable row level security;
alter table public.feedback_competency_links enable row level security;
alter table public.feedback_attachments enable row level security;

-- catálogo
create policy fb_comp_select on public.feedback_competencies
  for select using (public.is_tenant_member(tenant_id));
create policy fb_comp_write on public.feedback_competencies
  for all using (public.is_tenant_member(tenant_id) and public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]))
  with check (public.is_tenant_member(tenant_id) and public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]));

-- feedbacks
create policy fb_select on public.feedbacks
  for select using (
    public.is_tenant_member(tenant_id) and (
      public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[])
      or public.manages_user(subject_user_id, tenant_id)
      or author_id = auth.uid()
      or (subject_user_id = auth.uid() and visibility = 'compartilhado')
    )
  );
create policy fb_insert on public.feedbacks
  for insert with check (
    public.is_tenant_member(tenant_id)
    and author_id = auth.uid()
    and subject_user_id <> auth.uid()
    and (public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]) or public.manages_user(subject_user_id, tenant_id))
  );
create policy fb_update on public.feedbacks
  for update using (
    public.is_tenant_member(tenant_id) and (public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]) or author_id = auth.uid())
  ) with check (
    public.is_tenant_member(tenant_id) and (public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]) or author_id = auth.uid())
  );
create policy fb_delete on public.feedbacks
  for delete using (
    public.is_tenant_member(tenant_id) and (public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]) or author_id = auth.uid())
  );

-- links: leitura se enxerga o feedback pai; escrita se autor/admin do feedback pai
create policy fb_link_select on public.feedback_competency_links
  for select using (exists (select 1 from public.feedbacks f where f.id = feedback_id));
create policy fb_link_write on public.feedback_competency_links
  for all using (
    exists (select 1 from public.feedbacks f where f.id = feedback_id
      and (public.has_tenant_role(f.tenant_id, '{owner,admin}'::public.member_role[]) or f.author_id = auth.uid()))
  ) with check (
    exists (select 1 from public.feedbacks f where f.id = feedback_id
      and (public.has_tenant_role(f.tenant_id, '{owner,admin}'::public.member_role[]) or f.author_id = auth.uid()))
  );

-- anexos: idem
create policy fb_att_select on public.feedback_attachments
  for select using (exists (select 1 from public.feedbacks f where f.id = feedback_id));
create policy fb_att_write on public.feedback_attachments
  for all using (
    exists (select 1 from public.feedbacks f where f.id = feedback_id
      and (public.has_tenant_role(f.tenant_id, '{owner,admin}'::public.member_role[]) or f.author_id = auth.uid()))
  ) with check (
    exists (select 1 from public.feedbacks f where f.id = feedback_id
      and (public.has_tenant_role(f.tenant_id, '{owner,admin}'::public.member_role[]) or f.author_id = auth.uid()))
  );

-- ---------- storage bucket ----------
insert into storage.buckets (id, name, public) values ('feedback-attachments','feedback-attachments', false)
  on conflict (id) do nothing;

create policy fb_attach_select on storage.objects
  for select using (bucket_id = 'feedback-attachments' and public.is_tenant_member(((storage.foldername(name))[1])::uuid));
create policy fb_attach_insert on storage.objects
  for insert with check (bucket_id = 'feedback-attachments' and public.is_tenant_member(((storage.foldername(name))[1])::uuid));
create policy fb_attach_delete on storage.objects
  for delete using (bucket_id = 'feedback-attachments' and public.is_tenant_member(((storage.foldername(name))[1])::uuid));
