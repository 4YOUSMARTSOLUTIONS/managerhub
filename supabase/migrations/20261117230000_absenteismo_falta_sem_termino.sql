-- Falta sem data de término (LUIZ, 17/11/2026).
--
-- Caso real: colaboradores que pararam de vir e não vão justificar (vão pedir
-- rescisão indireta). A falta tem início, mas ninguém sabe quando termina.
-- Antes, a única saída era lançar com um fim inventado e renovar todo mês.
--
-- Desenho aprovado pelo LUIZ:
--   * no Efetivar, com motivo de falta, "Continua faltando, sem data de
--     término": vai ao RH uma vez e, aprovado, conta como falta todos os dias;
--   * o término guardado é 9999-12-31, a mesma convenção do afastamento sem
--     retorno (a RV e as metas comparam `dia <= fim` como texto; NULL contaria
--     o dia como trabalhado);
--   * a situação do colaborador mostra "Faltando";
--   * o DP encerra pela ficha, com o último dia de falta (e pode reabrir ou
--     corrigir); o desligamento encerra sozinho na data dele, e desfazer o
--     desligamento reabre;
--   * lembrete semanal ao DP (segunda, 08:00) com quem segue sem término.

-- ---------------------------------------------------------------------------
-- 1. as marcas
-- ---------------------------------------------------------------------------
alter table public.absenteismo_lancamentos
  add column falta_continua boolean not null default false,
  add column falta_encerrada_no_desligamento boolean not null default false;

comment on column public.absenteismo_lancamentos.falta_continua is
  'Falta lançada sem data de término (end_date 9999-12-31 enquanto segue). Encerrada, o end_date vira o último dia de falta e a marca fica.';
comment on column public.absenteismo_lancamentos.falta_encerrada_no_desligamento is
  'O término veio do desligamento do colaborador: desfazer o desligamento reabre a falta.';

alter table public.absenteismo_lancamentos
  add constraint absenteismo_sem_termino_so_na_falta_continua
    check (end_date is distinct from date '9999-12-31' or falta_continua),
  add constraint absenteismo_falta_continua_e_falta
    check (not falta_continua or snap_kind is null or snap_kind = 'falta');

-- a ausência de falta também pode ficar sem término
alter table public.employee_absences
  drop constraint employee_absences_sem_retorno,
  add constraint employee_absences_sem_retorno
    check (end_date <> date '9999-12-31' or kind in ('afastamento', 'licenca', 'falta'));

-- o comunicado de encerramento
alter table public.absenteismo_emails
  drop constraint absenteismo_emails_event_check,
  add constraint absenteismo_emails_event_check
    check (event = any (array['aberto', 'confirmado', 'aprovado', 'reprovado', 'reenvio', 'direto', 'cancelado', 'continua', 'encerrada']));

-- ---------------------------------------------------------------------------
-- 2. as guardas: só o encerramento mexe no término depois da aprovação
-- ---------------------------------------------------------------------------
-- `app.absenteismo_encerrando` só é ligado dentro das funções deste arquivo
-- (local à transação e fora do alcance da API). Com ele, só o término e a
-- marca do desligamento podem mudar.
create or replace function public.guard_absenteismo_lancamento()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_adm boolean;
  v_so_anexo constant text[] := array[
    'doc_path', 'doc_filename', 'doc_size', 'doc_content_type', 'doc_uploaded_at', 'doc_uploaded_by',
    'updated_at', 'ausencia_inicio'
  ];
  v_so_termino constant text[] := array['end_date', 'falta_encerrada_no_desligamento', 'updated_at', 'ausencia_inicio'];
begin
  if coalesce(current_setting('app.absenteismo_encerrando', true), '') = 'on' then
    if old.falta_continua and (to_jsonb(new) - v_so_termino) = (to_jsonb(old) - v_so_termino) then
      return new;
    end if;
    raise exception 'O encerramento da falta só muda o término.';
  end if;

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
       or new.ausente_ate is distinct from old.ausente_ate
       or new.falta_continua is distinct from old.falta_continua
       or new.falta_encerrada_no_desligamento is distinct from old.falta_encerrada_no_desligamento)
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
    -- importado e aprovado: o DP anexa o atestado depois, e só o anexo muda
    if old.importado and old.status = 'aprovado'
       and (to_jsonb(new) - v_so_anexo) = (to_jsonb(old) - v_so_anexo) then
      if not v_adm then
        raise exception 'Só o DP anexa documento a lançamento importado.';
      end if;
    else
      raise exception 'Lançamento já encerrado. Não é possível alterá-lo.';
    end if;
  end if;

  return new;
end;
$function$;

revoke execute on function public.guard_absenteismo_lancamento() from public, anon, authenticated;

-- a ausência que veio de lançamento só muda o término, e só pelo encerramento
create or replace function public.guard_ausencia_de_lancamento()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if exists (select 1 from public.absenteismo_lancamentos l where l.absence_id = old.id)
     and (new.user_id is distinct from old.user_id
          or new.kind is distinct from old.kind
          or new.start_date is distinct from old.start_date
          or (new.end_date is distinct from old.end_date
              and coalesce(current_setting('app.absenteismo_encerrando', true), '') <> 'on'))
  then
    raise exception 'Esta ausência veio de um lançamento aprovado. Para desfazê-la, cancele o lançamento em Absenteísmos.';
  end if;
  return new;
end;
$function$;

revoke execute on function public.guard_ausencia_de_lancamento() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. encerrar, corrigir ou reabrir (o DP, pela ficha)
-- ---------------------------------------------------------------------------
-- p_ultimo_dia = o último dia de falta; nulo = reabrir (segue faltando).
create or replace function public.absenteismo_encerrar_falta(p_id uuid, p_ultimo_dia date)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_l public.absenteismo_lancamentos%rowtype;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_inicio date;
  v_deslig date;
  v_fim date;
  v_c record;
begin
  select l.* into v_l from public.absenteismo_lancamentos l where l.id = p_id;
  if v_l.id is null then
    raise exception 'Lançamento não encontrado.';
  end if;
  if not public.has_tenant_role(v_l.tenant_id, '{owner,admin,hr}'::public.member_role[]) then
    raise exception 'Só o DP encerra as faltas.' using errcode = '42501';
  end if;
  if not v_l.falta_continua then
    raise exception 'Este lançamento não é de falta sem término.';
  end if;
  if v_l.status not in ('pendente', 'aprovado') then
    raise exception 'Só dá para encerrar a falta enviada ao RH ou aprovada. Em aberto, ajuste pelo Efetivar.';
  end if;

  v_inicio := coalesce(v_l.ausencia_inicio, v_l.start_date);
  select m.dismissed_at into v_deslig from public.memberships m
   where m.tenant_id = v_l.tenant_id and m.user_id = v_l.user_id;

  if p_ultimo_dia is null then
    if v_deslig is not null then
      raise exception 'O colaborador está desligado desde %: a falta não pode seguir sem término.', to_char(v_deslig, 'DD/MM/YYYY');
    end if;
    v_fim := date '9999-12-31';
  else
    if p_ultimo_dia < v_inicio then
      raise exception 'O último dia de falta não pode ser antes do início (%).', to_char(v_inicio, 'DD/MM/YYYY');
    end if;
    if p_ultimo_dia > v_hoje then
      raise exception 'O último dia de falta não pode ser depois de hoje.';
    end if;
    if v_deslig is not null and p_ultimo_dia > v_deslig then
      raise exception 'O último dia de falta não pode passar do desligamento (%).', to_char(v_deslig, 'DD/MM/YYYY');
    end if;
    v_fim := p_ultimo_dia;
  end if;

  perform set_config('app.absenteismo_encerrando', 'on', true);
  update public.absenteismo_lancamentos
     set end_date = v_fim, falta_encerrada_no_desligamento = false, updated_at = now()
   where id = p_id;
  if v_l.absence_id is not null then
    begin
      update public.employee_absences set end_date = v_fim where id = v_l.absence_id;
    exception when exclusion_violation then
      select e.start_date, e.end_date into v_c from public.employee_absences e
       where e.tenant_id = v_l.tenant_id and e.user_id = v_l.user_id and e.id <> v_l.absence_id
         and daterange(e.start_date, e.end_date, '[]') && daterange(v_inicio, v_fim, '[]')
       limit 1;
      raise exception 'A falta cruzaria com uma ausência já lançada de % a %.',
        to_char(v_c.start_date, 'DD/MM/YYYY'), to_char(v_c.end_date, 'DD/MM/YYYY');
    end;
  end if;
  perform set_config('app.absenteismo_encerrando', 'off', true);
end;
$function$;

revoke execute on function public.absenteismo_encerrar_falta(uuid, date) from public, anon;
grant execute on function public.absenteismo_encerrar_falta(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. o desligamento encerra (e desfazer o desligamento reabre)
-- ---------------------------------------------------------------------------
-- Vale para todo caminho que grava a data de desligamento: a ficha, a
-- importação de colaboradores, o SQL do suporte.
create or replace function public.absenteismo_faltas_no_desligamento()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r record;
  v_fim date;
begin
  perform set_config('app.absenteismo_encerrando', 'on', true);

  -- o desligamento anterior tinha encerrado: volta a seguir sem término
  if old.dismissed_at is not null then
    for r in
      select l.id, l.absence_id from public.absenteismo_lancamentos l
       where l.tenant_id = new.tenant_id and l.user_id = new.user_id
         and l.falta_continua and l.falta_encerrada_no_desligamento
         and l.status <> 'cancelado' and l.end_date = old.dismissed_at
    loop
      update public.absenteismo_lancamentos
         set end_date = date '9999-12-31', falta_encerrada_no_desligamento = false, updated_at = now()
       where id = r.id;
      if r.absence_id is not null then
        update public.employee_absences set end_date = date '9999-12-31' where id = r.absence_id;
      end if;
    end loop;
  end if;

  if new.dismissed_at is not null then
    for r in
      select l.id, l.absence_id, coalesce(l.ausencia_inicio, l.start_date) as inicio
        from public.absenteismo_lancamentos l
       where l.tenant_id = new.tenant_id and l.user_id = new.user_id
         and l.falta_continua and l.status <> 'cancelado'
         and l.end_date = date '9999-12-31'
    loop
      v_fim := greatest(new.dismissed_at, r.inicio);
      update public.absenteismo_lancamentos
         set end_date = v_fim, falta_encerrada_no_desligamento = true, updated_at = now()
       where id = r.id;
      if r.absence_id is not null then
        update public.employee_absences set end_date = v_fim where id = r.absence_id;
      end if;
    end loop;
  end if;

  perform set_config('app.absenteismo_encerrando', 'off', true);
  return new;
end;
$function$;

revoke execute on function public.absenteismo_faltas_no_desligamento() from public, anon, authenticated;

create trigger trg_absenteismo_faltas_no_desligamento
  after update of dismissed_at on public.memberships
  for each row
  when (old.dismissed_at is distinct from new.dismissed_at)
  execute function public.absenteismo_faltas_no_desligamento();

-- ---------------------------------------------------------------------------
-- 5. lembrete semanal ao DP
-- ---------------------------------------------------------------------------
create or replace function public.absenteismo_lembrar_faltas_sem_termino()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r record;
  v_dp uuid[];
begin
  for r in
    select l.tenant_id, count(*) as n,
           string_agg(
             coalesce(l.snap_full_name, 'Colaborador') || ' (desde ' ||
             to_char(coalesce(l.ausencia_inicio, l.start_date), 'DD/MM') || ', ' ||
             (v_hoje - coalesce(l.ausencia_inicio, l.start_date) + 1) || ' dias' ||
             case when l.status = 'pendente' then ', aguardando o RH' else '' end || ')',
             '; ' order by l.start_date) as lista
      from public.absenteismo_lancamentos l
     where l.falta_continua and l.end_date = date '9999-12-31'
       and l.status in ('pendente', 'aprovado')
     group by l.tenant_id
  loop
    select array_agg(m.user_id) into v_dp
      from public.memberships m
     where m.tenant_id = r.tenant_id and m.is_active
       and (m.role in ('owner', 'admin') or m.is_hr);
    if v_dp is null then continue; end if;

    perform public.notify_users_sistema(
      r.tenant_id, v_dp, 'absenteismo_faltas_sem_termino',
      case when r.n = 1 then '1 falta sem término' else r.n || ' faltas sem término' end,
      'Seguem faltando, sem data de término: ' || r.lista ||
      '. Quando a situação se resolver, encerre pela ficha do lançamento; o desligamento encerra sozinho.');
  end loop;
end;
$function$;

revoke execute on function public.absenteismo_lembrar_faltas_sem_termino() from public, anon, authenticated;

-- segunda-feira, 08:00 de Brasília (11:00 UTC)
select cron.schedule('absenteismo-faltas-sem-termino', '0 11 * * 1',
                     'select public.absenteismo_lembrar_faltas_sem_termino();');

-- ---------------------------------------------------------------------------
-- 6. situação do colaborador: "Faltando" enquanto a falta segue sem término
-- ---------------------------------------------------------------------------
create or replace function public.colaboradores_situacoes(p_tenant uuid)
 returns table(user_id uuid, situacao text, desde date, retorno date, observacao text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_todos boolean;
begin
  if not public.is_tenant_member(p_tenant) then
    raise exception 'Você não é membro desta empresa.';
  end if;

  v_todos := public.has_tenant_role(p_tenant, '{owner,admin,hr,manager}'::public.member_role[]);
  if not v_todos and not public.has_tenant_role(p_tenant, '{team_lead}'::public.member_role[]) then
    return; -- colaborador comum: nada
  end if;

  return query
    select distinct on (ea.user_id)
           ea.user_id,
           coalesce(ea.motivo, ea.kind::text),
           ea.start_date,
           nullif(ea.end_date, date '9999-12-31'),
           ea.note
      from public.employee_absences ea
     where ea.tenant_id = p_tenant
       and (ea.kind in ('afastamento', 'licenca')
            or (ea.kind = 'falta' and ea.end_date = date '9999-12-31'))
       and v_hoje between ea.start_date and ea.end_date
       and (v_todos or ea.user_id in (
             select mm.user_id from public.my_managed_memberships() mm
              where mm.tenant_id = p_tenant))
     order by ea.user_id, ea.start_date desc;
end;
$function$;

revoke execute on function public.colaboradores_situacoes(uuid) from public, anon;
grant execute on function public.colaboradores_situacoes(uuid) to authenticated;

-- a mesma regra na situação que o painel de férias mostra (troca só o filtro)
do $do$
declare
  v_def text := pg_get_functiondef('public.ferias_painel'::regproc);
  v_de constant text := 'and ea.kind in (''afastamento'', ''licenca'')';
  v_para constant text := 'and (ea.kind in (''afastamento'', ''licenca'') or (ea.kind = ''falta'' and ea.end_date = date ''9999-12-31''))';
begin
  if position(v_de in v_def) = 0 then
    raise exception 'ferias_painel mudou: o filtro de situação não foi encontrado.';
  end if;
  execute replace(v_def, v_de, v_para);
end;
$do$;


revoke execute on function public.ferias_painel(uuid, date, uuid[]) from public, anon;

-- ---------------------------------------------------------------------------
-- 7. relatório: sem término sai com o fim vazio e os dias contados até hoje
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
    case when l.end_date = date '9999-12-31' then null
         else coalesce(l.end_date, case when l.status = 'aberto' then l.ausente_ate end) end,
    case when l.partial_day or l.start_date is null then null
         when l.end_date = date '9999-12-31'
           then ((now() at time zone 'America/Sao_Paulo')::date - l.ausencia_inicio) + 1
         else (l.end_date - l.ausencia_inicio) + 1 end,
    case when l.partial_day or l.end_date is null or l.end_date = date '9999-12-31' then null
         else l.end_date + 1 end,
    l.snap_type_name,
    case when l.end_date = date '9999-12-31' then concat_ws('. ', 'Sem término: segue faltando (dias contados até hoje)', l.note)
         when l.falta_encerrada_no_desligamento then concat_ws('. ', 'Encerrada no desligamento', l.note)
         else l.note end,
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
