-- Bucket dos anexos de tarefa do Planner.
--
-- Privado, 10MB, mesmos MIMEs de `src/lib/uploads.ts` — o mesmo contrato dos
-- demais buckets de arquivo (migração 20260804034330). O caminho é
-- `tenant/task/arquivo`, e a policy lê o PRIMEIRO segmento: o recorte fino
-- (participante do quadro) é feito na server action, antes do storage — o
-- mesmo trade-off já aceito nos anexos de demanda, documentado lá.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'planner-attachments', 'planner-attachments', false, 10485760,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv'
  ]
)
on conflict (id) do nothing;

create policy planner_att_read on storage.objects for select
  using (bucket_id = 'planner-attachments'
         and public.is_tenant_member(((storage.foldername(name))[1])::uuid));
create policy planner_att_insert on storage.objects for insert
  with check (bucket_id = 'planner-attachments'
              and public.is_tenant_member(((storage.foldername(name))[1])::uuid));
create policy planner_att_delete on storage.objects for delete
  using (bucket_id = 'planner-attachments'
         and public.is_tenant_member(((storage.foldername(name))[1])::uuid));
