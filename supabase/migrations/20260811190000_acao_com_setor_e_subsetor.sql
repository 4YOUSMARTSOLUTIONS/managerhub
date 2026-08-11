-- Setor e subsetor na ação: recortes que a exportação e os relatórios pedem
-- ("as ações do Comercial", "as do Financeiro"). São do CABEÇALHO da ação e
-- opcionais: nem toda ação nasce amarrada a uma área.
--
-- Não confundir com o setor do RESPONSÁVEL: aquele muda quando a pessoa é
-- transferida e reescreveria o passado. Este fica gravado na ação, é o setor a
-- que a ação se refere, e não se move.
alter table public.actions
  add column if not exists department_id uuid references public.departments(id) on delete set null,
  add column if not exists subdepartment_id uuid references public.subdepartments(id) on delete set null;

create index if not exists actions_department_idx on public.actions(department_id) where department_id is not null;
create index if not exists actions_subdepartment_idx on public.actions(subdepartment_id) where subdepartment_id is not null;

-- create_action e update_action passam a gravá-los, com a mesma checagem de
-- tenant dos demais catálogos (id de outra empresa vira nulo, não erro).
do $do$
declare
  v_def text; v_new text;
  c_ins_col constant text := $q$    meeting_series_id, occurrence_id, kpi_id, tool_id, unit_id,$q$;
  c_ins_col_novo constant text := $q$    meeting_series_id, occurrence_id, kpi_id, tool_id, unit_id, department_id, subdepartment_id,$q$;
  c_ins_val constant text := $q$    (select id from public.units where id = nullif(p_data->>'unit_id','')::uuid and tenant_id = v_tenant),$q$;
  c_ins_val_novo constant text := $q$    (select id from public.units where id = nullif(p_data->>'unit_id','')::uuid and tenant_id = v_tenant),
    (select id from public.departments where id = nullif(p_data->>'department_id','')::uuid and tenant_id = v_tenant),
    (select id from public.subdepartments where id = nullif(p_data->>'subdepartment_id','')::uuid and tenant_id = v_tenant),$q$;
  c_upd constant text := $q$    unit_id = (select id from public.units where id = nullif(p_data->>'unit_id','')::uuid and tenant_id = v_tenant),$q$;
  c_upd_novo constant text := $q$    unit_id = (select id from public.units where id = nullif(p_data->>'unit_id','')::uuid and tenant_id = v_tenant),
    department_id = (select id from public.departments where id = nullif(p_data->>'department_id','')::uuid and tenant_id = v_tenant),
    subdepartment_id = (select id from public.subdepartments where id = nullif(p_data->>'subdepartment_id','')::uuid and tenant_id = v_tenant),$q$;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_action';
  v_new := replace(v_def, c_ins_col, c_ins_col_novo);
  v_new := replace(v_new, c_ins_val, c_ins_val_novo);
  if v_new = v_def then raise exception 'create_action: trechos do insert não encontrados'; end if;
  execute v_new;

  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'update_action';
  v_new := replace(v_def, c_upd, c_upd_novo);
  if v_new = v_def then raise exception 'update_action: linha do unit_id não encontrada'; end if;
  execute v_new;
end
$do$;

revoke execute on function public.create_action(jsonb) from public, anon;
revoke execute on function public.update_action(uuid, jsonb) from public, anon;
