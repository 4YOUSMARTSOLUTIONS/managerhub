-- Excluir uma reunião deixa de ser poder de participante.
--
-- Numa reunião PRIVADA, qualquer participante podia editar, inativar E EXCLUIR
-- a série inteira. Editar e inativar continuam (é o que faz a reunião privada
-- funcionar sem depender do dono), mas excluir apaga o histórico de todo mundo
-- e passa a ser só de quem responde pela reunião.
--
-- Regra de exclusão, a partir daqui:
--   dono da série, papel `owner`, papel `manager`; e, só em reunião PÚBLICA,
--   também `admin`. Participante, nunca.
--
-- A guarda vive em DOIS lugares porque há dois caminhos de exclusão:
--   1. DELETE de verdade  -> policy `meeting_series_delete`;
--   2. soft-delete (o que o app usa) -> é um UPDATE de `deleted_at`, que a
--      policy de UPDATE libera para o participante. Sem o trigger, bastaria um
--      PostgREST direto com a chave pública para excluir assim mesmo.

create or replace function public.pode_excluir_serie(p_series public.meeting_series)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_series.tenant_id in (select public.my_tenant_ids())
     and (
       p_series.owner_user_id = (select auth.uid())
       or p_series.tenant_id in (select public.my_role_tenant_ids('{owner,manager}'::member_role[]))
       or (p_series.is_private = false
           and p_series.tenant_id in (select public.my_role_tenant_ids('{admin}'::member_role[])))
     );
$$;

revoke execute on function public.pode_excluir_serie(public.meeting_series) from public, anon;
grant execute on function public.pode_excluir_serie(public.meeting_series) to authenticated;

-- 1. DELETE físico
drop policy if exists meeting_series_delete on public.meeting_series;
create policy meeting_series_delete on public.meeting_series
  for delete using (public.pode_excluir_serie(meeting_series.*));

-- 2. soft-delete: só quem pode excluir carimba `deleted_at`.
-- A policy de UPDATE continua como está (participante edita a reunião privada);
-- o trigger recorta apenas o gesto de excluir.
create or replace function public.guard_series_soft_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null
     and not public.pode_excluir_serie(old) then
    raise exception 'Apenas o dono da reunião, o proprietário ou o gerencial podem excluí-la.';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_series_soft_delete() from public, anon, authenticated;

drop trigger if exists meeting_series_guard_soft_delete on public.meeting_series;
create trigger meeting_series_guard_soft_delete
  before update on public.meeting_series
  for each row execute function public.guard_series_soft_delete();
