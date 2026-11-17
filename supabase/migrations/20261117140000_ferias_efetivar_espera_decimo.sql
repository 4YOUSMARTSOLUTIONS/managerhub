-- Férias: a efetivação espera a escolha do 13º do operacional (LUIZ, 17/11/2026).
--
-- Quem é de nível bloqueado escolhe o adiantamento do 13º em Minhas férias, uma
-- vez por ano, e a escolha só corrige previsões AINDA NÃO efetivadas
-- (`ferias_decimo_sincronizar` mexe em solicitada/aprovada). Se o DP efetivava
-- antes, o "Sim" que viesse depois não alcançava a férias: o 13º se perdia.
-- Caso real: a gestora lançou 32 férias de 2027 para operacionais que nunca
-- entraram no sistema.
--
-- Regra: enquanto o prazo da escolha do ano das férias (`ferias_prazo_decimo`,
-- 31/01 na Cervantes) não terminou e o operacional não escolheu, a efetivação
-- é recusada. Passado o prazo, libera: no modo "bloquear" a escolha não é mais
-- possível, e esperar não teria fim. Vale também para férias de um ano cuja
-- escolha ainda nem abriu (ex.: 2028 vista de 2026).

-- Até quando a escolha do 13º segura a efetivação (nulo = não segura).
create or replace function public.ferias_decimo_pendente_ate(p_tenant uuid, p_user uuid, p_inicio date)
 returns date
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select v.prazo
    from (select extract(year from p_inicio)::int as ano,
                 public.ferias_prazo_decimo(p_tenant, extract(year from p_inicio)::int) as prazo) v
   where public.ferias_nivel_bloqueado(p_tenant, p_user)
     and (now() at time zone 'America/Sao_Paulo')::date <= v.prazo
     and not exists (select 1 from public.ferias_decimo_escolhas c
                      where c.tenant_id = p_tenant and c.user_id = p_user and c.ano = v.ano);
$function$;

-- helper interno: chamado só por funções SECURITY DEFINER
revoke execute on function public.ferias_decimo_pendente_ate(uuid, uuid, date) from public, anon, authenticated;

-- A fila de Efetivação do DP marca as previsões que esperam a escolha.
create or replace function public.ferias_efetivacao_aguardando_decimo(p_tenant uuid)
 returns table(solicitacao_id uuid, prazo date)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not public.has_tenant_role(p_tenant, '{owner,admin,hr}'::public.member_role[]) then
    return;
  end if;
  return query
  select x.id, x.prazo
    from (select f.id, public.ferias_decimo_pendente_ate(f.tenant_id, f.user_id, f.start_date) as prazo
            from public.ferias_solicitacoes f
           where f.tenant_id = p_tenant and f.status = 'aprovada') x
   where x.prazo is not null;
end;
$function$;

revoke execute on function public.ferias_efetivacao_aguardando_decimo(uuid) from public, anon;
grant execute on function public.ferias_efetivacao_aguardando_decimo(uuid) to authenticated;

-- ferias_efetivar: igual à anterior, mais a espera da escolha do 13º.
create or replace function public.ferias_efetivar(p_id uuid, p_desconta_rv boolean default true, p_nota text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_l record;
  v_o record;
  v_c record;
  v_aq record;
  v_extra int := 0;
  v_aus uuid;
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
  v_avisar uuid[];
  v_prazo_decimo date;
begin
  select f.* into v_l from public.ferias_solicitacoes f where f.id = p_id;
  if v_l.id is null then
    raise exception 'Previsão não encontrada.';
  end if;
  if not public.has_tenant_role(v_l.tenant_id, '{owner,admin,hr}'::public.member_role[]) then
    raise exception 'Apenas o departamento pessoal efetiva férias.';
  end if;
  if v_l.status <> 'aprovada' then
    raise exception 'Esta previsão não está aguardando efetivação.';
  end if;

  -- 13º do operacional (LUIZ, 17/11/2026): a escolha só corrige previsões não
  -- efetivadas; efetivar antes dela perderia o adiantamento
  v_prazo_decimo := public.ferias_decimo_pendente_ate(v_l.tenant_id, v_l.user_id, v_l.start_date);
  if v_prazo_decimo is not null then
    raise exception '% ainda não escolheu se quer o adiantamento do 13º junto com as férias de %. A escolha é do colaborador, em Minhas férias, até %. A efetivação fica liberada depois da escolha ou quando esse prazo terminar.',
      coalesce(v_l.snap_full_name, 'O colaborador'), extract(year from v_l.start_date)::int,
      to_char(v_prazo_decimo, 'DD/MM/YYYY');
  end if;

  select a.* into v_aq
    from public.ferias_periodos_aquisitivos(v_l.tenant_id, v_l.user_id, current_date, p_id) a
   where a.aq_inicio = v_l.aquisitivo_inicio;
  if v_aq.aq_inicio is null then
    raise exception 'O período aquisitivo desta previsão (% a %) não consta nos dados da folha. Devolva a previsão para ser lançada de novo.',
      to_char(v_l.aquisitivo_inicio, 'DD/MM/YYYY'), to_char(v_l.aquisitivo_fim, 'DD/MM/YYYY');
  end if;
  -- no reagendamento, a original efetivada ainda ocupa o saldo até a troca
  if v_l.reagendada_de is not null then
    select coalesce(sum(o.dias + o.abono_dias), 0)::int into v_extra
      from public.ferias_solicitacoes o
     where o.id = v_l.reagendada_de and o.status = 'efetivada'
       and o.aquisitivo_inicio = v_l.aquisitivo_inicio
       and (v_aq.referencia is null or o.start_date > v_aq.referencia);
  end if;
  if v_l.dias + v_l.abono_dias > v_aq.saldo + v_extra then
    raise exception 'O aquisitivo %/% tem % dia(s) de saldo, menos que os % desta previsão. Os dados da folha mudaram depois da aprovação: devolva a previsão para correção.',
      extract(year from v_aq.aq_inicio)::int, extract(year from v_aq.aq_fim)::int,
      v_aq.saldo + v_extra, v_l.dias + v_l.abono_dias;
  end if;
  if v_l.end_date > v_aq.concessivo_fim and not v_l.em_dobro then
    raise exception 'Esta previsão termina depois do prazo de concessão do aquisitivo (%). Devolva para correção, ou cancele e lance de novo como férias em dobro.',
      to_char(v_aq.concessivo_fim, 'DD/MM/YYYY');
  end if;

  -- daqui em diante a escrita em employee_absences é do módulo, e a trava do
  -- registro direto (que só aceita histórico) deixa passar
  perform set_config('ferias.via_modulo', '1', true);

  if v_l.reagendada_de is not null then
    select f.* into v_o from public.ferias_solicitacoes f where f.id = v_l.reagendada_de;
    if v_o.id is not null and v_o.status = 'efetivada' then
      v_aus := v_o.absence_id;
      update public.ferias_solicitacoes
         set status = 'reagendada', absence_id = null, updated_at = now()
       where id = v_o.id;
      if v_aus is not null then
        delete from public.employee_absences where id = v_aus;
      end if;
      v_aus := null;
    end if;
  end if;

  select e.start_date, e.end_date into v_c
    from public.employee_absences e
   where e.tenant_id = v_l.tenant_id
     and e.user_id = v_l.user_id
     and daterange(e.start_date, e.end_date, '[]')
      && daterange(v_l.start_date, v_l.end_date, '[]')
   limit 1;
  if found then
    raise exception 'O período de % a % cruza com uma ausência já lançada de % a %. Ajuste as datas ou corrija o período em Configurações, na aba Colaboradores.',
      to_char(v_l.start_date, 'DD/MM/YYYY'), to_char(v_l.end_date, 'DD/MM/YYYY'),
      to_char(v_c.start_date, 'DD/MM/YYYY'), to_char(v_c.end_date, 'DD/MM/YYYY');
  end if;

  begin
    insert into public.employee_absences (
      tenant_id, user_id, kind, start_date, end_date, discounts_rv, note, created_by)
    values (
      v_l.tenant_id, v_l.user_id, 'ferias', v_l.start_date, v_l.end_date,
      coalesce(p_desconta_rv, true),
      case when v_l.em_dobro then 'Férias (em dobro)' else 'Férias' end,
      (select auth.uid()))
    returning id into v_aus;
  exception when exclusion_violation then
    select e.start_date, e.end_date into v_c
      from public.employee_absences e
     where e.tenant_id = v_l.tenant_id
       and e.user_id = v_l.user_id
       and daterange(e.start_date, e.end_date, '[]')
        && daterange(v_l.start_date, v_l.end_date, '[]')
     limit 1;
    raise exception 'O período de % a % cruza com uma ausência já lançada de % a %.',
      to_char(v_l.start_date, 'DD/MM/YYYY'), to_char(v_l.end_date, 'DD/MM/YYYY'),
      to_char(v_c.start_date, 'DD/MM/YYYY'), to_char(v_c.end_date, 'DD/MM/YYYY');
  end;

  perform set_config('ferias.via_modulo', '', true);

  update public.ferias_solicitacoes
     set status = 'efetivada', absence_id = v_aus,
         efetivada_at = now(), efetivada_by = (select auth.uid()),
         efetivacao_note = v_nota, updated_at = now()
   where id = p_id;

  v_avisar := array_remove(
    array[v_l.user_id, v_l.created_by, v_l.snap_manager_id], (select auth.uid()));
  if array_length(v_avisar, 1) > 0 then
    perform public.notify_users_sistema(
      v_l.tenant_id, v_avisar, 'ferias_efetivada',
      'Férias efetivadas',
      coalesce(v_l.snap_full_name, 'Colaborador') || ': ' ||
      to_char(v_l.start_date, 'DD/MM/YYYY') || ' a ' || to_char(v_l.end_date, 'DD/MM/YYYY') ||
      ' confirmadas pelo departamento pessoal.');
  end if;
end;
$function$;

revoke execute on function public.ferias_efetivar(uuid, boolean, text) from public, anon;
grant execute on function public.ferias_efetivar(uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
