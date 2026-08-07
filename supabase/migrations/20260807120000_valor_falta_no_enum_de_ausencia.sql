-- Valor `falta` no enum `absence_kind`, SOZINHO nesta migração.
--
-- O Postgres não deixa usar um valor de enum na mesma transação que o criou, e
-- a migração seguinte precisa dele para semear a regra de redutor da falta.
-- Mesma separação que já foi feita quando `team_lead` entrou em `member_role`.
--
-- Falta sem justificativa é dia não trabalhado, então mora em
-- `employee_absences` junto com férias e atestado, e não numa tabela nova: a
-- tela, a RLS e a importação já existem.

alter type public.absence_kind add value if not exists 'falta';
