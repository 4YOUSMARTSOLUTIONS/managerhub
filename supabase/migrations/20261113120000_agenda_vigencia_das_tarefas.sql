-- Agendas: editar no presente não reescreve o passado (LUIZ, 13/11/2026).
--
-- A aderência de cada dia, inclusive dos passados, é calculada com a agenda
-- como ela está HOJE. Sem vigência:
--   * tarefa nova era cobrada em todos os dias desde a criação da agenda (235
--     de 537 tarefas foram criadas depois da agenda; na "Analista Financeiro",
--     804 de 1.297 cobranças dos últimos 3 meses eram de tarefas que ainda não
--     existiam);
--   * mudar os dias de uma tarefa reescrevia o histórico dela;
--   * remover uma tarefa APAGAVA, em cascata, todos os registros dela;
--   * inativar a agenda sumia com todo o passado dela.
--
-- Agora:
--   1. cada tarefa tem vigência (`vigente_de` incluso, `vigente_ate` exclusivo,
--      o mesmo jeito de `agenda_responsaveis`);
--   2. `agenda_salvar_tarefas` grava a edição com uma data "a partir de": mudar
--      a recorrência encerra a versão antiga e abre uma nova, remover encerra
--      (o histórico fica), e só some de vez a tarefa que nunca valeu e não tem
--      registro;
--   3. a agenda guarda os períodos em que esteve inativa (`periodos_inativa`),
--      mantidos por gatilho; o passado anterior à inativação continua contando.

-- ---------------------------------------------------------------------------
-- 1. vigência das tarefas
-- ---------------------------------------------------------------------------
alter table public.agenda_tasks
  add column vigente_de date,
  add column vigente_ate date;

-- as que existem passam a valer desde o dia em que foram criadas
update public.agenda_tasks set vigente_de = (created_at at time zone 'America/Sao_Paulo')::date;
-- tarefa de data única (inclui demanda não prevista registrada para trás) vale no próprio dia
update public.agenda_tasks set vigente_de = least(vigente_de, fixed_date)
 where frequency = 'unica' and fixed_date is not null;

alter table public.agenda_tasks
  alter column vigente_de set not null,
  alter column vigente_de set default ((now() at time zone 'America/Sao_Paulo')::date),
  add constraint agenda_tasks_vigencia check (vigente_ate is null or vigente_ate >= vigente_de);

create index agenda_tasks_atuais_idx on public.agenda_tasks (agenda_id) where vigente_ate is null;

comment on column public.agenda_tasks.vigente_de is
  'Primeiro dia em que a tarefa é cobrada (incluso). Antes disso ela não existia.';
comment on column public.agenda_tasks.vigente_ate is
  'Dia em que a tarefa deixou de valer (exclusivo); null = em vigor. Encerrada por edição ou remoção, com o histórico preservado.';

-- ---------------------------------------------------------------------------
-- 2. períodos de inatividade da agenda
-- ---------------------------------------------------------------------------
alter table public.agendas add column periodos_inativa jsonb not null default '[]'::jsonb;

comment on column public.agendas.periodos_inativa is
  'Períodos em que a agenda esteve inativa: [{de, ate}] (de incluso, ate exclusivo, null = ainda inativa). Mantido pelo gatilho agendas_registrar_inatividade.';

-- as já inativas (decisão do LUIZ): o passado conta até a última alteração registrada
update public.agendas
   set periodos_inativa = jsonb_build_array(jsonb_build_object(
         'de', (updated_at at time zone 'America/Sao_Paulo')::date, 'ate', null))
 where not active;

create or replace function public.agenda_registrar_inatividade()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_dia date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if new.active is distinct from old.active then
    if not new.active then
      new.periodos_inativa := coalesce(old.periodos_inativa, '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object('de', v_dia, 'ate', null));
    else
      new.periodos_inativa := coalesce((
        select jsonb_agg(case when x.e->>'ate' is null then jsonb_set(x.e, '{ate}', to_jsonb(v_dia)) else x.e end
                         order by x.ord)
          from jsonb_array_elements(coalesce(old.periodos_inativa, '[]'::jsonb)) with ordinality as x(e, ord)
      ), '[]'::jsonb);
    end if;
  end if;
  return new;
end;
$function$;

create trigger agendas_registrar_inatividade
  before update of active on public.agendas
  for each row execute function public.agenda_registrar_inatividade();

revoke execute on function public.agenda_registrar_inatividade() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. salvar as tarefas com vigência
-- ---------------------------------------------------------------------------
create or replace function public.agenda_salvar_tarefas(p_agenda uuid, p_tarefas jsonb, p_desde date default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ag record;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_desde date := coalesce(p_desde, (now() at time zone 'America/Sao_Paulo')::date);
  v_ids uuid[];
  v_t record;
  v_in jsonb;
  v_id uuid;
  v_novo uuid;
  v_freq public.agenda_frequency;
  v_dias int[];
  v_dia_mes int;
  v_data date;
  v_duracao int;
  v_flex boolean;
  v_ativa boolean;
  v_recorrencia_mudou boolean;
begin
  select * into v_ag from public.agendas where id = p_agenda;
  -- a mesma regra da policy ag_task_write
  if v_ag.id is null or not (
       public.agenda_can_admin(v_ag.tenant_id, v_ag.owner_id)
       or (v_ag.responsible_id = auth.uid() and v_ag.can_responsible_edit)) then
    raise exception 'Você não pode editar as tarefas desta agenda.' using errcode = '42501';
  end if;
  if v_desde > v_hoje then
    raise exception 'As alterações valem de hoje para trás: escolha hoje ou uma data passada.';
  end if;
  if jsonb_typeof(p_tarefas) <> 'array' then
    raise exception 'Tarefas inválidas.';
  end if;

  select coalesce(array_agg((e->>'id')::uuid), '{}') into v_ids
    from jsonb_array_elements(p_tarefas) e
   where nullif(e->>'id', '') is not null;
  if exists (
    select 1 from unnest(v_ids) i
     where not exists (select 1 from public.agenda_tasks t
                        where t.id = i and t.agenda_id = p_agenda and t.vigente_ate is null)
  ) then
    raise exception 'Uma das tarefas mudou enquanto você editava. Recarregue a página e tente de novo.';
  end if;

  -- removidas: encerram a partir da data (o histórico fica); some de vez só a
  -- que nunca chegou a valer antes da data e não tem nenhum registro
  for v_t in
    select * from public.agenda_tasks t
     where t.agenda_id = p_agenda and t.vigente_ate is null and not (t.id = any(v_ids))
  loop
    if v_t.vigente_de >= v_desde
       and not exists (select 1 from public.agenda_logs l where l.task_id = v_t.id) then
      delete from public.agenda_tasks where id = v_t.id;
    else
      update public.agenda_tasks set vigente_ate = greatest(v_desde, v_t.vigente_de) where id = v_t.id;
    end if;
  end loop;

  for v_in in select e from jsonb_array_elements(p_tarefas) e loop
    if coalesce(btrim(v_in->>'title'), '') = '' then
      continue;
    end if;
    v_id := nullif(v_in->>'id', '')::uuid;
    v_freq := (v_in->>'frequency')::public.agenda_frequency;
    v_dias := coalesce((select array_agg(x::int order by x::int) from jsonb_array_elements_text(v_in->'weekdays') x), '{}');
    v_dia_mes := nullif(v_in->>'day_of_month', '')::int;
    v_data := nullif(v_in->>'fixed_date', '')::date;
    v_duracao := coalesce(nullif(v_in->>'duration_minutes', '')::int, 30);
    v_flex := coalesce((v_in->>'flexible')::boolean, false);
    v_ativa := coalesce((v_in->>'active')::boolean, true);

    if v_id is null then
      insert into public.agenda_tasks (
        tenant_id, agenda_id, title, description, scheduled_time, duration_minutes, frequency,
        weekdays, day_of_month, fixed_date, sort, active, flexible, vigente_de)
      values (
        v_ag.tenant_id, p_agenda, btrim(v_in->>'title'), nullif(btrim(coalesce(v_in->>'description', '')), ''),
        nullif(v_in->>'scheduled_time', '')::time, v_duracao, v_freq,
        v_dias, v_dia_mes, v_data, coalesce((v_in->>'sort')::int, 0), v_ativa, v_flex,
        -- tarefa de data única vale no próprio dia, mesmo que antes da data
        case when v_freq = 'unica' and v_data is not null then least(v_desde, v_data) else v_desde end);
      continue;
    end if;

    select * into v_t from public.agenda_tasks where id = v_id;
    v_recorrencia_mudou :=
         v_t.frequency is distinct from v_freq
      or coalesce((select array_agg(x order by x) from unnest(v_t.weekdays) x), '{}') is distinct from v_dias
      or v_t.day_of_month is distinct from v_dia_mes
      or v_t.fixed_date is distinct from v_data
      or v_t.duration_minutes is distinct from v_duracao
      or v_t.flexible is distinct from v_flex
      or v_t.active is distinct from v_ativa;

    if not v_recorrencia_mudou or v_t.vigente_de >= v_desde then
      -- título, descrição, horário e ordem se corrigem no lugar; e a tarefa que
      -- só começa na data (ou depois) também, porque não tem passado a guardar
      update public.agenda_tasks
         set title = btrim(v_in->>'title'),
             description = nullif(btrim(coalesce(v_in->>'description', '')), ''),
             scheduled_time = nullif(v_in->>'scheduled_time', '')::time,
             duration_minutes = v_duracao, frequency = v_freq, weekdays = v_dias,
             day_of_month = v_dia_mes, fixed_date = v_data,
             sort = coalesce((v_in->>'sort')::int, v_t.sort), active = v_ativa, flexible = v_flex
       where id = v_id;
    else
      -- recorrência mudou: a versão antiga fica como era até a véspera, e a nova
      -- vale da data em diante; os registros da data em diante vão com ela
      update public.agenda_tasks set vigente_ate = v_desde where id = v_id;
      insert into public.agenda_tasks (
        tenant_id, agenda_id, title, description, scheduled_time, duration_minutes, frequency,
        weekdays, day_of_month, fixed_date, sort, active, flexible, vigente_de)
      values (
        v_ag.tenant_id, p_agenda, btrim(v_in->>'title'), nullif(btrim(coalesce(v_in->>'description', '')), ''),
        nullif(v_in->>'scheduled_time', '')::time, v_duracao, v_freq,
        v_dias, v_dia_mes, v_data, coalesce((v_in->>'sort')::int, v_t.sort), v_ativa, v_flex, v_desde)
      returning id into v_novo;
      update public.agenda_logs set task_id = v_novo where task_id = v_id and log_date >= v_desde;
    end if;
  end loop;
end;
$function$;

-- AGENTS.md: SECURITY DEFINER fora do alcance da chave pública
revoke execute on function public.agenda_salvar_tarefas(uuid, jsonb, date) from public, anon;
grant execute on function public.agenda_salvar_tarefas(uuid, jsonb, date) to authenticated;

notify pgrst, 'reload schema';
