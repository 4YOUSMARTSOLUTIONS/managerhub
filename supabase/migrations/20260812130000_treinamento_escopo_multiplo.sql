-- "Onde se aplica" passa a aceitar VÁRIOS de cada coisa.
--
-- Unidade já tinha virado N:N na migração anterior; setor, subsetor e pilar
-- continuavam presos a uma coluna única, então um treinamento que vale para
-- Logística e Manutenção obrigava a cadastrar dois cursos iguais, com dois
-- históricos que nunca mais se juntam.
--
-- Em vez de três tabelas quase idênticas (training_departments,
-- training_subdepartments, training_pilares), uma só com `kind` + `ref_id`,
-- mesmo molde polimórfico de `training_assignment_rules`. Bloco e item já
-- entram no CHECK: quando forem para o formulário, não precisam de migração.
--
-- `training_units` é absorvida por ela e sai: duas tabelas para dizer a mesma
-- coisa é como se cria divergência.
--
-- Regra que não muda: NENHUMA linha de um `kind` significa "todos". Marcar
-- cinco setores para dizer "todos" seria trabalho sem informação.

create table public.training_scopes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  training_id uuid not null references public.trainings(id) on delete cascade,
  kind text not null check (kind in ('unit', 'department', 'subdepartment', 'pilar', 'bloco', 'item')),
  ref_id uuid not null,
  created_at timestamptz not null default now(),
  unique (training_id, kind, ref_id)
);
create index training_scopes_training_idx on public.training_scopes (training_id);
create index training_scopes_ref_idx on public.training_scopes (kind, ref_id);

-- absorve o que existir de unidades (hoje: nada, mas a migração precisa ser
-- correta em qualquer ambiente que já tenha rodado a anterior)
insert into public.training_scopes (tenant_id, training_id, kind, ref_id)
select tenant_id, training_id, 'unit', unit_id from public.training_units
on conflict do nothing;

drop table public.training_units;

-- as colunas de escopo saem de `trainings`: quem responde por elas agora é a
-- tabela de escopos, e duas fontes para o mesmo fato divergem em silêncio
alter table public.trainings
  drop column department_id,
  drop column subdepartment_id,
  drop column programa_id,
  drop column pilar_id,
  drop column secao_id,
  drop column bloco_id,
  drop column item_id;

alter table public.training_scopes enable row level security;

create policy training_scopes_select on public.training_scopes
  for select using (public.is_tenant_member(tenant_id));
create policy training_scopes_write on public.training_scopes
  for all using (public.pode_gerir_treinamento(training_id))
  with check (public.pode_gerir_treinamento(training_id));

revoke all on table public.training_scopes from public, anon;

drop trigger if exists audit_training_scopes on public.training_scopes;
create trigger audit_training_scopes
  after insert or update or delete on public.training_scopes
  for each row execute function public.audit_trigger();

notify pgrst, 'reload schema';
