-- Fechar a competência fecha os lançamentos junto.
--
-- Antes o cadeado travava só o dinheiro (pote, proporcional e corte por conduta)
-- e o desempenho continuava aberto: dava para mudar o realizado de julho depois
-- de julho estar fechado, e o valor mudava com ele. Fechar a competência agora
-- aprova todo lançamento que ainda estava `aberta` naquele mês.
--
-- A coluna guarda EXATAMENTE quais lançamentos o fechamento mexeu, e é isso que
-- torna a reabertura reversível de verdade: sem ela, reabrir teria de escolher
-- entre não desfazer nada ou reabrir também o que o gestor já tinha aprovado à
-- mão antes, apagando uma decisão que não era do cadeado.
--
-- Lançamento `reprovada` não é tocado: uma meta recusada não vira aprovada por
-- o mês ter fechado.
alter table public.rv_period_locks
  add column if not exists closed_entry_ids uuid[] not null default '{}'::uuid[];

comment on column public.rv_period_locks.closed_entry_ids is
  'Lançamentos que estavam `aberta` e o fechamento aprovou. A reabertura devolve estes, e só estes, para `aberta`.';
