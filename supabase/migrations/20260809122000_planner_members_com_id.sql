-- `audit_trigger()` grava `new.id` no log, e planner_board_members nasceu só
-- com a PK composta (board_id, user_id): convidar alguém quebrava no trigger.
-- A coluna é um substituto para o log; a identidade real continua sendo o par.
alter table public.planner_board_members
  add column if not exists id uuid not null default gen_random_uuid();
