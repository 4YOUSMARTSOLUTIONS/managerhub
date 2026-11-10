-- ---------------------------------------------------------------------------
-- Férias, 13º do operacional: a escolha vira definitiva e vai ao DP; o prazo
-- passa a ser da empresa; o gestor acompanha quem já escolheu.
--
-- Pedido do LUIZ (10/11/2026), sobre 20261109220000:
--
-- 1) A escolha é coisa séria: o colaborador confirma e ela vai na hora ao DP
--    (aviso no sino). Depois disso ele NÃO muda pela tela; quem libera uma
--    nova escolha é o DP (`ferias_reabrir_decimo`).
--
-- 2) Prazo da empresa (`ferias_config.decimo_prazo`, 'MM-DD', padrão '01-31').
--    A lei (Lei 4.749/65, art. 2º §2º) garante o adiantamento a quem pede em
--    janeiro do ano das férias: até 31/01 a empresa não pode recusar. Depois,
--    ela pode aceitar se quiser. Então o prazo da empresa vai de 31/01 em
--    diante, nunca antes. Ele substitui o 31/01 fixo nas duas portas do
--    colaborador (o pedido de férias de quem solicita e a escolha anual do
--    operacional); o `decimo_fora_prazo` da config continua dizendo o que
--    fazer depois dele (bloquear ou aceitar com alerta).
--
-- 3) `ferias_painel_decimo`: os operacionais do escopo de quem olha (DP e
--    Gerencial a empresa; gestor a cadeia) e a escolha de cada um no ano.
-- ---------------------------------------------------------------------------

-- 1) o prazo da empresa
alter table public.ferias_config
  add column decimo_prazo text not null default '01-31'
  constraint ferias_config_decimo_prazo_valido
    check (decimo_prazo ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' and decimo_prazo >= '01-31');

create or replace function public.ferias_prazo_decimo(p_tenant uuid, p_ano int)
 returns date
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare
  v text;
  v_mes int;
  v_dia int;
begin
  select c.decimo_prazo into v from public.ferias_config c where c.tenant_id = p_tenant;
  v := coalesce(v, '01-31');
  v_mes := split_part(v, '-', 1)::int;
  v_dia := split_part(v, '-', 2)::int;
  -- 29/02 em ano que não é bissexto (ou 31 num mês de 30): o último dia do mês
  return least(
    make_date(p_ano, v_mes, 1) + (v_dia - 1),
    (make_date(p_ano, v_mes, 1) + interval '1 month - 1 day')::date);
end;
$function$;

revoke execute on function public.ferias_prazo_decimo(uuid, int) from public, anon, authenticated;

-- 2) o pedido de férias de quem solicita usa o prazo da empresa
do $do$
declare
  v_def text;
  a1 text := $q$      v_prazo := make_date(v_ano, 1, 31);$q$;
  a2 text := $q$          'O adiantamento da 1ª parcela do 13º com férias em %s precisava ser pedido até 31/01/%s (Lei 4.749/65). Fora desse prazo, só o gestor ou o departamento pessoal podem lançar.',
          v_ano, v_ano);$q$;
begin
  v_def := pg_get_functiondef('public.ferias_aplicar_prazos_legais(uuid, jsonb, text, date, date)'::regprocedure);
  if strpos(v_def, a1) = 0 or strpos(v_def, a2) = 0 then
    raise exception 'ferias_aplicar_prazos_legais: trecho não encontrado';
  end if;
  v_def := replace(v_def, a1, $q$      v_prazo := public.ferias_prazo_decimo(p_tenant, v_ano);$q$);
  v_def := replace(v_def, a2, $q$          'O adiantamento da 1ª parcela do 13º com férias em %s precisava ser pedido até %s. Fora desse prazo, só o gestor ou o departamento pessoal podem lançar.',
          v_ano, to_char(v_prazo, 'DD/MM/YYYY'));$q$);
  execute v_def;
end
$do$;

-- 3) a escolha: prazo da empresa, definitiva, avisa o DP
create or replace function public.ferias_escolher_decimo(p_tenant uuid, p_ano int, p_quer boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_prazo date;
  v_modo text;
  v_fora boolean;
  v_ja record;
  v_nome text;
  v_dp uuid[];
begin
  if v_uid is null or not public.is_tenant_member(p_tenant) then
    raise exception 'Você não é membro desta empresa.';
  end if;
  if not exists (select 1 from public.memberships m
                  where m.tenant_id = p_tenant and m.user_id = v_uid and m.is_active) then
    raise exception 'Vínculo não encontrado nesta empresa.';
  end if;
  if not public.ferias_nivel_bloqueado(p_tenant, v_uid) then
    raise exception 'O adiantamento do 13º você pede no próprio pedido de férias.';
  end if;
  if p_quer is null or p_ano is null
     or p_ano < extract(year from v_hoje)::int or p_ano > extract(year from v_hoje)::int + 1 then
    raise exception 'Escolha o adiantamento do 13º deste ano ou do próximo.';
  end if;

  -- definitiva: mudar só pelo departamento pessoal
  select c.quer, c.escolhido_em into v_ja from public.ferias_decimo_escolhas c
   where c.tenant_id = p_tenant and c.user_id = v_uid and c.ano = p_ano;
  if found then
    raise exception 'Você já escolheu o adiantamento do 13º das férias de % em %. Para mudar, fale com o departamento pessoal.',
      p_ano, to_char(v_ja.escolhido_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY');
  end if;

  v_prazo := public.ferias_prazo_decimo(p_tenant, p_ano);
  select c.decimo_fora_prazo into v_modo from public.ferias_config c where c.tenant_id = p_tenant;
  v_modo := coalesce(v_modo, 'alerta');
  v_fora := v_hoje > v_prazo;
  if v_fora and v_modo = 'bloquear' then
    raise exception 'O prazo para escolher o adiantamento do 13º das férias de % terminou em %. Fale com o departamento pessoal.',
      p_ano, to_char(v_prazo, 'DD/MM/YYYY');
  end if;

  insert into public.ferias_decimo_escolhas (tenant_id, user_id, ano, quer, fora_prazo, escolhido_em, escolhido_por)
  values (p_tenant, v_uid, p_ano, p_quer, v_fora, now(), v_uid);

  perform public.ferias_decimo_sincronizar(p_tenant, v_uid, p_ano);

  -- vai ao DP na hora
  select p.full_name into v_nome from public.profiles p where p.id = v_uid;
  v_dp := array_remove(public.ferias_destinatarios_dp(p_tenant), v_uid);
  if v_dp is not null and array_length(v_dp, 1) > 0 then
    perform public.notify_users_sistema(
      p_tenant, v_dp, 'ferias_decimo_escolha',
      'Escolha do adiantamento do 13º',
      coalesce(v_nome, 'Colaborador') || ': '
        || case when p_quer then 'quer' else 'não quer' end
        || ' o adiantamento da 1ª parcela do 13º junto com as férias de ' || p_ano || '.'
        || case when v_fora then ' Escolha feita depois do prazo.' else '' end);
  end if;
end;
$function$;

revoke execute on function public.ferias_escolher_decimo(uuid, int, boolean) from public, anon;
grant execute on function public.ferias_escolher_decimo(uuid, int, boolean) to authenticated;

-- 4) o DP libera uma nova escolha
create or replace function public.ferias_reabrir_decimo(p_tenant uuid, p_user uuid, p_ano int)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_choque record;
begin
  if not public.has_tenant_role(p_tenant, '{owner,admin,hr}'::public.member_role[]) then
    raise exception 'Só o departamento pessoal libera uma nova escolha do 13º.';
  end if;
  if not exists (select 1 from public.ferias_decimo_escolhas c
                  where c.tenant_id = p_tenant and c.user_id = p_user and c.ano = p_ano) then
    raise exception 'Esta pessoa ainda não escolheu o adiantamento do 13º de %.', p_ano;
  end if;

  select f.start_date, f.end_date into v_choque
    from public.ferias_solicitacoes f
   where f.tenant_id = p_tenant and f.user_id = p_user and f.status = 'efetivada'
     and f.adiantar_decimo_terceiro and extract(year from f.start_date) = p_ano
   order by f.start_date limit 1;
  if found then
    raise exception 'O adiantamento do 13º de % já foi efetivado nas férias de % a %. Cancele ou reagende essas férias antes.',
      p_ano, to_char(v_choque.start_date, 'DD/MM/YYYY'), to_char(v_choque.end_date, 'DD/MM/YYYY');
  end if;

  delete from public.ferias_decimo_escolhas c
   where c.tenant_id = p_tenant and c.user_id = p_user and c.ano = p_ano;
  perform public.ferias_decimo_sincronizar(p_tenant, p_user, p_ano);

  perform public.notify_users_sistema(
    p_tenant, array[p_user], 'ferias_decimo_reaberto',
    'Escolha do 13º liberada',
    'O departamento pessoal liberou uma nova escolha do adiantamento do 13º das férias de '
      || p_ano || '. Escolha em Férias, Minhas férias.');
end;
$function$;

revoke execute on function public.ferias_reabrir_decimo(uuid, uuid, int) from public, anon;
grant execute on function public.ferias_reabrir_decimo(uuid, uuid, int) to authenticated;

-- 5) quem já escolheu: os operacionais no escopo de quem olha
create or replace function public.ferias_painel_decimo(p_tenant uuid, p_ano int, p_unit_ids uuid[] default null)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare
  v_empresa boolean;
  v_ids uuid[];
begin
  if not public.is_tenant_member(p_tenant) then
    raise exception 'Você não é membro desta empresa.';
  end if;

  v_empresa := public.has_tenant_role(p_tenant, '{owner,admin,hr,manager}'::public.member_role[]);
  if not v_empresa then
    select array_agg(distinct mm.user_id) into v_ids
      from public.my_managed_memberships() mm where mm.tenant_id = p_tenant;
    if v_ids is null then
      return '[]'::jsonb;
    end if;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'userId', m.user_id, 'nome', p.full_name, 'matricula', m.employee_code,
             'unidade', (select u.name from public.membership_units mu join public.units u on u.id = mu.unit_id
                          where mu.membership_id = m.id order by u.name limit 1),
             'setor', d.name,
             'quer', c.quer, 'foraPrazo', c.fora_prazo, 'escolhidoEm', c.escolhido_em)
             order by p.full_name)
      from public.memberships m
      join public.profiles p on p.id = m.user_id
      join public.ferias_niveis_bloqueados b on b.tenant_id = m.tenant_id and b.hierarchy_level_id = m.hierarchy_level_id
      left join public.departments d on d.id = m.department_id
      left join public.ferias_decimo_escolhas c on c.tenant_id = m.tenant_id and c.user_id = m.user_id and c.ano = p_ano
     where m.tenant_id = p_tenant
       and m.is_active
       and (v_empresa or m.user_id = any(v_ids))
       and m.user_id <> (select auth.uid())
       -- afastado sem data de retorno não tem férias a programar
       and not exists (select 1 from public.employee_absences a
                        where a.tenant_id = p_tenant and a.user_id = m.user_id
                          and a.end_date = date '9999-12-31'
                          and a.start_date <= (now() at time zone 'America/Sao_Paulo')::date)
       and (p_unit_ids is null or exists (
             select 1 from public.membership_units mu
              where mu.membership_id = m.id and mu.unit_id = any(p_unit_ids)))
  ), '[]'::jsonb);
end;
$function$;

revoke execute on function public.ferias_painel_decimo(uuid, int, uuid[]) from public, anon;
grant execute on function public.ferias_painel_decimo(uuid, int, uuid[]) to authenticated;

notify pgrst, 'reload schema';
