-- Absenteísmo: os campos que a folha exige, o relatório do RH e o alerta de INSS.
--
-- Cinco coisas que o formulário ainda não coletava e que a folha precisa:
-- acidente de trabalho, atestado odontológico, abono de falta, o horário a
-- descontar numa falta parcial e a lista de licenças completa (suspensão e
-- serviço militar).
--
-- Três decisões de política, tomadas pelo RH e escritas aqui para não virarem
-- escolha de quem lança:
--
-- 1. SUSPENSÃO não desconta a proporcionalidade. O corte já vem do redutor por
--    punição; descontar de novo cortaria o mesmo dia duas vezes.
-- 2. AUSÊNCIA EM HORAS não pesa na remuneração variável. Ela fica registrada e
--    sai no relatório (é de lá que sai o desconto em folha), mas não tira o dia
--    do cálculo: duas horas no consultório não valem um dia inteiro.
-- 3. FALTA ABONADA continua existindo como fato e no indicador, mas não pesa na
--    remuneração variável. É o que "abonar" quer dizer.
--
-- Correção que vem junto: as licenças semeadas na 20260816100000 nasceram
-- descontando remuneração variável. Está errado. As ausências do art. 473 da
-- CLT (nojo, gala, doação de sangue, serviço eleitoral, comparecimento em juízo
-- e o serviço militar que entra agora) são faltas JUSTIFICADAS, sem prejuízo do
-- salário. O padrão delas passa a ser `false`; lançamento já feito não muda,
-- porque o valor foi carimbado no lançamento.

-- ============================================================================
-- Lançamento: acidente, tipo de atestado, abono e as horas
-- ============================================================================
--
-- As horas SAEM da tabela clínica e vêm para cá. Horário de entrada e saída não
-- é diagnóstico, e agora vale para falta parcial também: mantê-lo atrás da
-- porta do CID obrigaria o relatório do RH a abrir aquela porta sem precisar.
alter table public.absenteismo_lancamentos
  add column if not exists work_accident   boolean not null default false,
  add column if not exists certificate_kind text,
  add column if not exists waived          boolean not null default false,
  add column if not exists hours_start     time,
  add column if not exists hours_end       time;

comment on column public.absenteismo_lancamentos.work_accident is
  'Acidente de trabalho ou de trajeto (o caso que gera CAT).';
comment on column public.absenteismo_lancamentos.certificate_kind is
  'medico | odontologico. Só faz sentido quando o tipo exige dados do atestado.';
comment on column public.absenteismo_lancamentos.waived is
  'Falta abonada: continua sendo fato e indicador, mas não pesa na remuneração variável.';
comment on column public.absenteismo_lancamentos.hours_start is
  'Ausência de horas: entrada. Vale para atestado de horas E para falta parcial.';

update public.absenteismo_lancamentos l
   set hours_start = a.hours_start,
       hours_end   = a.hours_end
  from public.absenteismo_atestados a
 where a.lancamento_id = l.id
   and a.hours_start is not null;

alter table public.absenteismo_atestados
  drop constraint if exists absenteismo_atestado_horas_coerentes;
alter table public.absenteismo_atestados
  drop column if exists hours_start,
  drop column if exists hours_end;

alter table public.absenteismo_lancamentos
  drop constraint if exists absenteismo_horas_coerentes;
alter table public.absenteismo_lancamentos
  add constraint absenteismo_horas_coerentes
  check (
    (hours_start is null and hours_end is null)
    or (hours_start is not null and hours_end is not null and hours_end > hours_start)
  );

-- Ausência de horas cobre UM dia. Um intervalo de datas com horário de entrada
-- e saída não descreve documento nenhum.
alter table public.absenteismo_lancamentos
  drop constraint if exists absenteismo_horas_um_dia_so;
alter table public.absenteismo_lancamentos
  add constraint absenteismo_horas_um_dia_so
  check (hours_start is null or start_date is null or start_date = end_date);

alter table public.absenteismo_lancamentos
  drop constraint if exists absenteismo_tipo_de_atestado;
alter table public.absenteismo_lancamentos
  add constraint absenteismo_tipo_de_atestado
  check (certificate_kind is null or certificate_kind in ('medico', 'odontologico'));

-- Aprovado exige a ausência real, EXCETO quando é ausência de horas: essa não
-- vira linha em `employee_absences` porque não é um dia de ausência. É
-- implicação, e não equivalência, pelo mesmo motivo da 20260814103000.
alter table public.absenteismo_lancamentos
  drop constraint if exists absenteismo_aprovado_tem_ausencia;
alter table public.absenteismo_lancamentos
  add constraint absenteismo_aprovado_tem_ausencia
  check (status <> 'aprovado' or absence_id is not null or hours_start is not null);

-- ============================================================================
-- A base real aprende o abono
-- ============================================================================
--
-- Aditiva e com default: todo o passado continua significando o que significava,
-- e os `rv_period_snapshots` já congelados não mudam. A coluna existe para o
-- cálculo distinguir "faltou e conta" de "faltou e a empresa abonou", sem
-- precisar de uma lista de exceções escrita no código.
alter table public.employee_absences
  add column if not exists waived boolean not null default false;

comment on column public.employee_absences.waived is
  'Abonada pela empresa: entra no histórico e no indicador, mas não reduz remuneração variável.';

-- ============================================================================
-- Catálogo: suspensão, serviço militar e o padrão certo das licenças
-- ============================================================================
insert into public.absence_types
  (tenant_id, name, description, kind, requires_document, requires_medical,
   requires_companion, requires_kinship, discounts_rv_default,
   counts_as_absenteeism, sort)
select t.id, x.name, x.descr, x.kind, x.req_doc, false, false, false,
       x.desconta, true, x.sort
from public.tenants t
cross join (values
  -- Serviço militar é falta justificada por lei (art. 473, VI da CLT e Lei
  -- 4.375/64): o dia não é descontado.
  ('Convocação para serviço militar', 'Documento da Junta de Serviço Militar.', 'licenca'::public.absence_kind, true, false, 28),
  -- Suspensão disciplinar entra como motivo e conta no indicador, mas NÃO
  -- desconta a proporcionalidade: quem corta a remuneração variável dela é o
  -- redutor por punição, em Remuneração variável › Redutores. Marcar os dois
  -- cortaria o mesmo dia duas vezes.
  ('Suspensão disciplinar', 'Suspensão aplicada pela empresa. O desconto de remuneração variável vem do redutor por punição.', 'falta', true, false, 45)
) as x(name, descr, kind, req_doc, desconta, sort)
on conflict (tenant_id, name) do nothing;

update public.absence_types
   set discounts_rv_default = false, updated_at = now()
 where kind = 'licenca'
   and discounts_rv_default
   and name in (
     'Licença nojo (falecimento)', 'Licença gala (casamento)', 'Doação de sangue',
     'Serviço eleitoral', 'Comparecimento em juízo', 'Convocação para serviço militar',
     -- paternidade é remunerada pelo empregador (ADCT art. 10, §1º); maternidade
     -- fica DE FORA da correção de propósito: são meses de afastamento, e a
     -- proporcionalidade da remuneração variável tem de refletir isso
     'Licença paternidade'
   );

-- ============================================================================
-- A guarda das transições aprende os campos novos
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
       or new.work_accident is distinct from old.work_accident
       or new.certificate_kind is distinct from old.certificate_kind
       or new.waived is distinct from old.waived
       or new.hours_start is distinct from old.hours_start
       or new.hours_end is distinct from old.hours_end
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
-- Enviar ao RH: horas em qualquer tipo, tipo do atestado obrigatório
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

  -- CID não é obrigatório de propósito: nem todo atestado traz um.
  if v_l.snap_requires_medical then
    if v_at.lancamento_id is null
       or coalesce(btrim(v_at.doctor_name), '') = ''
       or v_at.issued_on is null then
      raise exception 'Preencha o nome do profissional e a data de emissão do atestado.';
    end if;
    if v_l.certificate_kind is null then
      raise exception 'Informe se o atestado é médico ou odontológico.';
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

  if v_l.hours_start is not null and v_l.start_date <> v_l.end_date then
    raise exception 'Ausência de horas vale para um único dia: início e término precisam ser a mesma data.';
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
-- O alerta dos 15 dias
-- ============================================================================
--
-- Art. 60, §3º da Lei 8.213/91 com o art. 75 do Decreto 3.048/99: a empresa
-- paga os 15 primeiros dias; do 16º em diante o benefício é do INSS. Dois
-- caminhos levam ao 16º dia, e os dois precisam ser vistos:
--
-- 1. MESMA DOENÇA: períodos da mesma categoria de CID (os 3 primeiros
--    caracteres, que é o nível "categoria" da CID-10) somam quando o novo
--    afastamento começa dentro de 60 dias do fim do anterior.
-- 2. CONTÍNUO: períodos encadeados (com até 1 dia de intervalo, que costuma ser
--    fim de semana entre um atestado e outro) somam independentemente do CID.
--
-- Só conta atestado, e só o que já foi APROVADO mais o lançamento que está
-- sendo avaliado: contar rascunho faria o alerta piscar e sumir.
create or replace function public.absenteismo_inss(
  p_tenant uuid, p_user uuid, p_ate date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_ate date := coalesce(p_ate, current_date);
  v_dias_doenca int := 0;
  v_dias_cont   int := 0;
  v_cat_top text;
  r record;
  v_ini date;
  v_fim date;
  v_soma int;
begin
  if not public.pode_ver_absenteismo(p_tenant, p_user, (select auth.uid())) then
    return null;
  end if;

  -- ---- caminho 1: mesma categoria de CID, janela de 60 dias ----
  for r in
    select coalesce(left(upper(btrim(a.cid_code)), 3), 'SEM-CID') as cat,
           l.start_date, l.end_date
      from public.absenteismo_lancamentos l
      left join public.absenteismo_atestados a on a.lancamento_id = l.id
     where l.tenant_id = p_tenant
       and l.user_id = p_user
       and l.status in ('aprovado', 'pendente')
       and l.snap_kind = 'atestado'
       and l.hours_start is null
       and l.start_date is not null
       and l.start_date <= v_ate
     order by cat, l.start_date
  loop
    if v_cat_top is distinct from r.cat then
      v_cat_top := r.cat;
      v_ini := r.start_date;
      v_fim := r.end_date;
      v_soma := (r.end_date - r.start_date) + 1;
    elsif r.start_date <= v_fim + 60 then
      -- dentro da janela: soma ao mesmo caso
      v_soma := v_soma + greatest((r.end_date - greatest(r.start_date, v_fim + 1)) + 1, 0);
      v_fim := greatest(v_fim, r.end_date);
    else
      -- fora da janela: caso novo
      v_ini := r.start_date;
      v_fim := r.end_date;
      v_soma := (r.end_date - r.start_date) + 1;
    end if;
    v_dias_doenca := greatest(v_dias_doenca, v_soma);
  end loop;

  -- ---- caminho 2: períodos encadeados, qualquer CID ----
  v_fim := null;
  v_soma := 0;
  for r in
    select l.start_date, l.end_date
      from public.absenteismo_lancamentos l
     where l.tenant_id = p_tenant
       and l.user_id = p_user
       and l.status in ('aprovado', 'pendente')
       and l.snap_kind = 'atestado'
       and l.hours_start is null
       and l.start_date is not null
       and l.start_date <= v_ate
     order by l.start_date
  loop
    if v_fim is null or r.start_date > v_fim + 1 then
      v_soma := (r.end_date - r.start_date) + 1;
    else
      v_soma := v_soma + greatest((r.end_date - greatest(r.start_date, v_fim + 1)) + 1, 0);
    end if;
    v_fim := greatest(coalesce(v_fim, r.end_date), r.end_date);
    v_dias_cont := greatest(v_dias_cont, v_soma);
  end loop;

  return jsonb_build_object(
    'dias', greatest(v_dias_doenca, v_dias_cont),
    'diasMesmaDoenca', v_dias_doenca,
    'diasContinuo', v_dias_cont,
    'motivo', case
                when v_dias_doenca > 15 and v_dias_doenca >= v_dias_cont then 'mesma_doenca'
                when v_dias_cont > 15 then 'continuo'
                else null end,
    'atinge', (v_dias_doenca > 15 or v_dias_cont > 15)
  );
end;
$$;

revoke execute on function public.absenteismo_inss(uuid, uuid, date) from public, anon;
grant execute on function public.absenteismo_inss(uuid, uuid, date) to authenticated;

-- ============================================================================
-- A decisão do RH
-- ============================================================================
create or replace function public.absenteismo_decidir(
  p_id uuid, p_aprovar boolean, p_nota text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_l record;
  v_c record;
  v_aus uuid;
  v_inss jsonb;
  v_adm uuid[];
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
begin
  select l.* into v_l from public.absenteismo_lancamentos l where l.id = p_id;
  if v_l.id is null then
    raise exception 'Lançamento não encontrado.';
  end if;
  if not public.has_tenant_role(v_l.tenant_id, '{owner,admin,hr}'::public.member_role[]) then
    raise exception 'Apenas o RH, o administrador ou o proprietário decidem um absenteísmo.';
  end if;
  if v_l.status <> 'pendente' then
    raise exception 'Este lançamento não está aguardando decisão.';
  end if;
  if not p_aprovar and v_nota is null then
    raise exception 'Informe o motivo da reprovação.';
  end if;

  if p_aprovar then
    -- Ausência de HORAS não vira linha na base real: ela não é um dia de
    -- ausência, e um período de um dia inteiro ali diria outra coisa para a
    -- remuneração variável e para o indicador. O registro fica no lançamento, e
    -- é de lá que o relatório do RH tira o horário para o desconto em folha.
    if v_l.hours_start is null then
      select e.start_date, e.end_date, e.kind into v_c
        from public.employee_absences e
       where e.tenant_id = v_l.tenant_id
         and e.user_id = v_l.user_id
         and daterange(e.start_date, e.end_date, '[]')
          && daterange(v_l.start_date, v_l.end_date, '[]')
       limit 1;
      if found then
        raise exception 'O período de % a % cruza com uma ausência já lançada de % a %. Ajuste as datas ou corrija o período em Configurações, na aba Colaboradores.',
          to_char(v_l.start_date, 'DD/MM/YYYY'), to_char(v_l.end_date, 'DD/MM/YYYY'),
          to_char(v_c.start_date, 'DD/MM/YYYY'), to_char(v_c.end_date, 'DD/MM/YYYY');
      end if;

      begin
        -- O FATO nasce aqui. `note` leva o NOME DO TIPO e nada mais: esta coluna é
        -- lida por service client em /metas e congelada em `rv_period_snapshots`,
        -- e é o último lugar do sistema onde um CID poderia acabar.
        insert into public.employee_absences (
          tenant_id, user_id, kind, start_date, end_date, discounts_rv, waived, note, created_by)
        values (
          v_l.tenant_id, v_l.user_id, v_l.snap_kind, v_l.start_date, v_l.end_date,
          coalesce(v_l.discounts_rv, v_l.snap_discounts_rv_default),
          v_l.waived,
          nullif(btrim(coalesce(v_l.snap_type_name, '')), ''),
          (select auth.uid()))
        returning id into v_aus;
      exception when exclusion_violation then
        select e.start_date, e.end_date into v_c
          from public.employee_absences e
         where e.tenant_id = v_l.tenant_id
           and e.user_id = v_l.user_id
           and daterange(e.start_date, e.end_date, '[]')
            && daterange(v_l.start_date, v_l.end_date, '[]')
         limit 1;
        raise exception 'O período de % a % cruza com uma ausência já lançada de % a %.',
          to_char(v_l.start_date, 'DD/MM/YYYY'), to_char(v_l.end_date, 'DD/MM/YYYY'),
          to_char(v_c.start_date, 'DD/MM/YYYY'), to_char(v_c.end_date, 'DD/MM/YYYY');
      end;
    end if;

    update public.absenteismo_lancamentos
       set status = 'aprovado', absence_id = v_aus,
           decided_at = now(), decided_by = (select auth.uid()),
           decision_note = v_nota, updated_at = now()
     where id = p_id;

    perform public.notify_users_sistema(
      v_l.tenant_id, array[v_l.created_by], 'absenteismo_aprovado',
      'Absenteísmo aprovado',
      coalesce(v_l.snap_full_name, 'Colaborador') || ': ' ||
      coalesce(v_l.snap_type_name, 'ausência') || ' aprovada pelo RH.');

    -- Passou de 15 dias: quem paga do 16º em diante é o INSS, e alguém precisa
    -- providenciar o encaminhamento. O aviso não leva CID nem doença.
    if v_l.snap_kind = 'atestado' then
      v_inss := public.absenteismo_inss(v_l.tenant_id, v_l.user_id, v_l.end_date);
      if coalesce((v_inss ->> 'atinge')::boolean, false) then
        select array_agg(m.user_id) into v_adm
          from public.memberships m
         where m.tenant_id = v_l.tenant_id
           and m.role in ('owner', 'admin', 'hr')
           and m.is_active;
        if v_adm is not null then
          perform public.notify_users_sistema(
            v_l.tenant_id, v_adm, 'absenteismo_inss',
            'Afastamento passou de 15 dias',
            coalesce(v_l.snap_full_name, 'Colaborador') || ' soma ' ||
            (v_inss ->> 'dias') || ' dias de atestado. Do 16º dia em diante o pagamento é do INSS: encaminhe a perícia.');
        end if;
      end if;
    end if;
  else
    update public.absenteismo_lancamentos
       set status = 'reprovado',
           decided_at = now(), decided_by = (select auth.uid()),
           decision_note = v_nota, updated_at = now()
     where id = p_id;

    perform public.notify_users_sistema(
      v_l.tenant_id, array[v_l.created_by], 'absenteismo_reprovado',
      'Absenteísmo reprovado',
      coalesce(v_l.snap_full_name, 'Colaborador') || ': ' || v_nota);
  end if;
end;
$$;

revoke execute on function public.absenteismo_decidir(uuid, boolean, text) from public, anon;
grant execute on function public.absenteismo_decidir(uuid, boolean, text) to authenticated;

-- ============================================================================
-- A porta de leitura do atestado, sem as horas (que mudaram de casa)
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
    'acompanhado', v_a.companion_name
  );
end;
$$;

revoke execute on function public.absenteismo_atestado(uuid) from public, anon;
grant execute on function public.absenteismo_atestado(uuid) to authenticated;

-- ============================================================================
-- O relatório do RH
-- ============================================================================
--
-- Esta é a ÚNICA porta que junta CPF e dado clínico na mesma linha, e por isso
-- ela é do RH para cima. O gestor continua com a exportação da tela, que não
-- tem nem um nem outro.
--
-- Os campos de pessoa vêm dos carimbos `snap_*` do lançamento, e não do vínculo
-- de hoje: o relatório de agosto precisa dizer o setor de agosto, mesmo que a
-- pessoa tenha mudado de área em setembro.
create or replace function public.absenteismo_relatorio(
  p_tenant uuid, p_de date, p_ate date, p_units uuid[] default null)
returns table (
  unidade text, setor text, subsetor text,
  data date, mes text,
  matricula text, cpf text, colaborador text,
  inicio date, fim date, dias int, retorno date,
  tipo text, observacao text,
  cid text, cid_descricao text, cid_categoria text, cid_categoria_descricao text,
  medico text, crm text, hospital text, horario text,
  acidente_trabalho text, tipo_atestado text, abonada text, acompanhado text,
  parentesco text, alerta_inss text, situacao text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.has_tenant_role(p_tenant, '{owner,admin,hr}'::public.member_role[]) then
    raise exception 'Apenas o RH, o administrador ou o proprietário geram este relatório.';
  end if;

  return query
  select
    l.snap_unit_name,
    l.snap_department_name,
    l.snap_subdepartment_name,
    l.occurred_on,
    to_char(l.occurred_on, 'MM/YYYY'),
    l.snap_employee_code,
    p.cpf,
    l.snap_full_name,
    l.start_date,
    l.end_date,
    case when l.hours_start is not null or l.start_date is null then null
         else (l.end_date - l.start_date) + 1 end,
    case when l.hours_start is not null or l.end_date is null then null
         else l.end_date + 1 end,
    l.snap_type_name,
    l.note,
    a.cid_code,
    a.cid_description,
    left(upper(btrim(a.cid_code)), 3),
    c.description,
    a.doctor_name,
    a.doctor_crm,
    a.facility,
    case when l.hours_start is null then null
         else to_char(l.hours_start, 'HH24:MI') || ' às ' || to_char(l.hours_end, 'HH24:MI') end,
    case when l.work_accident then 'Sim' else 'Não' end,
    case l.certificate_kind when 'medico' then 'Médico'
                            when 'odontologico' then 'Odontológico' else null end,
    case when l.waived then 'Sim' else 'Não' end,
    a.companion_name,
    l.kinship_of_deceased,
    case when l.snap_kind = 'atestado'
           and coalesce((public.absenteismo_inss(l.tenant_id, l.user_id, l.end_date) ->> 'atinge')::boolean, false)
         then 'Passou de 15 dias (INSS)' else null end,
    case l.status when 'aberto' then 'Não comparecimento'
                  when 'pendente' then 'Aguardando o RH'
                  when 'aprovado' then 'Aprovado'
                  when 'reprovado' then 'Reprovado'
                  else 'Cancelado' end
  from public.absenteismo_lancamentos l
  left join public.absenteismo_atestados a on a.lancamento_id = l.id
  left join public.cid10 c on c.code = left(upper(btrim(a.cid_code)), 3)
  left join public.profiles p on p.id = l.user_id
  where l.tenant_id = p_tenant
    and l.status <> 'cancelado'
    and l.occurred_on between p_de and p_ate
    and (p_units is null or l.snap_unit_id = any(p_units))
  order by l.occurred_on desc, l.snap_full_name;
end;
$$;

revoke execute on function public.absenteismo_relatorio(uuid, date, date, uuid[]) from public, anon;
grant execute on function public.absenteismo_relatorio(uuid, date, date, uuid[]) to authenticated;

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
