-- ---------------------------------------------------------------------------
-- Editar colaborador: movimentação exige a data, como na importação.
--
-- Pedido do LUIZ (09/11/2026). A RV pesa cada função pelos dias do mês
-- (src/lib/rv-funcao.ts), então trocar unidade, setor, subsetor, função,
-- nível, hierarquia ou gestor pela ficha passa a exigir o primeiro dia na
-- situação nova. Antes o campo era opcional e, em branco, valia o momento de
-- salvar.
--
-- Mesmas regras de 20261109140000:
--   - campo vazio que passa a ter valor é PREENCHIMENTO: sem data, e a vigência
--     aberta recebe o valor junto (o trigger encontra tudo igual);
--   - subsetor só é preenchimento se o setor não mudou junto (senão a vigência
--     antiga ficaria com um subsetor de outro setor);
--   - a data não pode ser futura nem anterior ao início da situação atual.
--
-- E duas correções que valem para todos os caminhos:
--   - trigger do histórico: mudança no MESMO DIA em que a situação atual
--     começou atualiza a vigência aberta no lugar, em vez de abrir uma de
--     duração zero (ou recusar, quando a aberta começou às 14h e a data
--     informada é o mesmo dia às 0h);
--   - importação: o mesmo cuidado do subsetor no preenchimento.
-- ---------------------------------------------------------------------------

-- 1) trigger: mesmo dia atualiza no lugar
do $do$
declare
  v_def text;
  v_velho text := $q$  if not v_tem_aberta then
    v_from := coalesce(m.admission_date::timestamptz, v_from);
  else
    if v_from < v_open.effective_from then$q$;
begin
  v_def := pg_get_functiondef('public.membership_history_capture()'::regprocedure);
  if strpos(v_def, v_velho) = 0 then
    raise exception 'trigger: trecho não encontrado';
  end if;
  v_def := replace(v_def, v_velho, $q$  if not v_tem_aberta then
    v_from := coalesce(m.admission_date::timestamptz, v_from);
  elsif v_from::date = v_open.effective_from::date then
    -- mudança no mesmo dia em que a situação atual começou: a vigência aberta
    -- recebe o retrato novo, sem abrir uma de duração zero
    update public.membership_history set
      department_id = m.department_id, subdepartment_id = m.subdepartment_id,
      position_id = m.position_id, position_level_id = m.position_level_id,
      hierarchy_level_id = m.hierarchy_level_id, manager_id = m.manager_id,
      role = m.role, employee_code = m.employee_code, is_active = m.is_active,
      dismissed_at = m.dismissed_at, unit_ids = v_units, changed_by = (select auth.uid())
    where id = v_open.id;
    return null;
  else
    if v_from < v_open.effective_from then$q$);
  execute v_def;
end
$do$;

revoke execute on function public.membership_history_capture() from public, anon, authenticated;

-- 2) edição do colaborador
do $do$
declare
  v_def text;
  v_decl text := $q$  v_new_role member_role := nullif(p_data->>'role', '')::member_role;$q$;
  v_ancora text := $q$  perform set_config('app.mov_effective_date', coalesce(nullif(trim(p_data->>'effective_date'), ''), ''), true);$q$;
begin
  v_def := pg_get_functiondef('public.admin_update_employee(uuid, jsonb)'::regprocedure);
  if strpos(v_def, v_decl) = 0 then raise exception 'edição: declaração não encontrada'; end if;
  if strpos(v_def, v_ancora) = 0 then raise exception 'edição: âncora não encontrada'; end if;

  v_def := replace(v_def, v_decl, v_decl || $q$
  v_atual public.memberships%rowtype;
  v_units_atuais uuid[];
  v_units_novas uuid[];
  v_mudou text[] := '{}';
  v_mesmo_setor boolean;
  v_data_mud date;
  v_desde timestamptz;$q$);

  v_def := replace(v_def, v_ancora, v_ancora || $q$

  -- Movimentação exige data (LUIZ, 09/11/2026): a RV pesa cada função pelos
  -- dias do mês. Campo vazio que passa a ter valor é preenchimento, sem data.
  select m.* into v_atual from public.memberships m where m.user_id = p_user and m.tenant_id = v_tenant;
  v_units_atuais := array(select mu.unit_id from public.membership_units mu
                          where mu.membership_id = v_atual.id order by mu.unit_id);
  v_units_novas := array(select distinct x::uuid
                           from jsonb_array_elements_text(coalesce(p_data->'unit_ids', '[]'::jsonb)) as x
                          order by 1);
  v_mesmo_setor := nullif(p_data->>'department_id', '')::uuid is not distinct from v_atual.department_id;

  if v_atual.department_id is not null and not v_mesmo_setor then
    v_mudou := v_mudou || 'Setor'::text;
  end if;
  if v_atual.subdepartment_id is not null
     and nullif(p_data->>'subdepartment_id', '')::uuid is distinct from v_atual.subdepartment_id then
    v_mudou := v_mudou || 'Subsetor'::text;
  end if;
  if v_atual.position_id is not null
     and nullif(p_data->>'position_id', '')::uuid is distinct from v_atual.position_id then
    v_mudou := v_mudou || 'Função'::text;
  end if;
  if v_atual.position_level_id is not null
     and nullif(p_data->>'position_level_id', '')::uuid is distinct from v_atual.position_level_id then
    v_mudou := v_mudou || 'Nível'::text;
  end if;
  if v_atual.hierarchy_level_id is not null
     and nullif(p_data->>'hierarchy_level_id', '')::uuid is distinct from v_atual.hierarchy_level_id then
    v_mudou := v_mudou || 'Hierarquia'::text;
  end if;
  if v_atual.manager_id is not null
     and nullif(p_data->>'manager_id', '')::uuid is distinct from v_atual.manager_id then
    v_mudou := v_mudou || 'Gestor'::text;
  end if;
  if cardinality(v_units_atuais) > 0 and v_units_novas is distinct from v_units_atuais then
    v_mudou := v_mudou || 'Unidade'::text;
  end if;

  if cardinality(v_mudou) > 0 then
    v_data_mud := nullif(trim(p_data->>'effective_date'), '')::date;
    if v_data_mud is null then
      raise exception 'Informe a data da mudança (%): o primeiro dia na situação nova.',
        array_to_string(v_mudou, ', ');
    end if;
    select h.effective_from into v_desde from public.membership_history h
     where h.membership_id = v_atual.id and h.effective_to is null;
    if v_desde is not null and v_data_mud < v_desde::date then
      raise exception 'A data da mudança (%) é anterior ao início da situação atual (%). Use uma data a partir de %.',
        to_char(v_data_mud, 'DD/MM/YYYY'), to_char(v_desde, 'DD/MM/YYYY'), to_char(v_desde, 'DD/MM/YYYY');
    end if;
  end if;

  -- preenchimento: a vigência aberta recebe o valor antes do cadastro
  update public.membership_history h set
    department_id = case when v_atual.department_id is null
                         then nullif(p_data->>'department_id', '')::uuid else h.department_id end,
    subdepartment_id = case when v_atual.subdepartment_id is null and v_mesmo_setor
                            then nullif(p_data->>'subdepartment_id', '')::uuid else h.subdepartment_id end,
    position_id = case when v_atual.position_id is null
                       then nullif(p_data->>'position_id', '')::uuid else h.position_id end,
    position_level_id = case when v_atual.position_level_id is null
                             then nullif(p_data->>'position_level_id', '')::uuid else h.position_level_id end,
    hierarchy_level_id = case when v_atual.hierarchy_level_id is null
                              then nullif(p_data->>'hierarchy_level_id', '')::uuid else h.hierarchy_level_id end,
    manager_id = case when v_atual.manager_id is null
                      then nullif(p_data->>'manager_id', '')::uuid else h.manager_id end,
    unit_ids = case when cardinality(v_units_atuais) = 0 then v_units_novas else h.unit_ids end
  where h.membership_id = v_atual.id and h.effective_to is null
    and (v_atual.department_id is null or v_atual.subdepartment_id is null or v_atual.position_id is null
         or v_atual.position_level_id is null or v_atual.hierarchy_level_id is null
         or v_atual.manager_id is null or cardinality(v_units_atuais) = 0);$q$);
  execute v_def;
end
$do$;

revoke execute on function public.admin_update_employee(uuid, jsonb) from public, anon;
grant execute on function public.admin_update_employee(uuid, jsonb) to authenticated;

-- 3) importação: subsetor só é preenchimento se o setor não mudou junto
do $do$
declare
  v_def text;
  v_velho text := $q$                subdepartment_id = case when v_ex_sub is null then v_sub_final else h.subdepartment_id end,$q$;
begin
  v_def := pg_get_functiondef('public.admin_import_employees(jsonb, text, boolean)'::regprocedure);
  if strpos(v_def, v_velho) = 0 then
    raise exception 'importação: trecho não encontrado';
  end if;
  v_def := replace(v_def, v_velho, $q$                subdepartment_id = case when v_ex_sub is null
                                         and not (v_dept_given and v_dept is distinct from v_ex_dept)
                                        then v_sub_final else h.subdepartment_id end,$q$);
  execute v_def;
end
$do$;

revoke all on function public.admin_import_employees(jsonb, text, boolean) from public, anon;
grant execute on function public.admin_import_employees(jsonb, text, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
