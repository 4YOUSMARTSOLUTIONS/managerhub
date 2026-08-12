-- Toda conta criada com senha escolhida por OUTRA pessoa já nasce com a troca
-- pendente.
--
-- São cinco funções, e todas escrevem o mesmo literal em `raw_app_meta_data`
-- ao inserir em `auth.users`, o que dá uma âncora de remendo limpa:
--   admin_create_employee    cadastro individual pela ficha
--   admin_import_employees   importação em lote (a senha padrão da planilha)
--   admin_create_user        usuário avulso pelo painel
--   platform_create_owner    proprietário de plataforma
--   platform_create_company  empresa nova com o owner dela
--
-- O corpo é remendado a partir do banco (molde da 20260807162000): o de
-- importação passa de 400 linhas e já vem de quatro remendos anteriores, então
-- reescrever à mão é a forma de perder uma linha em silêncio.
--
-- O ramo de RECONTRATAÇÃO da importação não é tocado, e isso é proposital: ele
-- só atualiza `profiles` e não redefine senha nenhuma. Quem já é da casa não
-- teve a senha mexida pela planilha e não deve ser cobrado.
do $do$
declare
  r record;
  v_def text;
  v_novo text;
  v_achadas text[] := '{}';
  v_esperadas constant text[] := array[
    'admin_create_employee','admin_create_user','admin_import_employees',
    'platform_create_company','platform_create_owner'
  ];
  c_de constant text := $q$'{"provider":"email","providers":["email"]}'$q$;
  c_para constant text := $q$'{"provider":"email","providers":["email"],"must_change_password":true}'$q$;
begin
  for r in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and pg_get_functiondef(p.oid) like '%' || c_de || '%'
     order by p.proname
  loop
    v_def := pg_get_functiondef(r.oid);

    -- o literal precisa aparecer exatamente uma vez: com duas, o replace estaria
    -- mexendo em mais coisa do que se enxerga daqui
    if (length(v_def) - length(replace(v_def, c_de, ''))) / length(c_de) <> 1 then
      raise exception 'literal de app_meta_data aparece % vez(es) em %',
        (length(v_def) - length(replace(v_def, c_de, ''))) / length(c_de), r.proname;
    end if;

    v_novo := replace(v_def, c_de, c_para);
    if v_novo = v_def then raise exception 'remendo não alterou %', r.proname; end if;

    execute v_novo;
    v_achadas := v_achadas || r.proname::text;
  end loop;

  -- o laço não pode ter achado a mais nem a menos do que se sabe existir
  if not (v_achadas @> v_esperadas and v_esperadas @> v_achadas) then
    raise exception 'conjunto inesperado de funções: % (esperado %)', v_achadas, v_esperadas;
  end if;
end
$do$;

revoke execute on function public.admin_create_employee(jsonb, text) from public, anon;
revoke execute on function public.admin_import_employees(jsonb, text) from public, anon;
revoke execute on function public.admin_create_user(text, text, text, member_role) from public, anon;
revoke execute on function public.platform_create_owner(text, text, text) from public, anon;
revoke execute on function public.platform_create_company(text, text, text, text) from public, anon;
