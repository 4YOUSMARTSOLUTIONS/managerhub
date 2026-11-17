-- Alerta de INSS no comunicado por e-mail (LUIZ, 17/11/2026).
--
-- O e-mail de motivo confirmado passa a avisar quando o colaborador passou de
-- 15 dias de atestado. O comunicado é montado no servidor com a service role,
-- onde `auth.uid()` é nulo e `pode_ver_absenteismo` recusava: a função
-- devolvia NULL e o alerta nunca sairia. A guarda agora deixa passar a
-- service role (chave só do servidor), no mesmo molde de
-- `absenteismo_destinatarios`; para o app nada muda.
--
-- O e-mail recebe só a contagem de dias. A categoria do CID, que a função usa
-- por dentro para somar a mesma doença, não sai daqui.
--
-- (A guarda de `pode_ver_absenteismo` abaixo tinha um furo antigo, corrigido
-- logo em seguida em 20261117121000_absenteismo_inss_guarda.sql.)

create or replace function public.absenteismo_inss(p_tenant uuid, p_user uuid, p_ate date default null::date)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_ate date := coalesce(p_ate, current_date);
  v_dias_doenca int := 0;
  v_dias_cont   int := 0;
  v_cat_top text;
  r record;
  v_fim date;
  v_soma int;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.pode_ver_absenteismo(p_tenant, p_user, (select auth.uid())) then
    return null;
  end if;

  for r in
    select coalesce(left(upper(btrim(a.cid_code)), 3), 'SEM-CID') as cat,
           l.ausencia_inicio as start_date, l.end_date
      from public.absenteismo_lancamentos l
      left join public.absenteismo_atestados a on a.lancamento_id = l.id
     where l.tenant_id = p_tenant
       and l.user_id = p_user
       and l.status in ('aprovado', 'pendente')
       and l.snap_kind = 'atestado'
       and not l.partial_day
       and l.ausencia_inicio is not null
       and l.ausencia_inicio <= v_ate
     order by cat, l.ausencia_inicio
  loop
    if v_cat_top is distinct from r.cat then
      v_cat_top := r.cat;
      v_fim := r.end_date;
      v_soma := (r.end_date - r.start_date) + 1;
    elsif r.start_date <= v_fim + 60 then
      v_soma := v_soma + greatest((r.end_date - greatest(r.start_date, v_fim + 1)) + 1, 0);
      v_fim := greatest(v_fim, r.end_date);
    else
      v_fim := r.end_date;
      v_soma := (r.end_date - r.start_date) + 1;
    end if;
    v_dias_doenca := greatest(v_dias_doenca, v_soma);
  end loop;

  v_fim := null;
  v_soma := 0;
  for r in
    select l.ausencia_inicio as start_date, l.end_date
      from public.absenteismo_lancamentos l
     where l.tenant_id = p_tenant
       and l.user_id = p_user
       and l.status in ('aprovado', 'pendente')
       and l.snap_kind = 'atestado'
       and not l.partial_day
       and l.ausencia_inicio is not null
       and l.ausencia_inicio <= v_ate
     order by l.ausencia_inicio
  loop
    if v_fim is null or r.start_date > v_fim + 1 then
      v_soma := (r.end_date - r.start_date) + 1;
    else
      v_soma := v_soma + greatest((r.end_date - greatest(r.start_date, v_fim + 1)) + 1, 0);
    end if;
    v_fim := greatest(coalesce(v_fim, r.end_date), r.end_date);
    v_dias_cont := greatest(v_dias_cont, v_soma);
  end loop;

  return jsonb_build_object(
    'dias', greatest(v_dias_doenca, v_dias_cont),
    'diasMesmaDoenca', v_dias_doenca,
    'diasContinuo', v_dias_cont,
    'motivo', case
                when v_dias_doenca > 15 and v_dias_doenca >= v_dias_cont then 'mesma_doenca'
                when v_dias_cont > 15 then 'continuo'
                else null end,
    'atinge', (v_dias_doenca > 15 or v_dias_cont > 15)
  );
end;
$function$;

revoke execute on function public.absenteismo_inss(uuid, uuid, date) from public, anon;
grant execute on function public.absenteismo_inss(uuid, uuid, date) to authenticated;
