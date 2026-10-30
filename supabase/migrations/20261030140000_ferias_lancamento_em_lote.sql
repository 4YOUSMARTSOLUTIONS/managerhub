-- Férias: o gestor lança a programação da equipe por planilha.
--
-- Para os níveis que não solicitam as próprias férias (Operacional, Aprendiz,
-- Estagiário na Cervantes), o caminho é o gestor lançar. Com dezenas de
-- pessoas, um por um não escala: o gestor baixa o modelo com a equipe, preenche
-- as datas e importa.
--
-- Regra de ouro: a planilha passa EXATAMENTE pelas mesmas regras do
-- "Lançar férias" individual, porque cada pessoa é lançada por
-- `ferias_lancar`. A prévia roda o lançamento de verdade dentro de um bloco e
-- o desfaz levantando um erro próprio (P0099): o que a prévia aprova é o que o
-- envio grava, sem uma segunda implementação das regras para divergir.
--
-- Cada pessoa é independente: a recusa de uma não derruba as outras.

-- ---------------------------------------------------------------------------
-- 1. ferias_lancar: no lote, o DP recebe um aviso só
-- ---------------------------------------------------------------------------
create or replace function public.ferias_lancar(
  p_tenant uuid, p_user uuid, p_periodos jsonb, p_hoje date default current_date,
  p_justificativa_dobro text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_s jsonb;
  v_val jsonb;
  v_n int;
  v_dp uuid[];
  v_eh_dp boolean;
  v_just text := nullif(btrim(coalesce(p_justificativa_dobro, '')), '');
begin
  v_eh_dp := public.has_tenant_role(p_tenant, '{owner,admin,hr}'::public.member_role[]);
  if not public.manages_user(p_user, p_tenant) and not v_eh_dp then
    raise exception 'Apenas o gestor do colaborador ou o departamento pessoal lançam a previsão de férias.';
  end if;
  if v_just is not null and not v_eh_dp then
    raise exception 'Só o departamento pessoal lança férias em dobro.';
  end if;

  v_s := public.ferias_montar_snaps(p_tenant, p_user);
  if v_s is null or not coalesce((v_s->>'is_active')::boolean, false) then
    raise exception 'Vínculo não encontrado nesta empresa.';
  end if;
  if v_s->>'admission_date' is null then
    raise exception 'A data de admissão deste colaborador não está cadastrada. Peça ao departamento pessoal.';
  end if;

  v_val := public.ferias_validar_periodos(p_tenant, p_user, p_periodos, p_hoje, null, v_just is not null);

  -- a justificativa vai só nos períodos que de fato passam do prazo
  if v_just is not null then
    select coalesce(jsonb_agg(
             case when coalesce((t.e->>'em_dobro')::boolean, false)
                  then t.e || jsonb_build_object('justificativa_dobro', v_just)
                  else t.e end
             order by t.o), '[]'::jsonb)
      into v_val
      from jsonb_array_elements(v_val) with ordinality as t(e, o);
  end if;

  v_n := public.ferias_criar_linhas(p_tenant, p_user, v_val, v_s, 'aprovada', true);

  if p_user is distinct from (select auth.uid()) then
    perform public.notify_users_sistema(
      p_tenant, array[p_user], 'ferias_lancada',
      'Suas férias foram programadas',
      v_n || ' período(s) a partir de ' ||
      to_char((v_val->0->>'inicio')::date, 'DD/MM/YYYY') ||
      ', aguardando a efetivação do departamento pessoal.');
  end if;

  -- no lançamento por planilha, quem avisa o DP é o lote, uma vez só
  if coalesce(current_setting('ferias.lote', true), '') <> '1' then
    v_dp := array_remove(public.ferias_destinatarios_dp(p_tenant), (select auth.uid()));
    if v_dp is not null and array_length(v_dp, 1) > 0 then
      perform public.notify_users_sistema(
        p_tenant, v_dp, 'ferias_aguardando_efetivacao',
        'Férias aguardando efetivação',
        coalesce(v_s->>'full_name', 'Colaborador') || ': previsão lançada pelo gestor a partir de ' ||
        to_char((v_val->0->>'inicio')::date, 'DD/MM/YYYY') || '.');
    end if;
  end if;
end;
$function$;

revoke execute on function public.ferias_lancar(uuid, uuid, jsonb, date, text) from public, anon;

-- ---------------------------------------------------------------------------
-- 2. O lote
-- ---------------------------------------------------------------------------
-- p_lancamentos: [{ user_id, periodos: [{ inicio, fim, abono, decimo }] }]
-- Devolve [{ user_id, ok, erro }] na mesma ordem.
create or replace function public.ferias_lancar_lote(
  p_tenant uuid, p_lancamentos jsonb, p_hoje date, p_somente_validar boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  e jsonb;
  v_user uuid;
  v_res jsonb := '[]'::jsonb;
  v_ok int := 0;
  v_dp uuid[];
  v_nome text;
begin
  if not public.is_tenant_member(p_tenant) then
    raise exception 'Você não é membro desta empresa.';
  end if;
  if p_lancamentos is null or jsonb_typeof(p_lancamentos) <> 'array' or jsonb_array_length(p_lancamentos) = 0 then
    raise exception 'Nenhum lançamento na planilha.';
  end if;
  if jsonb_array_length(p_lancamentos) > 500 then
    raise exception 'Envie no máximo 500 colaboradores por planilha.';
  end if;

  perform set_config('ferias.lote', '1', true);
  for e in select * from jsonb_array_elements(p_lancamentos) loop
    v_user := (e->>'user_id')::uuid;
    begin
      -- a alçada (gestor da pessoa ou DP) e todas as regras moram aqui dentro
      perform public.ferias_lancar(p_tenant, v_user, e->'periodos', p_hoje);
      if coalesce(p_somente_validar, true) then
        -- prévia: desfaz o que acabou de gravar (o bloco volta inteiro)
        raise exception using errcode = 'P0099', message = 'validado';
      end if;
      v_ok := v_ok + 1;
      v_res := v_res || jsonb_build_object('user_id', v_user, 'ok', true);
    exception
      when sqlstate 'P0099' then
        v_res := v_res || jsonb_build_object('user_id', v_user, 'ok', true);
      when others then
        v_res := v_res || jsonb_build_object('user_id', v_user, 'ok', false, 'erro', sqlerrm);
    end;
  end loop;
  perform set_config('ferias.lote', '', true);

  if not coalesce(p_somente_validar, true) and v_ok > 0 then
    v_dp := array_remove(public.ferias_destinatarios_dp(p_tenant), (select auth.uid()));
    if v_dp is not null and array_length(v_dp, 1) > 0 then
      select p.full_name into v_nome from public.profiles p where p.id = (select auth.uid());
      perform public.notify_users_sistema(
        p_tenant, v_dp, 'ferias_aguardando_efetivacao',
        'Férias lançadas por planilha',
        coalesce(v_nome, 'Um gestor') || ' lançou as férias de ' || v_ok ||
        ' colaborador(es) por planilha. Elas aguardam a efetivação.');
    end if;
  end if;

  return v_res;
end;
$function$;

revoke execute on function public.ferias_lancar_lote(uuid, jsonb, date, boolean) from public, anon;

-- ---------------------------------------------------------------------------
-- 3. O modelo: a equipe que só o gestor lança, com o saldo de cada um
-- ---------------------------------------------------------------------------
-- DP: todos os ativos dos níveis que não solicitam. Gestor: a própria cadeia.
-- O saldo é o do aquisitivo mais antigo com dias (o próximo a programar), com
-- a data a partir da qual ele pode ser gozado e o prazo final.
create or replace function public.ferias_modelo_lancamento(p_tenant uuid, p_hoje date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_ids uuid[];
  v jsonb;
begin
  if not public.is_tenant_member(p_tenant) then
    raise exception 'Você não é membro desta empresa.';
  end if;

  if public.has_tenant_role(p_tenant, '{owner,admin,hr}'::public.member_role[]) then
    select array_agg(m.user_id) into v_ids
      from public.memberships m where m.tenant_id = p_tenant and m.is_active;
  else
    select array_agg(distinct mm.user_id) into v_ids
      from public.my_managed_memberships() mm where mm.tenant_id = p_tenant;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'userId', x.user_id, 'nome', x.nome, 'matricula', x.matricula,
           'unidade', x.unidade, 'setor', x.setor, 'nivel', x.nivel,
           'aqInicio', x.aq_inicio, 'aqFim', x.aq_fim, 'saldo', x.saldo,
           'gozarAte', x.concessivo_fim)
           order by x.unidade nulls last, x.nome), '[]'::jsonb)
    into v
    from (
      select m.user_id, p.full_name as nome, m.employee_code as matricula, d.name as setor, l.name as nivel,
             (select u.name from public.membership_units mu join public.units u on u.id = mu.unit_id
               where mu.membership_id = m.id order by u.name limit 1) as unidade,
             a.aq_inicio, a.aq_fim, a.saldo, a.concessivo_fim
        from public.memberships m
        join public.profiles p on p.id = m.user_id
        left join public.departments d on d.id = m.department_id
        left join public.hierarchy_levels l on l.id = m.hierarchy_level_id
        left join lateral (
          select q.aq_inicio, q.aq_fim, q.saldo, q.concessivo_fim
            from public.ferias_periodos_aquisitivos(p_tenant, m.user_id, p_hoje) q
           where q.saldo > 0
           order by q.aq_inicio
           limit 1
        ) a on true
       where m.tenant_id = p_tenant
         and m.is_active
         and m.user_id = any(coalesce(v_ids, '{}'))
         and m.user_id <> (select auth.uid())
         and coalesce(m.employee_code, '') <> ''
         and exists (select 1 from public.ferias_niveis_bloqueados b
                      where b.tenant_id = p_tenant and b.hierarchy_level_id = m.hierarchy_level_id)
    ) x;

  return v;
end;
$function$;

revoke execute on function public.ferias_modelo_lancamento(uuid, date) from public, anon;

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
