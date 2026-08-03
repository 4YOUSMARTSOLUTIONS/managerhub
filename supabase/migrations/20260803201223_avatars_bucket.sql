-- Foto de perfil. Unico bucket PUBLICO do projeto, e de proposito: a foto aparece
-- em toda tela que mostra avatar, entao signed url de 10 min (o padrao dos outros
-- 6 buckets) daria uma chamada por linha de lista, sem cache e com a inicial
-- piscando antes de cada foto. E foto de rosto de colaborador, nao documento.
--
-- Tambem e o primeiro bucket com limite declarado: e o unico que recebe arquivo
-- de camera de celular sem passar por triagem.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- A escrita NAO segue o padrao dos outros buckets (is_tenant_member sobre o
-- primeiro segmento do path): aqui o dono e a pessoa, nao a empresa. O primeiro
-- segmento e o user_id, e so o proprio usuario escreve na sua pasta.
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars_own_insert" on storage.objects;
create policy "avatars_own_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_own_update" on storage.objects;
create policy "avatars_own_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_own_delete" on storage.objects;
create policy "avatars_own_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
