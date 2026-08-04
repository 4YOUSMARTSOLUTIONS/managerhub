-- Senha minima de 6 para 8 caracteres.
--
-- Vale so para senhas NOVAS: ninguem e deslogado nem forcado a trocar. O numero
-- importa porque e ele que decide se o throttle de autenticacao e conforto ou
-- defesa: com 6 caracteres, o freio era a unica coisa entre a base e a forca bruta.
--
-- Atinge admin_set_password, admin_create_user, admin_create_employee,
-- admin_import_employees e platform_create_owner. A reescrita e gerada a partir do
-- proprio texto das funcoes, para nao redigir cinco corpos a mao e mudar outra
-- coisa sem querer.
do $$
declare r record; novo text;
begin
  for r in
    select p.oid as f_oid, p.proname as nome
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%length(p_password) < 6%'
  loop
    novo := pg_get_functiondef(r.f_oid);
    novo := replace(novo, 'length(p_password) < 6', 'length(p_password) < 8');
    novo := replace(novo, 'ao menos 6 caracteres', 'ao menos 8 caracteres');
    execute novo;
    raise notice 'senha minima atualizada em %', r.nome;
  end loop;
end $$;
