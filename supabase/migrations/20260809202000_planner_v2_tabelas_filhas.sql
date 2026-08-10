-- Planner v2: o conteúdo do cartão (etiquetas, checklist, comentários, anexos e
-- o histórico).
--
-- Toda tabela carrega `board_id` denormalizado, pelo mesmo motivo de
-- `planner_tasks`: a policy resolve em UM salto (`board_id in (select fn())`),
-- no formato SETOF que o planner otimiza. Quem mantém a coerência do trio
-- task/board é a server action (e a RPC de mover entre quadros).
--
-- Três decisões de alçada que não são simétricas:
--   * comentário: quem escreve assina (`author_id = auth.uid()`) e só o AUTOR
--     apaga. Dono de quadro não edita fala alheia.
--   * histórico (`planner_task_events`): append-only. Não existe policy de
--     update nem de delete, de propósito: uma linha de histórico que pode ser
--     editada não é histórico.
--   * etiquetas: paleta FIXA de 8 tons já existentes no design system. Cor
--     livre viraria um arco-íris ilegível e um campo a validar para sempre.

create table public.planner_labels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  board_id uuid not null references public.planner_boards(id) on delete cascade,
  name text not null,
  color text not null check (color in ('blue','green','amber','red','purple','pink','gray','dark')),
  created_at timestamptz not null default now(),
  constraint planner_labels_nome_unico unique (board_id, name)
);
create index planner_labels_board_idx on public.planner_labels (board_id);

create table public.planner_task_labels (
  task_id uuid not null references public.planner_tasks(id) on delete cascade,
  label_id uuid not null references public.planner_labels(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  board_id uuid not null references public.planner_boards(id) on delete cascade,
  primary key (task_id, label_id)
);
create index planner_task_labels_board_idx on public.planner_task_labels (board_id);

create table public.planner_checklist_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  board_id uuid not null references public.planner_boards(id) on delete cascade,
  task_id uuid not null references public.planner_tasks(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  position integer not null,
  created_at timestamptz not null default now()
);
create index planner_checklist_items_task_idx on public.planner_checklist_items (task_id, position);
create index planner_checklist_items_board_idx on public.planner_checklist_items (board_id);

create table public.planner_task_comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  board_id uuid not null references public.planner_boards(id) on delete cascade,
  task_id uuid not null references public.planner_tasks(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index planner_task_comments_task_idx on public.planner_task_comments (task_id, created_at);
create index planner_task_comments_board_idx on public.planner_task_comments (board_id);

create table public.planner_task_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  board_id uuid not null references public.planner_boards(id) on delete cascade,
  task_id uuid not null references public.planner_tasks(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index planner_task_attachments_task_idx on public.planner_task_attachments (task_id);
create index planner_task_attachments_board_idx on public.planner_task_attachments (board_id);

create table public.planner_task_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  board_id uuid not null references public.planner_boards(id) on delete cascade,
  task_id uuid not null references public.planner_tasks(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  type text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index planner_task_events_task_idx on public.planner_task_events (task_id, created_at);
create index planner_task_events_board_idx on public.planner_task_events (board_id);

-- ---------------------------------------------------------------------- RLS

alter table public.planner_labels enable row level security;
alter table public.planner_task_labels enable row level security;
alter table public.planner_checklist_items enable row level security;
alter table public.planner_task_comments enable row level security;
alter table public.planner_task_attachments enable row level security;
alter table public.planner_task_events enable row level security;

revoke all on table public.planner_labels from public, anon;
revoke all on table public.planner_task_labels from public, anon;
revoke all on table public.planner_checklist_items from public, anon;
revoke all on table public.planner_task_comments from public, anon;
revoke all on table public.planner_task_attachments from public, anon;
revoke all on table public.planner_task_events from public, anon;

create policy planner_labels_select on public.planner_labels for select
  using (board_id in (select public.my_visible_planner_board_ids()));
create policy planner_labels_write on public.planner_labels for all
  using (board_id in (select public.my_planner_board_ids()))
  with check (board_id in (select public.my_planner_board_ids()));

create policy planner_task_labels_select on public.planner_task_labels for select
  using (board_id in (select public.my_visible_planner_board_ids()));
create policy planner_task_labels_write on public.planner_task_labels for all
  using (board_id in (select public.my_planner_board_ids()))
  with check (board_id in (select public.my_planner_board_ids()));

create policy planner_checklist_select on public.planner_checklist_items for select
  using (board_id in (select public.my_visible_planner_board_ids()));
create policy planner_checklist_write on public.planner_checklist_items for all
  using (board_id in (select public.my_planner_board_ids()))
  with check (board_id in (select public.my_planner_board_ids()));

create policy planner_comments_select on public.planner_task_comments for select
  using (board_id in (select public.my_visible_planner_board_ids()));
create policy planner_comments_insert on public.planner_task_comments for insert
  with check (board_id in (select public.my_planner_board_ids())
              and author_id = (select auth.uid()));
create policy planner_comments_delete on public.planner_task_comments for delete
  using (author_id = (select auth.uid()));

create policy planner_attachments_select on public.planner_task_attachments for select
  using (board_id in (select public.my_visible_planner_board_ids()));
create policy planner_attachments_write on public.planner_task_attachments for all
  using (board_id in (select public.my_planner_board_ids()))
  with check (board_id in (select public.my_planner_board_ids()));

-- histórico: entra quem edita; não sai nem muda NUNCA (sem policy de update/delete)
create policy planner_events_select on public.planner_task_events for select
  using (board_id in (select public.my_visible_planner_board_ids()));
create policy planner_events_insert on public.planner_task_events for insert
  with check (board_id in (select public.my_planner_board_ids()));
