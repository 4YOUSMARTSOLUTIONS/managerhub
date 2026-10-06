-- O diff do lançamento passa a registrar a troca de indicador.
--
-- A migração de ontem (20261006140000) deixou `goal_id` fora do diff com a
-- justificativa de que ele não muda. Muda: mover um lançamento de um indicador
-- para outro é como se corrige um KPI lançado no lugar errado, e foi a primeira
-- coisa que precisou ser feita depois de ligar a auditoria. Sem ele no diff, a
-- correção não deixava rastro nenhum (um UPDATE só de `goal_id` produzia um diff
-- vazio, que a função descarta).
create or replace function public.audit_lancamento_de_meta()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant  uuid;
  v_id      text;
  v_goal    uuid;
  v_period  date;
  v_label   text;
  v_row     jsonb;
  v_old     jsonb;
  v_new     jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_key     text;
  v_val     jsonb;
  v_ignore constant text[] := array[
    'id','tenant_id','created_at','updated_at','updated_by','created_by','deleted_at'
  ];
begin
  if (tg_op = 'DELETE') then
    v_tenant := old.tenant_id; v_id := old.id::text; v_row := to_jsonb(old);
    v_goal := old.goal_id; v_period := old.period;
  else
    v_tenant := new.tenant_id; v_id := new.id::text; v_row := to_jsonb(new);
    v_goal := new.goal_id; v_period := new.period;
  end if;

  -- "Baixa de pagamentos · 09/2026 · MARIA FERNANDA ROCHA CANABRAVA"
  select g.name || ' · ' || to_char(v_period, 'MM/YYYY') || coalesce(' · ' || p.full_name, '')
    into v_label
    from public.individual_goals g
    left join public.profiles p on p.id = g.owner_id
   where g.id = v_goal;

  if (tg_op = 'UPDATE') then
    v_old := to_jsonb(old); v_new := to_jsonb(new);
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key = any(v_ignore) then continue; end if;
      if (v_old->v_key) is distinct from (v_new->v_key) then
        v_changes := v_changes || jsonb_build_object(
          v_key, jsonb_build_object('de', v_old->v_key, 'para', v_new->v_key)
        );
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return new; end if;
  else
    for v_key, v_val in select key, value from jsonb_each(v_row) loop
      if v_key = any(v_ignore) then continue; end if;
      if v_val is null or v_val = 'null'::jsonb or v_val = '""'::jsonb then continue; end if;
      v_changes := v_changes || jsonb_build_object(v_key, v_val);
    end loop;
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, entity_label, changes)
  values (v_tenant, auth.uid(), tg_op, tg_table_name, v_id, v_label, v_changes);

  if (tg_op = 'DELETE') then return old; else return new; end if;
end;
$function$;

revoke execute on function public.audit_lancamento_de_meta() from public, anon, authenticated;

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
