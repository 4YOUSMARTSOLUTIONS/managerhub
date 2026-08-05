-- Férias e ausências do colaborador.
--
-- A remuneração variável das metas individuais era binária no tempo: ou existia
-- vigência na competência e pagava o valor cheio conforme o atingimento, ou não
-- pagava nada. Um mês com 10 dias trabalhados pagava igual a um mês inteiro.
--
-- Esta tabela é a fonte de "quais dias a pessoa não trabalhou". A conta em si
-- (dias do mês, dias descontados, fator) mora no app, em src/lib/rv-proporcional.ts,
-- ao lado da que já resolve o pote por vigência: aqui fica só o dado.
--
-- O tipo diz o QUE foi, e `discounts_rv` diz SE desconta. São coisas separadas de
-- propósito: um atestado de um dia e um de trinta dias merecem tratamento
-- diferente, e essa é uma decisão de política da empresa, não do esquema.

create extension if not exists "btree_gist";

do $$ begin
  create type public.absence_kind as enum ('ferias','licenca','afastamento','atestado');
exception when duplicate_object then null; end $$;

create table if not exists public.employee_absences (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  kind         public.absence_kind not null default 'ferias',
  start_date   date not null,
  end_date     date not null,
  discounts_rv boolean not null default true,
  note         text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint employee_absences_periodo check (end_date >= start_date),
  -- a mesma pessoa não pode ter dois períodos que se cruzem. Sem isso, dois
  -- lançamentos parecidos (o mesmo afastamento digitado duas vezes, com um dia
  -- de diferença) descontariam os mesmos dias em dobro e ninguém perceberia,
  -- porque a conta é feita na tela e não tem de onde reclamar.
  -- Intervalo fechado nas duas pontas: o dia de início e o de fim são dias de
  -- ausência, então 10 a 15 e 15 a 20 se sobrepõem no dia 15.
  constraint employee_absences_sem_sobreposicao exclude using gist (
    tenant_id with =,
    user_id with =,
    daterange(start_date, end_date, '[]') with &&
  )
);

comment on column public.employee_absences.discounts_rv is
  'Se os dias deste período reduzem a remuneração variável do mês proporcionalmente.';

create index if not exists employee_absences_user_idx
  on public.employee_absences (tenant_id, user_id, start_date desc);

drop trigger if exists trg_employee_absences_updated on public.employee_absences;
create trigger trg_employee_absences_updated before update on public.employee_absences
  for each row execute function public.set_updated_at();

-- Mexer nas datas de férias mexe no que a pessoa recebe. Isso precisa aparecer em
-- Logs do sistema, pelo mesmo motivo que individual_rv_config já aparece.
create or replace trigger audit_employee_absences
  after insert or update or delete on public.employee_absences
  for each row execute function public.audit_trigger();

alter table public.employee_absences enable row level security;

-- O ACL padrão do Supabase concede tudo a anon em tabela nova de public, e RLS
-- sozinha não cobre isso (ver AGENTS.md).
--
-- `authenticated` PERMANECE com o grant de tabela de propósito: é a role de todo
-- mundo que loga, inclusive owner/admin, e revogar aqui tornaria a policy abaixo
-- inalcançável até para quem ela quer autorizar. Quem recorta é a RLS. É o mesmo
-- arranjo de individual_rv_config, que também é owner/admin.
revoke all on table public.employee_absences from public, anon;

drop policy if exists employee_absences_read on public.employee_absences;
create policy employee_absences_read on public.employee_absences
  for select using (public.has_tenant_role(tenant_id, array['owner','admin']::member_role[]));

drop policy if exists employee_absences_write on public.employee_absences;
create policy employee_absences_write on public.employee_absences
  for all using (public.has_tenant_role(tenant_id, array['owner','admin']::member_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner','admin']::member_role[]));

-- A tela de Metas precisa do fator de dias para explicar o valor ao gestor, mas
-- não pode abrir a tabela para ele. Ela lê pelo service client, restrita aos
-- colaboradores já visíveis, exatamente como já faz com individual_rv_config.
