-- Conserta as turmas criadas ANTES do número automático e do término calculado.
--
-- A migração que criou `code` adicionou a coluna sem numerar o que já existia, e
-- o trigger só age no INSERT: as turmas anteriores ficaram sem número, e a tela
-- mostraria "Turma" seguido de nada. O mesmo vale para o término, que passou a
-- sair da carga horária depois que aquelas turmas já estavam gravadas.
--
-- Numeração pela ordem de criação, por treinamento: é a ordem em que as turmas
-- de fato aconteceram, e mantém coerência com o que o trigger faz daqui pra
-- frente.
with numeradas as (
  select id, row_number() over (partition by training_id order by created_at) as n
  from public.training_sessions
  where code is null
)
update public.training_sessions s
   set code = n.n
  from numeradas n
 where s.id = n.id;

-- término ausente: deriva da carga horária do curso, como a tela passou a fazer
update public.training_sessions s
   set ends_at = s.starts_at + (t.workload_minutes || ' minutes')::interval
  from public.trainings t
 where t.id = s.training_id
   and s.ends_at is null
   and t.workload_minutes > 0;

-- agora que ninguém está sem número, a coluna passa a exigir um. O default do
-- trigger continua preenchendo; isto é a rede que impede uma inserção por fora
-- criar turma sem identificação.
alter table public.training_sessions alter column code set not null;
