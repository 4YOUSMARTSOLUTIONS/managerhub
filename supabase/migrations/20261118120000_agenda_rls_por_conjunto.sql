-- Regras de acesso da agenda por CONJUNTO (desempenho, LUIZ 18/11/2026).
--
-- Antes, cada leitura avaliava `agenda_can_view` / `agenda_ve_pelo_historico`
-- LINHA A LINHA, e cada chamada remontava a cadeia de gestão inteira
-- (`my_managed_memberships`, recursiva). Medido: a 1ª página de `agenda_logs`
-- levava ~3 s para um gestor (1 ms sem as regras); /agenda tinha p95 de 9 s.
--
-- Agora `agendas_visiveis()` calcula UMA vez por consulta (initplan, pelo
-- `in (select ...)`, como as regras de memberships) o conjunto de agendas que a pessoa vê, com a MESMA lógica:
--   agenda_can_view(tenant, owner, responsible)  OR  agenda_ve_pelo_historico(id)
-- e as regras de leitura só conferem se a agenda está no conjunto.
--
-- As regras de gravação que eram `ALL` (e por isso também rodavam em toda
-- LEITURA, somadas por OR) viram INSERT/UPDATE/DELETE com as mesmas
-- expressões. Quem grava continua o mesmo; o que elas liberavam de leitura já
-- estava contido no conjunto de visíveis (can_fill = can_view; preenche_no_dia
-- e can_admin são subconjuntos).
--
-- Conferido antes de aplicar: para os 318 colaboradores ativos, o conjunto da
-- função nova é idêntico ao da regra antiga (0 diferenças).

create or replace function public.agendas_visiveis()
 returns setof uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with cadeia as materialized (
    select c.user_id, c.tenant_id from public.my_managed_memberships() c
  ),
  meus as materialized (
    select m.tenant_id, m.role from public.memberships m where m.user_id = (select auth.uid())
  )
  select a.id
    from public.agendas a
   where (select public.is_super_admin())
      -- agenda_can_view
      or (
        exists (select 1 from meus where meus.tenant_id = a.tenant_id)
        and (
          exists (select 1 from meus where meus.tenant_id = a.tenant_id and meus.role in ('owner', 'admin'))
          or a.owner_id = (select auth.uid())
          or a.responsible_id = (select auth.uid())
          or exists (select 1 from cadeia c where c.tenant_id = a.tenant_id and c.user_id in (a.owner_id, a.responsible_id))
        )
      )
      -- agenda_ve_pelo_historico
      or exists (
        select 1 from public.agenda_responsaveis v
         where v.agenda_id = a.id
           and exists (select 1 from meus where meus.tenant_id = v.tenant_id)
           and (v.user_id = (select auth.uid())
                or exists (select 1 from cadeia c where c.tenant_id = v.tenant_id and c.user_id = v.user_id))
      );
$function$;

-- usada pelas regras de acesso (que rodam como o usuário logado): authenticated
-- precisa de EXECUTE; a guarda é o próprio auth.uid() no corpo
revoke execute on function public.agendas_visiveis() from public, anon;
grant execute on function public.agendas_visiveis() to authenticated;

-- ---------------------------------------------------------------------------
-- agendas
-- ---------------------------------------------------------------------------
drop policy if exists ag_select on public.agendas;
create policy ag_select on public.agendas
  for select using (id in (select public.agendas_visiveis()));

-- ---------------------------------------------------------------------------
-- agenda_tasks
-- ---------------------------------------------------------------------------
drop policy if exists ag_task_select on public.agenda_tasks;
create policy ag_task_select on public.agenda_tasks
  for select using (agenda_id in (select public.agendas_visiveis()));

drop policy if exists ag_task_write on public.agenda_tasks;
create policy ag_task_insert on public.agenda_tasks
  for insert with check (exists (
    select 1 from public.agendas a
     where a.id = agenda_tasks.agenda_id
       and (public.agenda_can_admin(a.tenant_id, a.owner_id)
            or (a.responsible_id = (select auth.uid()) and a.can_responsible_edit))));
create policy ag_task_update on public.agenda_tasks
  for update
  using (exists (
    select 1 from public.agendas a
     where a.id = agenda_tasks.agenda_id
       and (public.agenda_can_admin(a.tenant_id, a.owner_id)
            or (a.responsible_id = (select auth.uid()) and a.can_responsible_edit))))
  with check (exists (
    select 1 from public.agendas a
     where a.id = agenda_tasks.agenda_id
       and (public.agenda_can_admin(a.tenant_id, a.owner_id)
            or (a.responsible_id = (select auth.uid()) and a.can_responsible_edit))));
create policy ag_task_delete on public.agenda_tasks
  for delete using (exists (
    select 1 from public.agendas a
     where a.id = agenda_tasks.agenda_id
       and (public.agenda_can_admin(a.tenant_id, a.owner_id)
            or (a.responsible_id = (select auth.uid()) and a.can_responsible_edit))));

-- ---------------------------------------------------------------------------
-- agenda_logs
-- ---------------------------------------------------------------------------
drop policy if exists ag_log_select on public.agenda_logs;
create policy ag_log_select on public.agenda_logs
  for select using (agenda_id in (select public.agendas_visiveis()));

drop policy if exists ag_log_write on public.agenda_logs;
create policy ag_log_insert on public.agenda_logs
  for insert with check (
    exists (select 1 from public.agendas a
             where a.id = agenda_logs.agenda_id
               and public.agenda_can_fill(a.tenant_id, a.owner_id, a.responsible_id))
    or public.agenda_preenche_no_dia(agenda_id, log_date));
create policy ag_log_update on public.agenda_logs
  for update
  using (
    exists (select 1 from public.agendas a
             where a.id = agenda_logs.agenda_id
               and public.agenda_can_fill(a.tenant_id, a.owner_id, a.responsible_id))
    or public.agenda_preenche_no_dia(agenda_id, log_date))
  with check (
    exists (select 1 from public.agendas a
             where a.id = agenda_logs.agenda_id
               and public.agenda_can_fill(a.tenant_id, a.owner_id, a.responsible_id))
    or public.agenda_preenche_no_dia(agenda_id, log_date));
create policy ag_log_delete on public.agenda_logs
  for delete using (
    exists (select 1 from public.agendas a
             where a.id = agenda_logs.agenda_id
               and public.agenda_can_fill(a.tenant_id, a.owner_id, a.responsible_id))
    or public.agenda_preenche_no_dia(agenda_id, log_date));

-- ---------------------------------------------------------------------------
-- comentários e anexos do registro: visível se o registro é de agenda visível
-- ---------------------------------------------------------------------------
drop policy if exists ag_cmt_select on public.agenda_log_comments;
create policy ag_cmt_select on public.agenda_log_comments
  for select using (exists (
    select 1 from public.agenda_logs l
     where l.id = agenda_log_comments.log_id
       and l.agenda_id in (select public.agendas_visiveis())));

drop policy if exists ag_cmt_insert on public.agenda_log_comments;
create policy ag_cmt_insert on public.agenda_log_comments
  for insert with check (
    author_id = (select auth.uid())
    and exists (
      select 1 from public.agenda_logs l
       where l.id = agenda_log_comments.log_id
         and l.agenda_id in (select public.agendas_visiveis())));

drop policy if exists ag_att_select on public.agenda_log_attachments;
create policy ag_att_select on public.agenda_log_attachments
  for select using (exists (
    select 1 from public.agenda_logs l
     where l.id = agenda_log_attachments.log_id
       and l.agenda_id in (select public.agendas_visiveis())));

-- ---------------------------------------------------------------------------
-- responsáveis por período
-- ---------------------------------------------------------------------------
drop policy if exists agenda_responsaveis_select on public.agenda_responsaveis;
create policy agenda_responsaveis_select on public.agenda_responsaveis
  for select to authenticated using (agenda_id in (select public.agendas_visiveis()));
