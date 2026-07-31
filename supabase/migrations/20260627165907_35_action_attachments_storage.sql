
insert into storage.buckets (id, name, public)
values ('action-attachments', 'action-attachments', false)
on conflict (id) do nothing;

-- caminho: <tenant_id>/<action_id>/<arquivo>  → acesso só a membros do tenant
drop policy if exists action_attach_select on storage.objects;
create policy action_attach_select on storage.objects for select to authenticated
using (bucket_id = 'action-attachments' and public.is_tenant_member(((storage.foldername(name))[1])::uuid));

drop policy if exists action_attach_insert on storage.objects;
create policy action_attach_insert on storage.objects for insert to authenticated
with check (bucket_id = 'action-attachments' and public.is_tenant_member(((storage.foldername(name))[1])::uuid));

drop policy if exists action_attach_delete on storage.objects;
create policy action_attach_delete on storage.objects for delete to authenticated
using (bucket_id = 'action-attachments' and public.is_tenant_member(((storage.foldername(name))[1])::uuid));

