-- Relatório de absenteísmo: o período pega o que esteve EM CURSO (LUIZ, 16/11/2026).
--
-- Antes o filtro era pelo dia do lançamento (occurred_on): quem estava afastado
-- em novembro desde junho não aparecia no relatório de novembro. Agora entra
-- todo lançamento cujo período (início a fim; sem período ainda, o dia lançado)
-- toca o intervalo pedido. Colunas e guarda não mudam.

create or replace function public.absenteismo_relatorio(p_tenant uuid, p_de date, p_ate date, p_units uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(unidade text, setor text, subsetor text, data date, mes text, matricula text, cpf text, colaborador text, inicio date, fim date, dias integer, retorno date, tipo text, observacao text, cid text, cid_descricao text, cid_categoria text, cid_categoria_descricao text, medico text, crm text, hospital text, horario text, primeiro_dia text, acidente_trabalho text, tipo_atestado text, abonada text, acompanhado text, parentesco text, alerta_inss text, situacao text)
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
    -- em curso em algum dia do período (sem período ainda, vale o dia lançado)
    and daterange(coalesce(l.start_date, l.occurred_on), coalesce(l.end_date, l.occurred_on), '[]')
        && daterange(p_de, p_ate, '[]')
    and (p_units is null or l.snap_unit_id = any(p_units))
  order by l.occurred_on desc, l.snap_full_name;
end;
$function$;

revoke execute on function public.absenteismo_relatorio(uuid, date, date, uuid[]) from public, anon;
grant execute on function public.absenteismo_relatorio(uuid, date, date, uuid[]) to authenticated;

notify pgrst, 'reload schema';
