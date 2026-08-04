-- Fecha cpf/phone/birth_date/gender para a chave publica.
--
-- ATENCAO ao detalhe que muda a solucao inteira: "revoke select (coluna)" NAO
-- remove um grant de SELECT em nivel de TABELA. E o caso aqui, confirmado no banco:
-- anon e authenticated tinham SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES
-- e TRIGGER em public.profiles, herdados do default ACL do Supabase. E preciso
-- derrubar o SELECT inteiro e devolver, coluna a coluna, so o que pode ser lido.
--
-- As RPCs de escrita continuam funcionando: email_by_cpf, admin_create_employee,
-- admin_update_employee e admin_import_employees sao SECURITY DEFINER e pertencem
-- a postgres, entao dentro delas o usuario efetivo e o dono, que mantem todos os
-- privilegios. Vale inclusive para "where cpf = ..." e para o RETURNING, que
-- exigem SELECT na coluna.
--
-- ORDEM DE APLICACAO: esta migracao entra DEPOIS do deploy do codigo que le esses
-- campos pelas RPCs meu_perfil_pessoal() e tenant_dados_pessoais(). Aplicar antes
-- deixaria "Meu perfil" e Configuracoes quebradas na janela entre uma coisa e
-- outra.
--
-- Verificado depois de aplicar, com sessao simulada:
--   member lendo cpf da tabela ........ recusado (42501)
--   member filtrando por cpf no WHERE . recusado (42501)
--   member lendo id/nome/email ........ 987 linhas, como antes
--   member lendo o PROPRIO cpf (RPC) .. ok
--   owner lendo a ficha (RPC) ......... 987 cpfs
--   email_by_cpf (login por CPF) ...... ok

revoke select on table public.profiles from anon, authenticated;

grant select (id, full_name, email, avatar_url, created_at, updated_at)
  on table public.profiles to authenticated;

-- anon nao le perfil nenhum. A RLS ja bloqueava (sem auth.uid() a policy nao casa),
-- mas o grant de tabela existir era uma camada a menos do que deveria. O login por
-- CPF resolve o e-mail com service role dentro do servidor.

-- Mesma logica na escrita: authenticated tinha UPDATE de tabela e a policy
-- profiles_self_update libera a propria linha, entao um funcionario podia
-- reescrever o proprio cpf ou data de nascimento pelo PostgREST, contornando o
-- admin_update_employee. O unico UPDATE que o app faz com a sessao do usuario e
-- avatar_url (src/lib/actions/profile.ts).
--
-- De brinde: depois disto, um "update ... where cpf = 'X'" disparado por um
-- funcionario falha com 42501 por causa do WHERE. O oraculo por WHERE fecha junto.
revoke insert, update, delete on table public.profiles from anon;
revoke update, delete on table public.profiles from authenticated;
grant update (full_name, avatar_url) on table public.profiles to authenticated;
