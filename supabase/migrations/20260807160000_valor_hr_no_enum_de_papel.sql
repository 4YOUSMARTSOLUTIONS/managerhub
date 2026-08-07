-- Papel `hr` (RH), SOZINHO nesta migração.
--
-- O Postgres não deixa usar um valor de enum na mesma transação que o criou, e a
-- migração seguinte precisa dele nas policies. Mesma separação de `team_lead` e
-- de `falta`.
--
-- RH é um FUNCIONÁRIO COMUM com alçada de departamento pessoal: cadastro de
-- colaborador, férias, punições e remuneração variável. Para todo o resto do
-- sistema (metas, checklists, feedbacks, chamados, logs) ele é `member`, e é por
-- isso que os `role === "admin"` espalhados pelas outras telas NÃO são tocados.

alter type public.member_role add value if not exists 'hr';
