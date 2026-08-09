-- Planner: quadros com colunas livres e cartões, no molde do Microsoft Planner.
--
-- O desenho separa três círculos, e a RLS é a tradução deles:
--
--   * DONO         quem criou o quadro. Só ele renomeia, exclui e convida.
--   * PARTICIPANTE dono ∪ membros convidados. Escrevem: colunas, cartões, arraste.
--   * VISÍVEL      participante ∪ o GESTOR de qualquer participante (cadeia de
--                  chefia via my_managed_memberships). O gestor só lê: o quadro
--                  da equipe é transparente para cima, não editável de cima.
--
-- O criador NÃO vira linha em planner_board_members, de propósito: participante
-- é derivado (created_by ∪ membros), e ter as duas coisas criaria o estado
-- "criador removido da própria lista", que ninguém sabe o que significa.
--
-- `board_id` é denormalizado em tasks e task_assignees para as policies
-- resolverem em UM salto (`board_id in (select fn())`), no formato SETOF que o
-- planner consegue otimizar. A lição de performance está em
-- 20260804003639_rls_actions_select_em_conjunto.sql: função boolean por linha
-- nunca é inlined e virava 2.583ms; o formato conjunto caiu para 39ms.
--
-- A ordenação de colunas e cartões é `position` inteiro esparso (passo 1024):
-- mover é o ponto médio dos vizinhos, e quando o ponto médio colide a server
-- action renormaliza o bucket. O banco não guarda regra disso; é decisão de
-- aplicação, e a coluna é só um número.

-- ------------------------------------------------------------------ tabelas

create table public.planner_boards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index planner_boards_dono_idx on public.planner_boards (tenant_id, created_by);

create table public.planner_board_members (
  board_id uuid not null references public.planner_boards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);
create index planner_board_members_user_idx on public.planner_board_members (tenant_id, user_id);

create table public.planner_buckets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  board_id uuid not null references public.planner_boards(id) on delete cascade,
  name text not null,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index planner_buckets_board_idx on public.planner_buckets (board_id, position);

create table public.planner_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- denormalizado do bucket: é o que deixa a policy em um salto. A server action
  -- de mover garante que bucket e board andam juntos.
  board_id uuid not null references public.planner_boards(id) on delete cascade,
  bucket_id uuid not null references public.planner_buckets(id) on delete cascade,
  title text not null,
  description text,
  due_date date,
  -- o mesmo enum das ações: prioridade não merece um vocabulário próprio
  priority public.priority_level,
  -- "feito" é um risco no cartão, independente da coluna em que ele está:
  -- no Planner um cartão concluído pode continuar na coluna do assunto dele
  completed_at timestamptz,
  position integer not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index planner_tasks_bucket_idx on public.planner_tasks (bucket_id, position);
create index planner_tasks_board_idx on public.planner_tasks (board_id);

create table public.planner_task_assignees (
  task_id uuid not null references public.planner_tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  board_id uuid not null references public.planner_boards(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index planner_task_assignees_board_idx on public.planner_task_assignees (board_id);

-- ------------------------------------------------------------------ funções
-- Três círculos, três funções SETOF. `security definer` para não reentrar nas
-- policies das próprias tabelas (recursão), `stable` para o planner reusar o
-- resultado dentro da consulta.

-- DONO: quadros que eu criei
create or replace function public.my_owned_planner_board_ids()
returns setof uuid
language sql stable security definer
set search_path to 'public'
as $$
  select b.id from public.planner_boards b
  where b.created_by = (select auth.uid());
$$;

-- PARTICIPANTE: dono ∪ convidado. É o círculo de ESCRITA.
create or replace function public.my_planner_board_ids()
returns setof uuid
language sql stable security definer
set search_path to 'public'
as $$
  select public.my_owned_planner_board_ids()
  union
  select m.board_id from public.planner_board_members m
  where m.user_id = (select auth.uid());
$$;

-- VISÍVEL: participante ∪ quadros onde um subordinado meu participa. É o
-- círculo de LEITURA; o pedaço do gestor não entra no de escrita nunca.
create or replace function public.my_visible_planner_board_ids()
returns setof uuid
language sql stable security definer
set search_path to 'public'
as $$
  select public.my_planner_board_ids()
  union
  select b.id
    from public.planner_boards b
    join public.my_managed_memberships() g
      on g.tenant_id = b.tenant_id and g.user_id = b.created_by
  union
  select pm.board_id
    from public.planner_board_members pm
    join public.my_managed_memberships() g
      on g.tenant_id = pm.tenant_id and g.user_id = pm.user_id;
$$;

revoke execute on function public.my_owned_planner_board_ids() from public, anon;
revoke execute on function public.my_planner_board_ids() from public, anon;
revoke execute on function public.my_visible_planner_board_ids() from public, anon;
grant execute on function public.my_owned_planner_board_ids() to authenticated;
grant execute on function public.my_planner_board_ids() to authenticated;
grant execute on function public.my_visible_planner_board_ids() to authenticated;

-- ---------------------------------------------------------------------- RLS

alter table public.planner_boards enable row level security;
alter table public.planner_board_members enable row level security;
alter table public.planner_buckets enable row level security;
alter table public.planner_tasks enable row level security;
alter table public.planner_task_assignees enable row level security;

-- RLS sem revoke não basta: o ACL padrão concede tudo a anon/authenticated em
-- toda tabela nova de public. `authenticated` mantém o grant, senão as policies
-- ficariam inalcançáveis até para quem elas autorizam.
revoke all on table public.planner_boards from public, anon;
revoke all on table public.planner_board_members from public, anon;
revoke all on table public.planner_buckets from public, anon;
revoke all on table public.planner_tasks from public, anon;
revoke all on table public.planner_task_assignees from public, anon;

create policy planner_boards_select on public.planner_boards for select
  using (tenant_id in (select public.my_tenant_ids())
         and id in (select public.my_visible_planner_board_ids()));
create policy planner_boards_insert on public.planner_boards for insert
  with check (created_by = (select auth.uid())
              and tenant_id in (select public.my_tenant_ids()));
-- renomear e excluir é do dono; participante escreve DENTRO, não NO quadro
create policy planner_boards_update on public.planner_boards for update
  using (id in (select public.my_owned_planner_board_ids()))
  with check (id in (select public.my_owned_planner_board_ids()));
create policy planner_boards_delete on public.planner_boards for delete
  using (id in (select public.my_owned_planner_board_ids()));

create policy planner_board_members_select on public.planner_board_members for select
  using (board_id in (select public.my_visible_planner_board_ids()));
-- convidar e desconvidar é só do dono. A checagem passa pela função, nunca pela
-- própria tabela: policy de members lendo members seria recursão.
create policy planner_board_members_write on public.planner_board_members for all
  using (board_id in (select public.my_owned_planner_board_ids()))
  with check (board_id in (select public.my_owned_planner_board_ids())
              and tenant_id in (select public.my_tenant_ids()));

create policy planner_buckets_select on public.planner_buckets for select
  using (board_id in (select public.my_visible_planner_board_ids()));
create policy planner_buckets_write on public.planner_buckets for all
  using (board_id in (select public.my_planner_board_ids()))
  with check (board_id in (select public.my_planner_board_ids()));

create policy planner_tasks_select on public.planner_tasks for select
  using (board_id in (select public.my_visible_planner_board_ids()));
create policy planner_tasks_write on public.planner_tasks for all
  using (board_id in (select public.my_planner_board_ids()))
  with check (board_id in (select public.my_planner_board_ids()));

create policy planner_task_assignees_select on public.planner_task_assignees for select
  using (board_id in (select public.my_visible_planner_board_ids()));
create policy planner_task_assignees_write on public.planner_task_assignees for all
  using (board_id in (select public.my_planner_board_ids()))
  with check (board_id in (select public.my_planner_board_ids()));

-- ------------------------------------------------------------------ triggers

create trigger planner_boards_updated_at
  before update on public.planner_boards
  for each row execute function public.set_updated_at();
create trigger planner_buckets_updated_at
  before update on public.planner_buckets
  for each row execute function public.set_updated_at();
create trigger planner_tasks_updated_at
  before update on public.planner_tasks
  for each row execute function public.set_updated_at();

-- Log só onde a mudança é de GENTE e de existência: criar/excluir quadro e
-- mudar quem participa. Arraste de cartão no log seria ruído que enterra o
-- que importa.
create trigger planner_boards_audit
  after insert or update or delete on public.planner_boards
  for each row execute function public.audit_trigger('Planner: quadro');
create trigger planner_board_members_audit
  after insert or update or delete on public.planner_board_members
  for each row execute function public.audit_trigger('Planner: participantes');
