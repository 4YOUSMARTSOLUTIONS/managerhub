-- O processo de férias, separado do fato que a remuneração variável lê.
--
-- Mesmo desenho do absenteísmo (20260815101000): `employee_absences` continua
-- sendo a BASE REAL e não ganha coluna nenhuma. Esta tabela guarda a PREVISÃO e
-- seu trâmite (colaborador solicita -> gestor aprova -> DP efetiva), e só a
-- efetivação do DP insere a linha em `employee_absences` (kind 'ferias'),
-- guardando o vínculo em `absence_id`. RV, metas e treinamentos enxergam as
-- férias sem mudar uma linha.
--
-- FRACIONAMENTO É UMA LINHA POR PERÍODO. Cada período tem ciclo de vida próprio
-- (o DP efetiva um por vez na folha, reagenda-se um por vez) e mapeia 1:1 para
-- employee_absences. As regras de conjunto (máx. 3 períodos, um >= 14 dias,
-- total <= 30) são do CONJUNTO, e vivem na validação da RPC olhando as linhas
-- irmãs do mesmo período aquisitivo.
--
-- REAGENDAR É LINHA NOVA (`reagendada_de`), nunca mutação da efetivada: a
-- original continua de pé enquanto o pedido tramita, e a troca acontece inteira
-- na transação da efetivação do DP.
--
-- Escrita SÓ por RPC: a tabela não tem policy de insert/update e o grant de
-- authenticated é só select/delete. As RPCs são security definer e rodam como o
-- dono; o guard de transições abaixo é quem estreita o de/para.

create table public.ferias_solicitacoes (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  status    public.ferias_status not null default 'solicitada',

  -- ---- o período ----
  start_date date not null,
  end_date   date not null,
  dias int generated always as (end_date - start_date + 1) stored,
  -- abono pecuniário "vendido" junto deste período (art. 143: até 10 dias no
  -- total do aquisitivo; a soma entre irmãos é regra da RPC)
  abono_dias int not null default 0,
  adiantar_decimo_terceiro boolean not null default false,

  -- ---- o período aquisitivo de referência ----
  -- Calculado na RPC a partir do admission_date e CARIMBADO aqui: se a data de
  -- admissão for corrigida depois, as previsões já tramitadas não mudam de
  -- aquisitivo em silêncio.
  aquisitivo_inicio date not null,
  aquisitivo_fim    date not null,
  snap_admission_date date not null,

  -- reagendamento: esta linha substitui aquela quando o DP efetivar
  reagendada_de uuid references public.ferias_solicitacoes(id) on delete restrict,

  -- ---- o vínculo da época (molde absenteismo_lancamentos) ----
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
  snap_hierarchy_name     text,

  -- ---- os carimbos do trâmite ----
  created_by uuid not null references public.profiles(id) on delete restrict,
  -- true = nasceu por `ferias_lancar` (gestor programando, caso do operacional)
  lancada_pelo_gestor boolean not null default false,
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  decision_note text,
  efetivada_at timestamptz,
  efetivada_by uuid references public.profiles(id) on delete set null,
  efetivacao_note text,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete set null,
  cancel_note  text,

  absence_id uuid references public.employee_absences(id) on delete restrict,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ferias_periodo_valido check (end_date >= start_date),
  -- art. 134 §1º: nenhum período pode ser inferior a 5 dias corridos. O "um dos
  -- períodos >= 14" é regra de conjunto e fica na RPC.
  constraint ferias_minimo_clt check (end_date - start_date + 1 >= 5),
  constraint ferias_abono_faixa check (abono_dias between 0 and 10),
  constraint ferias_total_maximo check (end_date - start_date + 1 + abono_dias <= 30),
  constraint ferias_aquisitivo_valido
    check (aquisitivo_fim = (aquisitivo_inicio + interval '1 year' - interval '1 day')::date),
  constraint ferias_efetivada_tem_ausencia
    check (status <> 'efetivada' or absence_id is not null),
  -- a original que foi substituída solta a ausência na troca
  constraint ferias_reagendada_sem_ausencia
    check (status <> 'reagendada' or absence_id is null),
  constraint ferias_reprovada_tem_nota
    check (status <> 'reprovada' or coalesce(btrim(decision_note), '') <> ''),
  -- Implicação, e não equivalência: cancelar uma aprovada mantém o carimbo de
  -- quem decidiu (lição da migração 20260814103000).
  constraint ferias_decidida_tem_carimbo
    check (status not in ('aprovada', 'reprovada')
           or (decided_at is not null and decided_by is not null)),
  constraint ferias_cancelada_tem_carimbo
    check ((status = 'cancelada') = (cancelled_at is not null)),

  -- Duas previsões vivas da mesma pessoa não podem se cruzar. O filtro deixa de
  -- fora as linhas de reagendamento (`reagendada_de` preenchido): a filha
  -- convive por desenho com a original efetivada que vai substituir. Para elas
  -- a sobreposição é checada na RPC, e o fato tem a própria constraint em
  -- `employee_absences` como última linha de defesa.
  constraint ferias_sem_sobreposicao exclude using gist (
    tenant_id with =,
    user_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (status in ('solicitada', 'aprovada', 'efetivada') and reagendada_de is null)
);

create index ferias_fila_idx    on public.ferias_solicitacoes (tenant_id, status, created_at desc);
create index ferias_saldo_idx   on public.ferias_solicitacoes (tenant_id, user_id, aquisitivo_inicio);
create index ferias_agenda_idx  on public.ferias_solicitacoes (tenant_id, start_date);
create index ferias_reagendada_de_idx on public.ferias_solicitacoes (reagendada_de);

create unique index ferias_ausencia_uk
  on public.ferias_solicitacoes (absence_id) where absence_id is not null;

create trigger trg_ferias_solicitacoes_updated
  before update on public.ferias_solicitacoes
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Quem vê o quê
-- ============================================================================
--
-- Recebe VALORES e não o id (molde `pode_ver_absenteismo`): dentro da policy da
-- própria tabela, consultar a tabela seria recursão.
--
-- PRECEDENTE NOVO E PROPOSITAL: aqui o colaborador VÊ a própria linha. Punições
-- e absenteísmos escondem do interessado por decisão; férias é o contrário, o
-- fluxo começa com ele solicitando e ele precisa acompanhar o trâmite.
create or replace function public.pode_ver_ferias(
  p_tenant uuid, p_user uuid, p_created_by uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_user = (select auth.uid())
      or p_created_by = (select auth.uid())
      or public.manages_user(p_user, p_tenant)
      or public.has_tenant_role(p_tenant, '{owner,admin,hr,manager}'::public.member_role[]);
$$;

revoke execute on function public.pode_ver_ferias(uuid, uuid, uuid) from public, anon;
grant execute on function public.pode_ver_ferias(uuid, uuid, uuid) to authenticated;

alter table public.ferias_solicitacoes enable row level security;

create policy ferias_select on public.ferias_solicitacoes
  for select using (public.pode_ver_ferias(tenant_id, user_id, created_by));

-- Excluir é limpeza administrativa do proprietário (padrão da casa). O caminho
-- normal é cancelar, com nota, e o registro fica.
create policy ferias_delete on public.ferias_solicitacoes
  for delete using (public.has_tenant_role(tenant_id, '{owner}'::public.member_role[]));

-- Sem policy de insert/update: escrita só pelas RPCs. O revoke abaixo tira até
-- o grant de tabela, para a ausência de policy não ser a única camada.
revoke all on table public.ferias_solicitacoes from public, anon, authenticated;
grant select, delete on table public.ferias_solicitacoes to authenticated;

drop trigger if exists audit_ferias_solicitacoes on public.ferias_solicitacoes;
create trigger audit_ferias_solicitacoes
  after insert or update or delete on public.ferias_solicitacoes
  for each row execute function public.audit_trigger();

-- ============================================================================
-- A guarda das transições
-- ============================================================================
--
-- As RPCs rodam como o dono e passam por cima da RLS; quem estreita o de/para é
-- este trigger, que enxerga old e new e pergunta a alçada do CHAMADOR
-- (auth.uid() atravessa o security definer).
create or replace function public.guard_ferias_solicitacao()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_dp     boolean;
  v_adm    boolean;
  v_gestor boolean;
  v_dono   boolean;
begin
  v_dp     := public.has_tenant_role(old.tenant_id, '{owner,admin,hr}'::public.member_role[]);
  v_adm    := public.has_tenant_role(old.tenant_id, '{owner,admin}'::public.member_role[]);
  v_gestor := public.manages_user(old.user_id, old.tenant_id);
  v_dono   := old.created_by = (select auth.uid());

  -- `reprovada` fica editável junto com `solicitada`: é o estado em que a
  -- previsão voltou para as mãos de quem abriu (lição do absenteísmo).
  if old.status not in ('solicitada', 'reprovada') and (
       new.user_id is distinct from old.user_id
       or new.start_date is distinct from old.start_date
       or new.end_date is distinct from old.end_date
       or new.abono_dias is distinct from old.abono_dias
       or new.adiantar_decimo_terceiro is distinct from old.adiantar_decimo_terceiro
       or new.aquisitivo_inicio is distinct from old.aquisitivo_inicio
       or new.aquisitivo_fim is distinct from old.aquisitivo_fim
       or new.snap_admission_date is distinct from old.snap_admission_date
       or new.reagendada_de is distinct from old.reagendada_de
       or new.snap_full_name is distinct from old.snap_full_name
       or new.snap_department_name is distinct from old.snap_department_name
       or new.snap_manager_id is distinct from old.snap_manager_id
       or new.snap_unit_id is distinct from old.snap_unit_id)
  then
    raise exception 'Esta previsão já está em trâmite. Peça a devolução para corrigir.';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'solicitada' and new.status = 'aprovada'  and (v_gestor or v_dp))
      or (old.status = 'solicitada' and new.status = 'reprovada' and (v_gestor or v_dp))
      or (old.status = 'solicitada' and new.status = 'cancelada' and (v_dono or v_gestor or v_dp))
      -- reenvio: só quem abriu corrige e devolve à fila
      or (old.status = 'reprovada'  and new.status = 'solicitada' and v_dono)
      or (old.status = 'reprovada'  and new.status = 'cancelada'  and (v_dono or v_gestor or v_dp))
      -- efetivar (= calculada na folha) e devolver aprovada são atos do DP
      or (old.status = 'aprovada'   and new.status = 'efetivada'  and v_dp)
      or (old.status = 'aprovada'   and new.status = 'reprovada'  and v_dp)
      or (old.status = 'aprovada'   and new.status = 'cancelada'  and (v_gestor or v_dp))
      -- a troca do reagendamento acontece na efetivação da filha, pelo DP
      or (old.status = 'efetivada'  and new.status = 'reagendada' and v_dp)
      -- desfazer férias efetivada mexe em employee_absences e na RV
      or (old.status = 'efetivada'  and new.status = 'cancelada'  and v_adm)
    ) then
      raise exception 'Transição de status inválida.';
    end if;
  elsif old.status in ('reagendada', 'cancelada') then
    raise exception 'Esta previsão já foi encerrada. Não é possível alterá-la.';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_ferias_solicitacao() from public, anon, authenticated;

create trigger trg_guard_ferias_solicitacao
  before update on public.ferias_solicitacoes
  for each row execute function public.guard_ferias_solicitacao();

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
