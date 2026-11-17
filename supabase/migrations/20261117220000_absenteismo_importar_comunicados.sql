-- Importação de COMUNICADOS de absenteísmo (LUIZ, 17/11/2026).
--
-- A irmã da importação de histórico: em vez de entrar aprovado, cada linha
-- entra EM ABERTO, como o "Ainda não sei o motivo" do Lançar ausência, e segue
-- o fluxo normal (Efetivar com motivo e atestado → RH). Serve para os
-- comunicados que aconteceram antes do sistema e ainda esperam o documento.
--
-- Decisões do LUIZ:
--   * só o PROPRIETÁRIO importa, como o histórico;
--   * NADA de aviso na importação: nem e-mail, nem sino. O e-mail sai quando o
--     lançamento for efetivado e enviado ao RH;
--   * quem cuida é o GESTOR ATUAL de cada colaborador: o lançamento fica no
--     nome dele (created_by), então ele efetiva e recebe o lembrete das 08:00,
--     como se tivesse lançado. Sem gestor ativo, fica com quem importou. O DP
--     efetiva de qualquer jeito.
--
-- A pessoa vem pelo CPF ou pelo ID (matrícula) + Unidade, nunca pelo nome. O
-- CPF é resolvido aqui dentro: a coluna não é legível pela chave pública.
--
-- `comunicado_importado_por` guarda quem importou (a lista mostra "Importação"
-- em "Lançado por") e, como a marca `importado`, só nasce dentro desta função.
-- Não usa `importado`: aquele dispensa o anexo, e o comunicado importado é
-- efetivado com documento como qualquer outro.

-- ---------------------------------------------------------------------------
-- 1. a marca
-- ---------------------------------------------------------------------------
alter table public.absenteismo_lancamentos
  add column comunicado_importado_por uuid references public.profiles(id);

comment on column public.absenteismo_lancamentos.comunicado_importado_por is
  'Quem importou o comunicado (importação de comunicados, só o proprietário). Entra em aberto, sem e-mail, no nome do gestor atual.';

create or replace function public.guard_absenteismo_importado()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    if (new.importado or new.comunicado_importado_por is not null)
       and coalesce(current_setting('app.absenteismo_importando', true), '') <> 'on' then
      raise exception 'Só a importação marca um lançamento como importado.';
    end if;
  elsif new.importado is distinct from old.importado
     or new.comunicado_importado_por is distinct from old.comunicado_importado_por then
    raise exception 'A marca de importação não muda depois de gravada.';
  end if;
  return new;
end;
$function$;

revoke execute on function public.guard_absenteismo_importado() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. a importação
-- ---------------------------------------------------------------------------
-- p_linhas: [{linha, user_id | cpf, unit_id, matricula, data, obs}]. O app já
-- resolveu ID + Unidade em user_id; o CPF chega só com dígitos e é resolvido
-- aqui. A resposta traz, em `entradas`, quem é a pessoa no cadastro e com quem
-- o lançamento fica, para a prévia mostrar antes de gravar.
create or replace function public.absenteismo_importar_comunicados(
  p_tenant uuid, p_linhas jsonb, p_simular boolean default true)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_eu uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_l jsonb;
  v_n int;
  v_user uuid;
  v_cpf text;
  v_achados uuid[];
  v_unit_planilha uuid;
  v_dia date;
  v_m public.memberships%rowtype;
  v_h public.membership_history%rowtype;
  v_ct public.employee_contracts%rowtype;
  v_admissao date;
  v_c record;
  v_unit uuid;
  v_dep uuid;
  v_sub uuid;
  v_pos uuid;
  v_ger uuid;
  v_codigo text;
  v_resp uuid;
  v_ok int := 0;
  v_recusas jsonb := '[]'::jsonb;
  v_entradas jsonb := '[]'::jsonb;
begin
  if v_eu is null or not public.has_tenant_role(p_tenant, '{owner}'::public.member_role[]) then
    raise exception 'Apenas o proprietário importa comunicados de absenteísmo.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_linhas) is distinct from 'array' then
    raise exception 'Formato inválido.';
  end if;
  if jsonb_array_length(p_linhas) > 2000 then
    raise exception 'No máximo 2.000 linhas por importação. Divida a planilha.';
  end if;

  begin
    perform set_config('app.absenteismo_importando', 'on', true);

    for v_l in select * from jsonb_array_elements(p_linhas) loop
      v_n := (v_l ->> 'linha')::int;
      begin
        v_user := nullif(v_l ->> 'user_id', '')::uuid;
        v_cpf := regexp_replace(coalesce(v_l ->> 'cpf', ''), '\D', '', 'g');
        if v_user is null and v_cpf <> '' then
          select array_agg(m.user_id) into v_achados
            from public.memberships m
            join public.profiles p on p.id = m.user_id
           where m.tenant_id = p_tenant
             and regexp_replace(coalesce(p.cpf, ''), '\D', '', 'g') = v_cpf;
          if coalesce(array_length(v_achados, 1), 0) = 0 then
            raise exception 'CPF não encontrado no cadastro desta empresa.' using errcode = 'P0097';
          end if;
          if array_length(v_achados, 1) > 1 then
            raise exception 'CPF em mais de um cadastro: corrija o cadastro antes de importar.' using errcode = 'P0097';
          end if;
          v_user := v_achados[1];
        end if;
        if v_user is null then
          raise exception 'Informe o CPF ou o ID (matrícula) do colaborador.' using errcode = 'P0097';
        end if;
        v_unit_planilha := nullif(v_l ->> 'unit_id', '')::uuid;

        v_dia := nullif(v_l ->> 'data', '')::date;
        if v_dia is null then
          raise exception 'Informe a data.' using errcode = 'P0097';
        end if;
        if v_dia >= v_hoje then
          raise exception 'Data de hoje em diante: lance pelo Lançar ausência.' using errcode = 'P0097';
        end if;

        select m.* into v_m from public.memberships m
         where m.tenant_id = p_tenant and m.user_id = v_user;
        if v_m.id is null then
          raise exception 'Colaborador não encontrado nesta empresa.' using errcode = 'P0097';
        end if;

        select least(v_m.admission_date, min(ec.admission_date)) into v_admissao
          from public.employee_contracts ec
         where ec.tenant_id = p_tenant and ec.user_id = v_user;
        if v_admissao is not null and v_dia < v_admissao then
          raise exception 'Data antes da admissão (%).', to_char(v_admissao, 'DD/MM/YYYY') using errcode = 'P0097';
        end if;
        if v_m.dismissed_at is not null and v_dia > v_m.dismissed_at then
          raise exception 'Data depois do desligamento (%). Se a pessoa foi readmitida, atualize o cadastro antes.',
            to_char(v_m.dismissed_at, 'DD/MM/YYYY') using errcode = 'P0097';
        end if;

        -- absenteísmo que já cobre o dia (no sistema ou numa linha anterior
        -- desta planilha, que a esta altura já foi gravada)
        select coalesce(l.ausencia_inicio, l.start_date, l.occurred_on) as ini,
               coalesce(l.end_date, l.ausente_ate, l.occurred_on) as fim
          into v_c
          from public.absenteismo_lancamentos l
         where l.tenant_id = p_tenant and l.user_id = v_user
           and l.status <> 'cancelado'
           and daterange(coalesce(l.ausencia_inicio, l.start_date, l.occurred_on),
                         coalesce(l.end_date, l.ausente_ate, l.occurred_on), '[]') @> v_dia
         limit 1;
        if found then
          raise exception 'Já há absenteísmo de % a % para esta pessoa (no sistema ou em outra linha da planilha).',
            to_char(v_c.ini, 'DD/MM/YYYY'), to_char(v_c.fim, 'DD/MM/YYYY') using errcode = 'P0097';
        end if;

        select e.start_date, e.end_date, e.kind into v_c
          from public.employee_absences e
         where e.tenant_id = p_tenant and e.user_id = v_user
           and v_dia between e.start_date and e.end_date
         limit 1;
        if found then
          raise exception 'Cai em % de % a %.',
            case v_c.kind when 'ferias' then 'férias' when 'licenca' then 'licença'
                          when 'afastamento' then 'afastamento' when 'atestado' then 'atestado'
                          when 'falta' then 'falta' else 'ausência' end,
            to_char(v_c.start_date, 'DD/MM/YYYY'),
            case when v_c.end_date = '9999-12-31' then 'sem retorno' else to_char(v_c.end_date, 'DD/MM/YYYY') end
            using errcode = 'P0097';
        end if;

        -- o vínculo NA DATA, como na importação de histórico
        v_h := null;
        v_ct := null;
        select h.* into v_h from public.membership_history h
         where h.tenant_id = p_tenant and h.user_id = v_user
           and h.effective_from::date <= v_dia
           and (h.effective_to is null or h.effective_to::date > v_dia)
         order by h.effective_from desc
         limit 1;
        select ec.* into v_ct from public.employee_contracts ec
         where ec.tenant_id = p_tenant and ec.user_id = v_user
           and v_dia between ec.admission_date and coalesce(ec.dismissed_at, 'infinity'::date)
         order by ec.admission_date desc
         limit 1;

        if v_h.id is not null then
          v_dep := v_h.department_id; v_sub := v_h.subdepartment_id; v_pos := v_h.position_id;
          v_ger := v_h.manager_id; v_codigo := v_h.employee_code;
          v_unit := case when v_unit_planilha = any(v_h.unit_ids) then v_unit_planilha
                         else coalesce(v_h.unit_ids[1], v_unit_planilha) end;
        elsif v_ct.id is not null then
          v_dep := v_ct.department_id; v_sub := v_ct.subdepartment_id; v_pos := v_ct.position_id;
          v_ger := null; v_codigo := v_ct.employee_code;
          v_unit := v_unit_planilha;
        else
          v_dep := v_m.department_id; v_sub := v_m.subdepartment_id; v_pos := v_m.position_id;
          v_ger := v_m.manager_id;
          v_codigo := coalesce(nullif(btrim(coalesce(v_l ->> 'matricula', '')), ''), v_m.employee_code);
          v_unit := v_unit_planilha;
        end if;
        if v_unit is null then
          select mu.unit_id into v_unit from public.membership_units mu
           where mu.membership_id = v_m.id order by mu.unit_id limit 1;
        end if;

        -- com quem fica: o gestor ATUAL, se ainda estiver ativo; senão quem importou
        v_resp := null;
        select g.user_id into v_resp from public.memberships g
         where g.tenant_id = p_tenant and g.user_id = v_m.manager_id and g.is_active;
        v_resp := coalesce(v_resp, v_eu);

        insert into public.absenteismo_lancamentos (
          tenant_id, user_id, status, occurred_on, reason_note,
          snap_full_name, snap_employee_code,
          snap_department_id, snap_department_name,
          snap_subdepartment_id, snap_subdepartment_name,
          snap_position_id, snap_position_name,
          snap_manager_id, snap_manager_name,
          snap_unit_id, snap_unit_name,
          created_by, comunicado_importado_por)
        values (
          p_tenant, v_user, 'aberto', v_dia, nullif(btrim(coalesce(v_l ->> 'obs', '')), ''),
          (select p.full_name from public.profiles p where p.id = v_user), v_codigo,
          v_dep, (select d.name from public.departments d where d.id = v_dep),
          v_sub, (select s.name from public.subdepartments s where s.id = v_sub),
          v_pos, (select ps.name from public.positions ps where ps.id = v_pos),
          v_ger, (select p.full_name from public.profiles p where p.id = v_ger),
          v_unit, (select u.name from public.units u where u.id = v_unit),
          v_resp, v_eu);

        v_ok := v_ok + 1;
        v_entradas := v_entradas || jsonb_build_object(
          'linha', v_n,
          'nome', (select p.full_name from public.profiles p where p.id = v_user),
          'matricula', v_codigo,
          'responsavel', (select p.full_name from public.profiles p where p.id = v_resp),
          'semGestor', v_resp = v_eu and v_m.manager_id is distinct from v_eu);
      exception
        when sqlstate 'P0097' then
          v_recusas := v_recusas || jsonb_build_object('linha', v_n, 'motivo', sqlerrm);
        when others then
          v_recusas := v_recusas || jsonb_build_object('linha', v_n, 'motivo', sqlerrm);
      end;
    end loop;

    perform set_config('app.absenteismo_importando', 'off', true);

    if p_simular then
      raise exception 'simulação' using errcode = 'P0098';
    end if;
  exception
    when sqlstate 'P0098' then null;
  end;

  return jsonb_build_object('importadas', v_ok, 'recusadas', v_recusas, 'entradas', v_entradas, 'simulado', p_simular);
end;
$function$;

revoke execute on function public.absenteismo_importar_comunicados(uuid, jsonb, boolean) from public, anon;
grant execute on function public.absenteismo_importar_comunicados(uuid, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Relatório: "Lançado por" diz "Importação" também no comunicado importado
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
    case when l.importado or l.comunicado_importado_por is not null then 'Importação' else lp.full_name end,
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
