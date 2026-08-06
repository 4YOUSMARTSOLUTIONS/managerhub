-- A reimportação nunca gravava e-mail, telefone, nascimento e sexo.
--
-- Dois defeitos, em ordem de efeito:
--
-- 1) No caminho "mesmo código de funcionário", que é o de TODA reimportação, a
--    função dava `continue` antes do `update public.profiles`. A linha voltava
--    como "Já cadastrado, nada a mudar" e os campos do PERFIL ficavam fora de
--    alcance. Só gestor, perfil de acesso e hierarquia chegavam lá, porque essas
--    três moram em `memberships` e eram tratadas antes do `continue`.
--
-- 2) A guarda de duplicidade de e-mail descartava o valor quando ele já existia
--    em `auth.users`, inclusive quando o dono era a PRÓPRIA pessoa da linha.
--    Reimportar o e-mail de alguém que já o tinha virava um silencioso nada.
--
-- A correção é feita transformando a definição vigente, e não reescrevendo a
-- função: são ~400 linhas e transcrever à mão só criaria uma terceira falha. As
-- âncoras são verificadas, então a migração falha alto se o corpo mudar.
--
-- Blank na planilha continua NÃO limpando o que está gravado (`coalesce`). É
-- proposital: planilha com a coluna faltando apagaria o cadastro de todo mundo.
do $outer$
declare
  src text; antes text; alvo1 text; novo1 text; alvo2 text; novo2 text;
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_import_employees';

  if src is null then raise exception 'admin_import_employees não encontrada'; end if;

  alvo1 := 'if v_email is not null and exists (select 1 from auth.users where email = v_email) then v_email := null; end if;';
  novo1 := 'if v_email is not null and exists (select 1 from auth.users u where u.email = v_email'
        || ' and u.id is distinct from (select p2.id from public.profiles p2 where p2.cpf = v_cpf)) then v_email := null; end if;';
  antes := src; src := replace(src, alvo1, novo1);
  if src = antes then raise exception 'âncora 1 (guarda de duplicidade) não encontrada'; end if;

  alvo2 := E'          continue;\n        end if;\n\n        update public.profiles set';
  novo2 := E'          update public.profiles set\n'
        || E'            full_name = trim(r->>''full_name''),\n'
        || E'            email = coalesce(v_email, email),\n'
        || E'            phone = coalesce(nullif(trim(r->>''phone''), ''''), phone),\n'
        || E'            birth_date = coalesce(public.parse_br_date(r->>''birth_date''), birth_date),\n'
        || E'            gender = v_gender\n'
        || E'          where id = v_existing_uid;\n'
        || E'          continue;\n        end if;\n\n        update public.profiles set';
  antes := src; src := replace(src, alvo2, novo2);
  if src = antes then raise exception 'âncora 2 (continue do mesmo código) não encontrada'; end if;

  execute src;
end $outer$;
