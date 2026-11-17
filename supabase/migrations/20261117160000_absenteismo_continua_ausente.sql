-- Absenteísmo: "Continua ausente" (LUIZ, 17/11/2026).
--
-- Caso real: comunicado de não comparecimento em 16/11, e em 17/11 o
-- colaborador seguia sem aparecer e sem dar notícia. Lançar outro "não
-- comparecimento" para o dia 17 criava duas ausências desligadas: dois
-- comunicados, dois Efetivar, e a aprovação do segundo batia no período do
-- primeiro. Decisões do LUIZ:
--
--   1. O lançamento em aberto acumula os dias: `ausente_ate` é o último dia
--      registrado sem comparecer (botão "Continua ausente"), e cada registro
--      sai por e-mail ("Continua ausente: Fulano em 17/11 (2º dia)").
--   2. No Efetivar, o período vem de `occurred_on` a `ausente_ate`. Os dias que
--      o documento não cobrir viram FALTA num lançamento separado, que vai ao
--      RH junto (`absenteismo_confirmar_e_separar`).
--   3. Lembrete diário no sino de quem lançou, enquanto houver ausência em
--      aberto de dia anterior (cron, dias úteis às 08:00 de Brasília).

-- ---------------------------------------------------------------------------
-- 1. O último dia sem comparecer
-- ---------------------------------------------------------------------------
alter table public.absenteismo_lancamentos add column ausente_ate date;

comment on column public.absenteismo_lancamentos.ausente_ate is
  'Último dia registrado sem comparecer ("Continua ausente"). Nulo = só o dia do lançamento. Os dias corridos de occurred_on a ausente_ate são a ausência ainda sem motivo.';

alter table public.absenteismo_lancamentos
  add constraint absenteismo_ausente_ate_coerente
  check (ausente_ate is null or ausente_ate >= occurred_on);

-- o e-mail de cada novo dia
alter table public.absenteismo_emails drop constraint absenteismo_emails_event_check;
alter table public.absenteismo_emails add constraint absenteismo_emails_event_check
  check (event = any (array['aberto', 'confirmado', 'aprovado', 'reprovado', 'reenvio', 'direto', 'cancelado', 'continua']));

-- ---------------------------------------------------------------------------
-- 2. A guarda: ausente_ate congela com o RH e nunca é futuro
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
       or new.snap_unit_id is distinct from old.snap_unit_id
       or new.ausente_ate is distinct from old.ausente_ate)
  then
    raise exception 'Este lançamento está com o RH. Peça a reprovação para corrigir.';
  end if;

  -- "Continua ausente" registra o que já aconteceu, nunca o que virá
  if new.ausente_ate is distinct from old.ausente_ate
     and new.ausente_ate > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'O último dia sem comparecer não pode ser depois de hoje.';
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

-- função de gatilho: ninguém chama direto
revoke execute on function public.guard_absenteismo_lancamento() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. "Continua ausente": estende o lançamento em aberto até o dia informado
-- ---------------------------------------------------------------------------
create or replace function public.absenteismo_continua_ausente(p_id uuid, p_ate date)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_l record;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ultimo date;
  v_outro record;
begin
  select l.* into v_l from public.absenteismo_lancamentos l where l.id = p_id;
  if v_l.id is null or not public.pode_ver_absenteismo(v_l.tenant_id, v_l.user_id, v_l.created_by) then
    raise exception 'Lançamento não encontrado.';
  end if;
  if v_l.status <> 'aberto' then
    raise exception 'Só um lançamento em aberto recebe mais dias sem comparecer.';
  end if;
  if v_l.partial_day then
    raise exception 'A ausência parcial vale para um dia só. Se o colaborador faltou no dia seguinte, lance uma nova ausência.';
  end if;

  v_ultimo := coalesce(v_l.ausente_ate, v_l.occurred_on);
  if p_ate is null or p_ate <= v_ultimo then
    raise exception 'Informe um dia depois de %, o último já registrado.', to_char(v_ultimo, 'DD/MM/YYYY');
  end if;
  if p_ate > v_hoje then
    raise exception 'O último dia sem comparecer não pode ser depois de hoje.';
  end if;

  -- o mesmo dia não pode estar em dois lançamentos da pessoa
  select coalesce(o.start_date, o.occurred_on) as ini into v_outro
    from public.absenteismo_lancamentos o
   where o.tenant_id = v_l.tenant_id and o.user_id = v_l.user_id and o.id <> v_l.id
     and o.status <> 'cancelado'
     and daterange(coalesce(o.start_date, o.occurred_on), coalesce(o.end_date, o.ausente_ate, o.occurred_on), '[]')
         && daterange(v_ultimo + 1, p_ate, '[]')
   order by 1
   limit 1;
  if found then
    raise exception 'Já existe outro lançamento deste colaborador a partir de %. Cancele-o, ou registre só até o dia anterior.',
      to_char(v_outro.ini, 'DD/MM/YYYY');
  end if;

  update public.absenteismo_lancamentos
     set ausente_ate = p_ate, updated_at = now()
   where id = p_id;
end;
$function$;

revoke execute on function public.absenteismo_continua_ausente(uuid, date) from public, anon;
grant execute on function public.absenteismo_continua_ausente(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Enviar ao RH separando os dias que o documento não cobre
-- ---------------------------------------------------------------------------
-- Ex.: sem comparecer de 16 a 17/11 e atestado só do dia 17. O lançamento fica
-- com o dia 17 (o atestado) e o dia 16 vira um lançamento de falta, já enviado
-- ao RH. Tudo numa transação: se o envio do principal falhar, nenhuma falta
-- fica para trás. Devolve os ids das faltas criadas (para o comunicado).
create or replace function public.absenteismo_confirmar_e_separar(p_id uuid)
 returns uuid[]
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_l record;
  v_t record;
  v_ini date;
  v_fim date;
  v_cob_ini date;
  v_blocos daterange[] := '{}';
  v_b daterange;
  v_novo uuid;
  v_criados uuid[] := '{}';
  v_hist text;
begin
  select l.* into v_l from public.absenteismo_lancamentos l where l.id = p_id;
  if v_l.id is null or not public.pode_ver_absenteismo(v_l.tenant_id, v_l.user_id, v_l.created_by) then
    raise exception 'Lançamento não encontrado.';
  end if;

  if v_l.status in ('aberto', 'reprovado')
     and v_l.ausente_ate is not null and v_l.ausente_ate > v_l.occurred_on
     and v_l.start_date is not null and v_l.end_date is not null
     and v_l.end_date >= v_l.start_date then
    v_ini := v_l.occurred_on;
    v_fim := v_l.ausente_ate;
    -- o primeiro dia trabalhado do documento não cobre ausência
    v_cob_ini := case when v_l.primeiro_dia = 'trabalhou' then v_l.start_date + 1 else v_l.start_date end;

    if v_l.primeiro_dia = 'trabalhou' and v_l.start_date between v_ini and v_fim then
      raise exception 'O colaborador estava sem comparecer em %, mas o primeiro dia do documento está marcado como trabalhado.',
        to_char(v_l.start_date, 'DD/MM/YYYY');
    end if;
    if not (daterange(v_cob_ini, v_l.end_date, '[]') && daterange(v_ini, v_fim, '[]')) then
      raise exception 'O período do documento (% a %) não cobre nenhum dos dias sem comparecer (% a %).',
        to_char(v_l.start_date, 'DD/MM/YYYY'), to_char(v_l.end_date, 'DD/MM/YYYY'),
        to_char(v_ini, 'DD/MM/YYYY'), to_char(v_fim, 'DD/MM/YYYY');
    end if;

    if v_ini < v_cob_ini then
      v_blocos := v_blocos || daterange(v_ini, v_cob_ini - 1, '[]');
    end if;
    if v_fim > v_l.end_date then
      v_blocos := v_blocos || daterange(v_l.end_date + 1, v_fim, '[]');
    end if;

    if cardinality(v_blocos) > 0 then
      select t.* into v_t
        from public.absence_types t
       where t.tenant_id = v_l.tenant_id and t.active and t.kind = 'falta' and not t.requires_document
       order by t.sort nulls last, t.name
       limit 1;
      if v_t.id is null then
        raise exception 'Os dias que o documento não cobre seriam lançados como falta, mas o catálogo não tem motivo de falta sem documento obrigatório. Cadastre um em Configurações, na aba Absenteísmos.';
      end if;

      v_hist := 'Sem comparecer de ' || to_char(v_ini, 'DD/MM/YYYY') || ' a ' || to_char(v_fim, 'DD/MM/YYYY') || '.';

      -- O principal fica só com os dias cobertos. Vem ANTES das faltas: um dia
      -- tem um lançamento só, e a falta pode nascer no dia que era dele.
      update public.absenteismo_lancamentos
         set occurred_on = greatest(v_ini, v_cob_ini),
             ausente_ate = least(v_fim, v_l.end_date),
             note = concat_ws(' ', nullif(btrim(coalesce(note, '')), ''),
                    v_hist || ' Os dias fora do documento foram lançados à parte como ' || v_t.name || '.'),
             updated_at = now()
       where id = p_id;

      foreach v_b in array v_blocos loop
        begin
          insert into public.absenteismo_lancamentos (
            tenant_id, user_id, created_by, status, occurred_on, reason_note,
            absence_type_id, snap_type_name, snap_kind, snap_requires_document, snap_requires_medical,
            snap_requires_companion, snap_requires_kinship, snap_discounts_rv_default, discounts_rv,
            start_date, end_date, note,
            snap_full_name, snap_employee_code, snap_department_id, snap_department_name,
            snap_subdepartment_id, snap_subdepartment_name, snap_position_id, snap_position_name,
            snap_manager_id, snap_manager_name, snap_unit_id, snap_unit_name)
          values (
            v_l.tenant_id, v_l.user_id, (select auth.uid()), 'aberto', lower(v_b), v_l.reason_note,
            v_t.id, v_t.name, v_t.kind, v_t.requires_document, v_t.requires_medical,
            v_t.requires_companion, v_t.requires_kinship, v_t.discounts_rv_default, v_t.discounts_rv_default,
            lower(v_b), upper(v_b) - 1,
            v_hist || ' Dias sem cobertura do documento (' || coalesce(v_l.snap_type_name, 'motivo') || ' de '
              || to_char(v_l.start_date, 'DD/MM/YYYY') || ' a ' || to_char(v_l.end_date, 'DD/MM/YYYY') || ').',
            v_l.snap_full_name, v_l.snap_employee_code, v_l.snap_department_id, v_l.snap_department_name,
            v_l.snap_subdepartment_id, v_l.snap_subdepartment_name, v_l.snap_position_id, v_l.snap_position_name,
            v_l.snap_manager_id, v_l.snap_manager_name, v_l.snap_unit_id, v_l.snap_unit_name)
          returning id into v_novo;
        exception when unique_violation then
          raise exception 'Já existe outro lançamento deste colaborador em %. Cancele-o antes de efetivar este.',
            to_char(lower(v_b), 'DD/MM/YYYY');
        end;
        perform public.absenteismo_confirmar(v_novo);
        v_criados := v_criados || v_novo;
      end loop;
    end if;
  end if;

  perform public.absenteismo_confirmar(p_id);
  return v_criados;
end;
$function$;

revoke execute on function public.absenteismo_confirmar_e_separar(uuid) from public, anon;
grant execute on function public.absenteismo_confirmar_e_separar(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Relatório: o lançamento em aberto ocupa os dias sem comparecer
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

-- ---------------------------------------------------------------------------
-- 6. Lembrete diário de quem lançou
-- ---------------------------------------------------------------------------
-- Um aviso por pessoa que lançou (não um por lançamento): com três ausências em
-- aberto, três avisos toda manhã viravam ruído. Só o que é de dia anterior:
-- quem lançou ou registrou "Continua ausente" hoje já está em dia.
create or replace function public.absenteismo_lembrar_em_aberto()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r record;
  v_n int := 0;
begin
  for r in
    select l.tenant_id, l.created_by, count(*) as qtd,
           min(coalesce(l.snap_full_name, 'Colaborador')) as nome,
           min(l.occurred_on) as desde,
           bool_and(l.partial_day) as so_parcial,
           string_agg(coalesce(l.snap_full_name, 'Colaborador') || ' (desde ' || to_char(l.occurred_on, 'DD/MM') || ')',
                      ', ' order by l.occurred_on, l.snap_full_name) as quem
      from public.absenteismo_lancamentos l
     where l.status = 'aberto'
       and coalesce(l.ausente_ate, l.occurred_on) < v_hoje
     group by l.tenant_id, l.created_by
  loop
    perform public.notify_users_sistema(
      r.tenant_id, array[r.created_by], 'absenteismo_em_aberto',
      case when r.qtd = 1 then 'Ausência em aberto' else r.qtd || ' ausências em aberto' end,
      case when r.qtd = 1 then
        r.nome || ' segue em aberto desde ' || to_char(r.desde, 'DD/MM') || '. '
          || case when r.so_parcial then 'Efetive quando tiver o horário e o motivo.'
                  else 'Se não comparecer hoje, registre em "Continua ausente". Quando tiver o motivo, use Efetivar.' end
      else
        'Seguem em aberto: ' || r.quem || '. Registre quem continua ausente e efetive quem já tem o motivo.'
      end);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

-- só o cron chama
revoke execute on function public.absenteismo_lembrar_em_aberto() from public, anon, authenticated;

-- dias úteis, 08:00 de Brasília (11:00 UTC)
select cron.schedule('absenteismo-lembrete-em-aberto', '0 11 * * 1-5',
                     'select public.absenteismo_lembrar_em_aberto();');

notify pgrst, 'reload schema';
