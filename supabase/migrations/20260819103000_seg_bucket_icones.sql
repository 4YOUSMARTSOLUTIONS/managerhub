-- Segurança: as figuras dos catálogos.
--
-- O relato é preenchido no chão da operação, muitas vezes no celular e por quem
-- lê pouco. Uma figura por tipo, local e área torna a escolha instantânea. Mas
-- as figuras são de CADA CLIENTE (o armazém dele, a revenda dele), então quem
-- sobe é o admin da empresa em Configurações, não o dono da plataforma.
--
-- Mesma régua do avatar e da foto de grupo: bucket PÚBLICO (a figura aparece em
-- lista e em botão; signed URL por item seria um round-trip por ícone), 2 MB,
-- só imagem. Caminho `{tenant_id}/{uuid}.ext` e escrita de owner/admin do tenant
-- do primeiro segmento.
--
-- `storage.objects.name` sempre QUALIFICADO (lição da 20260818110000): `name`
-- cru dentro de um EXISTS é capturado por qualquer tabela da subquery que tenha
-- coluna homônima, e a policy passa a comparar a coisa errada em silêncio.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('seg-icones', 'seg-icones', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists seg_icones_insert on storage.objects;
create policy seg_icones_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'seg-icones'
    and public.has_tenant_role(
      ((storage.foldername(storage.objects.name))[1])::uuid,
      '{owner,admin}'::public.member_role[]
    )
  );

drop policy if exists seg_icones_update on storage.objects;
create policy seg_icones_update on storage.objects for update to authenticated
  using (
    bucket_id = 'seg-icones'
    and public.has_tenant_role(
      ((storage.foldername(storage.objects.name))[1])::uuid,
      '{owner,admin}'::public.member_role[]
    )
  );

drop policy if exists seg_icones_delete on storage.objects;
create policy seg_icones_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'seg-icones'
    and public.has_tenant_role(
      ((storage.foldername(storage.objects.name))[1])::uuid,
      '{owner,admin}'::public.member_role[]
    )
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
