-- O responsável pode PEDIR reatribuição; quem gere a ação aprova.
--
-- Reatribuir direto continua sendo de quem gere (criador/owner/admin). O
-- responsável, que antes só podia pedir prazo ou conclusão, ganha um terceiro
-- pedido: sair da demanda, sugerindo para quem vai.
--
-- `demanda_requests.type` é text, então o tipo novo não precisa de enum; o que
-- falta é onde guardar os sugeridos.
alter table public.demanda_requests
  add column if not exists new_assignees uuid[] not null default '{}';

-- 1. pedir: aceita o tipo novo. A guarda de "só o responsável pede" já existe.
do $do$
declare
  v_def text; v_new text;
  c_tipo constant text := $q$if p_type not in ('prazo','conclusao') then raise exception 'Tipo inválido'; end if;$q$;
  c_tipo_novo constant text := $q$if p_type not in ('prazo','conclusao','reatribuicao') then raise exception 'Tipo inválido'; end if;$q$;
  c_ins constant text := $q$  insert into public.demanda_requests (tenant_id, demanda_id, type, requested_by, new_due_date, note)
  values (v_tenant, p_demanda, p_type, v_uid, case when p_type='prazo' then p_new_due end, nullif(trim(p_note),''));$q$;
  c_ins_novo constant text := $q$  insert into public.demanda_requests (tenant_id, demanda_id, type, requested_by, new_due_date, note, new_assignees)
  values (v_tenant, p_demanda, p_type, v_uid, case when p_type='prazo' then p_new_due end, nullif(trim(p_note),''),
          case when p_type='reatribuicao' then coalesce(p_assignees, '{}') else '{}' end);$q$;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'demanda_request';

  -- assinatura nova com os sugeridos (default preserva as chamadas existentes)
  v_new := replace(v_def,
    'FUNCTION public.demanda_request(p_demanda uuid, p_type text, p_new_due date, p_note text)',
    'FUNCTION public.demanda_request(p_demanda uuid, p_type text, p_new_due date, p_note text, p_assignees uuid[] DEFAULT ''{}'')');
  v_new := replace(v_new, c_tipo, c_tipo_novo);
  v_new := replace(v_new, c_ins, c_ins_novo);
  if v_new = v_def then raise exception 'demanda_request: trechos esperados não encontrados'; end if;
  execute v_new;
end
$do$;

-- a assinatura antiga (4 args) sai de cena: a nova a cobre pelo default, e
-- deixar as duas tornaria a chamada de 4 argumentos ambígua
drop function if exists public.demanda_request(uuid, text, date, text);

-- 2. decidir: quem gere a ação aprova (não mais só o solicitante), e aprovar
--    uma reatribuição aplica a troca de responsáveis.
do $do$
declare
  v_def text; v_new text;
  c_decl constant text := $q$declare v_tenant uuid; v_demanda uuid; v_type text; v_new_due date; v_req_by uuid; v_uid uuid := auth.uid(); v_requester uuid; v_desc text;$q$;
  c_decl_novo constant text := $q$declare v_tenant uuid; v_demanda uuid; v_type text; v_new_due date; v_req_by uuid; v_uid uuid := auth.uid(); v_requester uuid; v_desc text;
  v_action public.actions; v_new_assignees uuid[];$q$;

  c_sel constant text := $q$  select r.tenant_id, r.demanda_id, r.type, r.new_due_date, r.requested_by
  into v_tenant, v_demanda, v_type, v_new_due, v_req_by
  from demanda_requests r where r.id = p_request and r.status = 'pending';$q$;
  c_sel_novo constant text := $q$  select r.tenant_id, r.demanda_id, r.type, r.new_due_date, r.requested_by, r.new_assignees
  into v_tenant, v_demanda, v_type, v_new_due, v_req_by, v_new_assignees
  from demanda_requests r where r.id = p_request and r.status = 'pending';$q$;

  c_guard constant text := $q$  if v_uid <> v_requester then raise exception 'Apenas o solicitante da ação pode aprovar'; end if;$q$;
  c_guard_novo constant text := $q$  select a.* into v_action from action_demandas d join actions a on a.id = d.action_id where d.id = v_demanda;
  if not public.pode_gerir_acao(v_action) then
    raise exception 'Apenas quem criou a ação, um administrador ou o proprietário pode decidir';
  end if;$q$;

  c_apply constant text := $q$  elsif p_approve and v_type = 'conclusao' then
    update action_demandas set status = 'done', completed_at = now() where id = v_demanda;
  end if;$q$;
  c_apply_novo constant text := $q$  elsif p_approve and v_type = 'conclusao' then
    update action_demandas set status = 'done', completed_at = now() where id = v_demanda;
  elsif p_approve and v_type = 'reatribuicao' then
    -- sem sugestão, o pedido só tira quem pediu; a demanda não pode ficar órfã
    if coalesce(array_length(v_new_assignees, 1), 0) = 0 then
      raise exception 'O pedido não indica para quem passar. Reatribua pelo botão Reatribuir.';
    end if;
    delete from public.action_demanda_assignees where demanda_id = v_demanda;
    insert into public.action_demanda_assignees (demanda_id, user_id)
    select v_demanda, x from unnest(v_new_assignees) x
     where exists (select 1 from public.memberships m where m.tenant_id = v_tenant and m.user_id = x)
    on conflict do nothing;
  end if;$q$;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'demanda_decide';

  v_new := replace(v_def, c_decl, c_decl_novo);
  v_new := replace(v_new, c_sel, c_sel_novo);
  v_new := replace(v_new, c_guard, c_guard_novo);
  v_new := replace(v_new, c_apply, c_apply_novo);
  if v_new = v_def then raise exception 'demanda_decide: trechos esperados não encontrados'; end if;
  execute v_new;
end
$do$;

revoke execute on function public.demanda_request(uuid, text, date, text, uuid[]) from public, anon;
revoke execute on function public.demanda_decide(uuid, boolean, text) from public, anon;

-- O tipo de pedido é text com CHECK, e o CHECK ainda listava só os dois
-- antigos: sem isto o pedido de reatribuição é recusado pela constraint,
-- depois de passar por toda a guarda da função.
alter table public.demanda_requests drop constraint if exists demanda_requests_type_check;
alter table public.demanda_requests add constraint demanda_requests_type_check
  check (type = any (array['prazo'::text, 'conclusao'::text, 'reatribuicao'::text]));
