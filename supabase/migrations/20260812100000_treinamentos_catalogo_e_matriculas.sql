-- Treinamentos, leva 1: catálogo, matriz de atribuição e matrículas.
--
-- O desenho segue o consenso de LMS profissional (SuccessFactors, Cornerstone,
-- Docebo, Moodle Workplace), onde quatro coisas são entidades SEPARADAS:
--
--   CURSO      o que se ensina (catálogo, sem data e sem instrutor)
--   TURMA      uma oferta do curso, com data/instrutor/vagas (leva 2)
--   MATRÍCULA  um CICLO de um curso para uma pessoa
--   TENTATIVA  uma execução de prova, imutável (leva 4)
--
-- Juntar curso e turma parece economia e é a decisão que mais custa depois:
-- com data no curso não existe segunda oferta do mesmo conteúdo, e o histórico
-- de quem fez em turmas diferentes não tem onde morar. Curso auto-instrucional,
-- por sua vez, não tem turma nenhuma, então a turma é opcional na matrícula.
--
-- E cada recertificação é uma matrícula NOVA (`cycle_no`), nunca um UPDATE na
-- anterior: a NR-1 manda guardar a evidência por 5 anos, e sobrescrever apaga
-- justamente o que a fiscalização vem ver.

-- ---------------------------------------------------------------- enums
create type public.training_delivery as enum ('auto_instrucional', 'turma', 'misto');

-- Só os status "de fato" moram no banco. `a_vencer`, `vencido` e `overdue` são
-- DERIVADOS de data e calculados na leitura (src/lib/training-schedule.ts):
-- gravá-los exigiria um job para mantê-los verdadeiros a cada meia-noite, e um
-- job atrasado viraria relatório mentiroso.
create type public.training_enrollment_status as enum (
  'nao_iniciado', 'em_andamento', 'aguardando_correcao', 'concluido',
  'reprovado', 'isento', 'cancelado', 'nao_aplicavel', 'no_show'
);

create type public.training_enrollment_origin as enum (
  'regra', 'manual', 'turma', 'importado', 'recertificacao'
);

-- ---------------------------------------------------------------- catálogo
create table public.trainings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  code text,
  workload_minutes integer not null default 0,
  delivery public.training_delivery not null default 'auto_instrucional',
  -- null = avulso (não recertifica). 1 mensal, 6 semestral, 12 anual, 24 bianual.
  validade_meses smallint,
  -- janela para refazer antes de vencer sem perder a data-base
  antecipacao_dias smallint not null default 60,
  -- prazo para concluir depois de entrar no escopo (null = sem prazo)
  prazo_dias smallint,
  -- escopo: nulo em todos = vale para a empresa inteira. Mesmo critério de
  -- /acoes e /checklists, onde registro sem unidade aparece em qualquer recorte.
  unit_id uuid references public.units(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  subdepartment_id uuid references public.subdepartments(id) on delete set null,
  -- vínculo SDPO, mesmo conjunto de colunas de `actions`
  programa_id uuid references public.sdpo_programas(id) on delete set null,
  pilar_id uuid references public.sdpo_pilares(id) on delete set null,
  secao_id uuid references public.sdpo_secoes(id) on delete set null,
  bloco_id uuid references public.sdpo_blocos(id) on delete set null,
  item_id uuid references public.sdpo_itens(id) on delete set null,
  active boolean not null default true,
  -- evidência de 5 anos: curso NUNCA some, some da vista
  deleted_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trainings_validade_positiva check (validade_meses is null or validade_meses > 0)
);
create index trainings_tenant_idx on public.trainings (tenant_id) where deleted_at is null;

-- Responsáveis pelo treinamento (1 ou mais). Eles editam o curso e enxergam as
-- matrículas dele mesmo sem serem administradores.
create table public.training_owners (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  training_id uuid not null references public.trainings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (training_id, user_id)
);
create index training_owners_user_idx on public.training_owners (user_id);

-- A matriz do LENT: quem deve fazer o quê.
--
-- `kind` + `ref_id` é o molde polimórfico de `checklist_audiences`, ampliado com
-- subsetor e unidade. Sem FK no ref_id de propósito: a coluna aponta para cinco
-- tabelas diferentes conforme o kind.
create table public.training_assignment_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  training_id uuid not null references public.trainings(id) on delete cascade,
  kind text not null check (kind in ('user', 'position', 'department', 'subdepartment', 'unit')),
  ref_id uuid not null,
  -- false = o treinamento é oferecido a esse público, mas não é cobrado
  mandatory boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (training_id, kind, ref_id)
);
create index training_rules_training_idx on public.training_assignment_rules (training_id) where active;

-- ---------------------------------------------------------------- matrículas
create table public.training_enrollments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  training_id uuid not null references public.trainings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- turma entra na leva 2; auto-instrucional fica sem turma para sempre
  session_id uuid,
  -- 1, 2, 3... cada recertificação abre o próximo
  cycle_no smallint not null default 1,
  origin public.training_enrollment_origin not null default 'regra',
  status public.training_enrollment_status not null default 'nao_iniciado',
  -- carimbado da regra: se a regra virar opcional depois, o que já era cobrado
  -- continua cobrado neste ciclo
  mandatory boolean not null default true,
  due_at date,
  started_at timestamptz,
  completed_at timestamptz,
  -- calculado na conclusão, com data-base FIXA (vencimento anterior +
  -- periodicidade), para o calendário não escorregar a cada ciclo
  expires_at date,
  score numeric(5,2),
  exempted_by uuid references public.profiles(id) on delete set null,
  exempted_reason text,
  exempted_until date,
  -- Carimbo de época (mesmo padrão de feedbacks.subject_department_id): o
  -- relatório de um ciclo antigo mostra o cargo/setor de QUANDO ele aconteceu,
  -- e não o de hoje. Sem isto, transferir alguém reescreve o passado.
  snap_position_id uuid references public.positions(id) on delete set null,
  snap_department_id uuid references public.departments(id) on delete set null,
  snap_subdepartment_id uuid references public.subdepartments(id) on delete set null,
  snap_unit_id uuid references public.units(id) on delete set null,
  -- false quando a pessoa saiu do escopo da regra ou da empresa. Nunca se apaga
  -- matrícula: ela vira inaplicável e sai das contas.
  applicable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Um ciclo vivo por pessoa e curso. Cancelada e inaplicável ficam de fora do
-- índice para não travarem a criação do ciclo seguinte.
create unique index training_enrollments_ciclo_uidx
  on public.training_enrollments (training_id, user_id, cycle_no)
  where status not in ('cancelado', 'nao_aplicavel');
create index training_enrollments_user_idx on public.training_enrollments (tenant_id, user_id);
create index training_enrollments_training_idx on public.training_enrollments (training_id, status);
create index training_enrollments_expira_idx on public.training_enrollments (expires_at) where expires_at is not null;

-- ---------------------------------------------------------------- helpers de RLS
-- Quem administra o treinamento: administração, RH ou responsável pelo curso.
create or replace function public.pode_gerir_treinamento(p_training uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.trainings t
     where t.id = p_training
       and public.is_tenant_member(t.tenant_id)
       and (
         public.has_tenant_role(t.tenant_id, '{owner,admin,hr}'::public.member_role[])
         or exists (select 1 from public.training_owners o
                     where o.training_id = t.id and o.user_id = (select auth.uid()))
       )
  );
$$;

revoke execute on function public.pode_gerir_treinamento(uuid) from public, anon;
grant execute on function public.pode_gerir_treinamento(uuid) to authenticated;

-- ---------------------------------------------------------------- RLS
alter table public.trainings enable row level security;
alter table public.training_owners enable row level security;
alter table public.training_assignment_rules enable row level security;
alter table public.training_enrollments enable row level security;

-- O catálogo é interno: todo membro enxerga o que existe (é o que permite a
-- tela "quais treinamentos existem"). Quem edita é a administração ou o dono.
create policy trainings_select on public.trainings
  for select using (public.is_tenant_member(tenant_id));
create policy trainings_insert on public.trainings
  for insert with check (
    public.is_tenant_member(tenant_id)
    and public.has_tenant_role(tenant_id, '{owner,admin,hr}'::public.member_role[])
  );
create policy trainings_update on public.trainings
  for update using (public.pode_gerir_treinamento(id))
  with check (public.pode_gerir_treinamento(id));
create policy trainings_delete on public.trainings
  for delete using (
    public.is_tenant_member(tenant_id)
    and public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[])
  );

create policy training_owners_select on public.training_owners
  for select using (public.is_tenant_member(tenant_id));
create policy training_owners_write on public.training_owners
  for all using (public.pode_gerir_treinamento(training_id))
  with check (public.pode_gerir_treinamento(training_id));

create policy training_rules_select on public.training_assignment_rules
  for select using (public.is_tenant_member(tenant_id));
create policy training_rules_write on public.training_assignment_rules
  for all using (public.pode_gerir_treinamento(training_id))
  with check (public.pode_gerir_treinamento(training_id));

-- Matrícula: a própria pessoa, a cadeia de gestão, quem responde pelo curso e a
-- administração. Escrita só por RPC/action (o app nunca faz update direto).
create policy training_enrollments_select on public.training_enrollments
  for select using (
    public.is_tenant_member(tenant_id)
    and (
      user_id = (select auth.uid())
      or public.manages_user(user_id, tenant_id)
      or public.has_tenant_role(tenant_id, '{owner,admin,hr}'::public.member_role[])
      or exists (select 1 from public.training_owners o
                  where o.training_id = training_enrollments.training_id
                    and o.user_id = (select auth.uid()))
    )
  );
create policy training_enrollments_write on public.training_enrollments
  for all using (public.pode_gerir_treinamento(training_id))
  with check (public.pode_gerir_treinamento(training_id));

-- O ACL padrão do Supabase concede tudo em tabela nova de `public`; sem estes
-- revokes a RLS seria a única barreira (AGENTS.md).
revoke all on table public.trainings from public, anon;
revoke all on table public.training_owners from public, anon;
revoke all on table public.training_assignment_rules from public, anon;
revoke all on table public.training_enrollments from public, anon;

-- ---------------------------------------------------------------- auditoria
do $$
declare t text;
begin
  foreach t in array array['trainings','training_owners','training_assignment_rules','training_enrollments'] loop
    execute format(
      'drop trigger if exists %I on public.%I; create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_trigger();',
      'audit_' || t, t, 'audit_' || t, t);
  end loop;
end $$;

notify pgrst, 'reload schema';
