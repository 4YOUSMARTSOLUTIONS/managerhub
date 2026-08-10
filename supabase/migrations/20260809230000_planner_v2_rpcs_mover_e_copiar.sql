-- Planner v2: mover cartão entre quadros e duplicar quadro, como RPCs ATÔMICAS.
--
-- `board_id` é denormalizado em SEIS tabelas filhas. Mover um cartão de quadro
-- por updates soltos numa server action deixaria, no primeiro erro no meio, um
-- cartão com checklist num quadro e comentários no outro — invisível para a
-- RLS e impossível de notar pela tela. Dentro da função é uma transação: ou
-- tudo, ou nada.
--
-- As guardas leem as MESMAS funções das policies (`my_planner_board_ids`), com
-- o `auth.uid()` de quem chama: a RPC não abre nada que a RLS não abriria.

create or replace function public.planner_move_task_to_board(
  p_task uuid, p_to_board uuid, p_to_bucket uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_task record;
  v_dono_destino uuid;
  v_pos integer;
begin
  select id, board_id, tenant_id into v_task from public.planner_tasks where id = p_task;
  if v_task.id is null then raise exception 'Tarefa não encontrada'; end if;
  if v_task.board_id = p_to_board then raise exception 'A tarefa já está neste quadro'; end if;

  -- escrita nos DOIS quadros, senão mover vira jeito de tirar cartão de um
  -- quadro que não é meu, ou de despejar cartão num quadro alheio
  if v_task.board_id not in (select public.my_planner_board_ids())
     or p_to_board not in (select public.my_planner_board_ids()) then
    raise exception 'Você precisa poder editar os dois quadros para mover a tarefa';
  end if;

  select created_by into v_dono_destino from public.planner_boards
    where id = p_to_board and tenant_id = v_task.tenant_id;
  if v_dono_destino is null then raise exception 'Quadro de destino inválido'; end if;
  if not exists (select 1 from public.planner_buckets where id = p_to_bucket and board_id = p_to_board) then
    raise exception 'Coluna de destino inválida';
  end if;

  -- etiquetas são DO quadro: não migram (o destino tem o próprio catálogo)
  delete from public.planner_task_labels where task_id = p_task;

  -- responsável precisa participar do destino; quem não participa sai
  delete from public.planner_task_assignees a
  where a.task_id = p_task
    and a.user_id <> v_dono_destino
    and not exists (
      select 1 from public.planner_board_members m
      where m.board_id = p_to_board and m.user_id = a.user_id
    );

  select coalesce(max(position), 0) + 1024 into v_pos
    from public.planner_tasks where bucket_id = p_to_bucket;

  update public.planner_tasks
    set board_id = p_to_board, bucket_id = p_to_bucket, position = v_pos
    where id = p_task;
  update public.planner_task_assignees set board_id = p_to_board where task_id = p_task;
  update public.planner_checklist_items set board_id = p_to_board where task_id = p_task;
  update public.planner_task_comments set board_id = p_to_board where task_id = p_task;
  update public.planner_task_attachments set board_id = p_to_board where task_id = p_task;
  update public.planner_task_events set board_id = p_to_board where task_id = p_task;

  insert into public.planner_task_events (tenant_id, board_id, task_id, actor_id, type, meta)
  values (v_task.tenant_id, p_to_board, p_task, auth.uid(), 'moved_board',
          jsonb_build_object('de', v_task.board_id, 'para', p_to_board));
end;
$$;

revoke execute on function public.planner_move_task_to_board(uuid, uuid, uuid) from public, anon;
grant execute on function public.planner_move_task_to_board(uuid, uuid, uuid) to authenticated;

-- Duplicar: quem VÊ copia (o original não muda; o novo quadro é do ator).
-- Copia colunas e etiquetas; com tarefas, copia campos + etiquetas + checklist
-- zerado, progresso do zero. Membros, responsáveis, anexos, comentários e
-- histórico NÃO vêm: cópia é estrutura, não gente nem passado.
create or replace function public.planner_duplicate_board(
  p_board uuid, p_name text, p_with_tasks boolean
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_orig record;
  v_novo uuid;
  v_nome text := trim(coalesce(p_name, ''));
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if v_nome = '' then raise exception 'Dê um nome ao novo quadro'; end if;

  select id, tenant_id into v_orig from public.planner_boards
    where id = p_board and id in (select public.my_visible_planner_board_ids());
  if v_orig.id is null then raise exception 'Quadro não encontrado'; end if;

  insert into public.planner_boards (tenant_id, name, created_by)
    values (v_orig.tenant_id, v_nome, auth.uid())
    returning id into v_novo;

  insert into public.planner_buckets (tenant_id, board_id, name, position)
    select tenant_id, v_novo, name, position from public.planner_buckets where board_id = p_board;

  insert into public.planner_labels (tenant_id, board_id, name, color)
    select tenant_id, v_novo, name, color from public.planner_labels where board_id = p_board;

  if p_with_tasks then
    -- as tarefas caem na coluna homônima do quadro novo (posição preservada)
    insert into public.planner_tasks
      (tenant_id, board_id, bucket_id, title, description, start_date, due_date,
       priority, progress, recurrence, position, created_by)
    select t.tenant_id, v_novo, nb.id, t.title, t.description, t.start_date, t.due_date,
           t.priority, 'not_started', t.recurrence, t.position, auth.uid()
    from public.planner_tasks t
    join public.planner_buckets ob on ob.id = t.bucket_id
    join public.planner_buckets nb on nb.board_id = v_novo
      and nb.name = ob.name and nb.position = ob.position
    where t.board_id = p_board;

    -- etiquetas dos cartões, casadas pelo nome (a cópia tem os mesmos nomes)
    insert into public.planner_task_labels (task_id, label_id, tenant_id, board_id)
    select nt.id, nl.id, nt.tenant_id, v_novo
    from public.planner_tasks nt
    join public.planner_buckets nb on nb.id = nt.bucket_id
    join public.planner_buckets ob on ob.board_id = p_board
      and ob.name = nb.name and ob.position = nb.position
    join public.planner_tasks ot on ot.board_id = p_board
      and ot.bucket_id = ob.id and ot.title = nt.title and ot.position = nt.position
    join public.planner_task_labels otl on otl.task_id = ot.id
    join public.planner_labels ol on ol.id = otl.label_id
    join public.planner_labels nl on nl.board_id = v_novo and nl.name = ol.name
    where nt.board_id = v_novo;

    insert into public.planner_checklist_items (tenant_id, board_id, task_id, title, done, position)
    select nt.tenant_id, v_novo, nt.id, oc.title, false, oc.position
    from public.planner_tasks nt
    join public.planner_buckets nb on nb.id = nt.bucket_id
    join public.planner_buckets ob on ob.board_id = p_board
      and ob.name = nb.name and ob.position = nb.position
    join public.planner_tasks ot on ot.board_id = p_board
      and ot.bucket_id = ob.id and ot.title = nt.title and ot.position = nt.position
    join public.planner_checklist_items oc on oc.task_id = ot.id
    where nt.board_id = v_novo;
  end if;

  return v_novo;
end;
$$;

revoke execute on function public.planner_duplicate_board(uuid, text, boolean) from public, anon;
grant execute on function public.planner_duplicate_board(uuid, text, boolean) to authenticated;
