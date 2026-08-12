-- Notificação disparada pelo SISTEMA, sem sessão de usuário.
--
-- `notify_users` guarda com `is_tenant_member(p_tenant)`, e essa guarda olha o
-- usuário CORRENTE. Faz todo sentido: a função é chamável por `authenticated`,
-- e sem ela qualquer pessoa logada escreveria notificação em qualquer empresa.
--
-- O problema é que ela é chamada também de dentro do fechamento diário, que
-- roda no pg_cron, sem JWT. Ali `auth.uid()` é nulo, `is_tenant_member` devolve
-- falso e o insert simplesmente não acontece: nenhuma linha, nenhum erro. Na
-- prática, o aviso de prazo e o de reciclagem que a leva 5 do módulo criou
-- nunca chegariam ao sino em produção, e ninguém perceberia, porque a função
-- retorna a contagem do que ELA processou, não do que foi notificado.
--
-- (Passou nos testes daquela leva por um detalhe cruel: a transação de teste
-- ainda tinha `request.jwt.claims` de uma impersonação anterior, então havia
-- um usuário corrente onde o cron não terá nenhum.)
--
-- A saída não é afrouxar a guarda da função pública, é ter uma porta de
-- serviço: `notify_users_sistema` não pergunta quem está chamando porque o
-- chamador é o próprio banco. Ela é revogada até de `authenticated`, então a
-- única forma de alcançá-la é de dentro de outra SECURITY DEFINER.

create or replace function public.notify_users_sistema(
  p_tenant uuid, p_users uuid[], p_type text, p_title text, p_body text
)
returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into public.notifications (tenant_id, user_id, type, title, body)
  select distinct p_tenant, u, p_type, p_title, p_body
  from unnest(p_users) u
  where u is not null
    -- a única checagem que sobra, e a que importa aqui: destinatário existe
    -- mesmo dentro da empresa. O "quem chama" foi substituído pelo "para quem".
    and exists (
      select 1 from public.memberships m
       where m.user_id = u and m.tenant_id = p_tenant);
$$;

revoke execute on function public.notify_users_sistema(uuid, uuid[], text, text, text)
  from public, anon, authenticated;

-- ------------------------------------------------- recertificação e avisos
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
       and (e.expires_at - coalesce(t.antecipacao_dias, 60)) <= current_date
       and not exists (
         select 1 from public.training_enrollments n
          where n.training_id = e.training_id
            and n.user_id = e.user_id
            and n.cycle_no > e.cycle_no
            and n.status not in ('cancelado', 'nao_aplicavel'))
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
      r.expires_at,
      r.expires_at,
      r.position_id, r.department_id, r.subdepartment_id, r.unit_id
    ) returning id into v_id;

    perform public.notify_users_sistema(
      r.tenant_id, array[r.user_id], 'training_reciclagem',
      'Reciclagem disponível',
      r.training_name || ': seu certificado vence em ' || to_char(r.expires_at, 'DD/MM/YYYY') || '.');

    v_novas := v_novas + 1;
  end loop;

  return v_novas;
end;
$$;

revoke execute on function public.training_recertificar() from public, anon, authenticated;

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
    perform public.notify_users_sistema(
      r.tenant_id, array[r.user_id], 'training_prazo',
      case when r.due_at < current_date then 'Treinamento com prazo vencido'
           when r.due_at = current_date then 'Treinamento vence hoje'
           else 'Treinamento perto do prazo' end,
      r.training_name || ': prazo em ' || to_char(r.due_at, 'DD/MM/YYYY') || '.');

    update public.training_enrollments set due_notified_at = current_date where id = r.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.training_avisos(integer) from public, anon, authenticated;

-- --------------------------------------------- liberação do passo seguinte
-- Mesma troca: o destinatário é o dono da matrícula, decidido por dados. Quem
-- chamou a conclusão (o próprio aluno, ou o instrutor ao corrigir uma prova)
-- não deveria decidir se o aviso sai.
create or replace function public.treinamento_concluir_interno(
  p_enrollment uuid, p_score numeric default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_m record;
  v_curso record;
  v_base date;
  v_expira date;
  v_code text;
  v_nome text;
  v_instrutor text;
  v_prox record;
begin
  select e.* into v_m from public.training_enrollments e where e.id = p_enrollment;
  if v_m.id is null then
    raise exception 'Matrícula não encontrada.';
  end if;
  if v_m.status = 'concluido' then
    return (select c.code from public.training_certificates c where c.enrollment_id = p_enrollment);
  end if;

  select t.* into v_curso from public.trainings t where t.id = v_m.training_id;

  v_base := greatest(coalesce(v_m.expires_at, current_date), current_date);
  if v_curso.validade_meses is null or v_curso.validade_meses <= 0 then
    v_expira := null;
  else
    v_expira := (v_base + (v_curso.validade_meses || ' months')::interval)::date;
  end if;

  update public.training_enrollments
     set status = 'concluido',
         completed_at = now(),
         expires_at = v_expira,
         score = coalesce(p_score, score),
         updated_at = now()
   where id = p_enrollment;

  select coalesce(p.full_name, p.email) into v_nome
    from public.profiles p where p.id = v_m.user_id;

  if v_m.session_id is not null then
    select coalesce(p.full_name, p.email) into v_instrutor
      from public.training_sessions s
      join public.profiles p on p.id = s.instructor_id
     where s.id = v_m.session_id;
  end if;

  v_code := 'TR-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));

  insert into public.training_certificates (
    tenant_id, enrollment_id, code, user_name, training_name,
    workload_minutes, content_summary, instructor_name, completed_at, expires_at, score)
  values (
    v_m.tenant_id, p_enrollment, v_code, coalesce(v_nome, 'Não identificado'), v_curso.name,
    v_curso.workload_minutes, v_curso.description, v_instrutor, now(), v_expira,
    coalesce(p_score, v_m.score))
  on conflict (enrollment_id) do nothing;

  for v_prox in
    select e2.id, t2.name as curso, p.name as trilha, e2.tenant_id, e2.user_id
      from public.training_enrollments e2
      join public.trainings t2 on t2.id = e2.training_id
      join public.training_paths p on p.id = e2.path_id
     where e2.user_id = v_m.user_id
       and e2.path_id is not null
       and e2.status = 'nao_iniciado'
       and e2.id <> p_enrollment
       and exists (
         select 1
           from public.training_path_steps s_meu
           join public.training_path_steps s_prox
             on s_prox.path_id = s_meu.path_id and s_prox.training_id = e2.training_id
          where s_meu.path_id = e2.path_id
            and s_meu.training_id = v_m.training_id
            and s_prox.sort > s_meu.sort)
       and public.trilha_passo_bloqueado(e2.id) is null
  loop
    perform public.notify_users_sistema(
      v_prox.tenant_id, array[v_prox.user_id], 'training_trilha',
      'Próximo treinamento liberado',
      v_prox.trilha || ': "' || v_prox.curso || '" já pode ser feito.');
  end loop;

  return (select c.code from public.training_certificates c where c.enrollment_id = p_enrollment);
end;
$$;

revoke execute on function public.treinamento_concluir_interno(uuid, numeric) from public, anon, authenticated;

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
