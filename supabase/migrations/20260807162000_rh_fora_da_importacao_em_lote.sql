-- RH entra na mesma recusa de Administrador e Proprietário na planilha.
--
-- A importação em lote cria conta com senha padrão, e conceder alçada de
-- departamento pessoal a uma linha de Excel é o mesmo risco que já fez
-- Administrador ser recusado ali. RH se atribui um a um, na ficha.
--
-- O corpo é remendado a partir do que está no banco em vez de reescrito: a
-- função tem centenas de linhas e uma cópia à mão seria a chance de perder
-- alguma delas em silêncio.
do $do$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_import_employees';

  v_new := replace(
    v_def,
    $q$in ('administrador', 'admin', 'proprietario', 'owner')$q$,
    $q$in ('administrador', 'admin', 'proprietario', 'owner', 'rh', 'hr', 'recursos humanos')$q$
  );
  if v_new = v_def then
    raise exception 'trecho de perfis recusados não encontrado em admin_import_employees';
  end if;

  execute v_new;
end
$do$;

revoke execute on function public.admin_import_employees(jsonb, text) from public, anon;
