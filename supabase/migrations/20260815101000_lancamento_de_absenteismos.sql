-- O processo do absenteísmo, separado do fato que a remuneração variável lê.
--
-- `employee_absences` continua sendo a BASE REAL e não ganha coluna nenhuma. Ela
-- é lida por service client em três lugares (src/app/(app)/metas/page.tsx,
-- src/lib/actions/rv-lock.ts e src/lib/actions/training-sessions.ts), com lista
-- de colunas fixa: um `status` ali obrigaria a filtrar nos três, e um
-- `rv_period_snapshots` já gravado passaria a significar outra coisa.
--
-- Mais forte que isso: um não comparecimento ABERTO não pode existir naquela
-- tabela nem por um instante. Ele reduziria a remuneração variável antes de
-- alguém saber se houve falta, atestado ou se a pessoa apareceu depois.
--
-- ABERTO NÃO É RASCUNHO. Quando o lançamento nasce, o comunicado por e-mail já
-- saiu, então não existe "excluir e fingir que não houve". Desfazer é
-- `absenteismo_cancelar`, com nota, e o registro fica.

create type public.absenteismo_status as enum
  ('aberto', 'pendente', 'aprovado', 'reprovado', 'cancelado');

create table public.absenteismo_lancamentos (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  status    public.absenteismo_status not null default 'aberto',

  -- ---- o fato bruto da manhã ----
  -- `occurred_on` é o dia LOCAL de quem lançou, calculado no cliente. Um
  -- `now()::date` no banco viraria o dia seguinte às 21h de Brasília, porque o
  -- servidor está em UTC.
  occurred_on date not null,
  reported_at timestamptz not null default now(),
  reason_note text,

  -- ---- o que a confirmação descobriu ----
  absence_type_id uuid references public.absence_types(id) on delete restrict,
  snap_type_name  text,
  snap_kind       public.absence_kind,
  snap_requires_document boolean not null default false,
  snap_requires_medical  boolean not null default false,
  snap_discounts_rv_default boolean not null default true,
  start_date date,
  end_date   date,
  discounts_rv boolean,
  note text,

  -- ---- o vínculo da época ----
  snap_full_name          text,
  snap_employee_code      text,
  snap_department_id      uuid,
  snap_department_name    text,
  snap_subdepartment_id   uuid,
  snap_subdepartment_name text,
  snap_position_id        uuid,
  snap_position_name      text,
  snap_manager_id         uuid,
  snap_manager_name       text,
  snap_unit_id            uuid,
  snap_unit_name          text,

  -- ---- o documento digitalizado ----
  doc_path         text,
  doc_filename     text,
  doc_size         bigint,
  doc_content_type text,
  doc_uploaded_at  timestamptz,
  doc_uploaded_by  uuid references public.profiles(id) on delete set null,

  created_by   uuid not null references public.profiles(id) on delete restrict,
  submitted_at timestamptz,
  decided_at   timestamptz,
  decided_by   uuid references public.profiles(id) on delete set null,
  decision_note text,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete set null,
  cancel_note  text,

  -- espelho do último comunicado, para a lista mostrar o estado do e-mail sem
  -- uma consulta por linha
  email_status text check (email_status is null or email_status in ('sent','failed','skipped')),
  email_at     timestamptz,

  absence_id uuid references public.employee_absences(id) on delete restrict,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint absenteismo_periodo
    check (start_date is null or end_date is null or end_date >= start_date),
  -- O período confirmado precisa conter o dia do não comparecimento. Sem isto, o
  -- aviso da manhã e o atestado anexado falariam de dias diferentes, e ninguém
  -- notaria olhando a lista.
  constraint absenteismo_periodo_cobre_o_dia
    check (status = 'aberto' or start_date is null
           or (occurred_on between start_date and end_date)),
  constraint absenteismo_campos_para_confirmar
    check (status = 'aberto' or (absence_type_id is not null and snap_kind is not null
           and start_date is not null and end_date is not null)),
  -- A exigência de anexo é do CATÁLOGO, mas o carimbo a torna verificável aqui.
  constraint absenteismo_anexo_quando_o_tipo_exige
    check (status = 'aberto' or not snap_requires_document or doc_path is not null),
  -- Implicação, e não equivalência: cancelar uma aprovada mantém o carimbo de
  -- quem decidiu, que é o que a auditoria vai querer depois. É a lição da
  -- migração 20260814103000, já corrigida na origem.
  constraint absenteismo_decidido_tem_carimbo
    check (status not in ('aprovado', 'reprovado')
           or (decided_at is not null and decided_by is not null)),
  constraint absenteismo_reprovado_tem_nota
    check (status <> 'reprovado' or coalesce(btrim(decision_note), '') <> ''),
  constraint absenteismo_aprovado_tem_ausencia
    check (status <> 'aprovado' or absence_id is not null),
  constraint absenteismo_cancelado_tem_carimbo
    check ((status = 'cancelado') = (cancelled_at is not null))
);

create index absenteismo_fila_idx   on public.absenteismo_lancamentos (tenant_id, status, submitted_at desc);
create index absenteismo_pessoa_idx on public.absenteismo_lancamentos (tenant_id, user_id, occurred_on desc);
create index absenteismo_autor_idx  on public.absenteismo_lancamentos (tenant_id, created_by, created_at desc);

create unique index absenteismo_ausencia_uk
  on public.absenteismo_lancamentos (absence_id) where absence_id is not null;

-- Um não comparecimento por pessoa por dia.
--
-- Dois gestores da mesma cadeia (ou o mesmo, duas vezes) lançando a mesma manhã
-- disparariam dois comunicados e virariam dois períodos em `employee_absences`.
-- Cancelado libera o dia de propósito: "ela apareceu, foi engano" precisa
-- deixar lançar de novo se ela faltar de verdade mais tarde. Reprovado NÃO
-- libera, porque é o mesmo lançamento voltando para correção.
create unique index absenteismo_do_dia_uk
  on public.absenteismo_lancamentos (tenant_id, user_id, occurred_on)
  where status <> 'cancelado';

create trigger trg_absenteismo_lancamentos_updated
  before update on public.absenteismo_lancamentos
  for each row execute function public.set_updated_at();

-- ============================================================================
-- O dado médico, numa tabela à parte
-- ============================================================================
--
-- CID é dado sensível de saúde. Ele NÃO fica em `employee_absences` (lida por
-- service client e congelada em `rv_period_snapshots`) nem na tabela acima (a
-- tela faz `select("*")`, e todo gestor com alçada receberia diagnóstico de
-- dezenas de pessoas no payload da listagem, mesmo sem a tela mostrar).
--
-- Aqui ele é lido por UMA porta só, a RPC `absenteismo_atestado`, uma linha por
-- vez. E a tabela fica FORA do `audit_trigger` de propósito: senão o CID viraria
-- histórico permanente numa tela genérica de logs. Em troca ela carrega o
-- próprio `updated_by`/`updated_at`.
--
-- Efeito colateral desejado: apagar dado de saúde depois do prazo legal vira um
-- delete nesta tabela, sem tocar no registro do absenteísmo, que precisa
-- sobreviver para indicador e para a remuneração variável.
create table public.absenteismo_atestados (
  lancamento_id uuid primary key
    references public.absenteismo_lancamentos(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  cid_code        text,
  cid_description text,
  doctor_name text,
  doctor_crm  text,
  facility    text,
  issued_on   date,
  days_off    int check (days_off is null or days_off between 0 and 365),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_absenteismo_atestados_updated
  before update on public.absenteismo_atestados
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Quem vê o quê
-- ============================================================================
--
-- Recebe VALORES e não o id, pelo mesmo motivo de `pode_ver_punicao`: dentro da
-- policy da própria tabela, consultar a tabela seria recursão.
--
-- O colaborador não vê o próprio lançamento nesta versão. É decisão, não
-- esquecimento: o documento é tratado com o gestor e o RH. Se um dia mudar, é
-- uma linha aqui.
create or replace function public.pode_ver_absenteismo(
  p_tenant uuid, p_user uuid, p_created_by uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_created_by = (select auth.uid())
      or public.manages_user(p_user, p_tenant)
      or public.has_tenant_role(p_tenant, '{owner,admin,hr}'::public.member_role[]);
$$;

revoke execute on function public.pode_ver_absenteismo(uuid, uuid, uuid) from public, anon;
grant execute on function public.pode_ver_absenteismo(uuid, uuid, uuid) to authenticated;

alter table public.absenteismo_lancamentos enable row level security;

create policy absenteismo_select on public.absenteismo_lancamentos
  for select using (public.pode_ver_absenteismo(tenant_id, user_id, created_by));

create policy absenteismo_insert on public.absenteismo_lancamentos
  for insert with check (
    public.is_tenant_member(tenant_id)
    and created_by = (select auth.uid())
    and status = 'aberto'
    and (public.manages_user(user_id, tenant_id)
         or public.has_tenant_role(tenant_id, '{owner,admin,hr}'::public.member_role[]))
  );

-- Update largo de propósito: quem estreita é o trigger, que enxerga o de/para.
create policy absenteismo_update on public.absenteismo_lancamentos
  for update using (public.pode_ver_absenteismo(tenant_id, user_id, created_by))
  with check (public.pode_ver_absenteismo(tenant_id, user_id, created_by));

-- Não existe delete pela tela: o comunicado já saiu e o registro fica. Sobra a
-- limpeza administrativa, que é do proprietário e do administrador.
create policy absenteismo_delete on public.absenteismo_lancamentos
  for delete using (public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[]));

revoke all on table public.absenteismo_lancamentos from public, anon;

drop trigger if exists audit_absenteismo_lancamentos on public.absenteismo_lancamentos;
create trigger audit_absenteismo_lancamentos
  after insert or update or delete on public.absenteismo_lancamentos
  for each row execute function public.audit_trigger();

alter table public.absenteismo_atestados enable row level security;

create policy absenteismo_atestado_rw on public.absenteismo_atestados
  for all
  using (exists (
    select 1 from public.absenteismo_lancamentos l
     where l.id = lancamento_id
       and public.pode_ver_absenteismo(l.tenant_id, l.user_id, l.created_by)))
  with check (exists (
    select 1 from public.absenteismo_lancamentos l
     where l.id = lancamento_id
       and public.pode_ver_absenteismo(l.tenant_id, l.user_id, l.created_by)));

revoke all on table public.absenteismo_atestados from public, anon;

-- ============================================================================
-- A guarda das transições
-- ============================================================================
create or replace function public.guard_absenteismo_lancamento()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_adm boolean;
begin
  v_adm := public.has_tenant_role(old.tenant_id, '{owner,admin,hr}'::public.member_role[]);

  -- `reprovado` fica editável junto com `aberto`: é o estado em que o
  -- lançamento voltou para as mãos de quem lançou, e congelá-lo criaria um beco
  -- sem saída. A lição da migração 20260814104000, já corrigida na origem.
  if old.status not in ('aberto', 'reprovado') and (
       new.user_id is distinct from old.user_id
       or new.occurred_on is distinct from old.occurred_on
       or new.absence_type_id is distinct from old.absence_type_id
       or new.snap_type_name is distinct from old.snap_type_name
       or new.snap_kind is distinct from old.snap_kind
       or new.start_date is distinct from old.start_date
       or new.end_date is distinct from old.end_date
       or new.discounts_rv is distinct from old.discounts_rv
       or new.note is distinct from old.note
       or new.reason_note is distinct from old.reason_note
       or new.snap_full_name is distinct from old.snap_full_name
       or new.snap_department_name is distinct from old.snap_department_name
       or new.snap_position_name is distinct from old.snap_position_name
       or new.snap_manager_name is distinct from old.snap_manager_name
       or new.snap_unit_id is distinct from old.snap_unit_id)
  then
    raise exception 'Este lançamento está com o RH. Peça a reprovação para corrigir.';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'aberto'    and new.status in ('pendente', 'cancelado'))
      or (old.status = 'reprovado' and new.status in ('pendente', 'cancelado'))
      or (old.status = 'pendente'  and new.status in ('aprovado', 'reprovado') and v_adm)
      or (old.status = 'aprovado'  and new.status = 'cancelado'
          and public.has_tenant_role(old.tenant_id, '{owner,admin}'::public.member_role[]))
    ) then
      raise exception 'Transição de status inválida.';
    end if;
  elsif old.status in ('aprovado', 'cancelado') then
    raise exception 'Lançamento já encerrado. Não é possível alterá-lo.';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_absenteismo_lancamento() from public, anon, authenticated;

create trigger trg_guard_absenteismo_lancamento
  before update on public.absenteismo_lancamentos
  for each row execute function public.guard_absenteismo_lancamento();

-- O dado médico só se escreve enquanto o lançamento está com o gestor.
create or replace function public.guard_absenteismo_atestado()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_status public.absenteismo_status;
begin
  select l.status into v_status from public.absenteismo_lancamentos l
   where l.id = coalesce(new.lancamento_id, old.lancamento_id);
  if v_status is null then return coalesce(new, old); end if;
  if v_status not in ('aberto', 'reprovado') then
    raise exception 'Os dados do atestado não podem ser alterados depois do envio ao RH.';
  end if;
  return coalesce(new, old);
end;
$$;

revoke execute on function public.guard_absenteismo_atestado() from public, anon, authenticated;

create trigger trg_guard_absenteismo_atestado
  before insert or update or delete on public.absenteismo_atestados
  for each row execute function public.guard_absenteismo_atestado();

-- ============================================================================
-- O bucket do atestado
-- ============================================================================
--
-- A policy é mais ESTREITA que a de `punicao-documentos`, e isso é uma correção
-- consciente do molde: lá qualquer membro da empresa que soubesse o nome do
-- objeto alcançava o arquivo. Papel assinado de advertência já era ruim;
-- atestado médico é dado de saúde. Aqui o acesso segue a mesma regra do
-- lançamento, lendo o id da pasta.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('absenteismo-documentos', 'absenteismo-documentos', false, 10485760,
        array['application/pdf','image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists absenteismo_doc_all on storage.objects;
create policy absenteismo_doc_all on storage.objects for all
  using (
    bucket_id = 'absenteismo-documentos'
    and exists (
      select 1 from public.absenteismo_lancamentos l
       where l.id = ((storage.foldername(name))[2])::uuid
         and public.pode_ver_absenteismo(l.tenant_id, l.user_id, l.created_by)))
  with check (
    bucket_id = 'absenteismo-documentos'
    and exists (
      select 1 from public.absenteismo_lancamentos l
       where l.id = ((storage.foldername(name))[2])::uuid
         and public.pode_ver_absenteismo(l.tenant_id, l.user_id, l.created_by)));

do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_n <> 0 then
    raise exception 'ha % funcoes SECURITY DEFINER alcancaveis por anon', v_n;
  end if;
end $$;

notify pgrst, 'reload schema';
