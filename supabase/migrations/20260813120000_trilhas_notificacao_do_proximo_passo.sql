-- Avisa quando o próximo passo da trilha libera.
--
-- Sem isto, a trilha depende de a pessoa voltar sozinha na tela para descobrir
-- que o passo seguinte abriu, e uma integração de quatro cursos morre no
-- segundo. O aviso sai no mesmo instante da conclusão, dentro da transação que
-- conclui: se a conclusão não valer, o aviso também não existe.
--
-- Só notifica o que REALMENTE liberou: reconsulta
-- `trilha_passo_bloqueado` para cada candidato, porque um passo pode ter dois
-- anteriores obrigatórios e concluir um deles não abre nada. Anunciar liberação
-- que não aconteceu é pior do que não anunciar.

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

  -- o que a conclusão acabou de destravar na trilha desta pessoa
  for v_prox in
    select e2.id, t2.name as curso, p.name as trilha, e2.tenant_id, e2.user_id
      from public.training_enrollments e2
      join public.trainings t2 on t2.id = e2.training_id
      join public.training_paths p on p.id = e2.path_id
     where e2.user_id = v_m.user_id
       and e2.path_id is not null
       and e2.status = 'nao_iniciado'
       and e2.id <> p_enrollment
       -- só passos DEPOIS do que acabou de ser concluído, na mesma trilha
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
    perform public.notify_users(
      v_prox.tenant_id, array[v_prox.user_id], 'training_trilha',
      'Próximo treinamento liberado',
      v_prox.trilha || ': "' || v_prox.curso || '" já pode ser feito.',
      null, null);
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
