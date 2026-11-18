-- Banco de conhecimento: quem escreve é o Proprietário (LUIZ, 18/11/2026).
--
-- A primeira versão exigia o dono da plataforma (platform_admins), que é a
-- conta da 4YOU; o LUIZ trabalha com o login de Proprietário da Cervantes e
-- ficava só lendo. Decisão dele: liberar para o perfil Proprietário. Hoje a
-- Cervantes é a única empresa e ele o único proprietário; quando entrar outra
-- empresa, o proprietário dela também poderá editar os manuais (globais), e a
-- regra deve ser revista.

create or replace function public.pode_escrever_conhecimento()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.is_super_admin()
      or exists (
        select 1 from public.memberships m
        where m.user_id = (select auth.uid()) and m.role = 'owner' and m.is_active
      );
$$;

-- usada nas políticas (que rodam como authenticated): fica o grant dele
revoke execute on function public.pode_escrever_conhecimento() from public, anon;
grant execute on function public.pode_escrever_conhecimento() to authenticated;

drop policy if exists conhecimento_ler on public.conhecimento_artigos;
create policy conhecimento_ler on public.conhecimento_artigos
  for select to authenticated
  using (publicado or public.pode_escrever_conhecimento());

drop policy if exists conhecimento_criar on public.conhecimento_artigos;
create policy conhecimento_criar on public.conhecimento_artigos
  for insert to authenticated
  with check (public.pode_escrever_conhecimento());

drop policy if exists conhecimento_editar on public.conhecimento_artigos;
create policy conhecimento_editar on public.conhecimento_artigos
  for update to authenticated
  using (public.pode_escrever_conhecimento())
  with check (public.pode_escrever_conhecimento());

drop policy if exists conhecimento_apagar on public.conhecimento_artigos;
create policy conhecimento_apagar on public.conhecimento_artigos
  for delete to authenticated
  using (public.pode_escrever_conhecimento());

drop policy if exists conhecimento_imagem_enviar on storage.objects;
create policy conhecimento_imagem_enviar on storage.objects
  for insert to authenticated
  with check (bucket_id = 'conhecimento' and public.pode_escrever_conhecimento());

drop policy if exists conhecimento_imagem_trocar on storage.objects;
create policy conhecimento_imagem_trocar on storage.objects
  for update to authenticated
  using (bucket_id = 'conhecimento' and public.pode_escrever_conhecimento())
  with check (bucket_id = 'conhecimento' and public.pode_escrever_conhecimento());

drop policy if exists conhecimento_imagem_apagar on storage.objects;
create policy conhecimento_imagem_apagar on storage.objects
  for delete to authenticated
  using (bucket_id = 'conhecimento' and public.pode_escrever_conhecimento());

notify pgrst, 'reload schema';
