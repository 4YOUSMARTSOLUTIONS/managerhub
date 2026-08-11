-- O fechamento da competência de RV passa a congelar também o VÍNCULO da época.
--
-- O retrato já congelava o dinheiro (pote, proporcional, corte), mas o setor, a
-- função, o gestor e a unidade exibidos continuavam vindo do vínculo ATUAL:
-- transferir o colaborador em outubro reescrevia o rótulo de julho fechado.
-- Com o carimbo, a competência fechada mostra o vínculo de quando foi fechada.
--
-- Colunas novas e NULLABLE de propósito: retratos tirados antes desta migração
-- não têm o carimbo, e a tela cai no vínculo atual nesses casos. Não entra em
-- `detail` porque o contrato daquele campo é a lista de motivos de corte.
--
-- FKs com `on delete set null`, como em employee_contracts: apagar um setor do
-- catálogo não pode impedir a exclusão nem apagar o retrato inteiro.

alter table public.rv_period_snapshots
  add column department_id uuid references public.departments(id) on delete set null,
  add column subdepartment_id uuid references public.subdepartments(id) on delete set null,
  add column position_id uuid references public.positions(id) on delete set null,
  add column manager_id uuid references public.profiles(id) on delete set null,
  add column unit_ids uuid[] not null default '{}';
