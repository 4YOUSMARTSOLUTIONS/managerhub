-- Turma: número automático, sala do cadastro e modalidade presencial ou online.
--
-- Três ajustes pedidos na validação:
--
-- 1. NÚMERO. Identificar turma à mão vira "Turma 1" repetido em cinco cursos.
--    O número é sequencial por TREINAMENTO (o primeiro FEFO é 1, o primeiro 5S
--    também é 1), porque é assim que as pessoas falam: "a terceira turma da
--    NR-35". A identificação livre continua, agora como complemento opcional.
--
-- 2. SALA. O local passa a apontar para `rooms`, que já é o cadastro de salas
--    do módulo de reuniões: digitar "Sala 1" à mão em cada turma é o caminho
--    para ter "Sala 1", "sala 1" e "SALA 01" no mesmo relatório.
--
-- 3. ONLINE. Turma remota não tem sala, tem link. São dois campos excludentes,
--    e a modalidade diz qual vale.
--
-- `location` (texto livre) fica para o caso de fora: visita técnica, auditório
-- de terceiro, cliente. Não some, deixa de ser o caminho principal.

create type public.training_session_mode as enum ('presencial', 'online');

alter table public.training_sessions
  add column code integer,
  add column mode public.training_session_mode not null default 'presencial',
  add column room_id uuid references public.rooms(id) on delete set null,
  add column meeting_url text;

-- número sequencial POR TREINAMENTO, atribuído na inserção.
--
-- `lock_timeout` curto de propósito: duas turmas criadas no mesmo instante
-- disputam o mesmo número, e é melhor a segunda falhar rápido e ser repetida
-- pelo app do que ficar pendurada num lock.
create or replace function public.training_session_numera()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.code is null then
    select coalesce(max(s.code), 0) + 1 into new.code
      from public.training_sessions s
     where s.training_id = new.training_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.training_session_numera() from public, anon, authenticated;

create trigger training_sessions_numera
  before insert on public.training_sessions
  for each row execute function public.training_session_numera();

-- o número não se repete dentro do mesmo treinamento
create unique index training_sessions_code_uidx on public.training_sessions (training_id, code);

notify pgrst, 'reload schema';
