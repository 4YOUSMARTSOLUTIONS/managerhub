-- O histórico do ponto ordena pelo relógio (clock_timestamp), não pelo início da
-- transação: dois passos na mesma transação ficavam com a mesma hora e sem ordem.
-- (A migração 20261127140000 já cria a tabela assim; esta acerta o banco, que foi
-- criado antes da correção.)
alter table public.absenteismo_ponto_historico alter column em set default clock_timestamp();
