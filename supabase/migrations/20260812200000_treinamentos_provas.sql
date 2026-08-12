-- Treinamentos, leva 4: prova, tentativas e correção.
--
-- Três decisões sustentam o resto.
--
-- 1. SNAPSHOT DA PROVA. A tentativa guarda as questões como estavam no momento
--    em que foi aberta. Sem isso, corrigir um enunciado errado amanhã mudaria a
--    prova que alguém respondeu ontem, e o histórico deixaria de dizer o que a
--    pessoa de fato respondeu. Editar questão passa a ser seguro.
--
-- 2. GABARITO FORA DO ALCANCE DE QUEM RESPONDE. A RLS decide LINHA, e a linha
--    da tentativa é do próprio candidato: se o gabarito morasse nela, bastaria
--    um GET no PostgREST com a chave pública (que está no bundle) para ler as
--    respostas certas antes de responder. Por isso o gabarito vive em
--    `answer_key`, e o privilégio é de COLUNA. E, como o AGENTS.md registra, o
--    revoke de coluna só vale depois de derrubar o SELECT de TABELA, que o
--    Supabase concede por padrão.
--
--    Pelo mesmo motivo `training_exam_questions` (que tem o `correct` vivo) só
--    é legível por quem gere o treinamento. Quem responde lê do snapshot.
--
-- 3. O RELÓGIO É DO SERVIDOR. `deadline_at` é gravado na abertura e conferido
--    no envio. O cronômetro da tela é enfeite: adiantar o relógio da máquina,
--    fechar o navegador ou perder a conexão não muda o prazo, e a tentativa
--    aberta além do prazo é encerrada pelo próprio banco na primeira vez que
--    alguém a toca.

create type public.training_question_kind as enum (
  'multipla_escolha', 'multipla_selecao', 'verdadeiro_falso', 'dissertativa'
);

create type public.training_attempt_status as enum (
  'em_andamento', 'aguardando_correcao', 'aprovado', 'reprovado'
);

create table public.training_exams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  training_id uuid not null references public.trainings(id) on delete cascade,
  title text not null default 'Avaliação',
  instructions text,
  /** nota mínima para aprovar, em pontos percentuais */
  passing_score smallint not null default 70 check (passing_score between 1 and 100),
  /** null = sem limite de tentativas */
  max_attempts smallint check (max_attempts is null or max_attempts > 0),
  /** null = sem cronômetro */
  time_limit_minutes integer check (time_limit_minutes is null or time_limit_minutes > 0),
  /** trava contra o "clica em tudo e envia": só libera o envio depois disto */
  min_minutes integer not null default 0 check (min_minutes >= 0),
  shuffle_questions boolean not null default true,
  shuffle_options boolean not null default true,
  /** mostrar ao candidato quais questões ele errou, depois de corrigida */
  show_result_detail boolean not null default true,
  /** exige o conteúdo obrigatório concluído antes de abrir a prova */
  starts_after_content boolean not null default true,
  active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- uma prova por treinamento: duas provas ativas no mesmo curso é ambiguidade,
-- não recurso
create unique index training_exams_training_uidx
  on public.training_exams (training_id) where deleted_at is null;

create table public.training_exam_questions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  exam_id uuid not null references public.training_exams(id) on delete cascade,
  sort integer not null default 0,
  kind public.training_question_kind not null,
  statement text not null,
  /** [{"id":"a","text":"..."}] — vazio na dissertativa */
  options jsonb not null default '[]'::jsonb,
  /** ["a"] nas objetivas; null na dissertativa (correção humana) */
  correct jsonb,
  weight numeric(5,2) not null default 1 check (weight > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index training_exam_questions_exam_idx
  on public.training_exam_questions (exam_id, sort) where deleted_at is null;

create table public.training_exam_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  exam_id uuid not null references public.training_exams(id) on delete cascade,
  enrollment_id uuid not null references public.training_enrollments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  attempt_no smallint not null default 1,
  status public.training_attempt_status not null default 'em_andamento',
  /** a prova como foi aplicada, SEM gabarito */
  questions_snapshot jsonb not null,
  /** o gabarito da mesma prova; protegido por privilégio de COLUNA */
  answer_key jsonb not null,
  started_at timestamptz not null default now(),
  /** prazo calculado no servidor na abertura; o relógio do cliente não decide */
  deadline_at timestamptz,
  submitted_at timestamptz,
  graded_at timestamptz,
  score numeric(5,2),
  passed boolean,
  created_at timestamptz not null default now(),
  unique (enrollment_id, attempt_no)
);
create index training_attempts_enrollment_idx on public.training_exam_attempts (enrollment_id);
create index training_attempts_pendentes_idx
  on public.training_exam_attempts (exam_id) where status = 'aguardando_correcao';

create table public.training_exam_answers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  attempt_id uuid not null references public.training_exam_attempts(id) on delete cascade,
  question_id uuid not null,
  /** ["a","c"] nas objetivas, {"texto":"..."} na dissertativa */
  answer jsonb,
  /** null = ainda não corrigida (dissertativa na fila) */
  correct boolean,
  score numeric(5,2),
  feedback text,
  graded_by uuid references public.profiles(id) on delete set null,
  graded_at timestamptz,
  answered_at timestamptz not null default now(),
  unique (attempt_id, question_id)
);
create index training_answers_attempt_idx on public.training_exam_answers (attempt_id);

alter table public.training_exams enable row level security;
alter table public.training_exam_questions enable row level security;
alter table public.training_exam_attempts enable row level security;
alter table public.training_exam_answers enable row level security;

-- a existência e as regras da prova são públicas ao tenant (o candidato precisa
-- saber a nota mínima e quantas tentativas tem); as questões, não
create policy training_exams_select on public.training_exams
  for select using (public.is_tenant_member(tenant_id));
create policy training_exams_write on public.training_exams
  for all using (public.pode_gerir_treinamento(training_id))
  with check (public.pode_gerir_treinamento(training_id));

-- questão viva carrega o gabarito: só quem gere o treinamento enxerga
create policy training_questions_all on public.training_exam_questions
  for all using (
    exists (select 1 from public.training_exams e
             where e.id = exam_id and public.pode_gerir_treinamento(e.training_id))
  )
  with check (
    exists (select 1 from public.training_exams e
             where e.id = exam_id and public.pode_gerir_treinamento(e.training_id))
  );

create policy training_attempts_select on public.training_exam_attempts
  for select using (
    user_id = (select auth.uid())
    or public.manages_user(user_id, tenant_id)
    or public.has_tenant_role(tenant_id, '{owner,admin,hr}'::public.member_role[])
    or exists (select 1 from public.training_exams e
                where e.id = exam_id and public.pode_gerir_treinamento(e.training_id))
  );
-- sem policy de escrita: tentativa só nasce e muda por RPC

create policy training_answers_select on public.training_exam_answers
  for select using (
    exists (select 1 from public.training_exam_attempts a
             where a.id = attempt_id
               and (a.user_id = (select auth.uid())
                    or public.manages_user(a.user_id, a.tenant_id)
                    or public.has_tenant_role(a.tenant_id, '{owner,admin,hr}'::public.member_role[])
                    or exists (select 1 from public.training_exams e
                                where e.id = a.exam_id and public.pode_gerir_treinamento(e.training_id))))
  );

revoke all on table public.training_exams from public, anon;
revoke all on table public.training_exam_questions from public, anon;
revoke all on table public.training_exam_answers from public, anon;

-- O gabarito. Derrubar o SELECT de TABELA é o que faz o privilégio de coluna
-- valer: com o grant de tabela em pé, o revoke de coluna não tem efeito
-- nenhum. `answer_key` fica de fora da lista, e por isso também fica de fora do
-- Row em src/types/database.ts, para um `.select("answer_key")` futuro quebrar
-- na compilação em vez de virar 42501 em produção.
revoke all on table public.training_exam_attempts from public, anon, authenticated;
grant select (id, tenant_id, exam_id, enrollment_id, user_id, attempt_no, status,
              questions_snapshot, started_at, deadline_at, submitted_at, graded_at,
              score, passed, created_at)
  on table public.training_exam_attempts to authenticated;

do $$
declare t text;
begin
  foreach t in array array['training_exams','training_exam_questions','training_exam_attempts','training_exam_answers'] loop
    execute format(
      'drop trigger if exists %I on public.%I; create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_trigger();',
      'audit_' || t, t, 'audit_' || t, t);
  end loop;
end $$;

notify pgrst, 'reload schema';
