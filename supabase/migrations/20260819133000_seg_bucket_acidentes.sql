-- Anexos do acidente: CAT digitalizada, laudo, foto do local.
--
-- Bucket PRIVADO, ao contrário dos ícones do catálogo. Aqui há documento médico
-- e foto de cena, e o alcance é o mesmo da tabela: equipe de segurança mais
-- administração. A leitura é sempre por signed URL de 10 minutos, montada na
-- server action.
--
-- A policy recorta pelo tenant do primeiro segmento do caminho e exige
-- `pode_tratar_seguranca`, que é a mesma função da RLS da tabela. `name` do
-- storage sempre qualificado (lição da 20260818110000).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'seg-acidentes', 'seg-acidentes', false, 10485760,
  array[
    'image/jpeg','image/png','image/webp','image/heic',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists seg_acidente_anexo_select on storage.objects;
create policy seg_acidente_anexo_select on storage.objects for select to authenticated
  using (
    bucket_id = 'seg-acidentes'
    and public.pode_tratar_seguranca(((storage.foldername(storage.objects.name))[1])::uuid)
  );

drop policy if exists seg_acidente_anexo_insert on storage.objects;
create policy seg_acidente_anexo_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'seg-acidentes'
    and public.pode_tratar_seguranca(((storage.foldername(storage.objects.name))[1])::uuid)
  );

drop policy if exists seg_acidente_anexo_delete on storage.objects;
create policy seg_acidente_anexo_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'seg-acidentes'
    and public.pode_tratar_seguranca(((storage.foldername(storage.objects.name))[1])::uuid)
  );

do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_n <> 0 then
    raise exception 'ha % funcoes SECURITY DEFINER alcancaveis por anon', v_n;
  end if;
end $$;

notify pgrst, 'reload schema';
