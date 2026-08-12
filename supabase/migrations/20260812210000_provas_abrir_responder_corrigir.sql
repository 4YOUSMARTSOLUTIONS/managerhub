-- Provas: abrir, responder, enviar, corrigir e reabrir.
--
-- Tudo passa por função porque nenhuma das tabelas de tentativa tem policy de
-- escrita: quem responde não pode escrever a própria nota, e quem corrige não
-- pode reescrever a resposta. Cada regra abaixo existe porque a alternativa era
-- confiar na tela.
--
-- A conclusão do treinamento sai da função voltada ao aluno e vira um miolo
-- interno (`treinamento_concluir_interno`), sem verificação de dono. A razão é
-- a correção manual: quem aprova a dissertativa é o instrutor, e a conclusão
-- que vem daí é do ALUNO, não de quem corrigiu. O miolo é revogado até de
-- `authenticated`; só outra SECURITY DEFINER o alcança.

-- Tentativa extra é de UMA PESSOA. Somar no teto do exame liberaria uma
-- tentativa a mais para todo mundo que ainda vai fazer a prova, inclusive quem
-- nunca reprovou.
alter table public.training_enrollments
  add column extra_attempts smallint not null default 0
  constraint training_enrollments_extra_ok check (extra_attempts >= 0);

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

  return (select c.code from public.training_certificates c where c.enrollment_id = p_enrollment);
end;
$$;

-- helper interno: nem o app chama
revoke execute on function public.treinamento_concluir_interno(uuid, numeric) from public, anon, authenticated;

/**
 * Conclusão pedida pelo próprio aluno (treinamento sem prova, ou com a prova já
 * aprovada). Confere dono, conteúdo obrigatório e prova, e delega o resto.
 */
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
begin
  select e.* into v_m from public.training_enrollments e where e.id = p_enrollment;
  if v_m.id is null or v_m.user_id <> (select auth.uid()) then
    raise exception 'Esta matrícula não é sua.';
  end if;
  if v_m.status = 'concluido' then
    return (select c.code from public.training_certificates c where c.enrollment_id = p_enrollment);
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

  -- curso com prova só conclui pela prova: sem isto, bastaria clicar em
  -- concluir para pular a avaliação inteira
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

-- ------------------------------------------------------------------ abrir
/**
 * Abre uma tentativa e devolve o id.
 *
 * O snapshot é montado aqui, e é o que o candidato vai ver: as questões sem o
 * gabarito, já embaralhadas se o exame pedir. O gabarito da MESMA prova vai
 * para `answer_key`, que a coluna protege.
 *
 * Tentativa em andamento não gera outra: recarregar a página, cair a conexão ou
 * abrir em outra aba continua a mesma prova, com o mesmo prazo.
 */
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
begin
  select e.* into v_m from public.training_enrollments e where e.id = p_enrollment;
  if v_m.id is null or v_m.user_id <> (select auth.uid()) then
    raise exception 'Esta matrícula não é sua.';
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

  -- prazo estourado em tentativa antiga fecha agora, antes de qualquer decisão
  -- sobre tentativas restantes
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

-- --------------------------------------------------------------- responder
/** Grava a resposta de uma questão. Fora do prazo, não grava. */
create or replace function public.prova_responder(
  p_attempt uuid, p_question uuid, p_answer jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_a record;
begin
  select a.* into v_a from public.training_exam_attempts a where a.id = p_attempt;
  if v_a.id is null or v_a.user_id <> (select auth.uid()) then
    raise exception 'Esta tentativa não é sua.';
  end if;
  if v_a.status <> 'em_andamento' then
    raise exception 'Esta tentativa já foi enviada.';
  end if;
  if v_a.deadline_at is not null and v_a.deadline_at < now() then
    perform public.prova_encerrar(p_attempt, true);
    raise exception 'O tempo da avaliação terminou.';
  end if;
  if not (v_a.answer_key ? p_question::text) then
    raise exception 'Questão fora desta prova.';
  end if;

  insert into public.training_exam_answers (tenant_id, attempt_id, question_id, answer)
  values (v_a.tenant_id, p_attempt, p_question, p_answer)
  on conflict (attempt_id, question_id)
    do update set answer = excluded.answer, answered_at = now();
end;
$$;

revoke execute on function public.prova_responder(uuid, uuid, jsonb) from public, anon;
grant execute on function public.prova_responder(uuid, uuid, jsonb) to authenticated;

-- ----------------------------------------------------------------- encerrar
/**
 * Corrige o que é objetivo e fecha (ou manda para correção humana).
 *
 * `p_automatico` distingue o envio do candidato do encerramento por prazo: só o
 * primeiro respeita o tempo mínimo. Quem ficou sem tempo não é obrigado a
 * esperar mais.
 *
 * Questão sem resposta entra como errada, com linha gravada: "não respondeu" é
 * informação, e some se a ausência da linha for o único registro.
 */
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
      -- sem gabarito: fica para a correção humana, com a linha já criada
      insert into public.training_exam_answers (tenant_id, attempt_id, question_id, answer)
      values (v_a.tenant_id, p_attempt, v_q.qid::uuid, null)
      on conflict (attempt_id, question_id) do nothing;
    else
      select ans.answer into v_resp from public.training_exam_answers ans
       where ans.attempt_id = p_attempt and ans.question_id = v_q.qid::uuid;

      -- comparação por CONJUNTO ordenado: em múltipla seleção a ordem em que a
      -- pessoa clicou não pode mudar o resultado
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
                  then 'aguardando_correcao' else 'em_andamento' end
   where id = p_attempt;

  -- a matrícula acompanha: quem enviou e espera correção não está em falta
  update public.training_enrollments
     set status = 'aguardando_correcao', updated_at = now()
   where id = v_a.enrollment_id
     and exists (select 1 from public.training_exam_attempts a
                  where a.id = p_attempt and a.status = 'aguardando_correcao');

  perform public.prova_finalizar(p_attempt);
end;
$$;

revoke execute on function public.prova_encerrar(uuid, boolean) from public, anon, authenticated;

/** Fecha a nota quando não há mais nada pendente de correção. */
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
    return; -- ainda tem dissertativa na fila
  end if;

  select x.* into v_exam from public.training_exams x where x.id = v_a.exam_id;

  select sum((value->>'weight')::numeric) into v_total from jsonb_each(v_a.answer_key);
  select coalesce(sum(ans.score), 0) into v_obtido
    from public.training_exam_answers ans where ans.attempt_id = p_attempt;

  v_nota := case when coalesce(v_total, 0) = 0 then 0
                 else round((v_obtido / v_total) * 100, 2) end;
  v_passou := v_nota >= v_exam.passing_score;

  update public.training_exam_attempts
     set status = case when v_passou then 'aprovado' else 'reprovado' end,
         score = v_nota, passed = v_passou, graded_at = now(),
         submitted_at = coalesce(submitted_at, now())
   where id = p_attempt;

  if v_passou then
    perform public.treinamento_concluir_interno(v_a.enrollment_id, v_nota);
  else
    select count(*) into v_tentativas
      from public.training_exam_attempts a where a.enrollment_id = v_a.enrollment_id;
    -- só vira reprovado de fato quando não sobra tentativa: com tentativa
    -- restante, a matrícula continua pendente e cobrável. O teto é o do exame
    -- mais as liberações desta pessoa.
    update public.training_enrollments m
       set status = case when v_exam.max_attempts is not null
                          and v_tentativas >= v_exam.max_attempts + m.extra_attempts
                         then 'reprovado' else 'em_andamento' end,
           score = v_nota, updated_at = now()
     where m.id = v_a.enrollment_id;
  end if;
end;
$$;

revoke execute on function public.prova_finalizar(uuid) from public, anon, authenticated;

/** Envio pelo candidato. */
create or replace function public.prova_enviar(p_attempt uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_a record;
begin
  select a.* into v_a from public.training_exam_attempts a where a.id = p_attempt;
  if v_a.id is null or v_a.user_id <> (select auth.uid()) then
    raise exception 'Esta tentativa não é sua.';
  end if;
  -- prazo vencido: encerra como automático, sem exigir o tempo mínimo
  perform public.prova_encerrar(
    p_attempt, v_a.deadline_at is not null and v_a.deadline_at < now());
end;
$$;

revoke execute on function public.prova_enviar(uuid) from public, anon;
grant execute on function public.prova_enviar(uuid) to authenticated;

-- ----------------------------------------------------------------- corrigir
/** Correção da dissertativa por quem gere o treinamento. */
create or replace function public.prova_corrigir(
  p_answer uuid, p_score numeric, p_feedback text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ans record;
  v_a record;
  v_peso numeric;
begin
  select ans.* into v_ans from public.training_exam_answers ans where ans.id = p_answer;
  if v_ans.id is null then
    raise exception 'Resposta não encontrada.';
  end if;
  select a.* into v_a from public.training_exam_attempts a where a.id = v_ans.attempt_id;

  if not exists (select 1 from public.training_exams x
                  where x.id = v_a.exam_id and public.pode_gerir_treinamento(x.training_id)) then
    raise exception 'Sem permissão para corrigir esta avaliação.';
  end if;

  v_peso := (v_a.answer_key->(v_ans.question_id::text)->>'weight')::numeric;
  if p_score < 0 or p_score > v_peso then
    raise exception 'A nota da questão vai de 0 a %.', v_peso;
  end if;

  update public.training_exam_answers
     set score = p_score,
         correct = (p_score >= v_peso),
         feedback = p_feedback,
         graded_by = (select auth.uid()),
         graded_at = now()
   where id = p_answer;

  perform public.prova_finalizar(v_ans.attempt_id);
end;
$$;

revoke execute on function public.prova_corrigir(uuid, numeric, text) from public, anon;
grant execute on function public.prova_corrigir(uuid, numeric, text) to authenticated;

-- ----------------------------------------------------------------- reabrir
/**
 * Libera nova tentativa depois de esgotadas.
 *
 * Não apaga as tentativas anteriores: o histórico de reprovação é justamente o
 * que justifica a reabertura. Sobe o teto do candidato registrando uma
 * liberação, então a decisão fica auditável.
 */
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
         status = case when status = 'reprovado' then 'em_andamento' else status end,
         updated_at = now()
   where id = p_enrollment;
end;
$$;

revoke execute on function public.prova_reabrir(uuid) from public, anon;
grant execute on function public.prova_reabrir(uuid) to authenticated;

notify pgrst, 'reload schema';
