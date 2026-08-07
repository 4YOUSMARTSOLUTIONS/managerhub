-- Redutores da remuneração variável, configuráveis por empresa.
--
-- A RV das metas individuais já era `pote × fator de dias trabalhados`
-- (src/lib/rv-proporcional.ts). O que faltava era o corte por CONDUTA: falta sem
-- justificativa, atestado e punição. E como o produto é SaaS, os números não
-- podem morar no código — cada empresa corta de um jeito.
--
-- O desenho separa QUEM GERA o evento de QUANTO ELE CORTA. As regras da
-- Cervantes viram linhas de tabela, não `if`:
--
--   Falta      → 1 dia ou mais, 100%
--   Atestado   → 1 a 3 dias 20% · 4 a 6 dias 50% · 7 ou mais 100%
--   Punição    → 1 ocorrência ou mais, 100%
--
-- Duas regras de composição, decididas com o cliente e implementadas aqui:
--
--   1. Dentro de um MESMO motivo as faixas são EXCLUSIVAS. Isso não é convenção
--      do app: a constraint de exclusão em `rv_reducer_bands` impede cadastrar
--      faixas sobrepostas, então "qual faixa vale" nunca depende da ordem de
--      leitura.
--   2. Motivos DIFERENTES somam os percentuais, com teto de 100%. O teto mora no
--      app, junto da conta.

-- ---------------------------------------------------------------- catálogo
create table if not exists public.sanction_types (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  active     boolean not null default true,
  sort       int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sanction_types_nome_unico unique (tenant_id, name)
);

-- ------------------------------------------------------------- o registro
-- Dado disciplinar. É a informação mais sensível desta migração e por isso a
-- leitura NÃO chega ao navegador de quem vê metas: a tela de Metas usa o service
-- client e manda ao cliente só o percentual e o nome do motivo.
create table if not exists public.employee_sanctions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  sanction_type_id uuid not null references public.sanction_types(id) on delete restrict,
  occurred_on      date not null,
  note             text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists employee_sanctions_user_idx
  on public.employee_sanctions (tenant_id, user_id, occurred_on desc);

-- ----------------------------------------------------------------- o motivo
do $$ begin
  create type public.rv_reducer_source as enum ('absence','sanction');
exception when duplicate_object then null; end $$;

create table if not exists public.rv_reducer_rules (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  name             text not null,
  source           public.rv_reducer_source not null,
  -- `absence`: a quantidade é a SOMA DE DIAS daquele tipo de ausência no mês
  absence_kind     public.absence_kind,
  -- `sanction`: a quantidade é o NÚMERO DE OCORRÊNCIAS no mês.
  -- Nulo aqui significa "qualquer punição", que é a regra da Cervantes.
  sanction_type_id uuid references public.sanction_types(id) on delete cascade,
  active           boolean not null default true,
  sort             int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- par (id, tenant_id) para a FK composta das faixas amarrar as duas colunas
  constraint rv_reducer_rules_id_tenant_uk unique (id, tenant_id),
  constraint rv_reducer_rules_fonte check (
    (source = 'absence'  and absence_kind is not null and sanction_type_id is null)
    or
    (source = 'sanction' and absence_kind is null)
  )
);

-- Um motivo por fonte. Duas regras apontando para 'atestado' somariam duas
-- vezes o mesmo atestado, e a soma entre motivos deixaria de fazer sentido.
create unique index if not exists rv_reducer_rules_ausencia_uk
  on public.rv_reducer_rules (tenant_id, absence_kind) where source = 'absence';
create unique index if not exists rv_reducer_rules_punicao_geral_uk
  on public.rv_reducer_rules (tenant_id) where source = 'sanction' and sanction_type_id is null;
create unique index if not exists rv_reducer_rules_punicao_tipo_uk
  on public.rv_reducer_rules (tenant_id, sanction_type_id) where source = 'sanction' and sanction_type_id is not null;

-- ----------------------------------------------------------------- as faixas
create table if not exists public.rv_reducer_bands (
  id            uuid primary key default gen_random_uuid(),
  rule_id       uuid not null,
  -- Repetido da regra de propósito, por dois motivos concretos: o
  -- `audit_trigger()` exige `tenant_id` na linha, e a policy fica um `in` em vez
  -- de um `exists` correlacionado. A FK COMPOSTA abaixo torna impossível a faixa
  -- apontar para uma regra de outra empresa, que é o risco de repetir a coluna.
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  min_qtd       int not null default 1,
  max_qtd       int,                       -- nulo = sem teto
  reduction_pct numeric(5,2) not null,
  created_at    timestamptz not null default now(),
  constraint rv_reducer_bands_min check (min_qtd >= 1),
  constraint rv_reducer_bands_max check (max_qtd is null or max_qtd >= min_qtd),
  constraint rv_reducer_bands_pct check (reduction_pct >= 0 and reduction_pct <= 100),
  -- É ISTO que garante a faixa única. O teto aberto vira 1.000.000 só para caber
  -- num range fechado; dia e ocorrência nunca chegam perto, e usar o máximo do
  -- int4 estouraria na canonicalização de `[a,b]` para `[a,b+1)`.
  constraint rv_reducer_bands_sem_sobreposicao exclude using gist (
    rule_id with =,
    int4range(min_qtd, coalesce(max_qtd, 1000000), '[]') with &&
  ),
  constraint rv_reducer_bands_regra_fk foreign key (rule_id, tenant_id)
    references public.rv_reducer_rules (id, tenant_id) on delete cascade
);

create index if not exists rv_reducer_bands_rule_idx on public.rv_reducer_bands (tenant_id, rule_id, min_qtd);

-- --------------------------------------------------------------- triggers
drop trigger if exists trg_sanction_types_updated on public.sanction_types;
create trigger trg_sanction_types_updated before update on public.sanction_types
  for each row execute function public.set_updated_at();
drop trigger if exists trg_employee_sanctions_updated on public.employee_sanctions;
create trigger trg_employee_sanctions_updated before update on public.employee_sanctions
  for each row execute function public.set_updated_at();
drop trigger if exists trg_rv_reducer_rules_updated on public.rv_reducer_rules;
create trigger trg_rv_reducer_rules_updated before update on public.rv_reducer_rules
  for each row execute function public.set_updated_at();

-- Tudo aqui mexe no que a pessoa recebe. Vai para Logs do sistema pelo mesmo
-- motivo que individual_rv_config e employee_absences já vão.
create or replace trigger audit_sanction_types
  after insert or update or delete on public.sanction_types
  for each row execute function public.audit_trigger();
create or replace trigger audit_employee_sanctions
  after insert or update or delete on public.employee_sanctions
  for each row execute function public.audit_trigger();
create or replace trigger audit_rv_reducer_rules
  after insert or update or delete on public.rv_reducer_rules
  for each row execute function public.audit_trigger();
create or replace trigger audit_rv_reducer_bands
  after insert or update or delete on public.rv_reducer_bands
  for each row execute function public.audit_trigger();

-- -------------------------------------------------------------------- RLS
-- O ACL padrão do Supabase concede tudo a anon em tabela nova de public, e RLS
-- sozinha não cobre isso (AGENTS.md). `authenticated` MANTÉM o grant de tabela,
-- como em employee_absences: é a role de todo mundo que loga, e revogar aqui
-- tornaria a policy inalcançável até para quem ela quer autorizar.
alter table public.sanction_types      enable row level security;
alter table public.employee_sanctions  enable row level security;
alter table public.rv_reducer_rules    enable row level security;
alter table public.rv_reducer_bands    enable row level security;

revoke all on table public.sanction_types     from public, anon;
revoke all on table public.employee_sanctions from public, anon;
revoke all on table public.rv_reducer_rules   from public, anon;
revoke all on table public.rv_reducer_bands   from public, anon;

-- Catálogo e regras são CONFIGURAÇÃO, não dado pessoal: qualquer membro lê (a
-- tela de Metas precisa nomear o motivo do corte), e só owner/admin escreve.
drop policy if exists sanction_types_select on public.sanction_types;
create policy sanction_types_select on public.sanction_types
  for select using (tenant_id in (select public.my_tenant_ids()));
drop policy if exists sanction_types_write on public.sanction_types;
create policy sanction_types_write on public.sanction_types
  for all using (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::public.member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::public.member_role[])));

drop policy if exists rv_reducer_rules_select on public.rv_reducer_rules;
create policy rv_reducer_rules_select on public.rv_reducer_rules
  for select using (tenant_id in (select public.my_tenant_ids()));
drop policy if exists rv_reducer_rules_write on public.rv_reducer_rules;
create policy rv_reducer_rules_write on public.rv_reducer_rules
  for all using (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::public.member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::public.member_role[])));

drop policy if exists rv_reducer_bands_select on public.rv_reducer_bands;
create policy rv_reducer_bands_select on public.rv_reducer_bands
  for select using (tenant_id in (select public.my_tenant_ids()));
drop policy if exists rv_reducer_bands_write on public.rv_reducer_bands;
create policy rv_reducer_bands_write on public.rv_reducer_bands
  for all using (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::public.member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::public.member_role[])));

-- A punição em si é disciplinar. Segue employee_absences: escrita owner/admin, e
-- leitura owner/admin/manager, que é o recorte que o Gerencial ganhou ontem para
-- ver a tela de Configurações inteira.
drop policy if exists employee_sanctions_read on public.employee_sanctions;
create policy employee_sanctions_read on public.employee_sanctions
  for select using (public.has_tenant_role(tenant_id, array['owner','admin','manager']::member_role[]));
drop policy if exists employee_sanctions_write on public.employee_sanctions;
create policy employee_sanctions_write on public.employee_sanctions
  for all using (public.has_tenant_role(tenant_id, array['owner','admin']::member_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner','admin']::member_role[]));

-- ------------------------------------------------------------------- seed
-- Para TODAS as empresas existentes, que hoje é uma só. Sem id fixo na migração.
-- Empresa criada daqui para frente nasce sem redutor, e sem redutor nada muda no
-- valor pago: o fator é 1.
insert into public.sanction_types (tenant_id, name, sort)
select t.id, x.nome, x.ord
from public.tenants t
cross join (values ('Advertência verbal', 10), ('Advertência escrita', 20), ('Suspensão', 30)) as x(nome, ord)
on conflict (tenant_id, name) do nothing;

with nova as (
  insert into public.rv_reducer_rules (tenant_id, name, source, absence_kind, sort)
  select t.id, 'Falta sem justificativa', 'absence', 'falta', 10 from public.tenants t
  on conflict do nothing
  returning id, tenant_id
)
insert into public.rv_reducer_bands (rule_id, tenant_id, min_qtd, max_qtd, reduction_pct)
select id, tenant_id, 1, null, 100 from nova;

with nova as (
  insert into public.rv_reducer_rules (tenant_id, name, source, absence_kind, sort)
  select t.id, 'Atestado', 'absence', 'atestado', 20 from public.tenants t
  on conflict do nothing
  returning id, tenant_id
)
insert into public.rv_reducer_bands (rule_id, tenant_id, min_qtd, max_qtd, reduction_pct)
select n.id, n.tenant_id, f.mn, f.mx, f.pct
from nova n
cross join (values (1, 3, 20), (4, 6, 50), (7, null::int, 100)) as f(mn, mx, pct);

with nova as (
  insert into public.rv_reducer_rules (tenant_id, name, source, sort)
  select t.id, 'Punição', 'sanction', 30 from public.tenants t
  on conflict do nothing
  returning id, tenant_id
)
insert into public.rv_reducer_bands (rule_id, tenant_id, min_qtd, max_qtd, reduction_pct)
select id, tenant_id, 1, null, 100 from nova;
