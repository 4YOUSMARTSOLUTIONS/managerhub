-- Primeiro dia do atestado (LUIZ, 12/11/2026).
--
-- Atestado de 09 a 11 para quem foi ao médico DEPOIS do expediente do dia 09:
-- lançado como está no documento, descontava um dia que a pessoa trabalhou.
-- O período continua gravado como está escrito (o RH confere com o papel), e a
-- resposta sobre o primeiro dia decide a ausência que vale:
--
--   integral  -> não trabalhou: 09 a 11 (o que valia até hoje)
--   trabalhou -> trabalhou o dia todo: 10 a 11
--   parcial   -> trabalhou parte: 09 em horas (hours_start/hours_end) + 10 a 11
--
-- O sistema nunca estende o atestado (10 a 12): segue as datas escritas.
--
-- `ausencia_inicio` é o primeiro dia INTEIRO de ausência, calculado num lugar
-- só. Aprovação, contagem do INSS e relatório leem dele.
--
-- `partial_day` passa a ser o único marcador de "lançamento em horas": com o
-- primeiro dia parcial, ter horário não quer mais dizer que o lançamento todo
-- é de horas.

alter table public.absenteismo_lancamentos
  add column primeiro_dia text not null default 'integral',
  add constraint absenteismo_primeiro_dia_valido
    check (primeiro_dia in ('integral', 'trabalhou', 'parcial'));

alter table public.absenteismo_lancamentos
  add column ausencia_inicio date generated always as (
    case when primeiro_dia = 'integral' then start_date else start_date + 1 end
  ) stored;

comment on column public.absenteismo_lancamentos.primeiro_dia is
  'Primeiro dia do atestado: integral (não trabalhou), trabalhou (o dia todo, consulta depois do expediente) ou parcial (horas em hours_start/hours_end). Só em período de 2 dias ou mais.';
comment on column public.absenteismo_lancamentos.ausencia_inicio is
  'Primeiro dia inteiro de ausência: start_date, ou o dia seguinte quando o colaborador trabalhou (todo ou parte) no primeiro dia do atestado.';

-- só em lançamento de dias, com pelo menos dois dias
alter table public.absenteismo_lancamentos
  add constraint absenteismo_primeiro_dia_com_periodo
    check (primeiro_dia = 'integral'
           or (not partial_day and (start_date is null or end_date > start_date)));

-- horas: no lançamento de horas (um dia só) ou no primeiro dia parcial
alter table public.absenteismo_lancamentos drop constraint absenteismo_parcial_com_horas;
alter table public.absenteismo_lancamentos
  add constraint absenteismo_parcial_com_horas
    check (hours_start is null or partial_day or primeiro_dia = 'parcial');

alter table public.absenteismo_lancamentos drop constraint absenteismo_horas_um_dia_so;
alter table public.absenteismo_lancamentos
  add constraint absenteismo_horas_um_dia_so
    check (hours_start is null or start_date is null or start_date = end_date or primeiro_dia = 'parcial');

-- aprovado sem ausência registrada só o lançamento de horas
alter table public.absenteismo_lancamentos drop constraint absenteismo_aprovado_tem_ausencia;
alter table public.absenteismo_lancamentos
  add constraint absenteismo_aprovado_tem_ausencia
    check (status <> 'aprovado' or absence_id is not null or partial_day);

-- o dia comunicado precisa cair na ausência que vale (no parcial, o primeiro
-- dia conta: a pessoa saiu mais cedo nele)
alter table public.absenteismo_lancamentos drop constraint absenteismo_periodo_cobre_o_dia;
alter table public.absenteismo_lancamentos
  add constraint absenteismo_periodo_cobre_o_dia
    check (status = 'aberto' or start_date is null
           or (occurred_on >= start_date + case when primeiro_dia = 'trabalhou' then 1 else 0 end
               and occurred_on <= end_date));

-- ---------------------------------------------------------------------------
-- guarda: o primeiro dia congela junto com o resto no envio ao RH
-- ---------------------------------------------------------------------------
create or replace function public.guard_absenteismo_lancamento()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_adm boolean;
begin
  v_adm := public.has_tenant_role(old.tenant_id, '{owner,admin,hr}'::public.member_role[]);

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
       or new.partial_day is distinct from old.partial_day
       or new.primeiro_dia is distinct from old.primeiro_dia
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
$function$;

-- ---------------------------------------------------------------------------
-- envio ao RH
-- ---------------------------------------------------------------------------
create or replace function public.absenteismo_confirmar(p_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  if v_l.absence_type_id is null then raise exception 'Escolha o tipo de absenteísmo.'; end if;
  if v_l.start_date is null or v_l.end_date is null then
    raise exception 'Informe o período de início e término.';
  end if;
  if v_l.end_date < v_l.start_date then
    raise exception 'O término não pode ser antes do início.';
  end if;
  if v_l.primeiro_dia = 'trabalhou' and v_l.occurred_on = v_l.start_date then
    raise exception 'O colaborador trabalhou em % (primeiro dia do atestado), mas a ausência foi comunicada nesse dia. A ausência que vale começa em %.',
      to_char(v_l.start_date, 'DD/MM/YYYY'), to_char(v_l.ausencia_inicio, 'DD/MM/YYYY');
  end if;
  if v_l.occurred_on not between v_l.start_date and v_l.end_date then
    raise exception 'O período informado precisa incluir o dia do não comparecimento (%).',
      to_char(v_l.occurred_on, 'DD/MM/YYYY');
  end if;
  if v_l.snap_requires_document and v_l.doc_path is null then
    raise exception 'Anexe o documento antes de enviar ao RH.';
  end if;

  select a.* into v_at from public.absenteismo_atestados a where a.lancamento_id = p_id;

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

  -- parcial sem horário só até aqui: o RH precisa das horas para a folha
  if v_l.partial_day and v_l.hours_start is null then
    raise exception 'Ausência parcial: informe o horário (das e até) antes de enviar ao RH.';
  end if;

  if v_l.partial_day and v_l.start_date <> v_l.end_date then
    raise exception 'Ausência de horas vale para um único dia: início e término precisam ser a mesma data.';
  end if;

  if v_l.primeiro_dia = 'parcial' and v_l.hours_start is null then
    raise exception 'Informe o horário em que o colaborador ficou ausente no primeiro dia (das e até).';
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
     and (m.role in ('owner', 'admin') or m.is_hr)
     and m.is_active;

  if v_adm is not null then
    perform public.notify_users_sistema(
      v_l.tenant_id, v_adm, 'absenteismo_pendente',
      'Absenteísmo aguardando aprovação',
      coalesce(v_l.snap_full_name, 'Colaborador') || ': ' ||
      coalesce(v_l.snap_type_name, 'ausência') || ' de ' ||
      to_char(v_l.start_date, 'DD/MM') || ' a ' || to_char(v_l.end_date, 'DD/MM') ||
      case v_l.primeiro_dia
        when 'trabalhou' then ' (trabalhou no primeiro dia)'
        when 'parcial' then ' (trabalhou parte do primeiro dia)'
        else '' end || '.');
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- aprovação: a ausência registrada começa no primeiro dia INTEIRO
-- ---------------------------------------------------------------------------
create or replace function public.absenteismo_decidir(p_id uuid, p_aprovar boolean, p_nota text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    -- lançamento de horas não vira ausência de dias (o desconto é na folha)
    if not v_l.partial_day then
      select e.start_date, e.end_date, e.kind into v_c
        from public.employee_absences e
       where e.tenant_id = v_l.tenant_id
         and e.user_id = v_l.user_id
         and daterange(e.start_date, e.end_date, '[]')
          && daterange(v_l.ausencia_inicio, v_l.end_date, '[]')
       limit 1;
      if found then
        raise exception 'O período de % a % cruza com uma ausência já lançada de % a %. Ajuste as datas ou corrija o período em Configurações, na aba Colaboradores.',
          to_char(v_l.ausencia_inicio, 'DD/MM/YYYY'), to_char(v_l.end_date, 'DD/MM/YYYY'),
          to_char(v_c.start_date, 'DD/MM/YYYY'), to_char(v_c.end_date, 'DD/MM/YYYY');
      end if;

      begin
        insert into public.employee_absences (
          tenant_id, user_id, kind, start_date, end_date, discounts_rv, waived, note, created_by)
        values (
          v_l.tenant_id, v_l.user_id, v_l.snap_kind, v_l.ausencia_inicio, v_l.end_date,
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
            && daterange(v_l.ausencia_inicio, v_l.end_date, '[]')
         limit 1;
        raise exception 'O período de % a % cruza com uma ausência já lançada de % a %.',
          to_char(v_l.ausencia_inicio, 'DD/MM/YYYY'), to_char(v_l.end_date, 'DD/MM/YYYY'),
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

    if v_l.snap_kind = 'atestado' then
      v_inss := public.absenteismo_inss(v_l.tenant_id, v_l.user_id, v_l.end_date);
      if coalesce((v_inss ->> 'atinge')::boolean, false) then
        select array_agg(m.user_id) into v_adm
          from public.memberships m
         where m.tenant_id = v_l.tenant_id
           and (m.role in ('owner', 'admin') or m.is_hr)
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
$function$;

-- ---------------------------------------------------------------------------
-- 15 dias do INSS: só dias INTEIROS de ausência (o dia trabalhado não conta)
-- ---------------------------------------------------------------------------
create or replace function public.absenteismo_inss(p_tenant uuid, p_user uuid, p_ate date default null::date)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_ate date := coalesce(p_ate, current_date);
  v_dias_doenca int := 0;
  v_dias_cont   int := 0;
  v_cat_top text;
  r record;
  v_fim date;
  v_soma int;
begin
  if not public.pode_ver_absenteismo(p_tenant, p_user, (select auth.uid())) then
    return null;
  end if;

  for r in
    select coalesce(left(upper(btrim(a.cid_code)), 3), 'SEM-CID') as cat,
           l.ausencia_inicio as start_date, l.end_date
      from public.absenteismo_lancamentos l
      left join public.absenteismo_atestados a on a.lancamento_id = l.id
     where l.tenant_id = p_tenant
       and l.user_id = p_user
       and l.status in ('aprovado', 'pendente')
       and l.snap_kind = 'atestado'
       and not l.partial_day
       and l.ausencia_inicio is not null
       and l.ausencia_inicio <= v_ate
     order by cat, l.ausencia_inicio
  loop
    if v_cat_top is distinct from r.cat then
      v_cat_top := r.cat;
      v_fim := r.end_date;
      v_soma := (r.end_date - r.start_date) + 1;
    elsif r.start_date <= v_fim + 60 then
      v_soma := v_soma + greatest((r.end_date - greatest(r.start_date, v_fim + 1)) + 1, 0);
      v_fim := greatest(v_fim, r.end_date);
    else
      v_fim := r.end_date;
      v_soma := (r.end_date - r.start_date) + 1;
    end if;
    v_dias_doenca := greatest(v_dias_doenca, v_soma);
  end loop;

  v_fim := null;
  v_soma := 0;
  for r in
    select l.ausencia_inicio as start_date, l.end_date
      from public.absenteismo_lancamentos l
     where l.tenant_id = p_tenant
       and l.user_id = p_user
       and l.status in ('aprovado', 'pendente')
       and l.snap_kind = 'atestado'
       and not l.partial_day
       and l.ausencia_inicio is not null
       and l.ausencia_inicio <= v_ate
     order by l.ausencia_inicio
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
$function$;

-- ---------------------------------------------------------------------------
-- relatório do RH: início, dias e retorno são da ausência que vale; o
-- primeiro dia do atestado vira coluna própria
-- ---------------------------------------------------------------------------
drop function public.absenteismo_relatorio(uuid, date, date, uuid[]);

create function public.absenteismo_relatorio(p_tenant uuid, p_de date, p_ate date, p_units uuid[] default null::uuid[])
 returns table(unidade text, setor text, subsetor text, data date, mes text, matricula text, cpf text, colaborador text, inicio date, fim date, dias integer, retorno date, tipo text, observacao text, cid text, cid_descricao text, cid_categoria text, cid_categoria_descricao text, medico text, crm text, hospital text, horario text, primeiro_dia text, acidente_trabalho text, tipo_atestado text, abonada text, acompanhado text, parentesco text, alerta_inss text, situacao text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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
    case when l.partial_day then l.start_date else l.ausencia_inicio end,
    l.end_date,
    case when l.partial_day or l.start_date is null then null
         else (l.end_date - l.ausencia_inicio) + 1 end,
    case when l.partial_day or l.end_date is null then null
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
         when l.primeiro_dia = 'parcial'
           then to_char(l.start_date, 'DD/MM') || ', ' || to_char(l.hours_start, 'HH24:MI') || ' às ' || to_char(l.hours_end, 'HH24:MI')
         else to_char(l.hours_start, 'HH24:MI') || ' às ' || to_char(l.hours_end, 'HH24:MI') end,
    case l.primeiro_dia
      when 'trabalhou' then 'Trabalhou normalmente em ' || to_char(l.start_date, 'DD/MM/YYYY') || ' (atestado de ' ||
                            to_char(l.start_date, 'DD/MM/YYYY') || ' a ' || to_char(l.end_date, 'DD/MM/YYYY') || ')'
      when 'parcial' then 'Trabalhou parte de ' || to_char(l.start_date, 'DD/MM/YYYY') || ' (atestado de ' ||
                          to_char(l.start_date, 'DD/MM/YYYY') || ' a ' || to_char(l.end_date, 'DD/MM/YYYY') || ')'
      else null end,
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
$function$;

-- AGENTS.md: toda SECURITY DEFINER criada ou substituída sai do alcance da chave pública
revoke execute on function public.guard_absenteismo_lancamento() from public, anon, authenticated;
revoke execute on function public.absenteismo_confirmar(uuid) from public, anon;
revoke execute on function public.absenteismo_decidir(uuid, boolean, text) from public, anon;
revoke execute on function public.absenteismo_inss(uuid, uuid, date) from public, anon;
revoke execute on function public.absenteismo_relatorio(uuid, date, date, uuid[]) from public, anon;
grant execute on function public.absenteismo_relatorio(uuid, date, date, uuid[]) to authenticated;

notify pgrst, 'reload schema';
