-- Hierarquia do colaborador: Diretoria, Gerência, Coordenação, Supervisão...
--
-- É uma QUINTA dimensão do cadastro, e não se confunde com nenhuma das outras
-- quatro. Vale escrever, porque a confusão é fácil e cara:
--   memberships.role                  -> permissão no sistema (Gestor, Gerencial...)
--   positions                         -> o cargo (Analista de Compras)
--   position_levels ("Perfil Função") -> senioridade DENTRO do cargo (Júnior/Pleno)
--   departments/subdepartments        -> onde a pessoa está (Setor / Sub Setor)
--   hierarchy_levels ("Hierarquia")   -> o nível na estrutura da empresa
--
-- A diferença para os outros catálogos é o `rank`. Hierarquia tem ordem
-- intrínseca: sem ele a lista sairia alfabética e "Analista" apareceria acima de
-- "Diretoria", o que inverte o significado. O rank vai de 10 em 10 de propósito,
-- para caber nível novo no meio sem renumerar a tabela toda.

create table if not exists public.hierarchy_levels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  rank int not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

-- ordenação da tela: `rank` manda, nome só desempata
create index if not exists idx_hierarchy_levels_tenant_rank
  on public.hierarchy_levels (tenant_id, rank, name);

alter table public.hierarchy_levels enable row level security;

-- mesmo par de policies dos demais catálogos: todo membro LÊ (as telas dependem
-- disso), só owner/admin ESCREVE (onda de autorização)
create policy hierarchy_levels_select on public.hierarchy_levels
  for select using (tenant_id in (select public.my_tenant_ids()));

create policy hierarchy_levels_write on public.hierarchy_levels
  for all using (tenant_id in (select public.my_role_tenant_ids(array['owner','admin']::member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids(array['owner','admin']::member_role[])));

-- AGENTS.md: o ACL padrão do Supabase concede tudo a `anon` em toda tabela nova.
-- A RLS já barraria (anon não tem tenant), mas ligar RLS sem tirar o grant deixa
-- a segunda camada por conta de uma policy só.
revoke all on table public.hierarchy_levels from anon;

-- vínculo do colaborador com o nível
alter table public.memberships
  add column if not exists hierarchy_level_id uuid
    references public.hierarchy_levels(id) on delete set null;

-- FK sem índice é varredura na tabela de 987 linhas a cada join (mesma correção
-- feita nos 113 índices da onda de desempenho)
create index if not exists idx_memberships_hierarchy_level
  on public.memberships (hierarchy_level_id);

-- Semente para as empresas que já existem. Do topo ao chão, porque numa
-- distribuidora a maior parte do quadro é operacional e sem os níveis de baixo a
-- maioria ficaria sem classificação.
insert into public.hierarchy_levels (tenant_id, name, rank)
select t.id, x.name, x.rank
from public.tenants t
cross join (values
  ('Diretoria', 10), ('Gerência', 20), ('Coordenação', 30), ('Supervisão', 40),
  ('Liderança', 50), ('Analista', 60), ('Assistente', 70), ('Auxiliar', 80),
  ('Operacional', 90), ('Aprendiz/Estagiário', 100)
) as x(name, rank)
on conflict (tenant_id, name) do nothing;
