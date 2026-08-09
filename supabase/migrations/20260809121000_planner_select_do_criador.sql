-- O INSERT ... RETURNING do quadro falhava com 42501.
--
-- RETURNING exige que a linha recém-criada passe pela policy de SELECT, e a
-- policy dependia só de `my_visible_planner_board_ids()`, que é `stable`: o
-- snapshot dela é o do início do comando, e a linha que o próprio comando está
-- inserindo ainda não existe lá. O quadro nascia e o banco recusava devolvê-lo.
--
-- A saída é o teste row-local `created_by = auth.uid()` direto na policy, que é
-- avaliado sobre a linha nova. As tabelas filhas não têm o problema: quando um
-- bucket é inserido, o quadro dele veio de um comando anterior e a função já o
-- enxerga.
drop policy if exists planner_boards_select on public.planner_boards;
create policy planner_boards_select on public.planner_boards for select
  using (
    tenant_id in (select public.my_tenant_ids())
    and (
      created_by = (select auth.uid())
      or id in (select public.my_visible_planner_board_ids())
    )
  );
