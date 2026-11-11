-- Blitz: o topo da hierarquia não aparece para o Gerencial (LUIZ, 11/11/2026).
--
-- Os sucessores (JAIME e MARIANA) são as únicas pessoas ativas sem gestor no
-- cadastro: estão acima de todo mundo. O Gerencial vê a blitz da empresa
-- inteira, e com isso os dois apareciam na análise da Maria Cleidiane como se
-- fossem da equipe dela. Regra: quem é ativo e não tem gestor só aparece para
-- proprietário, admin, equipe de segurança e para o próprio topo. O Gestor já
-- não os via (só enxerga a cadeia dele).
--
-- Junto: a unidade de quem está em mais de uma passa a ser a do recorte do
-- seletor do topo. Antes era a primeira em ordem alfabética, e com MATRIZ
-- escolhida os dois apareciam num cartão FILIAL.

-- quem está no topo: ativo e sem gestor (desligados sem gestor não contam)
create or replace function public.seg_topo_da_hierarquia(p_tenant uuid)
 returns setof uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select m.user_id from public.memberships m
   where m.tenant_id = p_tenant and m.is_active and m.manager_id is null;
$function$;

-- quem pode ver o topo: segurança (inclui owner/admin) e o próprio topo
create or replace function public.ve_o_topo(p_tenant uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public.pode_tratar_seguranca(p_tenant)
      or (select auth.uid()) in (select public.seg_topo_da_hierarquia(p_tenant));
$function$;

-- a RLS da blitz (registros, respostas e veículos)
create or replace function public.pode_ver_blitz(p_tenant uuid, p_user uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p_user = (select auth.uid())
      or public.manages_user(p_user, p_tenant)
      or public.pode_tratar_seguranca(p_tenant)
      or (public.has_tenant_role(p_tenant, '{owner,admin}'::public.member_role[]))
      or (public.has_tenant_role(p_tenant, '{manager}'::public.member_role[])
          and (public.ve_o_topo(p_tenant)
               or p_user not in (select public.seg_topo_da_hierarquia(p_tenant))));
$function$;

create or replace function public.seg_blitz_analise(p_de date, p_ate date, p_unit_ids uuid[] default null::uuid[])
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.my_active_tenant();
  v_amplo boolean;
  v_lider boolean;
  v_ve_topo boolean;
  v_out jsonb;
begin
  if v_tenant is null or not public.is_tenant_member(v_tenant) then
    raise exception 'Você não tem acesso a esta empresa.';
  end if;
  v_amplo := public.has_tenant_role(v_tenant, '{owner,admin,manager}'::public.member_role[])
          or public.pode_tratar_seguranca(v_tenant);
  v_lider := public.has_tenant_role(v_tenant, '{team_lead}'::public.member_role[]);
  if not (v_amplo or v_lider) then
    raise exception 'As análises da blitz são de quem tem alçada sobre a equipe.' using errcode = '42501';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de then
    raise exception 'Período inválido.';
  end if;
  if p_ate - p_de > 400 then
    raise exception 'Escolha um período de até um ano.';
  end if;
  v_ve_topo := public.ve_o_topo(v_tenant);

  with equipe as (
    -- a cadeia do Gestor; vazia (e ignorada) para quem vê a empresa
    select e.user_id from public.my_managed_memberships() e where e.tenant_id = v_tenant
  ),
  topo as (
    -- os sucessores: fora da conta de quem não pode vê-los
    select t as user_id from public.seg_topo_da_hierarquia(v_tenant) t
  ),
  blitz as (
    select a.*
      from public.seg_blitz_avaliacoes a
     where a.tenant_id = v_tenant
       and a.occurred_on between p_de and p_ate
       and (p_unit_ids is null or a.snap_unit_id = any(p_unit_ids) or a.snap_unit_id is null)
       and (v_amplo or a.user_id in (select user_id from equipe))
       and (v_ve_topo or a.user_id not in (select user_id from topo))
  ),
  base as (
    select m.user_id, m.employee_code, m.position_id,
           p.full_name as nome, pos.name as funcao, d.name as setor, mg.full_name as gestor,
           -- quem está em mais de uma unidade conta na do recorte (antes: a primeira do alfabeto)
           (select u.name from public.membership_units mu join public.units u on u.id = mu.unit_id
             where mu.membership_id = m.id and (p_unit_ids is null or mu.unit_id = any(p_unit_ids))
             order by u.name limit 1) as unidade,
           (select array_agg(mu.unit_id) from public.membership_units mu where mu.membership_id = m.id) as unidades
      from public.memberships m
      join public.profiles p on p.id = m.user_id
      left join public.positions pos on pos.id = m.position_id
      left join public.departments d on d.id = m.department_id
      left join public.profiles mg on mg.id = m.manager_id
     where m.tenant_id = v_tenant
       and (m.admission_date is null or m.admission_date <= p_ate)
       and (m.is_active or (m.dismissed_at is not null and m.dismissed_at > p_ate))
       and (v_amplo or m.user_id in (select user_id from equipe))
       and (v_ve_topo or m.user_id not in (select user_id from topo))
  ),
  classif as (
    select b.*,
           x.participa as excecao,
           exists (select 1 from public.seg_blitz_publico_funcoes f
                    where f.tenant_id = v_tenant and f.position_id = b.position_id) as funcao_fora,
           coalesce((
             select range_agg(daterange(a.start_date, a.end_date, '[]'))
               from public.employee_absences a
              where a.tenant_id = v_tenant and a.user_id = b.user_id
                and a.start_date <= p_ate and a.end_date >= p_de
           ) @> daterange(p_de, p_ate, '[]'), false) as ausente_periodo,
           (select max(a.occurred_on) from public.seg_blitz_avaliacoes a
             where a.tenant_id = v_tenant and a.user_id = b.user_id
               and a.occurred_on between p_de and p_ate) as ultima_no_periodo,
           (select max(a.occurred_on) from public.seg_blitz_avaliacoes a
             where a.tenant_id = v_tenant and a.user_id = b.user_id) as ultima_geral
      from base b
      left join public.seg_blitz_publico_pessoas x on x.tenant_id = v_tenant and x.user_id = b.user_id
     where p_unit_ids is null or b.unidades && p_unit_ids
  ),
  publico as (
    select * from classif where coalesce(excecao, not funcao_fora) and not ausente_periodo
  )
  select jsonb_build_object(
    'de', p_de,
    'ate', p_ate,
    'indicadores', jsonb_build_object(
      'total',         (select count(*) from blitz),
      'conformes',     (select count(*) from blitz where conforme),
      'com_desvio',    (select count(*) from blitz where liberado and not conforme),
      'bloqueios',     (select count(*) from blitz where not liberado),
      'colaboradores', (select count(distinct user_id) from blitz),
      'alertas', (select jsonb_build_object('enviados', count(*), 'com_tratativa', count(*) filter (where al.registrada_em is not null))
                    from public.seg_blitz_alertas al join blitz b on b.id = al.avaliacao_id)
    ),
    'aderencia', jsonb_build_object(
      'publico', (select count(*) from publico),
      'passaram', (select count(*) from publico where ultima_no_periodo is not null),
      'fora', jsonb_build_object(
        'por_funcao', (select count(*) from classif where excecao is null and funcao_fora),
        'por_excecao', (select count(*) from classif where excecao = false),
        'ausentes', (select count(*) from classif where coalesce(excecao, not funcao_fora) and ausente_periodo)
      ),
      'por_setor', (select coalesce(jsonb_agg(jsonb_build_object('nome', k, 'publico', n, 'passaram', ok) order by k), '[]'::jsonb)
                      from (select coalesce(setor, 'Sem setor') k, count(*) n, count(*) filter (where ultima_no_periodo is not null) ok
                              from publico group by 1) x),
      'por_gestor', (select coalesce(jsonb_agg(jsonb_build_object('nome', k, 'publico', n, 'passaram', ok) order by k), '[]'::jsonb)
                       from (select coalesce(gestor, 'Sem gestor') k, count(*) n, count(*) filter (where ultima_no_periodo is not null) ok
                               from publico group by 1) x),
      'por_unidade', (select coalesce(jsonb_agg(jsonb_build_object('nome', k, 'publico', n, 'passaram', ok) order by k), '[]'::jsonb)
                        from (select coalesce(unidade, 'Sem unidade') k, count(*) n, count(*) filter (where ultima_no_periodo is not null) ok
                                from publico group by 1) x),
      'por_funcao', (select coalesce(jsonb_agg(jsonb_build_object('nome', k, 'publico', n, 'passaram', ok) order by k), '[]'::jsonb)
                       from (select coalesce(funcao, 'Sem função') k, count(*) n, count(*) filter (where ultima_no_periodo is not null) ok
                               from publico group by 1) x),
      'faltam', (select coalesce(jsonb_agg(jsonb_build_object(
                    'user_id', user_id, 'nome', nome, 'matricula', employee_code, 'funcao', funcao,
                    'setor', setor, 'gestor', gestor, 'unidade', unidade, 'ultima', ultima_geral) order by nome), '[]'::jsonb)
                   from publico where ultima_no_periodo is null),
      -- o público inteiro, pessoa a pessoa: a tela agrupa e filtra (unidade,
      -- setor, gestor, função) sem voltar ao banco
      'pessoas', (select coalesce(jsonb_agg(jsonb_build_object(
                    'user_id', user_id, 'nome', nome, 'matricula', employee_code, 'funcao', funcao,
                    'setor', setor, 'gestor', gestor, 'unidade', unidade,
                    'passou', ultima_no_periodo is not null, 'ultima', ultima_geral) order by nome), '[]'::jsonb)
                    from publico)
    ),
    'recorrencia', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'user_id', user_id, 'nome', nome, 'setor', setor, 'gestor', gestor, 'unidade', unidade, 'funcao', funcao,
               'nao_conformes', nc, 'total', n) order by nc desc, nome), '[]'::jsonb)
        from (
          -- setor, gestor, unidade e função da ÚLTIMA blitz da pessoa no período
          select b.user_id,
                 (array_agg(b.snap_full_name order by b.occurred_on desc, b.created_at desc))[1] as nome,
                 (array_agg(b.snap_department_name order by b.occurred_on desc, b.created_at desc))[1] as setor,
                 (array_agg(b.snap_manager_name order by b.occurred_on desc, b.created_at desc))[1] as gestor,
                 (array_agg(b.snap_unit_name order by b.occurred_on desc, b.created_at desc))[1] as unidade,
                 (array_agg(b.snap_position_name order by b.occurred_on desc, b.created_at desc))[1] as funcao,
                 count(*) filter (where not b.conforme) as nc, count(*) as n
            from blitz b
           group by b.user_id
          having count(*) filter (where not b.conforme) > 0
           order by nc desc
           limit 500
        ) x
    )
  ) into v_out;

  return v_out;
end;
$function$;

create or replace function public.seg_blitz_alertas_do_periodo(p_de date, p_ate date, p_unit_ids uuid[] default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.my_active_tenant();
  v_amplo boolean;
  v_lider boolean;
  v_ve_topo boolean;
begin
  if v_tenant is null or not public.is_tenant_member(v_tenant) then
    raise exception 'Você não tem acesso a esta empresa.';
  end if;
  v_amplo := public.has_tenant_role(v_tenant, '{owner,admin,manager}'::public.member_role[])
          or public.pode_tratar_seguranca(v_tenant);
  v_lider := public.has_tenant_role(v_tenant, '{team_lead}'::public.member_role[]);
  if not (v_amplo or v_lider) then
    raise exception 'As análises da blitz são de quem tem alçada sobre a equipe.' using errcode = '42501';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de then
    raise exception 'Período inválido.';
  end if;
  if p_ate - p_de > 400 then
    raise exception 'Escolha um período de até um ano.';
  end if;
  v_ve_topo := public.ve_o_topo(v_tenant);

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', al.id,
             'enviado_em', al.enviado_em,
             'occurred_on', a.occurred_on,
             'colaborador', a.snap_full_name,
             'setor', a.snap_department_name,
             'unidade', a.snap_unit_name,
             'gestor', coalesce(a.snap_manager_name, g.full_name),
             'meio', m.name,
             'liberado', a.liberado,
             'motivo', mo.name,
             'observacao', a.observacao,
             'respostas_nao', (
               select coalesce(jsonb_agg(r.snap_pergunta order by r.snap_pergunta), '[]'::jsonb)
                 from public.seg_blitz_respostas r
                where r.avaliacao_id = a.id and r.resposta = 'nao'
             ),
             'tratativa_em', al.tratativa_em,
             'tratativa_resumo', al.tratativa_resumo,
             'tratativa_acordo', al.tratativa_acordo,
             'registrada_em', al.registrada_em
           ) order by (al.registrada_em is not null), a.occurred_on desc, al.enviado_em desc), '[]'::jsonb)
      from public.seg_blitz_alertas al
      join public.seg_blitz_avaliacoes a on a.id = al.avaliacao_id
      left join public.profiles g on g.id = al.gestor_id
      left join public.seg_blitz_meios m on m.id = a.meio_id
      left join public.seg_blitz_motivos mo on mo.id = a.motivo_bloqueio_id
     where al.tenant_id = v_tenant
       and a.tenant_id = v_tenant
       and a.occurred_on between p_de and p_ate
       and (p_unit_ids is null or a.snap_unit_id = any(p_unit_ids) or a.snap_unit_id is null)
       and (v_amplo or a.user_id in (
             select e.user_id from public.my_managed_memberships() e where e.tenant_id = v_tenant
           ))
       and (v_ve_topo or a.user_id not in (select t from public.seg_topo_da_hierarquia(v_tenant) t))
  );
end;
$function$;

-- helpers internos: só as outras funções chamam (sob o dono)
revoke execute on function public.seg_topo_da_hierarquia(uuid) from public, anon, authenticated;
revoke execute on function public.ve_o_topo(uuid) from public, anon, authenticated;
-- as que já existiam mantêm o grant de authenticated (a RLS e o app chamam)
revoke execute on function public.pode_ver_blitz(uuid, uuid) from public, anon;
revoke execute on function public.seg_blitz_analise(date, date, uuid[]) from public, anon;
revoke execute on function public.seg_blitz_alertas_do_periodo(date, date, uuid[]) from public, anon;

notify pgrst, 'reload schema';
