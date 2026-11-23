-- Quem decide os pedidos da ação (LUIZ, 23/11/2026).
--
-- A tela mostrava Aprovar ao solicitante, mas o banco só aceitava quem criou, admin
-- e proprietário: o solicitante recebia erro e quem criou nem via o botão.
-- Prorrogação de prazo: solicitante, quem criou, admin e proprietário.
-- Reatribuição e conclusão: seguem com quem criou, admin e proprietário.
-- O aviso do pedido vai para quem de fato decide.

create or replace function public.pode_gerir_acao(p_action public.actions)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- o coalesce importa: com created_by nulo o resultado seria NULL, e `if not NULL`
  -- não barra ninguém
  select p_action.tenant_id in (select public.my_tenant_ids())
     and (coalesce(p_action.created_by = (select auth.uid()), false)
          or p_action.tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])));
$function$;

do $migracao$
declare
  v_def text;
  v_de text;
  v_para text;
begin
  v_def := replace(pg_get_functiondef('public.demanda_decide(uuid,boolean,text)'::regprocedure), E'\r\n', E'\n');

  v_de := $a$  if not public.pode_gerir_acao(v_action) then
    raise exception 'Apenas quem criou a ação, um administrador ou o proprietário pode decidir';
  end if;$a$;
  v_para := $b$  if not (public.pode_gerir_acao(v_action)
          or (v_type = 'prazo'
              and coalesce(v_uid = v_requester, false)
              and v_tenant in (select public.my_tenant_ids()))) then
    raise exception 'Você não pode decidir este pedido';
  end if;$b$;
  if position(v_de in v_def) = 0 then raise exception 'demanda_decide: guarda não encontrada'; end if;
  v_def := replace(v_def, v_de, v_para);

  v_de := $a$(case when v_type='prazo' then 'Prorrogação ' else 'Conclusão ' end)$a$;
  v_para := $b$(case v_type when 'prazo' then 'Prorrogação ' when 'reatribuicao' then 'Reatribuição ' else 'Conclusão ' end)$b$;
  if position(v_de in v_def) = 0 then raise exception 'demanda_decide: título não encontrado'; end if;
  execute replace(v_def, v_de, v_para);

  v_def := replace(pg_get_functiondef('public.demanda_request(uuid,text,date,text,uuid[])'::regprocedure), E'\r\n', E'\n');
  v_de := $a$  perform public.notify_users(v_tenant, array[v_requester], 'request',
    case when p_type='prazo' then 'Pedido de prorrogação' else 'Pedido de conclusão' end, v_desc, p_demanda);$a$;
  v_para := $b$  -- avisa quem decide: o prazo é do solicitante (sem ele, de quem criou); o resto, de quem criou
  perform public.notify_users(v_tenant,
    array[case when p_type = 'prazo'
               then coalesce(v_requester, (select a2.created_by from public.actions a2 where a2.id = v_action))
               else (select a2.created_by from public.actions a2 where a2.id = v_action) end],
    'request',
    case p_type when 'prazo' then 'Pedido de prorrogação' when 'reatribuicao' then 'Pedido de reatribuição' else 'Pedido de conclusão' end,
    v_desc, p_demanda);$b$;
  if position(v_de in v_def) = 0 then raise exception 'demanda_request: aviso não encontrado'; end if;
  execute replace(v_def, v_de, v_para);
end
$migracao$;

revoke execute on function public.pode_gerir_acao(public.actions) from public, anon;
grant execute on function public.pode_gerir_acao(public.actions) to authenticated;
revoke execute on function public.demanda_decide(uuid, boolean, text) from public, anon;
revoke execute on function public.demanda_request(uuid, text, date, text, uuid[]) from public, anon;

notify pgrst, 'reload schema';
