-- Logs profissionais: rótulo legível do registro + diff campo a campo (de/para) + cobertura ampla.

alter table public.audit_logs add column if not exists entity_label text;

create or replace function public.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid;
  v_entity_id text;
  v_label text;
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_val jsonb;
  v_ignore text[] := array['id','tenant_id','created_at','updated_at','updated_by','created_by','deleted_at'];
begin
  if (tg_op = 'DELETE') then
    v_tenant := old.tenant_id; v_entity_id := old.id::text; v_row := to_jsonb(old);
  else
    v_tenant := new.tenant_id; v_entity_id := new.id::text; v_row := to_jsonb(new);
  end if;

  -- rótulo legível do registro (primeiro campo de nome disponível)
  v_label := coalesce(v_row->>'name', v_row->>'title', v_row->>'full_name', v_row->>'code', v_row->>'label', v_row->>'display_name');

  if (tg_op = 'UPDATE') then
    v_old := to_jsonb(old); v_new := to_jsonb(new);
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key = any(v_ignore) then continue; end if;
      if v_key ~* 'search|vector|tsv|fts|embedding' then continue; end if;
      if (v_old->v_key) is distinct from (v_new->v_key) then
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('de', v_old->v_key, 'para', v_new->v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return new; end if; -- nada relevante mudou (ex.: só updated_at)
  else
    for v_key, v_val in select key, value from jsonb_each(v_row) loop
      if v_key = any(v_ignore) then continue; end if;
      if v_key ~* 'search|vector|tsv|fts|embedding' then continue; end if;
      if v_val is null or v_val = 'null'::jsonb or v_val = '""'::jsonb then continue; end if;
      v_changes := v_changes || jsonb_build_object(v_key, v_val);
    end loop;
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, entity_label, changes)
  values (v_tenant, auth.uid(), tg_op, tg_table_name, v_entity_id, v_label, v_changes);

  if (tg_op = 'DELETE') then return old; else return new; end if;
end; $function$;

-- amplia a cobertura para os cadastros e entidades operacionais (sem duplicar os já existentes)
do $$
declare
  t text;
  tbls text[] := array[
    'departments','subdepartments','positions','position_levels','units',
    'ticket_sectors','ticket_categories','ticket_slas','ticket_manager_sectors',
    'sdpo_programas','sdpo_pilares','sdpo_secoes','sdpo_blocos','sdpo_itens',
    'action_kpis','action_tools','actions',
    'area_goals','individual_goals','individual_rv_config',
    'pnr_categories','pnr_kpis','sustainability_kpis',
    'feedback_competencies','feedback_cadence_rules','holidays'
  ];
begin
  foreach t in array tbls loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format(
        'create or replace trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_trigger()',
        t
      );
    end if;
  end loop;
end $$;
