-- Planner v2, enums SOZINHOS nesta migração.
--
-- O Postgres não deixa usar um valor de enum na mesma transação que o criou, e
-- a migração seguinte precisa dos dois em colunas com default. Mesma separação
-- de `team_lead`, `binaria` e `falta`.

-- O progresso é separado da COLUNA de propósito: no Planner um cartão concluído
-- pode continuar na coluna do assunto dele. A coluna organiza; o progresso mede.
create type public.planner_progress as enum ('not_started', 'in_progress', 'done');

-- A recorrência não agenda nada: ao concluir uma tarefa recorrente, a aplicação
-- clona a tarefa com o prazo avançado. O enum só diz o intervalo.
create type public.planner_recurrence as enum ('none', 'daily', 'weekly', 'monthly');
