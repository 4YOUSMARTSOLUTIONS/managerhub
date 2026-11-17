-- Tipo de documento do afastamento (LUIZ, 17/11/2026)
--
-- O afastamento passa a dizer de onde vem o documento: Médico ou Perícia INSS.
-- O RH baixa o arquivo já com o nome que arquiva (PERÍCIA_INSS_2026_11_16), e
-- para isso o tipo precisa estar gravado.
--
-- Reaproveita `certificate_kind`, que já é "o tipo do documento" do atestado
-- (medico | odontologico): no afastamento ele vale medico | pericia_inss. O
-- motivo do lançamento diz qual dos dois conjuntos se aplica, e a confirmação
-- confere a combinação.

-- ---------------------------------------------------------------------------
-- 1. O valor novo
-- ---------------------------------------------------------------------------
alter table public.absenteismo_lancamentos
  drop constraint if exists absenteismo_tipo_de_atestado;
alter table public.absenteismo_lancamentos
  add constraint absenteismo_tipo_de_atestado
  check (certificate_kind is null or certificate_kind in ('medico', 'odontologico', 'pericia_inss'));

comment on column public.absenteismo_lancamentos.certificate_kind is
  'Tipo do documento. Atestado (tipo que exige dados do atestado): medico | odontologico. '
  'Afastamento: medico | pericia_inss. Nos demais motivos fica nulo.';

-- ---------------------------------------------------------------------------
-- 2. A confirmação exige o tipo do documento do afastamento
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
    if v_l.certificate_kind is null or v_l.certificate_kind not in ('medico', 'odontologico') then
      raise exception 'Informe se o atestado é médico ou odontológico.';
    end if;
  elsif v_l.snap_kind = 'afastamento' then
    -- o nome do arquivo que o RH baixa depende disto (LUIZ, 17/11/2026)
    if v_l.certificate_kind is null or v_l.certificate_kind not in ('medico', 'pericia_inss') then
      raise exception 'Informe o tipo de documento do afastamento: Médico ou Perícia INSS.';
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

revoke execute on function public.absenteismo_confirmar(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- 3. Relatório: a coluna "Tipo de atestado" mostra também a perícia
-- ---------------------------------------------------------------------------
create or replace function public.absenteismo_relatorio(p_tenant uuid, p_de date, p_ate date, p_units uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(unidade text, setor text, subsetor text, data date, mes text, matricula text, cpf text, colaborador text, inicio date, fim date, dias integer, retorno date, tipo text, observacao text, cid text, cid_descricao text, cid_categoria text, cid_categoria_descricao text, medico text, crm text, hospital text, horario text, primeiro_dia text, acidente_trabalho text, tipo_atestado text, abonada text, acompanhado text, parentesco text, alerta_inss text, situacao text, funcao text, comportamento text, desconta_rv text, horas text, lancado_por text, decidido_por text, observacao_decisao text, hora_inicial text, hora_final text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- em aberto com "Continua ausente": os dias sem comparecer, ainda sem motivo
    case when l.partial_day then l.start_date
         when l.status = 'aberto' and l.ausente_ate is not null then l.occurred_on
         else l.ausencia_inicio end,
    coalesce(l.end_date, case when l.status = 'aberto' then l.ausente_ate end),
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
                            when 'odontologico' then 'Odontológico'
                            when 'pericia_inss' then 'Perícia INSS' else null end,
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
                  else 'Cancelado' end,
    l.snap_position_name,
    l.snap_kind::text,
    case when l.discounts_rv is null then null when l.discounts_rv then 'Sim' else 'Não' end,
    -- o total da ausência de horas (ou do 1º dia parcial), que "Dias" não mostra
    case when l.hours_start is not null and l.hours_end is not null
         then to_char(l.hours_end - l.hours_start, 'HH24:MI') end,
    case when l.importado then 'Importação' else lp.full_name end,
    case when l.importado then null else dp.full_name end,
    case when l.importado then null else l.decision_note end,
    -- o horário em duas colunas (LUIZ, 16/11/2026); no 1º dia parcial, o
    -- horário ausente daquele dia
    to_char(l.hours_start, 'HH24:MI'),
    to_char(l.hours_end, 'HH24:MI')
  from public.absenteismo_lancamentos l
  left join public.absenteismo_atestados a on a.lancamento_id = l.id
  left join public.cid10 c on c.code = left(upper(btrim(a.cid_code)), 3)
  left join public.profiles p on p.id = l.user_id
  left join public.profiles lp on lp.id = l.created_by
  left join public.profiles dp on dp.id = l.decided_by
  where l.tenant_id = p_tenant
    and l.status <> 'cancelado'
    -- em curso em algum dia do período (sem período ainda, valem os dias sem comparecer)
    and daterange(coalesce(l.start_date, l.occurred_on), coalesce(l.end_date, l.ausente_ate, l.occurred_on), '[]')
        && daterange(p_de, p_ate, '[]')
    and (p_units is null or l.snap_unit_id = any(p_units))
  order by l.occurred_on desc, l.snap_full_name;
end;
$function$;

revoke execute on function public.absenteismo_relatorio(uuid, date, date, uuid[]) from public, anon;
grant execute on function public.absenteismo_relatorio(uuid, date, date, uuid[]) to authenticated;

notify pgrst, 'reload schema';
