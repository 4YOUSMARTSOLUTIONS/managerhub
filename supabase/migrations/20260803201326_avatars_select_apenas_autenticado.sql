-- A leitura da foto acontece pela URL publica (/object/public/...), que ignora a
-- RLS. A policy de select governa outra coisa: LISTAR o bucket. Deixa-la aberta ao
-- publico permitiria a um anonimo enumerar as fotos de todo mundo, que e justamente
-- o que o caminho aleatorio pretendia evitar.
--
-- Restringe a autenticado: colega de empresa ja ve a foto na tela de qualquer jeito.

drop policy if exists "avatars_public_read" on storage.objects;

drop policy if exists "avatars_auth_read" on storage.objects;
create policy "avatars_auth_read" on storage.objects
  for select to authenticated using (bucket_id = 'avatars');
