-- Efetivação do absenteísmo: atestado de horas, acompanhamento, licenças e CID.
--
-- Quatro pedidos do RH, todos na etapa de EFETIVAR:
--
-- 1. CID deixa de ser obrigatório: nem todo atestado tem CID, e a recusa de
--    envio estava forçando o gestor a inventar um código. A descrição deixa de
--    ser digitada e passa a vir da tabela oficial CID-10 (DATASUS), carregada
--    em `cid10` como catálogo GLOBAL (sem tenant: o código J11.0 significa a
--    mesma coisa em qualquer empresa).
-- 2. Atestado pode ser de HORAS (meio período no consultório), não só de dias.
--    As horas moram na tabela filha, junto do resto do atestado: são detalhe
--    clínico do documento, não do indicador.
-- 3. Atestado de ACOMPANHAMENTO: o colaborador não estava doente, estava
--    acompanhando alguém (filho, pai). Quem era o acompanhado é obrigatório
--    quando o TIPO pede, e mora na tabela filha pelo mesmo motivo do CID:
--    saúde de terceiro não viaja na listagem.
-- 4. LICENÇAS legais viram tipos semeados no catálogo (nojo, gala,
--    maternidade, paternidade...). Licença nojo pede o grau de parentesco do
--    falecido, que fica no LANÇAMENTO (não é dado clínico) e aparece para
--    quem já enxerga o lançamento.
--
-- A obrigatoriedade continua sendo POLÍTICA DO CATÁLOGO carimbada no
-- lançamento (`snap_*`), nunca escolha de quem lança.

-- ============================================================================
-- Catálogo: os dois novos pedidos de coleta
-- ============================================================================
alter table public.absence_types
  add column if not exists requires_companion boolean not null default false,
  add column if not exists requires_kinship   boolean not null default false;

comment on column public.absence_types.requires_companion is
  'Pede o nome de quem foi acompanhado (atestado de acompanhamento).';
comment on column public.absence_types.requires_kinship is
  'Pede o grau de parentesco do falecido (licença nojo).';

-- Licenças legais mais comuns + o atestado de acompanhamento, para cada
-- empresa existente. `on conflict do nothing`: quem já criou um tipo com o
-- mesmo nome mantém o seu. Os padrões seguem os tipos irmãos já semeados
-- (licença desconta proporcional; atestado fica com o redutor por faixa) e
-- TODOS pedem comprovante; o RH destrava no catálogo se a prática local for
-- outra.
insert into public.absence_types
  (tenant_id, name, description, kind, requires_document, requires_medical,
   requires_companion, requires_kinship, discounts_rv_default,
   counts_as_absenteeism, sort)
select t.id, x.name, x.descr, x.kind, x.req_doc, x.req_med,
       x.req_comp, x.req_kin, x.desconta, true, x.sort
from public.tenants t
cross join (values
  ('Licença maternidade',          'Certidão de nascimento ou atestado.',           'licenca'::public.absence_kind,  true, false, false, false, true, 21),
  ('Licença paternidade',          'Certidão de nascimento.',                       'licenca',                       true, false, false, false, true, 22),
  ('Licença nojo (falecimento)',   'Certidão ou declaração de óbito.',              'licenca',                       true, false, false, true,  true, 23),
  ('Licença gala (casamento)',     'Certidão de casamento.',                        'licenca',                       true, false, false, false, true, 24),
  ('Doação de sangue',             'Declaração do hemocentro.',                     'licenca',                       true, false, false, false, true, 25),
  ('Serviço eleitoral',            'Declaração da Justiça Eleitoral.',              'licenca',                       true, false, false, false, true, 26),
  ('Comparecimento em juízo',      'Declaração de comparecimento.',                 'licenca',                       true, false, false, false, true, 27),
  ('Atestado de acompanhamento',   'O colaborador acompanhou um dependente.',       'atestado',                      true, true,  true,  false, false, 41)
) as x(name, descr, kind, req_doc, req_med, req_comp, req_kin, desconta, sort)
on conflict (tenant_id, name) do nothing;

-- ============================================================================
-- Lançamento: parentesco e os carimbos das novas exigências
-- ============================================================================
alter table public.absenteismo_lancamentos
  add column if not exists kinship_of_deceased text,
  add column if not exists snap_requires_companion boolean not null default false,
  add column if not exists snap_requires_kinship   boolean not null default false;

-- ============================================================================
-- Atestado: horas e acompanhado
-- ============================================================================
alter table public.absenteismo_atestados
  add column if not exists companion_name text,
  add column if not exists hours_start time,
  add column if not exists hours_end   time;

-- Ou é atestado de dias (nenhuma hora) ou é de horas (as duas, em ordem).
alter table public.absenteismo_atestados
  add constraint absenteismo_atestado_horas_coerentes
  check (
    (hours_start is null and hours_end is null)
    or (hours_start is not null and hours_end is not null and hours_end > hours_start)
  );

-- ============================================================================
-- CID-10: catálogo global, somente leitura pelo app
-- ============================================================================
--
-- Fonte: tabela oficial do DATASUS (Ministério da Saúde). Sem `tenant_id` de
-- propósito. A carga dos ~14 mil códigos é feita à parte (arquivo grande);
-- aqui fica só a estrutura, para o app não depender da ordem da carga.
create table if not exists public.cid10 (
  code        text primary key,
  description text not null,
  constraint cid10_code_nao_vazio check (btrim(code) <> '')
);

alter table public.cid10 enable row level security;

drop policy if exists cid10_select on public.cid10;
create policy cid10_select on public.cid10
  for select using ((select auth.uid()) is not null);

revoke all on table public.cid10 from public, anon, authenticated;
grant select on table public.cid10 to authenticated;

-- ============================================================================
-- A guarda das transições aprende o campo novo
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
       or new.kinship_of_deceased is distinct from old.kinship_of_deceased
       or new.snap_requires_companion is distinct from old.snap_requires_companion
       or new.snap_requires_kinship is distinct from old.snap_requires_kinship
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

-- ============================================================================
-- Enviar ao RH: CID sai da lista de obrigatórios; entram acompanhado,
-- parentesco e a coerência do atestado de horas
-- ============================================================================
create or replace function public.absenteismo_confirmar(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_l record;
  v_at record;
  v_adm uuid[];
begin
  select l.* into v_l from public.absenteismo_lancamentos l where l.id = p_id;
  if v_l.id is null or not public.pode_ver_absenteismo(v_l.tenant_id, v_l.user_id, v_l.created_by) then
    raise exception 'Lançamento não encontrado.';
  end if;
  if v_l.status not in ('aberto', 'reprovado') then
    raise exception 'Este lançamento já foi enviado ao RH.';
  end if;

  -- as mesmas condições dos checks da tabela, ditas em português antes de o
  -- banco reclamar em inglês
  if v_l.absence_type_id is null then raise exception 'Escolha o tipo de absenteísmo.'; end if;
  if v_l.start_date is null or v_l.end_date is null then
    raise exception 'Informe o período de início e término.';
  end if;
  if v_l.end_date < v_l.start_date then
    raise exception 'O término não pode ser antes do início.';
  end if;
  if v_l.occurred_on not between v_l.start_date and v_l.end_date then
    raise exception 'O período informado precisa incluir o dia do não comparecimento (%).',
      to_char(v_l.occurred_on, 'DD/MM/YYYY');
  end if;
  if v_l.snap_requires_document and v_l.doc_path is null then
    raise exception 'Anexe o documento antes de enviar ao RH.';
  end if;

  select a.* into v_at from public.absenteismo_atestados a where a.lancamento_id = p_id;

  -- CID deixou de ser obrigatório de propósito: nem todo atestado traz um.
  if v_l.snap_requires_medical then
    if v_at.lancamento_id is null
       or coalesce(btrim(v_at.doctor_name), '') = ''
       or v_at.issued_on is null then
      raise exception 'Preencha o nome do profissional e a data de emissão do atestado.';
    end if;
  end if;

  if v_l.snap_requires_companion
     and coalesce(btrim(v_at.companion_name), '') = '' then
    raise exception 'Informe quem foi o acompanhado.';
  end if;

  if v_l.snap_requires_kinship
     and coalesce(btrim(v_l.kinship_of_deceased), '') = '' then
    raise exception 'Informe o grau de parentesco do falecido.';
  end if;

  -- Atestado de horas cobre UM dia. Um intervalo de datas com horário de
  -- entrada e saída não descreve documento nenhum.
  if v_at.lancamento_id is not null and v_at.hours_start is not null
     and v_l.start_date <> v_l.end_date then
    raise exception 'Atestado de horas vale para um único dia: início e término precisam ser a mesma data.';
  end if;

  update public.absenteismo_lancamentos
     set status = 'pendente',
         submitted_at = now(),
         decision_note = null,
         decided_at = null,
         decided_by = null,
         updated_at = now()
   where id = p_id;

  select array_agg(m.user_id) into v_adm
    from public.memberships m
   where m.tenant_id = v_l.tenant_id
     and m.role in ('owner', 'admin', 'hr')
     and m.is_active;

  -- O aviso do sino NUNCA leva dado clínico: ele aparece na barra de qualquer
  -- tela e pode ser lido por cima do ombro.
  if v_adm is not null then
    perform public.notify_users_sistema(
      v_l.tenant_id, v_adm, 'absenteismo_pendente',
      'Absenteísmo aguardando aprovação',
      coalesce(v_l.snap_full_name, 'Colaborador') || ': ' ||
      coalesce(v_l.snap_type_name, 'ausência') || ' de ' ||
      to_char(v_l.start_date, 'DD/MM') || ' a ' || to_char(v_l.end_date, 'DD/MM') || '.');
  end if;
end;
$$;

revoke execute on function public.absenteismo_confirmar(uuid) from public, anon;
grant execute on function public.absenteismo_confirmar(uuid) to authenticated;

-- ============================================================================
-- A porta de leitura devolve os campos novos
-- ============================================================================
create or replace function public.absenteismo_atestado(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_l record;
  v_a record;
begin
  select l.* into v_l from public.absenteismo_lancamentos l where l.id = p_id;
  if v_l.id is null or not public.pode_ver_absenteismo(v_l.tenant_id, v_l.user_id, v_l.created_by) then
    return null;
  end if;

  select a.* into v_a from public.absenteismo_atestados a where a.lancamento_id = p_id;

  return jsonb_build_object(
    'id', v_l.id,
    'colaborador', v_l.snap_full_name,
    'tipo', v_l.snap_type_name,
    'inicio', v_l.start_date,
    'fim', v_l.end_date,
    'cid', v_a.cid_code,
    'cidDescricao', v_a.cid_description,
    'medico', v_a.doctor_name,
    'crm', v_a.doctor_crm,
    'local', v_a.facility,
    'emitidoEm', v_a.issued_on,
    'diasAfastamento', v_a.days_off,
    'acompanhado', v_a.companion_name,
    'horaInicio', v_a.hours_start,
    'horaFim', v_a.hours_end
  );
end;
$$;

revoke execute on function public.absenteismo_atestado(uuid) from public, anon;
grant execute on function public.absenteismo_atestado(uuid) to authenticated;

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
