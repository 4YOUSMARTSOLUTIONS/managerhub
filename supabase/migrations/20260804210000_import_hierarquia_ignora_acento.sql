-- A busca do nível de hierarquia passa a ignorar ACENTO, não só a caixa.
--
-- Como estava, "Coordenacao" digitado sem cedilha não casava com "Coordenação"
-- do catálogo e criava um nível duplicado. Numa planilha de 987 linhas
-- preenchida à mão isso não é hipótese, é quando. Já ignorávamos maiúsculas
-- ("DIRETORIA" achava "Diretoria"); acento é o mesmo problema, com a mesma cura.
--
-- A definição é GERADA a partir da que está no banco, em vez de eu reescrever a
-- função inteira: a troca é cirúrgica e não há como um trecho não relacionado
-- mudar sem querer. As duas guardas abortam a migração se o alvo não existir, em
-- vez de deixar passar um replace que não pegou.
do $$
declare
  v_def text;
  v_alvo text := 'where tenant_id = v_tenant and lower(name) = lower(v_hier_name);';
  v_novo text := 'where tenant_id = v_tenant and lower(unaccent(name)) = lower(unaccent(v_hier_name));';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_import_employees';

  if v_def is null then
    raise exception 'admin_import_employees não encontrada';
  end if;
  if position(v_alvo in v_def) = 0 then
    raise exception 'trecho da busca de hierarquia não encontrado: a função mudou de forma';
  end if;

  execute replace(v_def, v_alvo, v_novo);
end $$;

-- AGENTS.md
revoke execute on function public.admin_import_employees(jsonb, text) from public, anon;
grant execute on function public.admin_import_employees(jsonb, text) to authenticated;
