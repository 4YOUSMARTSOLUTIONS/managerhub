-- Iniciar e concluir o treinamento: a regra mora no banco, não na tela.
--
-- A RLS de `training_enrollments` só dá escrita a quem GERE o treinamento, e
-- `training_certificates` não tem policy de insert nenhuma (de propósito:
-- certificado não é linha que o app escreve à vontade). Quem faz o treinamento
-- precisa mesmo assim mover a própria matrícula, e a saída certa não é afrouxar
-- a policy.
--
-- Afrouxar seria pior do que parece. `authenticated` tem grant de UPDATE em
-- NÍVEL DE TABELA, então uma policy que deixasse o aluno mexer na própria linha
-- deixaria junto `expires_at`, `due_at` e `score`: bastaria um PostgREST na mão
-- para o funcionário adiar o próprio vencimento. Com a função, a transição é a
-- única coisa que ele consegue pedir.
--
-- A conferência de "concluiu tudo que era obrigatório" também desce para cá. Na
-- action, ela responde "a tela achou que terminou"; aqui, responde "o sistema
-- tem como provar que terminou", que é o que a fiscalização cobra.

create or replace function public.treinamento_iniciar(p_enrollment uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_user uuid;
begin
  select user_id into v_user
    from public.training_enrollments where id = p_enrollment;

  if v_user is null or v_user <> (select auth.uid()) then
    raise exception 'Esta matrícula não é sua.';
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

/**
 * Conclui a matrícula e emite o certificado.
 *
 * Recusa se faltar material obrigatório: a lista do que falta volta na
 * mensagem, para a tela dizer o que ainda é preciso fazer em vez de um "não
 * pode" seco.
 *
 * O vencimento segue a DATA-BASE FIXA: vencimento anterior + periodicidade.
 * Reciclar antes da hora não encurta o ciclo seguinte, senão quem se antecipa
 * seria punido com um prazo menor. `+ interval` já ajusta o dia 31 para o
 * último dia do mês curto.
 */
create or replace function public.treinamento_concluir(p_enrollment uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_m record;
  v_curso record;
  v_falta text;
  v_base date;
  v_expira date;
  v_code text;
  v_nome text;
  v_instrutor text;
begin
  select e.* into v_m from public.training_enrollments e where e.id = p_enrollment;
  if v_m.id is null or v_m.user_id <> (select auth.uid()) then
    raise exception 'Esta matrícula não é sua.';
  end if;

  -- já concluída: devolve o certificado que existe, sem emitir outro
  if v_m.status = 'concluido' then
    return (select c.code from public.training_certificates c where c.enrollment_id = p_enrollment);
  end if;

  select t.* into v_curso from public.trainings t where t.id = v_m.training_id;

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
    v_curso.workload_minutes, v_curso.description, v_instrutor, now(), v_expira, v_m.score)
  on conflict (enrollment_id) do nothing;

  return (select c.code from public.training_certificates c where c.enrollment_id = p_enrollment);
end;
$$;

revoke execute on function public.treinamento_concluir(uuid) from public, anon;
grant execute on function public.treinamento_concluir(uuid) to authenticated;

notify pgrst, 'reload schema';
