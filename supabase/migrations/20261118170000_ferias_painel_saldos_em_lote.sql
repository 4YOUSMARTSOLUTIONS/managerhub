-- Painel de Férias: saldos de todo mundo numa consulta só (desempenho, LUIZ 18/11/2026).
--
-- O painel chamava `ferias_periodos_aquisitivos` uma vez por pessoa (318 vezes
-- para o DP), e cada chamada repetia a guarda de alçada (manages_user sobe a
-- cadeia) e um laço plpgsql com uma consulta por período. Medido: ~350 ms dos
-- ~342 ms do painel inteiro; média de 328 ms e pico de 3,2 s em produção.
--
-- `ferias_aquisitivos_lote` é a MESMA regra, em SQL e para uma lista de pessoas.
-- Conferida contra a função por pessoa em 18/11/2026, em todas as pessoas da
-- empresa (ativas e desligadas):
--   * caminho da folha: 1.748 linhas idênticas (4 datas, 6 situações);
--   * caminho da admissão (empresa sem folha), por cópia da lógica sem a
--     checagem de importação: 42.605 linhas idênticas (5 datas);
--   * 29/02: generate_series avança ano a ano igual ao laço antigo.
-- A função por pessoa continua sendo a usada pelo resto do sistema; esta é
-- interna, chamada só pelo painel (que já decidiu quem a pessoa alcança).

create or replace function public.ferias_aquisitivos_lote(p_tenant uuid, p_users uuid[], p_hoje date)
returns table(user_id uuid, aq_inicio date, aq_fim date, concessivo_fim date, dias_direito integer, dias_usados integer,
              abono_usado integer, saldo integer, qtd_periodos integer, situacao text, origem text, referencia date,
              gozados_folha integer, limite_gozo date, tem14 boolean)
language sql stable security definer set search_path to 'public'
as $function$
  with periodos as (
    -- folha: os aquisitivos importados; quem tem linha aqui não passa pela admissão
    select a.user_id, a.aq_inicio, a.aq_fim, a.concessivo_fim, a.dias_direito,
           'folha'::text as origem, a.referencia, a.dias_gozados as gozados_folha, a.limite_gozo,
           least(14, a.dias_direito) as min14, true as da_folha
      from public.ferias_aquisitivos a
     where a.tenant_id = p_tenant and a.user_id = any(p_users)
    union all
    -- admissão: só quando a empresa nunca importou da folha
    select m.user_id, g.ini::date,
           (g.ini + interval '1 year' - interval '1 day')::date,
           (((g.ini + interval '1 year' - interval '1 day')::date) + interval '1 year')::date,
           30, 'admissao'::text, null::date, 0, null::date, 14, false
      from public.memberships m
      cross join lateral generate_series(m.admission_date::timestamp, p_hoje::timestamp, interval '1 year') g(ini)
     where m.tenant_id = p_tenant and m.user_id = any(p_users)
       and m.admission_date is not null
       and not exists (select 1 from public.ferias_importacoes i where i.tenant_id = p_tenant)
       and not exists (select 1 from public.ferias_aquisitivos a where a.tenant_id = p_tenant and a.user_id = m.user_id)
  ),
  calc as (
    select p.*, s.usados + p.gozados_folha as usados_total, s.abono,
           s.qtd + case when p.gozados_folha > 0 then 1 else 0 end as qtd_total,
           s.tem14 or (p.gozados_folha > 0 and p.gozados_folha >= p.min14) as tem14_total,
           s.pendente, s.aprovada, s.em_gozo, s.por_vir
      from periodos p
      cross join lateral (
        select coalesce(sum(f.dias + f.abono_dias), 0)::int as usados,
               coalesce(sum(f.abono_dias), 0)::int as abono,
               count(*)::int as qtd,
               coalesce(bool_or(f.dias >= p.min14), false) as tem14,
               coalesce(bool_or(f.status = 'solicitada'), false) as pendente,
               coalesce(bool_or(f.status = 'aprovada'), false) as aprovada,
               coalesce(bool_or(f.status = 'efetivada' and f.start_date <= p_hoje and f.end_date >= p_hoje), false) as em_gozo,
               coalesce(bool_or(f.status = 'efetivada' and f.start_date > p_hoje), false) as por_vir
          from public.ferias_solicitacoes f
         where f.tenant_id = p_tenant and f.user_id = p.user_id
           and f.aquisitivo_inicio = p.aq_inicio
           and f.status in ('solicitada', 'aprovada', 'efetivada')
           -- na folha, só o que veio depois da referência do relatório
           and (not p.da_folha or f.start_date > p.referencia)
           and not exists (select 1 from public.ferias_solicitacoes rg
                            where rg.reagendada_de = f.id and rg.status in ('solicitada', 'aprovada'))
      ) s
  )
  select c.user_id, c.aq_inicio, c.aq_fim, c.concessivo_fim, c.dias_direito, c.usados_total, c.abono,
         greatest(c.dias_direito - c.usados_total, 0), c.qtd_total,
         case
           when greatest(c.dias_direito - c.usados_total, 0) <= 0 and c.usados_total > 0 then case
             when c.pendente then 'solicitada'
             when c.aprovada then 'aprovada'
             when c.em_gozo then 'em_gozo'
             when c.por_vir then 'agendada'
             else 'concluida'
           end
           when c.aq_fim >= p_hoje then 'em_curso'
           when greatest(c.dias_direito - c.usados_total, 0) <= 0 then 'concluida'
           when p_hoje > c.concessivo_fim then 'vencida'
           when c.concessivo_fim - p_hoje <= 90 then 'a_vencer'
           else 'aberta'
         end,
         c.origem, c.referencia, c.gozados_folha, c.limite_gozo, c.tem14_total
    from calc c
   order by c.user_id, c.aq_inicio;
$function$;

-- interna: sem guarda própria, só o painel (SECURITY DEFINER, que já recortou
-- quem a pessoa alcança) chama
revoke execute on function public.ferias_aquisitivos_lote(uuid, uuid[], date) from public, anon, authenticated;

create or replace function public.ferias_painel(p_tenant uuid, p_hoje date DEFAULT CURRENT_DATE, p_unit_ids uuid[] DEFAULT NULL::uuid[])
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_ids uuid[];
  v_janela_ini date;
  v_janela_fim date;
  v_agora jsonb;
  v_proximas jsonb;
  v_timeline jsonb;
  v_saldos jsonb;
  v_usa_folha boolean;
begin
  if not public.is_tenant_member(p_tenant) then
    raise exception 'Você não é membro desta empresa.';
  end if;

  if public.has_tenant_role(p_tenant, '{owner,admin,hr,manager}'::public.member_role[]) then
    select array_agg(m.user_id) into v_ids
      from public.memberships m
     where m.tenant_id = p_tenant and m.is_active;
  else
    select array_agg(distinct x.user_id) into v_ids
      from (
        select mm.user_id from public.my_managed_memberships() mm where mm.tenant_id = p_tenant
        union select v_uid
      ) x;
  end if;

  if p_unit_ids is not null then
    select array_agg(distinct m.user_id) into v_ids
      from public.memberships m
      join public.membership_units mu on mu.membership_id = m.id
     where m.tenant_id = p_tenant
       and m.user_id = any(coalesce(v_ids, '{}'))
       and mu.unit_id = any(p_unit_ids);
  end if;
  v_ids := coalesce(v_ids, '{}');

  v_usa_folha := exists (select 1 from public.ferias_importacoes i where i.tenant_id = p_tenant);

  v_janela_ini := date_trunc('month', p_hoje)::date;
  v_janela_fim := (date_trunc('month', p_hoje) + interval '12 months' - interval '1 day')::date;

  select coalesce(jsonb_agg(jsonb_build_object(
           'userId', x.user_id, 'nome', x.nome, 'setor', x.setor,
           'inicio', x.start_date, 'fim', x.end_date) order by x.end_date), '[]'::jsonb)
    into v_agora
    from (
      select e.user_id, p.full_name as nome, d.name as setor, e.start_date, e.end_date
        from public.employee_absences e
        join public.memberships m on m.tenant_id = e.tenant_id and m.user_id = e.user_id
        join public.profiles p on p.id = e.user_id
        left join public.departments d on d.id = m.department_id
       where e.tenant_id = p_tenant and e.kind = 'ferias'
         and e.user_id = any(v_ids)
         and p_hoje between e.start_date and e.end_date
    ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'userId', x.user_id, 'nome', x.nome, 'inicio', x.inicio, 'fim', x.fim,
           'origem', x.origem) order by x.inicio), '[]'::jsonb)
    into v_proximas
    from (
      select e.user_id, p.full_name as nome, e.start_date as inicio, e.end_date as fim,
             'efetivada' as origem
        from public.employee_absences e
        join public.profiles p on p.id = e.user_id
       where e.tenant_id = p_tenant and e.kind = 'ferias' and e.user_id = any(v_ids)
         and e.start_date > p_hoje and e.start_date <= p_hoje + 60
      union all
      select f.user_id, p.full_name, f.start_date, f.end_date, 'prevista'
        from public.ferias_solicitacoes f
        join public.profiles p on p.id = f.user_id
       where f.tenant_id = p_tenant and f.status = 'aprovada' and f.user_id = any(v_ids)
         and f.start_date > p_hoje and f.start_date <= p_hoje + 60
    ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'userId', g.user_id, 'nome', g.nome, 'itens', g.itens) order by g.nome), '[]'::jsonb)
    into v_timeline
    from (
      select y.user_id, y.nome,
             jsonb_agg(jsonb_build_object('inicio', y.inicio, 'fim', y.fim, 'tipo', y.tipo)
                       order by y.inicio) as itens
        from (
          select e.user_id, p.full_name as nome, e.start_date as inicio, e.end_date as fim,
                 'efetivada' as tipo
            from public.employee_absences e
            join public.profiles p on p.id = e.user_id
           where e.tenant_id = p_tenant and e.kind = 'ferias' and e.user_id = any(v_ids)
             and daterange(e.start_date, e.end_date, '[]')
              && daterange(v_janela_ini, v_janela_fim, '[]')
          union all
          select f.user_id, p.full_name, f.start_date, f.end_date, 'prevista'
            from public.ferias_solicitacoes f
            join public.profiles p on p.id = f.user_id
           where f.tenant_id = p_tenant and f.status in ('solicitada', 'aprovada')
             and f.user_id = any(v_ids)
             and daterange(f.start_date, f.end_date, '[]')
              && daterange(v_janela_ini, v_janela_fim, '[]')
        ) y
       group by y.user_id, y.nome
    ) g;

  -- Saldo por pessoa: o AQUISITIVO FIFO (o mais antigo com saldo), que é o
  -- próximo a programar. `semFolha`: a empresa importa da folha e esta pessoa
  -- não veio no relatório, então não há saldo confiável (não é "em dia").
  --
  -- Os aquisitivos de todo mundo saem de UMA chamada em lote, e não de uma por
  -- pessoa (desempenho, LUIZ 18/11/2026; ver ferias_aquisitivos_lote).
  select coalesce(jsonb_agg(jsonb_build_object(
           'userId', z.user_id, 'nome', z.full_name, 'setor', z.setor,
           'saldo', coalesce(z.saldo, 0), 'situacao', z.situacao,
           'aquisitivoInicio', z.aq_inicio, 'aquisitivoFim', z.aq_fim,
           'gozarAte', z.concessivo_fim, 'semFolha', z.sem_folha,
           'statusColaborador', z.status_colaborador)
           order by (z.situacao = 'vencida') desc nulls last,
                    (z.situacao = 'a_vencer') desc nulls last,
                    z.sem_folha desc, z.full_name), '[]'::jsonb)
    into v_saldos
    from (
      select m.user_id, p.full_name, d.name as setor,
             s.saldo, s.situacao, s.aq_inicio, s.aq_fim, s.concessivo_fim,
             (v_usa_folha and not exists (
                select 1 from public.ferias_aquisitivos a
                 where a.tenant_id = p_tenant and a.user_id = m.user_id)) as sem_folha,
             (select jsonb_build_object('situacao', coalesce(ea.motivo, ea.kind::text),
                                        'desde', ea.start_date,
                                        'retorno', nullif(ea.end_date, date '9999-12-31'),
                                        'observacao', ea.note)
                from public.employee_absences ea
               where ea.tenant_id = p_tenant and ea.user_id = m.user_id
                 and (ea.kind in ('afastamento', 'licenca') or (ea.kind = 'falta' and ea.end_date = date '9999-12-31'))
                 and p_hoje between ea.start_date and ea.end_date
               order by ea.start_date desc
               limit 1) as status_colaborador
        from public.memberships m
        join public.profiles p on p.id = m.user_id
        left join public.departments d on d.id = m.department_id
        left join (
          select distinct on (l.user_id) l.user_id, l.aq_inicio, l.aq_fim, l.saldo, l.concessivo_fim, l.situacao
            from public.ferias_aquisitivos_lote(p_tenant, v_ids, p_hoje) l
           where l.saldo > 0 and l.situacao in ('aberta', 'a_vencer', 'vencida')
           order by l.user_id, l.aq_inicio
        ) s on s.user_id = m.user_id
       where m.tenant_id = p_tenant and m.is_active
         and m.user_id = any(v_ids)
         and m.admission_date is not null
    ) z;

  return jsonb_build_object(
    'agora', v_agora,
    'proximas', v_proximas,
    'timeline', v_timeline,
    'saldos', v_saldos,
    'usaFolha', v_usa_folha,
    'janelaInicio', v_janela_ini,
    'janelaFim', v_janela_fim);
end;
$function$;

-- mesma assinatura e mesmo alcance de antes: guarda no corpo (is_tenant_member,
-- has_tenant_role / my_managed_memberships) e fora do alcance da chave pública
revoke execute on function public.ferias_painel(uuid, date, uuid[]) from public, anon;
grant execute on function public.ferias_painel(uuid, date, uuid[]) to authenticated;

-- Índices (fase 4, item 6). As buscas por pessoa já têm índices compostos
-- (tenant_id, user_id, ...); estas são as duas lacunas reais:
-- * respostas da blitz por pergunta (desativar/excluir pergunta confere se já
--   foi respondida; o índice único começa por avaliacao_id);
-- * histórico de vínculo por membership_id inteiro (o único índice é parcial,
--   só o período vigente, e Metas e a RV leem o histórico todo).
create index if not exists seg_blitz_respostas_pergunta_idx on public.seg_blitz_respostas (pergunta_id);
create index if not exists membership_history_membership_idx on public.membership_history (membership_id, effective_from);

notify pgrst, 'reload schema';
