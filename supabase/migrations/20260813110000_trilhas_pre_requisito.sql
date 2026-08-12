-- Pré-requisito: o passo seguinte da trilha só abre com o anterior concluído.
--
-- A trava mora NO BANCO porque a tela não é o lugar de decidir o que pode ser
-- feito: quem tem a chave pública alcança as RPCs direto, e um cadeado que só
-- existe em React é decoração. As três portas por onde alguém entra num
-- treinamento passam a perguntar a mesma coisa antes de qualquer trabalho:
-- iniciar o conteúdo, abrir a prova e concluir.
--
-- `trilha_passo_bloqueado` devolve o NOME do curso que falta, e não um boolean.
-- Sai de graça na mesma consulta e é o que permite dizer "conclua a Integração
-- institucional antes deste" em vez de "bloqueado", que só gera chamado no RH.
--
-- Uma decisão que merece registro: conclusão VENCIDA satisfaz o pré-requisito.
-- A trilha ordena o aprendizado inicial; se a validade caducou, o assunto é a
-- reciclagem daquele curso, que tem ciclo próprio. Travar o passo 2 porque o
-- passo 1 venceu há dois anos misturaria as duas coisas e prenderia gente numa
-- ordem que já foi cumprida.

create or replace function public.trilha_passo_bloqueado(p_enrollment uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_m record;
  v_sort integer;
  v_falta text;
begin
  select e.id, e.user_id, e.training_id, e.path_id into v_m
    from public.training_enrollments e where e.id = p_enrollment;

  -- curso avulso não tem ordem para respeitar
  if v_m.id is null or v_m.path_id is null then
    return null;
  end if;

  -- o passo pode ter saído da trilha depois da matrícula nascer; nesse caso não
  -- há ordem a impor, e a matrícula segue como um curso qualquer
  select s.sort into v_sort
    from public.training_path_steps s
   where s.path_id = v_m.path_id and s.training_id = v_m.training_id;
  if v_sort is null then
    return null;
  end if;

  -- o primeiro anterior obrigatório que a pessoa ainda não cumpriu.
  -- `isento` conta como cumprido: a dispensa foi uma decisão deliberada de
  -- quem administra, e ignorá-la aqui a desfaria pela porta dos fundos.
  select t.name into v_falta
    from public.training_path_steps s
    join public.trainings t on t.id = s.training_id
   where s.path_id = v_m.path_id
     and s.sort < v_sort
     and s.required
     and t.active and t.deleted_at is null
     and not exists (
       select 1 from public.training_enrollments e2
        where e2.user_id = v_m.user_id
          and e2.training_id = s.training_id
          and e2.status in ('concluido', 'isento'))
   order by s.sort
   limit 1;

  return v_falta;
end;
$$;

revoke execute on function public.trilha_passo_bloqueado(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ iniciar
create or replace function public.treinamento_iniciar(p_enrollment uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid;
  v_bloq text;
begin
  select user_id into v_user
    from public.training_enrollments where id = p_enrollment;

  if v_user is null or v_user <> (select auth.uid()) then
    raise exception 'Esta matrícula não é sua.';
  end if;

  v_bloq := public.trilha_passo_bloqueado(p_enrollment);
  if v_bloq is not null then
    raise exception 'Conclua "%" antes deste treinamento.', v_bloq;
  end if;

  update public.training_enrollments
     set status = 'em_andamento',
         started_at = coalesce(started_at, now()),
         updated_at = now()
   where id = p_enrollment
     and status = 'nao_iniciado';
end;
$$;

revoke execute on function public.treinamento_iniciar(uuid) from public, anon;
grant execute on function public.treinamento_iniciar(uuid) to authenticated;

-- ----------------------------------------------------------------- concluir
create or replace function public.treinamento_concluir(p_enrollment uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_m record;
  v_falta text;
  v_exam uuid;
  v_bloq text;
begin
  select e.* into v_m from public.training_enrollments e where e.id = p_enrollment;
  if v_m.id is null or v_m.user_id <> (select auth.uid()) then
    raise exception 'Esta matrícula não é sua.';
  end if;
  if v_m.status = 'concluido' then
    return (select c.code from public.training_certificates c where c.enrollment_id = p_enrollment);
  end if;

  -- a ordem da trilha vem antes de tudo: sem isso, dava para pular o passo 1
  -- concluindo o passo 2 direto pela RPC
  v_bloq := public.trilha_passo_bloqueado(p_enrollment);
  if v_bloq is not null then
    raise exception 'Conclua "%" antes deste treinamento.', v_bloq;
  end if;

  select string_agg(m.title, ', ' order by m.sort) into v_falta
    from public.training_materials m
   where m.training_id = v_m.training_id
     and m.deleted_at is null
     and m.required
     and not exists (
       select 1 from public.training_material_progress p
        where p.enrollment_id = p_enrollment
          and p.material_id = m.id
          and p.completed_at is not null);

  if v_falta is not null then
    raise exception 'Ainda falta concluir: %.', v_falta;
  end if;

  select e.id into v_exam
    from public.training_exams e
   where e.training_id = v_m.training_id and e.active and e.deleted_at is null;

  if v_exam is not null and not exists (
    select 1 from public.training_exam_attempts a
     where a.enrollment_id = p_enrollment and a.status = 'aprovado')
  then
    raise exception 'Faça a avaliação para concluir este treinamento.';
  end if;

  return public.treinamento_concluir_interno(p_enrollment, null);
end;
$$;

revoke execute on function public.treinamento_concluir(uuid) from public, anon;
grant execute on function public.treinamento_concluir(uuid) to authenticated;

-- ------------------------------------------------------------- abrir a prova
create or replace function public.prova_iniciar(p_enrollment uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_m record;
  v_exam record;
  v_falta text;
  v_att uuid;
  v_no smallint;
  v_snapshot jsonb;
  v_key jsonb;
  v_bloq text;
begin
  select e.* into v_m from public.training_enrollments e where e.id = p_enrollment;
  if v_m.id is null or v_m.user_id <> (select auth.uid()) then
    raise exception 'Esta matrícula não é sua.';
  end if;

  v_bloq := public.trilha_passo_bloqueado(p_enrollment);
  if v_bloq is not null then
    raise exception 'Conclua "%" antes deste treinamento.', v_bloq;
  end if;

  select x.* into v_exam
    from public.training_exams x
   where x.training_id = v_m.training_id and x.active and x.deleted_at is null;
  if v_exam.id is null then
    raise exception 'Este treinamento não tem avaliação.';
  end if;

  if v_exam.starts_after_content then
    select string_agg(m.title, ', ' order by m.sort) into v_falta
      from public.training_materials m
     where m.training_id = v_m.training_id
       and m.deleted_at is null
       and m.required
       and not exists (
         select 1 from public.training_material_progress p
          where p.enrollment_id = p_enrollment and p.material_id = m.id
            and p.completed_at is not null);
    if v_falta is not null then
      raise exception 'Conclua o conteúdo antes da avaliação. Falta: %.', v_falta;
    end if;
  end if;

  for v_att in
    select a.id from public.training_exam_attempts a
     where a.enrollment_id = p_enrollment and a.status = 'em_andamento'
       and a.deadline_at is not null and a.deadline_at < now()
  loop
    perform public.prova_encerrar(v_att, true);
  end loop;

  select a.id into v_att from public.training_exam_attempts a
   where a.enrollment_id = p_enrollment and a.status = 'em_andamento' limit 1;
  if v_att is not null then
    return v_att;
  end if;

  if exists (select 1 from public.training_exam_attempts a
              where a.enrollment_id = p_enrollment and a.status = 'aprovado') then
    raise exception 'Você já foi aprovado nesta avaliação.';
  end if;

  select coalesce(max(a.attempt_no), 0) + 1 into v_no
    from public.training_exam_attempts a where a.enrollment_id = p_enrollment;

  if v_exam.max_attempts is not null
     and v_no > v_exam.max_attempts + coalesce(v_m.extra_attempts, 0) then
    raise exception 'Tentativas esgotadas. Procure quem responde pelo treinamento para liberar uma nova.';
  end if;

  with ordenadas as (
    select q.id, q.kind, q.statement, q.weight, q.correct,
           case when v_exam.shuffle_options and jsonb_array_length(q.options) > 0
                then (select jsonb_agg(o order by random()) from jsonb_array_elements(q.options) o)
                else q.options end as options,
           case when v_exam.shuffle_questions then random()::numeric else q.sort::numeric end as ord
      from public.training_exam_questions q
     where q.exam_id = v_exam.id and q.deleted_at is null
  )
  select
    jsonb_agg(jsonb_build_object(
      'id', o.id, 'kind', o.kind, 'statement', o.statement,
      'options', o.options, 'weight', o.weight) order by o.ord),
    jsonb_object_agg(o.id::text, jsonb_build_object(
      'kind', o.kind, 'correct', o.correct, 'weight', o.weight))
  into v_snapshot, v_key
  from ordenadas o;

  if v_snapshot is null then
    raise exception 'A avaliação ainda não tem questões cadastradas.';
  end if;

  insert into public.training_exam_attempts (
    tenant_id, exam_id, enrollment_id, user_id, attempt_no,
    questions_snapshot, answer_key, deadline_at)
  values (
    v_m.tenant_id, v_exam.id, p_enrollment, v_m.user_id, v_no,
    v_snapshot, v_key,
    case when v_exam.time_limit_minutes is null then null
         else now() + (v_exam.time_limit_minutes || ' minutes')::interval end)
  returning id into v_att;

  update public.training_enrollments
     set status = 'em_andamento', started_at = coalesce(started_at, now()), updated_at = now()
   where id = p_enrollment and status = 'nao_iniciado';

  return v_att;
end;
$$;

revoke execute on function public.prova_iniciar(uuid) from public, anon;
grant execute on function public.prova_iniciar(uuid) to authenticated;

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
