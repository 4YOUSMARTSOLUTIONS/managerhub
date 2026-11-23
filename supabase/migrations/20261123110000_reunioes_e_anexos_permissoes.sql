-- Permissões de reuniões e de anexos de chamado (LUIZ, 23/11/2026).
--
-- 1. Criar reunião: além de proprietário, administrador e gerencial, os níveis de
--    hierarquia Coordenação e Supervisão. É por NÍVEL, e não pelo perfil Gestor,
--    que também reúne os analistas.
-- 2. A tabela aceitava gravação direta de qualquer pessoa da empresa, por fora da
--    regra. Criar passa a ser só por `save_meeting_series`.
-- 3. `save_meeting_series` ignora a RLS e, ao editar, só conferia se a pessoa era da
--    empresa. Agora confere a mesma regra de edição da tela.
-- 4. Anexo de chamado seguia a empresa, não o chamado: quem não via o chamado
--    localizava e abria o arquivo. Agora segue a visibilidade do chamado.

create or replace function public.pode_criar_reuniao(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.has_tenant_role(p_tenant, array['owner','admin','manager']::public.member_role[])
      or exists (
        select 1
          from public.memberships m
          join public.hierarchy_levels h on h.id = m.hierarchy_level_id and h.tenant_id = m.tenant_id
         where m.tenant_id = p_tenant
           and m.user_id = (select auth.uid())
           and m.is_active
           and (m.dismissed_at is null or m.dismissed_at > (now() at time zone 'America/Sao_Paulo')::date)
           and public.mh_norm(h.name) in ('coordenacao', 'supervisao')
      );
$function$;

revoke execute on function public.pode_criar_reuniao(uuid) from public, anon;
grant execute on function public.pode_criar_reuniao(uuid) to authenticated;

-- a mesma regra da policy meeting_series_update e de canEditSeries
create or replace function public.pode_editar_serie(p_series uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.is_super_admin() or exists (
    select 1
      from public.meeting_series s
     where s.id = p_series
       and s.tenant_id in (select public.my_tenant_ids())
       and (
         s.owner_user_id = (select auth.uid())
         or s.tenant_id in (select public.my_role_tenant_ids('{owner,manager}'::public.member_role[]))
         or (s.is_private = false and s.tenant_id in (select public.my_role_tenant_ids('{admin}'::public.member_role[])))
         or (s.is_private = true and exists (
               select 1 from public.meeting_series_participants p
                where p.series_id = s.id and p.user_id = (select auth.uid())))
       )
  );
$function$;

revoke execute on function public.pode_editar_serie(uuid) from public, anon, authenticated;

do $migracao$
declare
  v_def text := replace(pg_get_functiondef('public.save_meeting_series(jsonb)'::regprocedure), E'\r\n', E'\n');
  v_criar text := $a$    -- criação restrita: só owner, admin ou gerente
    if not public.has_tenant_role(v_tenant, array['owner','admin','manager']::public.member_role[]) then
      raise exception 'Apenas owner, administrador ou gerente podem criar reuniões';
    end if;$a$;
  v_criar_novo text := $b$    -- proprietário, administrador, gerencial, Coordenação e Supervisão
    if not coalesce(public.pode_criar_reuniao(v_tenant), false) then
      raise exception 'Você não tem permissão para criar reuniões';
    end if;$b$;
  v_editar text := $c$  else
    update public.meeting_series set$c$;
  v_editar_novo text := $d$  else
    if not public.pode_editar_serie(v_id) then
      raise exception 'Você não tem permissão para editar esta reunião';
    end if;
    update public.meeting_series set$d$;
begin
  if position(v_criar in v_def) = 0 or position(v_editar in v_def) = 0 then
    raise exception 'save_meeting_series: trecho esperado não encontrado';
  end if;
  execute replace(replace(v_def, v_criar, v_criar_novo), v_editar, v_editar_novo);
end
$migracao$;

revoke execute on function public.save_meeting_series(jsonb) from public, anon;
grant execute on function public.save_meeting_series(jsonb) to authenticated;

drop policy meeting_series_insert on public.meeting_series;
revoke insert on table public.meeting_series from anon, authenticated;

-- anexos de chamado: a linha segue a visibilidade do chamado (RLS de tickets)
drop policy ticket_attachments_rw on public.ticket_attachments;

create policy ticket_attachments_select on public.ticket_attachments
  for select to authenticated
  using (ticket_id in (select t.id from public.tickets t));

create policy ticket_attachments_insert on public.ticket_attachments
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and tenant_id in (select public.my_tenant_ids())
    and ticket_id in (select t.id from public.tickets t where t.tenant_id = ticket_attachments.tenant_id)
    and split_part(path, '/', 1) = tenant_id::text
    and split_part(path, '/', 2) = ticket_id::text
  );

revoke all on table public.ticket_attachments from anon;
revoke update, delete on table public.ticket_attachments from authenticated;

create index if not exists ticket_attachments_path_idx on public.ticket_attachments (path);

-- o arquivo segue a linha: só abre quem alcança o anexo (ou quem acabou de enviar)
drop policy ticket_attach_select on storage.objects;
drop policy ticket_attach_insert on storage.objects;
drop policy ticket_attach_delete on storage.objects;

create policy ticket_attach_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'ticket-attachments'
    and (
      owner_id = (select auth.uid())::text
      or name in (select a.path from public.ticket_attachments a)
    )
  );

create policy ticket_attach_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'ticket-attachments'
    and exists (
      select 1 from public.tickets t
       where t.id::text = (storage.foldername(name))[2]
         and t.tenant_id::text = (storage.foldername(name))[1]
    )
  );

create policy ticket_attach_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'ticket-attachments'
    and (
      owner_id = (select auth.uid())::text
      or (storage.foldername(name))[1] in (
        select x::text from public.my_role_tenant_ids('{owner,admin}'::public.member_role[]) x
      )
    )
  );

notify pgrst, 'reload schema';
