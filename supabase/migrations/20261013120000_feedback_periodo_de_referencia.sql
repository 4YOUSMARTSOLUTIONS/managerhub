-- Sessão de feedback: o mês de referência vira PERÍODO de referência.
--
-- A cadência de feedback é configurada em dias (`feedback_cadence_rules`), então
-- o sistema já admitia ciclo trimestral, semestral ou de experiência (45/90
-- dias). A sessão não: ela só sabia consolidar um mês de calendário, e num ciclo
-- de 90 dias enxergava um terço dos feedbacks pontuais do período que deveria
-- fechar.
--
-- O período é o que a sessão COBRE: é ele que escolhe os feedbacks pontuais a
-- referenciar e o que vai para o rascunho da IA. Um mês cheio continua sendo o
-- caso comum, e passa a ser só um período que começa no dia 1 e termina no
-- último dia.
--
-- Esta migração é a metade que SOMA: cria as colunas e converte o que existe.
-- A coluna antiga sai na migração seguinte, depois que o código novo estiver no
-- ar, para a versão anterior da tela não quebrar no intervalo do deploy.
alter table public.feedback_sessions
  add column if not exists period_start date,
  add column if not exists period_end   date;

comment on column public.feedback_sessions.period_start is
  'Início do período que a sessão cobre (os feedbacks pontuais consolidados saem deste intervalo).';
comment on column public.feedback_sessions.period_end is
  'Fim do período que a sessão cobre, inclusive.';

-- o mês de referência era sempre gravado no dia 1: o período equivalente é o mês inteiro
update public.feedback_sessions
   set period_start = date_trunc('month', reference_month)::date,
       period_end   = (date_trunc('month', reference_month) + interval '1 month' - interval '1 day')::date
 where reference_month is not null
   and period_start is null;

-- As duas datas andam juntas e em ordem. Sessão sem período continua possível
-- (a coluna antiga também era opcional); o que não existe é meio período.
alter table public.feedback_sessions
  drop constraint if exists feedback_session_periodo_coerente;
alter table public.feedback_sessions
  add constraint feedback_session_periodo_coerente check (
    (period_start is null and period_end is null)
    or (period_start is not null and period_end is not null and period_end >= period_start)
  );

notify pgrst, 'reload schema';
