-- Conserta o UPDATE de coluna enum a partir de CASE.
--
-- `case when ... then 'aguardando_correcao' else 'em_andamento' end` tem os dois
-- ramos como literais de tipo desconhecido, e o Postgres resolve o CASE inteiro
-- como `text` ANTES de olhar o tipo da coluna de destino. O resultado é
-- "column status is of type training_attempt_status but expression is of type
-- text", em tempo de execução, não na criação da função. Basta tipar um dos
-- ramos que o outro segue junto.
--
-- Apareceu no primeiro envio de prova testado; a mesma armadilha estava em três
-- lugares, e é por isso que os três voltam inteiros aqui.

create or replace function public.prova_encerrar(p_attempt uuid, p_automatico boolean default false)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_a record;
  v_exam record;
  v_q record;
  v_resp jsonb;
  v_acertou boolean;
begin
  select a.* into v_a from public.training_exam_attempts a where a.id = p_attempt;
  if v_a.id is null or v_a.status <> 'em_andamento' then
    return;
  end if;
  select x.* into v_exam from public.training_exams x where x.id = v_a.exam_id;

  if not p_automatico and v_exam.min_minutes > 0
     and now() < v_a.started_at + (v_exam.min_minutes || ' minutes')::interval then
    raise exception 'A avaliação só pode ser enviada após % minutos.', v_exam.min_minutes;
  end if;

  for v_q in select key as qid, value as meta from jsonb_each(v_a.answer_key) loop
    if (v_q.meta->>'kind') = 'dissertativa' then
      insert into public.training_exam_answers (tenant_id, attempt_id, question_id, answer)
      values (v_a.tenant_id, p_attempt, v_q.qid::uuid, null)
      on conflict (attempt_id, question_id) do nothing;
    else
      select ans.answer into v_resp from public.training_exam_answers ans
       where ans.attempt_id = p_attempt and ans.question_id = v_q.qid::uuid;

      v_acertou := coalesce(
        (select array(select jsonb_array_elements_text(coalesce(v_resp, '[]'::jsonb)) order by 1))
        = (select array(select jsonb_array_elements_text(coalesce(v_q.meta->'correct', '[]'::jsonb)) order by 1)),
        false);

      insert into public.training_exam_answers (
        tenant_id, attempt_id, question_id, answer, correct, score, graded_at)
      values (
        v_a.tenant_id, p_attempt, v_q.qid::uuid, v_resp, v_acertou,
        case when v_acertou then (v_q.meta->>'weight')::numeric else 0 end, now())
      on conflict (attempt_id, question_id) do update
        set correct = excluded.correct, score = excluded.score, graded_at = now();
    end if;
  end loop;

  update public.training_exam_attempts
     set submitted_at = now(),
         status = case when exists (
                    select 1 from public.training_exam_answers ans
                     where ans.attempt_id = p_attempt and ans.score is null)
                  then 'aguardando_correcao'::public.training_attempt_status
                  else 'em_andamento'::public.training_attempt_status end
   where id = p_attempt;

  update public.training_enrollments
     set status = 'aguardando_correcao', updated_at = now()
   where id = v_a.enrollment_id
     and exists (select 1 from public.training_exam_attempts a
                  where a.id = p_attempt and a.status = 'aguardando_correcao');

  perform public.prova_finalizar(p_attempt);
end;
$$;

revoke execute on function public.prova_encerrar(uuid, boolean) from public, anon, authenticated;

create or replace function public.prova_finalizar(p_attempt uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_a record;
  v_exam record;
  v_total numeric;
  v_obtido numeric;
  v_nota numeric;
  v_passou boolean;
  v_tentativas smallint;
begin
  select a.* into v_a from public.training_exam_attempts a where a.id = p_attempt;
  if v_a.id is null or v_a.status in ('aprovado', 'reprovado') then
    return;
  end if;
  if exists (select 1 from public.training_exam_answers ans
              where ans.attempt_id = p_attempt and ans.score is null) then
    return;
  end if;

  select x.* into v_exam from public.training_exams x where x.id = v_a.exam_id;

  select sum((value->>'weight')::numeric) into v_total from jsonb_each(v_a.answer_key);
  select coalesce(sum(ans.score), 0) into v_obtido
    from public.training_exam_answers ans where ans.attempt_id = p_attempt;

  v_nota := case when coalesce(v_total, 0) = 0 then 0
                 else round((v_obtido / v_total) * 100, 2) end;
  v_passou := v_nota >= v_exam.passing_score;

  update public.training_exam_attempts
     set status = case when v_passou then 'aprovado'::public.training_attempt_status
                       else 'reprovado'::public.training_attempt_status end,
         score = v_nota, passed = v_passou, graded_at = now(),
         submitted_at = coalesce(submitted_at, now())
   where id = p_attempt;

  if v_passou then
    perform public.treinamento_concluir_interno(v_a.enrollment_id, v_nota);
  else
    select count(*) into v_tentativas
      from public.training_exam_attempts a where a.enrollment_id = v_a.enrollment_id;
    update public.training_enrollments m
       set status = case when v_exam.max_attempts is not null
                          and v_tentativas >= v_exam.max_attempts + m.extra_attempts
                         then 'reprovado'::public.training_enrollment_status
                         else 'em_andamento'::public.training_enrollment_status end,
           score = v_nota, updated_at = now()
     where m.id = v_a.enrollment_id;
  end if;
end;
$$;

revoke execute on function public.prova_finalizar(uuid) from public, anon, authenticated;

create or replace function public.prova_reabrir(p_enrollment uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_m record;
begin
  select e.* into v_m from public.training_enrollments e where e.id = p_enrollment;
  if v_m.id is null then
    raise exception 'Matrícula não encontrada.';
  end if;
  if not (public.pode_gerir_treinamento(v_m.training_id)
          or public.has_tenant_role(v_m.tenant_id, '{owner,admin,hr}'::public.member_role[])) then
    raise exception 'Sem permissão para reabrir esta avaliação.';
  end if;

  update public.training_enrollments
     set extra_attempts = extra_attempts + 1,
         status = case when status = 'reprovado'
                       then 'em_andamento'::public.training_enrollment_status else status end,
         updated_at = now()
   where id = p_enrollment;
end;
$$;

revoke execute on function public.prova_reabrir(uuid) from public, anon;
grant execute on function public.prova_reabrir(uuid) to authenticated;

notify pgrst, 'reload schema';
