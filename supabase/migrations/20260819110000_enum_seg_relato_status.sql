-- O ciclo de vida do relato.
--
-- `aberto`   chegou, ninguém da segurança olhou ainda.
-- `triado`   a equipe leu, considerou procedente e está tratando.
-- `tratado`  virou ação, alerta ao gestor ou correção; acabou.
-- `improcedente` foi analisado e não era relato de segurança.
-- `duplicado`    já existe outro relato do mesmo fato (aponta para ele).
--
-- Improcedente e duplicado existem para a estatística não mentir: sem eles, o
-- mesmo buraco no piso relatado por cinco pessoas viraria cinco desvios na base
-- da pirâmide, e a empresa acharia que tem cinco problemas.
--
-- Enum sozinho no arquivo, como manda a lição da 20260807120000.

create type public.seg_relato_status as enum
  ('aberto', 'triado', 'tratado', 'improcedente', 'duplicado');

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
