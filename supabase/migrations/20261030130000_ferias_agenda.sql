-- Férias num período: a base do calendário, do acompanhamento e da programação.
--
-- Junta as duas fontes num formato só:
--   - o FATO (`employee_absences`, kind 'ferias'): efetivadas pelo módulo e o
--     histórico do registro direto, com status 'efetivada';
--   - o PROCESSO ainda em trâmite (`ferias_solicitacoes` solicitada/aprovada).
-- A efetivada do módulo vem pelo fato (com o abono e a marca de dobra da
-- solicitação ao lado), então nada aparece duas vezes.
--
-- Escopo decidido aqui dentro, como no `ferias_painel`: DP e gerencial veem a
-- empresa (inclusive quem já saiu, para o histórico do mês continuar
-- completo), gestor vê a cadeia, o resto vê só a si. A unidade do seletor do
-- topo só encolhe.
--
-- O setor é o de HOJE (a cor do calendário segue o cadastro atual).

create or replace function public.ferias_agenda(
  p_tenant uuid, p_inicio date, p_fim date, p_unit_ids uuid[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_ids uuid[];
  v_itens jsonb;
begin
  if not public.is_tenant_member(p_tenant) then
    raise exception 'Você não é membro desta empresa.';
  end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio then
    raise exception 'Informe um período válido.';
  end if;
  if p_fim - p_inicio > 800 then
    raise exception 'Escolha um período de até dois anos.';
  end if;

  if public.has_tenant_role(p_tenant, '{owner,admin,hr,manager}'::public.member_role[]) then
    select array_agg(m.user_id) into v_ids
      from public.memberships m
     where m.tenant_id = p_tenant;
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

  select coalesce(jsonb_agg(jsonb_build_object(
           'chave', x.chave,
           'userId', x.user_id,
           'nome', p.full_name,
           'matricula', m.employee_code,
           'ativo', m.is_active,
           'setorId', m.department_id,
           'setor', d.name,
           'subsetor', sd.name,
           'cargo', po.name,
           'unidade', (select string_agg(u.name, ', ' order by u.name)
                         from public.membership_units mu
                         join public.units u on u.id = mu.unit_id
                        where mu.membership_id = m.id),
           'status', x.status,
           'origem', x.origem,
           'inicio', x.inicio,
           'fim', x.fim,
           'dias', x.fim - x.inicio + 1,
           'abono', x.abono,
           'emDobro', x.em_dobro,
           'reagendamento', x.reagendamento)
           order by x.inicio, p.full_name), '[]'::jsonb)
    into v_itens
    from (
      select e.id::text as chave, e.user_id, 'efetivada'::text as status,
             case when f.id is null then 'registro' else 'modulo' end as origem,
             e.start_date as inicio, e.end_date as fim,
             coalesce(f.abono_dias, 0) as abono, coalesce(f.em_dobro, false) as em_dobro,
             false as reagendamento
        from public.employee_absences e
        left join public.ferias_solicitacoes f on f.absence_id = e.id
       where e.tenant_id = p_tenant and e.kind = 'ferias'
         and e.user_id = any(v_ids)
         and e.start_date <= p_fim and e.end_date >= p_inicio
      union all
      select f.id::text, f.user_id, f.status::text, 'modulo',
             f.start_date, f.end_date, f.abono_dias, f.em_dobro,
             f.reagendada_de is not null
        from public.ferias_solicitacoes f
       where f.tenant_id = p_tenant
         and f.status in ('solicitada', 'aprovada')
         and f.user_id = any(v_ids)
         and f.start_date <= p_fim and f.end_date >= p_inicio
    ) x
    join public.memberships m on m.tenant_id = p_tenant and m.user_id = x.user_id
    join public.profiles p on p.id = x.user_id
    left join public.departments d on d.id = m.department_id
    left join public.subdepartments sd on sd.id = m.subdepartment_id
    left join public.positions po on po.id = m.position_id;

  return v_itens;
end;
$function$;

revoke execute on function public.ferias_agenda(uuid, date, date, uuid[]) from public, anon;

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
