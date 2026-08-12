-- Origem `trilha` para a matrícula.
--
-- Sozinha numa migração porque o Postgres não deixa usar um valor de enum na
-- mesma transação em que ele foi adicionado. A migração seguinte já insere
-- matrículas com esta origem, e as duas juntas falhariam com "unsafe use of new
-- value of enum type". Mesmo motivo de `team_lead` e `binaria` terem vindo
-- isoladas.

alter type public.training_enrollment_origin add value if not exists 'trilha';
