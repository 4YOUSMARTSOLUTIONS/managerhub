-- Feedback carimba o setor e a função do SUJEITO no momento da criação.
--
-- O feedback é sobre um episódio: o contexto dele é o vínculo de QUANDO ele foi
-- dado. Sem o carimbo, a tela resolvia setor/função pelo vínculo atual, e
-- transferir ou promover alguém reescrevia o rótulo do histórico inteiro.
--
-- O preenchimento é por trigger BEFORE INSERT, e não pelas server actions: o
-- carimbo acontece em qualquer caminho de escrita, presente ou futuro, sem
-- depender de cada chamador lembrar. `security definer` porque quem insere é
-- `authenticated` e a leitura de memberships aqui é interna à regra.
--
-- Backfill com o vínculo ATUAL: é a única informação que existe para os
-- registros anteriores ao histórico de movimentações (aproximação assumida).
-- FKs com `on delete set null`: apagar um setor do catálogo não trava nem
-- apaga feedbacks.

alter table public.feedbacks
  add column subject_department_id uuid references public.departments(id) on delete set null,
  add column subject_position_id uuid references public.positions(id) on delete set null;

alter table public.feedback_sessions
  add column subject_department_id uuid references public.departments(id) on delete set null,
  add column subject_position_id uuid references public.positions(id) on delete set null;

create or replace function public.stamp_subject_vinculo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.subject_department_id is null and new.subject_position_id is null then
    select m.department_id, m.position_id
      into new.subject_department_id, new.subject_position_id
    from public.memberships m
    where m.user_id = new.subject_user_id and m.tenant_id = new.tenant_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.stamp_subject_vinculo() from public, anon, authenticated;

create trigger feedbacks_stamp_subject
  before insert on public.feedbacks
  for each row execute function public.stamp_subject_vinculo();

create trigger feedback_sessions_stamp_subject
  before insert on public.feedback_sessions
  for each row execute function public.stamp_subject_vinculo();

-- Backfill dos registros existentes a partir do vínculo atual do sujeito.
update public.feedbacks f
   set subject_department_id = m.department_id,
       subject_position_id = m.position_id
  from public.memberships m
 where m.user_id = f.subject_user_id and m.tenant_id = f.tenant_id
   and f.subject_department_id is null and f.subject_position_id is null;

update public.feedback_sessions s
   set subject_department_id = m.department_id,
       subject_position_id = m.position_id
  from public.memberships m
 where m.user_id = s.subject_user_id and m.tenant_id = s.tenant_id
   and s.subject_department_id is null and s.subject_position_id is null;
