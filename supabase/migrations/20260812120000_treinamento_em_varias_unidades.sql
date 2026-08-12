-- Um treinamento pode valer para VÁRIAS unidades de uma vez.
--
-- A coluna `unit_id` só aceitava uma unidade ou nenhuma (nenhuma = todas), então
-- o mesmo treinamento em duas de cinco filiais obrigava a cadastrar dois cursos
-- iguais, com dois catálogos, dois conjuntos de regras e dois históricos que
-- nunca mais se juntam.
--
-- Vira N:N. A ausência de linha continua significando "todas as unidades", que
-- é o caso mais comum e evita obrigar a marcar cinco caixas para dizer o óbvio.
--
-- Troca limpa: `trainings` ainda não tem uma linha sequer em nenhum ambiente, e
-- por isso a coluna sai em vez de conviver com a tabela nova. Duas fontes para o
-- mesmo fato é como se cria divergência silenciosa.

create table public.training_units (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  training_id uuid not null references public.trainings(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (training_id, unit_id)
);
create index training_units_training_idx on public.training_units (training_id);
create index training_units_unit_idx on public.training_units (unit_id);

alter table public.trainings drop column unit_id;

alter table public.training_units enable row level security;

create policy training_units_select on public.training_units
  for select using (public.is_tenant_member(tenant_id));
create policy training_units_write on public.training_units
  for all using (public.pode_gerir_treinamento(training_id))
  with check (public.pode_gerir_treinamento(training_id));

revoke all on table public.training_units from public, anon;

drop trigger if exists audit_training_units on public.training_units;
create trigger audit_training_units
  after insert or update or delete on public.training_units
  for each row execute function public.audit_trigger();

notify pgrst, 'reload schema';
