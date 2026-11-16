-- Importação do HISTÓRICO de absenteísmo (LUIZ, 16/11/2026).
--
-- Serve para carregar o que aconteceu antes do sistema. Lançamento de hoje em
-- diante segue o fluxo normal (Lançar ausência → Efetivar → RH), e por isso a
-- importação recusa linha que começa hoje ou depois.
--
-- Decisões do LUIZ:
--   * só o PROPRIETÁRIO importa;
--   * a linha entra já APROVADA (cria a ausência em employee_absences, como a
--     aprovação do RH): conta no relatório, nos 15 dias do INSS, na situação do
--     colaborador e na RV;
--   * NADA de aviso: nem comunicado por e-mail, nem sino.
--
-- O lançamento importado não tem anexo (o documento está no papel ou na pasta
-- do DP), então a regra "tipo que exige documento precisa de anexo" deixa de
-- valer para ele. A marca `importado` só pode ser gravada por esta função: sem
-- a trava, um gestor inseriria o próprio lançamento com a marca e pularia o
-- anexo.

-- ---------------------------------------------------------------------------
-- 1. a marca
-- ---------------------------------------------------------------------------
alter table public.absenteismo_lancamentos
  add column importado boolean not null default false;

comment on column public.absenteismo_lancamentos.importado is
  'Veio da importação de histórico (só o proprietário): entra aprovado, sem comunicado e sem anexo.';

alter table public.absenteismo_lancamentos
  drop constraint absenteismo_anexo_quando_o_tipo_exige,
  add constraint absenteismo_anexo_quando_o_tipo_exige
    check (status = 'aberto' or not snap_requires_document or doc_path is not null or importado);

-- a marca nasce só dentro da importação e nunca muda depois
create or replace function public.guard_absenteismo_importado()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    if new.importado
       and coalesce(current_setting('app.absenteismo_importando', true), '') <> 'on' then
      raise exception 'Só a importação de histórico marca um lançamento como importado.';
    end if;
  elsif new.importado is distinct from old.importado then
    raise exception 'A marca de importação não muda depois de gravada.';
  end if;
  return new;
end;
$function$;

revoke execute on function public.guard_absenteismo_importado() from public, anon, authenticated;

create trigger trg_guard_absenteismo_importado
  before insert or update on public.absenteismo_lancamentos
  for each row execute function public.guard_absenteismo_importado();

-- ---------------------------------------------------------------------------
-- 2. os dados do atestado de um lançamento que já nasce aprovado
-- ---------------------------------------------------------------------------
-- A guarda trava a ficha médica depois do envio ao RH. A importação grava o
-- lançamento já aprovado e a ficha logo depois, na mesma transação: só ela
-- passa (o GUC é local à transação e não é alcançável pela API).
create or replace function public.guard_absenteismo_atestado()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_status public.absenteismo_status;
begin
  if coalesce(current_setting('app.absenteismo_importando', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  select l.status into v_status from public.absenteismo_lancamentos l
   where l.id = coalesce(new.lancamento_id, old.lancamento_id);
  if v_status is null then return coalesce(new, old); end if;
  if v_status not in ('aberto', 'reprovado') then
    raise exception 'Os dados do atestado não podem ser alterados depois do envio ao RH.';
  end if;
  return coalesce(new, old);
end;
$function$;

revoke execute on function public.guard_absenteismo_atestado() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. a importação
-- ---------------------------------------------------------------------------
-- p_linhas: array de objetos já resolvidos pelo servidor do app (pessoa por
-- unidade + matrícula, motivo pelo nome do catálogo):
--   linha (int), user_id, tipo_id, unit_id, matricula, inicio, fim, das, ate,
--   obs, tipo_atestado, cid, medico, crm, local, emissao, acompanhado,
--   parentesco, acidente (bool), abonada (bool)
-- As conferências que dependem do banco moram aqui: período que cruza com
-- ausência ou absenteísmo já lançado (inclusive de outra linha da mesma
-- planilha), admissão, desligamento, CID.
--
-- p_simular = true faz tudo e desfaz no fim: a tela mostra a prévia exata.
create or replace function public.absenteismo_importar(
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
  v_unit_planilha uuid;
  v_tipo public.absence_types%rowtype;
  v_m public.memberships%rowtype;
  v_h public.membership_history%rowtype;
  v_ct public.employee_contracts%rowtype;
  v_ini date;
  v_fim date;
  v_das time;
  v_ate time;
  v_parcial boolean;
  v_admissao date;
  v_c record;
  v_cid text;
  v_cid_desc text;
  v_unit uuid;
  v_dep uuid;
  v_sub uuid;
  v_pos uuid;
  v_ger uuid;
  v_codigo text;
  v_aus uuid;
  v_id uuid;
  v_abonada boolean;
  v_ok int := 0;
  v_recusas jsonb := '[]'::jsonb;
begin
  if v_eu is null or not public.has_tenant_role(p_tenant, '{owner}'::public.member_role[]) then
    raise exception 'Apenas o proprietário importa o histórico de absenteísmo.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_linhas) is distinct from 'array' then
    raise exception 'Formato inválido.';
  end if;
  if jsonb_array_length(p_linhas) > 5000 then
    raise exception 'No máximo 5.000 linhas por importação. Divida a planilha.';
  end if;

  begin
    perform set_config('app.absenteismo_importando', 'on', true);

    for v_l in select * from jsonb_array_elements(p_linhas) loop
      v_n := (v_l ->> 'linha')::int;
      begin
        v_user := nullif(v_l ->> 'user_id', '')::uuid;
        v_unit_planilha := nullif(v_l ->> 'unit_id', '')::uuid;
        v_ini := nullif(v_l ->> 'inicio', '')::date;
        v_fim := nullif(v_l ->> 'fim', '')::date;
        v_das := nullif(v_l ->> 'das', '')::time;
        v_ate := nullif(v_l ->> 'ate', '')::time;
        v_parcial := v_das is not null;

        select m.* into v_m from public.memberships m
         where m.tenant_id = p_tenant and m.user_id = v_user;
        if v_m.id is null then
          raise exception 'Colaborador não encontrado nesta empresa.' using errcode = 'P0097';
        end if;

        select t.* into v_tipo from public.absence_types t
         where t.id = nullif(v_l ->> 'tipo_id', '')::uuid and t.tenant_id = p_tenant;
        if v_tipo.id is null then
          raise exception 'Motivo não encontrado no catálogo.' using errcode = 'P0097';
        end if;

        if v_ini is null or v_fim is null then
          raise exception 'Informe o início e o fim.' using errcode = 'P0097';
        end if;
        if v_fim < v_ini then
          raise exception 'O fim é antes do início.' using errcode = 'P0097';
        end if;
        if v_ini >= v_hoje then
          raise exception 'Começa hoje ou depois: lançamento atual segue pelo Lançar ausência.' using errcode = 'P0097';
        end if;
        if (v_das is null) <> (v_ate is null) then
          raise exception 'Ausência de horas: informe Das e Até.' using errcode = 'P0097';
        end if;
        if v_parcial and v_ate <= v_das then
          raise exception 'O horário Até precisa ser maior que o Das.' using errcode = 'P0097';
        end if;
        if v_parcial and v_fim <> v_ini then
          raise exception 'Ausência de horas vale para um dia só: início e fim iguais.' using errcode = 'P0097';
        end if;

        -- a primeira admissão conhecida (contrato atual ou anterior)
        select least(v_m.admission_date, min(ec.admission_date)) into v_admissao
          from public.employee_contracts ec
         where ec.tenant_id = p_tenant and ec.user_id = v_user;
        if v_admissao is not null and v_ini < v_admissao then
          raise exception 'Começa antes da admissão (%).', to_char(v_admissao, 'DD/MM/YYYY') using errcode = 'P0097';
        end if;
        if v_m.dismissed_at is not null and v_ini > v_m.dismissed_at then
          raise exception 'Começa depois do desligamento (%).', to_char(v_m.dismissed_at, 'DD/MM/YYYY') using errcode = 'P0097';
        end if;

        -- absenteísmo já lançado no período (no sistema ou numa linha anterior
        -- desta planilha, que a esta altura já foi gravada)
        select coalesce(l.ausencia_inicio, l.start_date, l.occurred_on) as ini,
               coalesce(l.end_date, l.occurred_on) as fim
          into v_c
          from public.absenteismo_lancamentos l
         where l.tenant_id = p_tenant and l.user_id = v_user
           and l.status not in ('cancelado', 'reprovado')
           and daterange(coalesce(l.ausencia_inicio, l.start_date, l.occurred_on),
                         coalesce(l.end_date, l.occurred_on), '[]')
            && daterange(v_ini, v_fim, '[]')
         limit 1;
        if found then
          raise exception 'Já há absenteísmo de % a % para esta pessoa (no sistema ou em outra linha da planilha).',
            to_char(v_c.ini, 'DD/MM/YYYY'), to_char(v_c.fim, 'DD/MM/YYYY') using errcode = 'P0097';
        end if;

        -- férias e afastamentos (inclusive os vindos da folha)
        select e.start_date, e.end_date, e.kind into v_c
          from public.employee_absences e
         where e.tenant_id = p_tenant and e.user_id = v_user
           and daterange(e.start_date, e.end_date, '[]') && daterange(v_ini, v_fim, '[]')
         limit 1;
        if found then
          raise exception 'Cruza com % de % a %.',
            case v_c.kind when 'ferias' then 'férias' when 'licenca' then 'licença'
                          when 'afastamento' then 'afastamento' when 'atestado' then 'atestado'
                          when 'falta' then 'falta' else 'ausência' end,
            to_char(v_c.start_date, 'DD/MM/YYYY'),
            case when v_c.end_date = '9999-12-31' then 'sem retorno' else to_char(v_c.end_date, 'DD/MM/YYYY') end
            using errcode = 'P0097';
        end if;

        v_cid := nullif(btrim(coalesce(v_l ->> 'cid', '')), '');
        v_cid_desc := null;
        if v_cid is not null then
          select c.description into v_cid_desc from public.cid10 c where c.code = v_cid;
          if v_cid_desc is null then
            raise exception 'CID % não existe na tabela CID-10.', v_cid using errcode = 'P0097';
          end if;
        end if;

        -- o vínculo NA ÉPOCA: a vigência do histórico que cobre o início; antes
        -- do histórico, o contrato anterior; sem nenhum dos dois, o de hoje
        select h.* into v_h from public.membership_history h
         where h.tenant_id = p_tenant and h.user_id = v_user
           and h.effective_from::date <= v_ini
           and (h.effective_to is null or h.effective_to::date > v_ini)
         order by h.effective_from desc
         limit 1;
        select ec.* into v_ct from public.employee_contracts ec
         where ec.tenant_id = p_tenant and ec.user_id = v_user
           and v_ini between ec.admission_date and coalesce(ec.dismissed_at, 'infinity'::date)
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

        -- abono só existe para falta, como no Efetivar
        v_abonada := v_tipo.kind = 'falta' and coalesce((v_l ->> 'abonada')::boolean, false);

        -- a ausência que a aprovação criaria (horas não viram dias: o desconto é na folha)
        v_aus := null;
        if not v_parcial then
          insert into public.employee_absences (
            tenant_id, user_id, kind, start_date, end_date, discounts_rv, waived, note, created_by)
          values (
            p_tenant, v_user, v_tipo.kind, v_ini, v_fim, v_tipo.discounts_rv_default, v_abonada,
            nullif(btrim(v_tipo.name), ''), v_eu)
          returning id into v_aus;
        end if;

        insert into public.absenteismo_lancamentos (
          tenant_id, user_id, status, occurred_on,
          absence_type_id, snap_type_name, snap_kind,
          snap_requires_document, snap_requires_medical, snap_requires_companion,
          snap_requires_kinship, snap_discounts_rv_default,
          start_date, end_date, discounts_rv, note,
          snap_full_name, snap_employee_code,
          snap_department_id, snap_department_name,
          snap_subdepartment_id, snap_subdepartment_name,
          snap_position_id, snap_position_name,
          snap_manager_id, snap_manager_name,
          snap_unit_id, snap_unit_name,
          created_by, submitted_at, decided_at, decided_by, decision_note,
          absence_id, kinship_of_deceased, work_accident, certificate_kind, waived,
          hours_start, hours_end, partial_day, primeiro_dia, importado)
        values (
          p_tenant, v_user, 'aprovado', v_ini,
          v_tipo.id, v_tipo.name, v_tipo.kind,
          v_tipo.requires_document, v_tipo.requires_medical, v_tipo.requires_companion,
          v_tipo.requires_kinship, v_tipo.discounts_rv_default,
          v_ini, v_fim, v_tipo.discounts_rv_default, nullif(btrim(coalesce(v_l ->> 'obs', '')), ''),
          (select p.full_name from public.profiles p where p.id = v_user), v_codigo,
          v_dep, (select d.name from public.departments d where d.id = v_dep),
          v_sub, (select s.name from public.subdepartments s where s.id = v_sub),
          v_pos, (select ps.name from public.positions ps where ps.id = v_pos),
          v_ger, (select p.full_name from public.profiles p where p.id = v_ger),
          v_unit, (select u.name from public.units u where u.id = v_unit),
          v_eu, now(), now(), v_eu, 'Importado do histórico.',
          v_aus,
          case when v_tipo.requires_kinship then nullif(btrim(coalesce(v_l ->> 'parentesco', '')), '') end,
          coalesce((v_l ->> 'acidente')::boolean, false),
          case when v_tipo.requires_medical then nullif(v_l ->> 'tipo_atestado', '') end,
          v_abonada,
          v_das, v_ate, v_parcial, 'integral', true)
        returning id into v_id;

        -- a ficha médica, quando a linha traz algum dado dela
        if v_cid is not null
           or nullif(btrim(coalesce(v_l ->> 'medico', '')), '') is not null
           or nullif(btrim(coalesce(v_l ->> 'crm', '')), '') is not null
           or nullif(btrim(coalesce(v_l ->> 'local', '')), '') is not null
           or nullif(v_l ->> 'emissao', '') is not null
           or nullif(btrim(coalesce(v_l ->> 'acompanhado', '')), '') is not null then
          insert into public.absenteismo_atestados (
            lancamento_id, tenant_id, cid_code, cid_description, doctor_name, doctor_crm,
            facility, issued_on, days_off, companion_name, updated_by)
          values (
            v_id, p_tenant, v_cid, v_cid_desc,
            nullif(btrim(coalesce(v_l ->> 'medico', '')), ''),
            nullif(btrim(coalesce(v_l ->> 'crm', '')), ''),
            nullif(btrim(coalesce(v_l ->> 'local', '')), ''),
            nullif(v_l ->> 'emissao', '')::date,
            case when v_parcial then null else (v_fim - v_ini) + 1 end,
            nullif(btrim(coalesce(v_l ->> 'acompanhado', '')), ''),
            v_eu);
        end if;

        v_ok := v_ok + 1;
      exception
        when sqlstate 'P0097' then
          v_recusas := v_recusas || jsonb_build_object('linha', v_n, 'motivo', sqlerrm);
        when exclusion_violation then
          v_recusas := v_recusas || jsonb_build_object('linha', v_n, 'motivo', 'Cruza com uma ausência já lançada.');
        when others then
          v_recusas := v_recusas || jsonb_build_object('linha', v_n, 'motivo', sqlerrm);
      end;
    end loop;

    perform set_config('app.absenteismo_importando', 'off', true);

    -- prévia: tudo o que foi gravado acima é desfeito; as contagens ficam
    if p_simular then
      raise exception 'simulação' using errcode = 'P0098';
    end if;
  exception
    when sqlstate 'P0098' then null;
  end;

  return jsonb_build_object('importadas', v_ok, 'recusadas', v_recusas, 'simulado', p_simular);
end;
$function$;

revoke execute on function public.absenteismo_importar(uuid, jsonb, boolean) from public, anon;
grant execute on function public.absenteismo_importar(uuid, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
