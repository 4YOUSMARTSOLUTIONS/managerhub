-- Quem NÃO solicita as próprias férias: níveis de hierarquia marcados.
--
-- A regra do produto é "colaborador operacional não pede férias; o gestor
-- programa por ele". "Operacional" no MANAGERHUB é um nível do catálogo
-- `hierarchy_levels` (a quinta dimensão do cadastro), então a marcação é por
-- nível, e não por pessoa nem por setor.
--
-- Tabela própria, e não coluna em `hierarchy_levels`, por causa da alçada: o
-- catálogo de hierarquia é escrito só por owner/admin (onda de autorização),
-- mas esta marcação é assunto do departamento pessoal, e o RH precisa poder
-- mudá-la sem ganhar a caneta do catálogo inteiro.
--
-- Nível listado = NÃO solicita. Empresa sem nível marcado = todo mundo solicita
-- (tenant novo nasce sem hierarquia nenhuma; quem cria o catálogo marca aqui).
create table public.ferias_niveis_bloqueados (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  hierarchy_level_id uuid not null references public.hierarchy_levels(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tenant_id, hierarchy_level_id)
);

create index idx_ferias_niveis_bloq_nivel
  on public.ferias_niveis_bloqueados (hierarchy_level_id);

alter table public.ferias_niveis_bloqueados enable row level security;

-- Todo membro LÊ (a tela do colaborador decide se mostra o botão de solicitar);
-- owner/admin/hr escrevem por policy direta: é catálogo simples, sem transição
-- de estado, no molde de `absence_types`.
create policy ferias_niveis_bloq_select on public.ferias_niveis_bloqueados
  for select using (public.is_tenant_member(tenant_id));

create policy ferias_niveis_bloq_write on public.ferias_niveis_bloqueados
  for all
  using (public.has_tenant_role(tenant_id, '{owner,admin,hr}'::public.member_role[]))
  with check (public.has_tenant_role(tenant_id, '{owner,admin,hr}'::public.member_role[]));

revoke all on table public.ferias_niveis_bloqueados from public, anon;

-- Semente para as empresas que já existem. Os nomes cobrem a semente original
-- ('Operacional', 'Aprendiz/Estagiário') e a renomeação posterior que separou
-- 'Estagiário' de 'Aprendiz' (migração 20260804200000).
insert into public.ferias_niveis_bloqueados (tenant_id, hierarchy_level_id)
select h.tenant_id, h.id
  from public.hierarchy_levels h
 where h.name in ('Operacional', 'Aprendiz/Estagiário', 'Estagiário', 'Aprendiz')
on conflict do nothing;

notify pgrst, 'reload schema';
