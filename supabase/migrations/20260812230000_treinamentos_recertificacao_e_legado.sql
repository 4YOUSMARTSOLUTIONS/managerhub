-- Treinamentos, leva 5: recertificação automática, avisos e histórico legado.
--
-- RECERTIFICAÇÃO. Cada ciclo é uma matrícula NOVA, nunca a antiga reaberta:
-- sobrescrever apagaria o que a NR-1 manda guardar por cinco anos. O ciclo
-- seguinte abre quando a janela de antecipação começa (`expires_at -
-- antecipacao_dias`), e o prazo dele é o próprio vencimento do ciclo anterior.
--
-- Quem já se moveu não é recertificado à toa: se a matrícula veio de regra e a
-- matriz de hoje não alcança mais a pessoa, o ciclo não abre. Matrícula manual
-- ou importada segue reciclando, porque ali quem decidiu foi uma pessoa.
--
-- AVISOS. Um por matrícula, carimbado em `due_notified_at`. Sem o carimbo, uma
-- pendência vencida encheria o sino todo santo dia até alguém fazer o curso, e
-- notificação que sempre chega é notificação que ninguém lê.
--
-- HISTÓRICO LEGADO. Empresa que entra no sistema já tem gente treinada, e
-- começar do zero significaria mostrar 100% de inadimplência no primeiro dia e
-- convocar todo mundo de novo. `training_importar_historico` grava a conclusão
-- com a DATA ANTIGA, e o vencimento sai dela, não de hoje: um curso anual feito
-- em março vence em março, e não em agosto porque foi digitado hoje.

alter table public.training_enrollments
  add column due_notified_at date;

-- ------------------------------------------------------------ recertificação
create or replace function public.training_recertificar()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_novas integer := 0;
  r record;
  v_id uuid;
begin
  for r in
    select e.id, e.tenant_id, e.training_id, e.user_id, e.cycle_no, e.mandatory,
           e.expires_at, t.name as training_name, t.antecipacao_dias,
           m.position_id, m.department_id, m.subdepartment_id,
           (select mu.unit_id from public.membership_units mu
             where mu.membership_id = m.id order by mu.unit_id limit 1) as unit_id,
           e.origin
      from public.training_enrollments e
      join public.trainings t on t.id = e.training_id
      join public.memberships m on m.tenant_id = e.tenant_id and m.user_id = e.user_id
     where e.status = 'concluido'
       and e.expires_at is not null
       and t.active and t.deleted_at is null
       and m.is_active and m.dismissed_at is null
       -- a janela de antecipação já abriu
       and (e.expires_at - coalesce(t.antecipacao_dias, 60)) <= current_date
       -- e ainda não existe ciclo seguinte vivo
       and not exists (
         select 1 from public.training_enrollments n
          where n.training_id = e.training_id
            and n.user_id = e.user_id
            and n.cycle_no > e.cycle_no
            and n.status not in ('cancelado', 'nao_aplicavel'))
       -- veio de regra? então a matriz de hoje precisa continuar alcançando a
       -- pessoa. Quem mudou de cargo não recicla o curso do cargo antigo.
       and (
         e.origin <> 'regra'
         or exists (
           select 1 from public.training_assignment_rules ar
            where ar.training_id = e.training_id and ar.active
              and (
                (ar.kind = 'user' and ar.ref_id = m.user_id)
                or (ar.kind = 'position' and ar.ref_id = m.position_id)
                or (ar.kind = 'department' and ar.ref_id = m.department_id)
                or (ar.kind = 'subdepartment' and ar.ref_id = m.subdepartment_id)
                or (ar.kind = 'unit' and exists (
                      select 1 from public.membership_units mu
                       where mu.membership_id = m.id and mu.unit_id = ar.ref_id))
              ))
       )
  loop
    insert into public.training_enrollments (
      tenant_id, training_id, user_id, cycle_no, origin, status, mandatory,
      due_at, expires_at,
      snap_position_id, snap_department_id, snap_subdepartment_id, snap_unit_id
    ) values (
      r.tenant_id, r.training_id, r.user_id, r.cycle_no + 1, 'recertificacao',
      'nao_iniciado', r.mandatory,
      -- o prazo do ciclo novo é o vencimento do anterior: reciclar depois disso
      -- já é atraso
      r.expires_at,
      -- carrega o vencimento antigo para a DATA-BASE FIXA valer na conclusão
      r.expires_at,
      r.position_id, r.department_id, r.subdepartment_id, r.unit_id
    ) returning id into v_id;

    perform public.notify_users(
      r.tenant_id, array[r.user_id], 'training_reciclagem',
      'Reciclagem disponível',
      r.training_name || ': seu certificado vence em ' || to_char(r.expires_at, 'DD/MM/YYYY') || '.',
      null, null);

    v_novas := v_novas + 1;
  end loop;

  return v_novas;
end;
$$;

revoke execute on function public.training_recertificar() from public, anon, authenticated;

-- ------------------------------------------------------------------- avisos
create or replace function public.training_avisos(p_antecedencia integer default 7)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select e.id, e.tenant_id, e.user_id, e.due_at, t.name as training_name
      from public.training_enrollments e
      join public.trainings t on t.id = e.training_id
     where e.mandatory
       and e.status in ('nao_iniciado', 'em_andamento')
       and e.due_at is not null
       and e.due_at <= current_date + p_antecedencia
       and e.due_notified_at is null
       and t.active and t.deleted_at is null
  loop
    perform public.notify_users(
      r.tenant_id, array[r.user_id], 'training_prazo',
      case when r.due_at < current_date then 'Treinamento com prazo vencido'
           when r.due_at = current_date then 'Treinamento vence hoje'
           else 'Treinamento perto do prazo' end,
      r.training_name || ': prazo em ' || to_char(r.due_at, 'DD/MM/YYYY') || '.',
      null, null);

    update public.training_enrollments set due_notified_at = current_date where id = r.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.training_avisos(integer) from public, anon, authenticated;

-- --------------------------------------------------------- fechamento diário
/**
 * A rotina que mantém a matriz verdadeira sem ninguém clicar em nada.
 *
 * A materialização roda por empresa, e não numa consulta só, porque um erro em
 * um cliente não pode derrubar o fechamento dos outros. `exception when others`
 * segue para a próxima empresa; a alternativa (abortar tudo) transformaria um
 * dado ruim de um tenant em ausência de recertificação para todos.
 */
create or replace function public.training_fechamento_diario()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_total integer := 0;
  t record;
begin
  for t in select id from public.tenants where status = 'active' loop
    begin
      v_total := v_total + coalesce(public.training_materialize_exec(t.id), 0);
    exception when others then
      raise warning 'materializacao de treinamentos falhou no tenant %: %', t.id, sqlerrm;
    end;
  end loop;

  v_total := v_total + coalesce(public.training_recertificar(), 0);
  perform public.training_avisos();
  return v_total;
end;
$$;

revoke execute on function public.training_fechamento_diario() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule('treinamentos-fechamento', '30 5 * * *', 'select public.training_fechamento_diario();');

-- -------------------------------------------------------------- legado
/**
 * Importa uma conclusão antiga, com a data de quando aconteceu.
 *
 * Não passa por `treinamento_concluir_interno` porque aquela função carimba
 * `now()`, e aqui a data é justamente o que não pode ser de hoje. O ciclo entra
 * como `importado` e recebe certificado com o mesmo retrato, para o histórico
 * ficar consultável do mesmo jeito que o que nasceu no sistema.
 */
create or replace function public.training_importar_historico(
  p_training uuid,
  p_user uuid,
  p_completed date,
  p_score numeric default null,
  p_instructor text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_t record;
  v_tenant uuid;
  v_expira date;
  v_ciclo smallint;
  v_id uuid;
  v_nome text;
  v_code text;
begin
  select t.* into v_t from public.trainings t where t.id = p_training and t.deleted_at is null;
  if v_t.id is null then
    raise exception 'Treinamento não encontrado.';
  end if;
  if not public.pode_gerir_treinamento(p_training) then
    raise exception 'Sem permissão para importar histórico deste treinamento.';
  end if;
  if p_completed > current_date then
    raise exception 'A data de conclusão não pode estar no futuro.';
  end if;
  v_tenant := v_t.tenant_id;

  if not exists (select 1 from public.memberships m
                  where m.tenant_id = v_tenant and m.user_id = p_user) then
    raise exception 'Colaborador não pertence a esta empresa.';
  end if;

  -- o vencimento conta da data REAL da conclusão: um curso anual feito há 11
  -- meses precisa aparecer como "vence em 1 mês", não como recém-feito
  if v_t.validade_meses is null or v_t.validade_meses <= 0 then
    v_expira := null;
  else
    v_expira := (p_completed + (v_t.validade_meses || ' months')::interval)::date;
  end if;

  select coalesce(max(e.cycle_no), 0) + 1 into v_ciclo
    from public.training_enrollments e
   where e.training_id = p_training and e.user_id = p_user;

  insert into public.training_enrollments (
    tenant_id, training_id, user_id, cycle_no, origin, status, mandatory,
    started_at, completed_at, expires_at, score,
    snap_position_id, snap_department_id, snap_subdepartment_id, snap_unit_id
  )
  select
    v_tenant, p_training, p_user, v_ciclo, 'importado', 'concluido', true,
    p_completed, p_completed, v_expira, p_score,
    m.position_id, m.department_id, m.subdepartment_id,
    (select mu.unit_id from public.membership_units mu
      where mu.membership_id = m.id order by mu.unit_id limit 1)
  from public.memberships m
  where m.tenant_id = v_tenant and m.user_id = p_user
  limit 1
  returning id into v_id;

  select coalesce(p.full_name, p.email) into v_nome
    from public.profiles p where p.id = p_user;

  v_code := 'TR-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
  insert into public.training_certificates (
    tenant_id, enrollment_id, code, user_name, training_name,
    workload_minutes, content_summary, instructor_name, completed_at, expires_at, score)
  values (
    v_tenant, v_id, v_code, coalesce(v_nome, 'Não identificado'), v_t.name,
    v_t.workload_minutes, v_t.description, p_instructor, p_completed, v_expira, p_score)
  on conflict (enrollment_id) do nothing;

  return v_id;
end;
$$;

revoke execute on function public.training_importar_historico(uuid, uuid, date, numeric, text) from public, anon;
grant execute on function public.training_importar_historico(uuid, uuid, date, numeric, text) to authenticated;

notify pgrst, 'reload schema';
