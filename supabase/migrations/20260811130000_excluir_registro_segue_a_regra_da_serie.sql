-- Excluir um REGISTRO de reunião segue a mesma regra de excluir a série.
--
-- A policy de ocorrências era um `for all` com `can_view_series`: quem
-- ENXERGAVA a reunião podia apagar qualquer registro dela, e a action nem
-- checava permissão. Numa reunião privada, isso significava que o colaborador
-- apagava a memória da conversa; numa pública, qualquer membro da empresa.
--
-- Ler, criar e editar o registro continuam abertos a quem vê a reunião (é o
-- registro colaborativo do que aconteceu: anotações, decisões, presença).
-- Só EXCLUIR passa a exigir `pode_excluir_serie`: dono, owner, manager e, em
-- reunião pública, admin.
--
-- O `for all` é quebrado em quatro porque policies permissivas se somam: uma
-- policy de DELETE mais estrita ao lado do `for all` não restringiria nada, o
-- OR entre elas continuaria liberando.

drop policy if exists meeting_occurrences_rw on public.meeting_occurrences;

create policy meeting_occurrences_select on public.meeting_occurrences
  for select using (
    exists (select 1 from public.meeting_series s
             where s.id = meeting_occurrences.series_id and public.can_view_series(s.*))
  );

create policy meeting_occurrences_insert on public.meeting_occurrences
  for insert with check (
    exists (select 1 from public.meeting_series s
             where s.id = meeting_occurrences.series_id and public.can_view_series(s.*))
  );

create policy meeting_occurrences_update on public.meeting_occurrences
  for update using (
    exists (select 1 from public.meeting_series s
             where s.id = meeting_occurrences.series_id and public.can_view_series(s.*))
  ) with check (
    exists (select 1 from public.meeting_series s
             where s.id = meeting_occurrences.series_id and public.can_view_series(s.*))
  );

create policy meeting_occurrences_delete on public.meeting_occurrences
  for delete using (
    exists (select 1 from public.meeting_series s
             where s.id = meeting_occurrences.series_id and public.pode_excluir_serie(s.*))
  );

-- soft-delete: o app apaga o registro carimbando `deleted_at`, o que é um
-- UPDATE e passaria pela policy acima. Mesmo trigger-guarda da série.
create or replace function public.guard_occurrence_soft_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null
     and not exists (
       select 1 from public.meeting_series s
        where s.id = old.series_id and public.pode_excluir_serie(s.*)
     ) then
    raise exception 'Apenas o dono da reunião, o proprietário ou o gerencial podem excluir um registro.';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_occurrence_soft_delete() from public, anon, authenticated;

drop trigger if exists meeting_occurrences_guard_soft_delete on public.meeting_occurrences;
create trigger meeting_occurrences_guard_soft_delete
  before update on public.meeting_occurrences
  for each row execute function public.guard_occurrence_soft_delete();
