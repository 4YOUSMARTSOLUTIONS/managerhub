-- Congelar a competência da remuneração variável.
--
-- O problema: o valor pago é RECALCULADO a cada abertura da tela. Registrar uma
-- punição em outubro mudava a RV de julho, e mudava calada. Com férias o efeito
-- já existia; com punição e atestado ele passou a valer o mês inteiro.
--
-- O congelamento tira do cálculo os três números que vêm de FORA do lançamento
-- da meta, que são justamente os que um lançamento retroativo mexe:
--
--   * `rv_full`     o pote vigente na competência (individual_rv_config)
--   * `prop_factor` a proporção de dias trabalhados (employee_absences + vínculo)
--   * `reducer_pct` o corte por conduta (atestado, falta, punição)
--
-- O atingimento das metas continua vivo porque ele já tem o seu próprio
-- fechamento, por lançamento (`individual_goal_entries.approval_status`). Aqui
-- se trava o dinheiro; lá se trava o desempenho.
--
-- O retrato é tirado NO SERVIDOR, pelos mesmos módulos puros que a tela usa
-- (`rv-proporcional.ts` e `rv-redutores.ts`). O navegador não manda valor
-- nenhum: quem congela escolhe a competência, e só.

-- O cadeado. Existe uma linha por competência congelada, e só; reabrir APAGA a
-- linha. O histórico de quem congelou e quem reabriu fica em `audit_logs`, que
-- já guarda o de-para com rótulo, em vez de virar mais duas colunas aqui.
create table if not exists public.rv_period_locks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- sempre o dia 1: é o mesmo formato de `individual_goal_entries.period`
  period date not null,
  locked_at timestamptz not null default now(),
  locked_by uuid references public.profiles(id) on delete set null,
  note text,
  constraint rv_period_locks_unico unique (tenant_id, period),
  constraint rv_period_locks_dia1 check (extract(day from period) = 1)
);

-- O retrato, um por colaborador que TINHA pote na competência. Quem não tinha
-- pote não entra: continuar fora é o mesmo resultado, e uma linha com zero
-- sugeriria que houve RV e ela foi cortada.
create table if not exists public.rv_period_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  period date not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rv_full numeric(14,2) not null,
  prop_factor numeric(9,6) not null default 1,
  reducer_pct numeric(5,2) not null default 0,
  -- `rv_full * prop_factor * (1 - reducer_pct/100)`, gravado e não calculado na
  -- leitura: é o número que a tela mostra e o que uma conferência futura compara
  pool numeric(14,2) not null,
  -- os motivos que cortaram, com nome e percentual, para o aviso da tela
  -- continuar explicando o valor menor depois de congelado
  detail jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint rv_period_snapshots_unico unique (tenant_id, period, user_id),
  constraint rv_period_snapshots_prop check (prop_factor >= 0 and prop_factor <= 1),
  constraint rv_period_snapshots_pct check (reducer_pct >= 0 and reducer_pct <= 100)
);

create index if not exists rv_period_snapshots_periodo_idx
  on public.rv_period_snapshots (tenant_id, period);

alter table public.rv_period_locks enable row level security;
alter table public.rv_period_snapshots enable row level security;

-- Leitura para qualquer membro da empresa: sem isto a tela de metas não saberia
-- que o mês está fechado, e o colaborador veria o valor recalculado enquanto o
-- administrador veria o congelado.
create policy rv_period_locks_select on public.rv_period_locks for select
  using (tenant_id in (select public.my_tenant_ids()));
create policy rv_period_snapshots_select on public.rv_period_snapshots for select
  using (tenant_id in (select public.my_tenant_ids()));

-- Escrita SÓ owner/admin, e o RH fica de fora de propósito: ele lança o dado que
-- entra na conta, então não pode ser também quem decide quando a conta fecha.
create policy rv_period_locks_write on public.rv_period_locks for all
  using (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])));
create policy rv_period_snapshots_write on public.rv_period_snapshots for all
  using (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])));

-- RLS sem revoke não basta: o ACL padrão do Supabase concede tudo a `anon` e
-- `authenticated` em toda tabela nova de `public`.
revoke all on table public.rv_period_locks from public, anon;
revoke all on table public.rv_period_snapshots from public, anon;

-- Fechar e reabrir competência é exatamente o tipo de coisa que precisa ter
-- dono e hora no log.
create trigger rv_period_locks_audit
  after insert or update or delete on public.rv_period_locks
  for each row execute function public.audit_trigger('Competência da RV');
