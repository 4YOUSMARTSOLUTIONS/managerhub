-- O gestor e o administrador passam a EDITAR os quadros dos colaboradores.
--
-- Antes: escrita era só do participante (dono ∪ convidados); o gestor lia em
-- consulta; admin/owner nem viam quadro alheio. Decisão nova do produto:
--
--   * gestor da cadeia edita o CONTEÚDO dos quadros em que um subordinado
--     participa (tarefas, colunas, arraste);
--   * admin/owner editam o conteúdo de QUALQUER quadro da empresa;
--   * a GESTÃO do quadro (renomear, excluir, convidar) continua com o dono,
--     e admin/owner entram como válvula de escape (ex.: dono desligado).
--     O gestor não gere o quadro do subordinado: mexe dentro, não nele.
--
-- Com isso o círculo de leitura vira IGUAL ao de escrita, e o modo
-- "somente consulta" deixa de existir na prática. As policies não mudam:
-- elas já apontam para estas funções, e é só o corpo delas que anda.
-- `create or replace` preserva os grants (authenticated) e revokes (anon).

-- gestão do quadro: dono OU admin/owner da empresa
create or replace function public.my_owned_planner_board_ids()
returns setof uuid
language sql stable security definer
set search_path to 'public'
as $$
  select b.id from public.planner_boards b
  where b.created_by = (select auth.uid())
  union
  select b.id from public.planner_boards b
  where b.tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::public.member_role[]));
$$;

-- escrita de conteúdo: gestão ∪ convidado ∪ quadros onde um subordinado meu
-- participa (o pedaço do gestor, antes só leitura)
create or replace function public.my_planner_board_ids()
returns setof uuid
language sql stable security definer
set search_path to 'public'
as $$
  select public.my_owned_planner_board_ids()
  union
  select m.board_id from public.planner_board_members m
  where m.user_id = (select auth.uid())
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

-- leitura = escrita: quem enxerga um quadro pode trabalhar nele
create or replace function public.my_visible_planner_board_ids()
returns setof uuid
language sql stable security definer
set search_path to 'public'
as $$
  select public.my_planner_board_ids();
$$;
