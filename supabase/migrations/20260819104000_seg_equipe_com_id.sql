-- `seg_equipe` precisa de `id` por causa do audit.
--
-- A tabela nasceu com chave composta (tenant_id, user_id), que descreve bem o
-- fato: uma pessoa está na equipe de uma empresa uma vez só. Só que o
-- `audit_trigger()` genérico lê `new.id` para carimbar a entidade alterada, e
-- numa tabela sem essa coluna o insert morre com `record "new" has no field
-- "id"`.
--
-- Auditar aqui não é opcional: esta lista é o que dá a alguém o direito de ler
-- o nome de quem fez cada relato. Então quem ganha coluna é a tabela, e a regra
-- de unicidade vira constraint própria. Mesmo desenho do
-- `ticket_manager_sectors`.

alter table public.seg_equipe drop constraint seg_equipe_pkey;

alter table public.seg_equipe
  add column id uuid not null default gen_random_uuid();

alter table public.seg_equipe
  add constraint seg_equipe_pkey primary key (id),
  add constraint seg_equipe_pessoa_unica unique (tenant_id, user_id);

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
