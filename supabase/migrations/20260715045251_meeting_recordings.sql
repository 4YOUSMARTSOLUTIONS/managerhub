-- Enum de status da transcrição
create type public.recording_transcript_status as enum ('pendente','processando','concluida','falha');

-- Tabela de gravações da reunião (ligada à ocorrência; sobrevive à finalização)
create table public.meeting_recordings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  occurrence_id uuid not null references public.meeting_occurrences(id) on delete cascade,
  path text not null,
  filename text not null,
  size bigint,
  content_type text,
  duration_seconds integer,
  source text not null default 'gravacao',
  transcript text,
  transcript_status public.recording_transcript_status not null default 'pendente',
  transcript_error text,
  transcribed_at timestamptz,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);
create index meeting_recordings_occ_idx on public.meeting_recordings(occurrence_id);

alter table public.meeting_recordings enable row level security;

-- RLS herda a privacidade da reunião (can_view_series)
create policy meeting_recordings_rw on public.meeting_recordings for all
  using (exists (select 1 from public.meeting_occurrences o join public.meeting_series s on s.id = o.series_id
                 where o.id = meeting_recordings.occurrence_id and public.can_view_series(s.*)))
  with check (exists (select 1 from public.meeting_occurrences o join public.meeting_series s on s.id = o.series_id
                 where o.id = meeting_recordings.occurrence_id and public.can_view_series(s.*)));

-- Bucket privado + storage policies (foldername[1] = tenant)
insert into storage.buckets (id, name, public) values ('meeting-audio','meeting-audio', false)
on conflict (id) do nothing;

create policy meeting_audio_read on storage.objects for select
  using (bucket_id = 'meeting-audio' and public.is_tenant_member(((storage.foldername(name))[1])::uuid));
create policy meeting_audio_insert on storage.objects for insert
  with check (bucket_id = 'meeting-audio' and public.is_tenant_member(((storage.foldername(name))[1])::uuid));
create policy meeting_audio_delete on storage.objects for delete
  using (bucket_id = 'meeting-audio' and public.is_tenant_member(((storage.foldername(name))[1])::uuid));

-- Modelo de transcrição por tenant
alter table public.tenants add column if not exists openai_transcribe_model text not null default 'gpt-4o-mini-transcribe';

-- Estende set_openai_settings para também gravar o modelo de transcrição
drop function if exists public.set_openai_settings(text, text, boolean);
create or replace function public.set_openai_settings(p_key text, p_model text, p_clear boolean default false, p_transcribe_model text default null)
returns void language plpgsql security definer set search_path to 'public','extensions' as $function$
declare v_tenant uuid := public.my_active_tenant();
begin
  if v_tenant is null then raise exception 'Nenhuma empresa ativa.'; end if;
  if not public.has_tenant_role(v_tenant, array['owner']::member_role[]) then
    raise exception 'Apenas o proprietário pode configurar a integração com IA.'; end if;
  if p_clear then
    delete from public.tenant_secrets where tenant_id = v_tenant;
    update public.tenants set has_openai_key = false where id = v_tenant;
  elsif coalesce(trim(p_key),'') <> '' then
    insert into public.tenant_secrets (tenant_id, openai_api_key, updated_at)
    values (v_tenant, trim(p_key), now())
    on conflict (tenant_id) do update set openai_api_key = excluded.openai_api_key, updated_at = now();
    update public.tenants set has_openai_key = true where id = v_tenant;
  end if;
  update public.tenants set
    openai_model = coalesce(nullif(trim(p_model),''), openai_model),
    openai_transcribe_model = coalesce(nullif(trim(p_transcribe_model),''), openai_transcribe_model)
  where id = v_tenant;
end; $function$;
