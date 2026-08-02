-- email_by_cpf devolve o e-mail de autenticacao a partir do CPF. Exposta ao anon,
-- era um oraculo: com uma lista de CPFs qualquer um mapeava os e-mails corporativos
-- dos colaboradores sem estar logado.
--
-- O login por CPF passou a resolver isso com service role, dentro do servidor
-- (src/lib/actions/auth.ts), entao a funcao nao precisa mais ser alcancavel pela
-- chave publica nem por usuarios logados.

revoke execute on function public.email_by_cpf(text) from public, anon, authenticated;
