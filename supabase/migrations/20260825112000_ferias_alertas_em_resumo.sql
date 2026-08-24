-- O varredor de vencimento avisa em RESUMO, não item a item.
--
-- A primeira versão (20260825111000) notificava uma vez por (pessoa,
-- aquisitivo, tipo). No teste com a base real, a primeira varredura geraria
-- 281 avisos de uma vez para cada pessoa do DP: o sino viraria martelo e o
-- alerta morreria ignorado. Agora:
--
--   - o DP recebe UM aviso por varredura com os totais novos;
--   - cada GESTOR recebe UM aviso com os números da própria equipe;
--   - o dedup continua por item (`ferias_alertas_enviados`), então varredura
--     sem novidade não avisa ninguém, e 'a_vencer' que virou 'vencida' conta
--     como novidade de novo, de propósito.
create or replace function public.ferias_alertas_vencimento()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_dp uuid[];
  v_n integer;
begin
  -- `on commit drop` só limpa no commit: duas execuções na MESMA transação
  -- (teste com rollback, retry de job) colidiriam sem este drop
  drop table if exists _ferias_novos;
  create temp table _ferias_novos on commit drop as
  select ms.tenant_id, ms.user_id, ms.manager_id, p.full_name,
         a.aq_inicio, a.aq_fim, a.concessivo_fim, a.saldo, a.situacao as tipo
    from public.memberships ms
    join public.profiles p on p.id = ms.user_id
    cross join lateral public.ferias_periodos_aquisitivos(ms.tenant_id, ms.user_id, current_date) a
   where ms.is_active
     and ms.admission_date is not null
     and a.saldo > 0
     -- vencida só se o estouro é recente (último ano): antes disso é ruído de
     -- histórico não importado, não pendência real
     and (a.situacao = 'a_vencer'
          or (a.situacao = 'vencida' and a.concessivo_fim >= current_date - 365))
     and not exists (
       select 1 from public.ferias_alertas_enviados f
        where f.tenant_id = ms.tenant_id and f.user_id = ms.user_id
          and f.aquisitivo_inicio = a.aq_inicio and f.tipo = a.situacao);

  select count(*) into v_n from _ferias_novos;
  if v_n = 0 then
    return 0;
  end if;

  for r in
    select n.tenant_id,
           count(*) filter (where n.tipo = 'a_vencer') as av,
           count(*) filter (where n.tipo = 'vencida') as vc
      from _ferias_novos n
     group by n.tenant_id
  loop
    v_dp := public.ferias_destinatarios_dp(r.tenant_id);
    if v_dp is not null then
      perform public.notify_users_sistema(
        r.tenant_id, v_dp, 'ferias_vencimento',
        'Férias com prazo de concessão',
        'Novos avisos: ' || r.av || ' período(s) aquisitivo(s) a vencer e ' ||
        r.vc || ' vencido(s). Confira os saldos no módulo Férias.');
    end if;
  end loop;

  for r in
    select n.tenant_id, n.manager_id,
           count(*) filter (where n.tipo = 'a_vencer') as av,
           count(*) filter (where n.tipo = 'vencida') as vc
      from _ferias_novos n
     where n.manager_id is not null
     group by n.tenant_id, n.manager_id
  loop
    perform public.notify_users_sistema(
      r.tenant_id, array[r.manager_id], 'ferias_vencimento',
      'Férias da sua equipe com prazo de concessão',
      'Na sua equipe: ' || r.av || ' período(s) aquisitivo(s) a vencer e ' ||
      r.vc || ' vencido(s). Programe as férias no módulo Férias.');
  end loop;

  insert into public.ferias_alertas_enviados (tenant_id, user_id, aquisitivo_inicio, tipo)
  select n.tenant_id, n.user_id, n.aq_inicio, n.tipo from _ferias_novos n
  on conflict do nothing;

  return v_n;
end;
$$;

revoke execute on function public.ferias_alertas_vencimento() from public, anon, authenticated;

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
