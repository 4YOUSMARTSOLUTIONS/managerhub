-- ---------------------------------------------------------------------------
-- Importação de colaboradores: mudança de cadastro vira MOVIMENTAÇÃO com data.
--
-- Pedido do LUIZ (09/11/2026): quando a planilha muda Função, Nível, Setor,
-- Subsetor, Gestor ou Hierarquia de quem já está cadastrado, isso é uma
-- movimentação, e quem importa informa a data de cada uma. Antes a planilha só
-- alcançava gestor, perfil, hierarquia e (desde 20261109120000) nível, sempre
-- com a data do dia; função, setor e subsetor nem eram atualizados.
--
-- Regras, para quem já tem cadastro com a mesma matrícula:
--   - campo VAZIO no sistema recebe o valor da planilha como PREENCHIMENTO:
--     sem data, e a vigência aberta do histórico recebe o valor junto
--   - trocar um valor que existia é MOVIMENTAÇÃO: exige a data da mudança
--     (`effective_date` da linha, AAAA-MM-DD), que não pode ser futura nem
--     anterior ao início da situação atual (as regras de Editar colaborador)
--   - célula vazia na planilha não mexe; "-" tira gestor e hierarquia
--   - trocar o setor sem informar o subsetor limpa o subsetor (o antigo é de
--     outro setor)
--   - perfil de acesso e desligamento seguem como eram (sem data pedida)
--
-- `p_simular = true` roda a importação inteira e desfaz tudo: devolve, em
-- `pendentes`, quem tem movimentação e precisa de data. É a prévia da tela.
--
-- Os nomes de função, setor e subsetor casam sem caixa e sem acento, para a
-- planilha não criar duplicatas de cadastro.
--
-- A gravação com data não usa o GUC `app.mov_effective_date`: o trigger de
-- histórico é diferido e, numa importação de várias linhas, leria no commit a
-- data da ÚLTIMA. `membership_history_registrar` grava a vigência na hora,
-- linha a linha, e o trigger encontra tudo igual e não faz nada.
-- ---------------------------------------------------------------------------

create or replace function public.membership_history_registrar(p_mid uuid, p_from date)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  m public.memberships%rowtype;
  v_units uuid[];
  v_open public.membership_history%rowtype;
  v_from timestamptz;
begin
  select * into m from public.memberships where id = p_mid;
  if not found then
    return;
  end if;

  select coalesce(array_agg(u.unit_id order by u.unit_id), '{}') into v_units
    from public.membership_units u where u.membership_id = p_mid;

  select * into v_open from public.membership_history h
   where h.membership_id = p_mid and h.effective_to is null;

  if not found then
    insert into public.membership_history (
      tenant_id, membership_id, user_id, effective_from,
      department_id, subdepartment_id, position_id, position_level_id,
      hierarchy_level_id, manager_id, role, employee_code, is_active,
      dismissed_at, unit_ids, changed_by, source
    ) values (
      m.tenant_id, m.id, m.user_id, coalesce(m.admission_date::timestamptz, p_from::timestamptz),
      m.department_id, m.subdepartment_id, m.position_id, m.position_level_id,
      m.hierarchy_level_id, m.manager_id, m.role, m.employee_code, m.is_active,
      m.dismissed_at, v_units, (select auth.uid()), 'importacao');
    return;
  end if;

  if v_open.department_id is not distinct from m.department_id
     and v_open.subdepartment_id is not distinct from m.subdepartment_id
     and v_open.position_id is not distinct from m.position_id
     and v_open.position_level_id is not distinct from m.position_level_id
     and v_open.hierarchy_level_id is not distinct from m.hierarchy_level_id
     and v_open.manager_id is not distinct from m.manager_id
     and v_open.role = m.role
     and v_open.employee_code is not distinct from m.employee_code
     and v_open.is_active = m.is_active
     and v_open.dismissed_at is not distinct from m.dismissed_at
     and v_open.unit_ids = v_units then
    return;
  end if;

  if p_from < v_open.effective_from::date then
    raise exception 'A data da mudança (%) é anterior ao início da situação atual (%). Use uma data a partir de %.',
      to_char(p_from, 'DD/MM/YYYY'), to_char(v_open.effective_from, 'DD/MM/YYYY'),
      to_char(v_open.effective_from, 'DD/MM/YYYY');
  end if;

  -- mesma data da situação atual: é correção dela, não uma vigência de zero dia
  if p_from = v_open.effective_from::date then
    update public.membership_history set
      department_id = m.department_id, subdepartment_id = m.subdepartment_id,
      position_id = m.position_id, position_level_id = m.position_level_id,
      hierarchy_level_id = m.hierarchy_level_id, manager_id = m.manager_id,
      role = m.role, employee_code = m.employee_code, is_active = m.is_active,
      dismissed_at = m.dismissed_at, unit_ids = v_units,
      changed_by = (select auth.uid()), source = 'importacao'
    where id = v_open.id;
    return;
  end if;

  v_from := p_from::timestamptz;
  update public.membership_history set effective_to = v_from where id = v_open.id;
  insert into public.membership_history (
    tenant_id, membership_id, user_id, effective_from,
    department_id, subdepartment_id, position_id, position_level_id,
    hierarchy_level_id, manager_id, role, employee_code, is_active,
    dismissed_at, unit_ids, changed_by, source
  ) values (
    m.tenant_id, m.id, m.user_id, v_from,
    m.department_id, m.subdepartment_id, m.position_id, m.position_level_id,
    m.hierarchy_level_id, m.manager_id, m.role, m.employee_code, m.is_active,
    m.dismissed_at, v_units, (select auth.uid()), 'importacao');
end;
$function$;

-- helper interno: só a importação chama, sob o dono
revoke execute on function public.membership_history_registrar(uuid, date) from public, anon, authenticated;

-- a assinatura ganha `p_simular`: a versão antiga sai para não haver duas
drop function if exists public.admin_import_employees(jsonb, text);

create function public.admin_import_employees(p_rows jsonb, p_password text, p_simular boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_tenant uuid := public.my_active_tenant();
  v_hash text;
  v_pode_papel boolean;
  r jsonb;
  v_cpf text; v_email text; v_auth_email text; v_name text;
  v_dept uuid; v_sub uuid; v_pos uuid; v_lvl uuid; v_unit uuid;
  v_uid uuid; v_mid uuid; v_dismissed date; v_adm date;
  v_gender gender_type; v_kind unit_kind;
  v_unit_names text[];
  v_code text; v_existing_uid uuid; v_existing_mid uuid; v_existing_code text; v_existing_adm date;
  v_ex_dis date; v_ex_dept uuid; v_ex_sub uuid; v_ex_pos uuid; v_ex_lvl uuid;
  v_mgr uuid; v_mgr_given boolean; v_mgr_code text; v_mgr_ref text;
  v_mgr_digits text; v_mgr_n int; v_cur_mgr uuid; v_mgr_name text; v_mgr_pool uuid[]; v_mgr_filtro uuid[];
  v_role member_role; v_role_given boolean; v_role_txt text; v_cur_role member_role;
  v_hier uuid; v_hier_given boolean; v_hier_name text; v_cur_hier uuid; v_hier_label text;
  v_lvl_given boolean; v_lvl_label text;
  v_dept_given boolean; v_sub_given boolean; v_pos_given boolean; v_sub_final uuid;
  v_mov jsonb; v_fill boolean; v_role_muda boolean; v_muda boolean;
  v_data_mud date; v_desde timestamptz;
  v_created int := 0; v_updated int := 0; v_skipped int := 0; v_archived int := 0;
  v_managers int := 0; v_roles int := 0; v_hiers int := 0; v_levels int := 0;
  v_movs int := 0; v_fills int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_skipped_list jsonb := '[]'::jsonb;
  v_updated_list jsonb := '[]'::jsonb;
  v_managers_list jsonb := '[]'::jsonb;
  v_roles_list jsonb := '[]'::jsonb;
  v_hiers_list jsonb := '[]'::jsonb;
  v_levels_list jsonb := '[]'::jsonb;
  v_movs_list jsonb := '[]'::jsonb;
  v_pendentes jsonb := '[]'::jsonb;
begin
  if v_tenant is null or not public.has_tenant_role(v_tenant, array['owner','admin','hr']::member_role[]) then
    raise exception 'Sem permissão';
  end if;
  v_pode_papel := public.has_tenant_role(v_tenant, array['owner','admin']::member_role[]);
  if not p_simular and (p_password is null or length(p_password) < 8) then
    raise exception 'Senha padrão mínima de 8 caracteres';
  end if;
  -- na prévia nada é gravado: dispensa o custo do hash
  v_hash := case when p_simular then 'simulacao' else crypt(p_password, gen_salt('bf')) end;

  begin
  for r in select value from jsonb_array_elements(p_rows) as t(value) loop
    begin
      v_mid := null;
      v_cpf := nullif(regexp_replace(coalesce(r->>'cpf', ''), '[^0-9]', '', 'g'), '');
      if v_cpf is null or v_cpf !~ '^[0-9]{11}$' then
        v_errors := v_errors || jsonb_build_object('nome', r->>'full_name', 'erro', 'CPF inválido'); continue;
      end if;
      if coalesce(trim(r->>'full_name'), '') = '' then
        v_errors := v_errors || jsonb_build_object('cpf', v_cpf, 'erro', 'Nome vazio'); continue;
      end if;

      v_code := nullif(trim(r->>'employee_code'), '');
      if v_code is null then
        v_errors := v_errors || jsonb_build_object('nome', r->>'full_name', 'cpf', v_cpf, 'erro', 'Matrícula vazia'); continue;
      end if;
      v_adm := public.parse_br_date(r->>'admission_date');
      v_dismissed := public.parse_br_date(r->>'dismissed_at');

      v_role := null; v_role_given := false;
      v_role_txt := case when v_pode_papel
                        then lower(unaccent(coalesce(trim(r->>'role'), ''))) else '' end;
      if v_role_txt <> '' then
        v_role_given := true;
        v_role := case v_role_txt
                    when 'gestor' then 'team_lead' when 'team_lead' then 'team_lead'
                    when 'gerencial' then 'manager' when 'manager' then 'manager'
                    when 'funcionario' then 'member' when 'membro' then 'member' when 'member' then 'member'
                    else null end;
        if v_role is null then
          if v_role_txt in ('rh', 'hr', 'recursos humanos') then
            v_errors := v_errors || jsonb_build_object('nome', trim(r->>'full_name'), 'cpf', v_cpf,
              'erro', 'RH não é perfil. Use Gestor, Gerencial ou Funcionário e marque a opção RH no cadastro do colaborador.');
          elsif v_role_txt in ('administrador', 'admin', 'proprietario', 'owner') then
            v_errors := v_errors || jsonb_build_object('nome', trim(r->>'full_name'), 'cpf', v_cpf,
              'erro', 'Perfil "' || trim(r->>'role') || '" não pode ser dado por planilha. Use a tela de colaboradores.');
          else
            v_errors := v_errors || jsonb_build_object('nome', trim(r->>'full_name'), 'cpf', v_cpf,
              'erro', 'Perfil desconhecido: "' || trim(r->>'role') || '". Use Gestor, Gerencial ou Funcionário.');
          end if;
          continue;
        end if;
      end if;

      -- ------------------------------------------------------------ hierarquia
      v_hier := null; v_hier_given := false; v_hier_label := null;
      v_hier_name := nullif(trim(r->>'hierarchy'), '');
      if v_hier_name is not null then
        v_hier_given := true;
        if lower(v_hier_name) in ('-', 'nenhum', 'sem hierarquia') then
          v_hier := null;
        else
          select id, name into v_hier, v_hier_label from public.hierarchy_levels
           where tenant_id = v_tenant and lower(unaccent(name)) = lower(unaccent(v_hier_name));
          if v_hier is null then
            insert into public.hierarchy_levels (tenant_id, name, rank)
            values (v_tenant, v_hier_name,
                    coalesce((select max(rank) from public.hierarchy_levels where tenant_id = v_tenant), 0) + 10)
            returning id, name into v_hier, v_hier_label;
          end if;
        end if;
      end if;

      v_mgr := null; v_mgr_given := false; v_mgr_name := null;
      v_mgr_code := nullif(trim(r->>'manager_code'), '');
      v_mgr_ref  := nullif(trim(r->>'manager'), '');

      if lower(coalesce(v_mgr_code, v_mgr_ref, '')) in ('-', 'nenhum', 'sem gestor') then
        v_mgr_given := true; v_mgr := null;
      elsif v_mgr_code is not null or v_mgr_ref is not null then
        v_mgr_given := true;
        if v_mgr_code is not null then
          -- unidades da LINHA (a mesma leitura roda de novo mais abaixo; repetir é inócuo)
          v_unit_names := '{}';
          if jsonb_typeof(r->'units') = 'array' then
            select array_agg(trim(x)) into v_unit_names from jsonb_array_elements_text(r->'units') as x where nullif(trim(x), '') is not null;
          elsif nullif(trim(r->>'unit'), '') is not null then
            select array_agg(trim(x)) into v_unit_names from regexp_split_to_table(r->>'unit', '[;,/]') as x where nullif(trim(x), '') is not null;
          end if;
          -- TODOS os donos da matrícula: nunca escolher um em silêncio
          select array_agg(m2.user_id) into v_mgr_pool from public.memberships m2
           where m2.tenant_id = v_tenant and m2.employee_code = v_mgr_code;
          if (select count(*) from public.units u where u.tenant_id = v_tenant) > 1 then
            -- empresa multiunidade: o casamento é por unidade + matrícula, e a
            -- unidade é a da linha do subordinado
            select array_agg(distinct m2.user_id) into v_mgr_filtro
              from public.memberships m2
              join public.membership_units mu on mu.membership_id = m2.id
              join public.units u on u.id = mu.unit_id
             where m2.tenant_id = v_tenant
               and m2.user_id = any(coalesce(v_mgr_pool, '{}'))
               and lower(unaccent(u.name)) = any(select lower(unaccent(x)) from unnest(coalesce(v_unit_names, '{}')) as x);
            v_mgr_pool := v_mgr_filtro;
          end if;
          if coalesce(array_length(v_mgr_pool, 1), 0) = 1 then
            v_mgr := v_mgr_pool[1];
          elsif v_mgr_ref is null then
            v_errors := v_errors || jsonb_build_object('nome', trim(r->>'full_name'), 'cpf', v_cpf,
              'erro', 'Código Gestor "' || v_mgr_code || '" não encontrado ou não resolve pela unidade da linha. Use o CPF do gestor na coluna Gestor.');
            continue;
          end if;
        end if;
        if v_mgr is null and v_mgr_ref is not null then
          v_mgr_digits := nullif(regexp_replace(v_mgr_ref, '[^0-9]', '', 'g'), '');
          if v_mgr_digits ~ '^[0-9]{11}$' then
            select p2.id into v_mgr from public.profiles p2
              join public.memberships m2 on m2.user_id = p2.id and m2.tenant_id = v_tenant
             where p2.cpf = v_mgr_digits;
          end if;
        end if;
        if v_mgr is null then
          v_errors := v_errors || jsonb_build_object('nome', trim(r->>'full_name'), 'cpf', v_cpf,
            'erro', 'Gestor não encontrado nesta empresa: "' || coalesce(v_mgr_code, v_mgr_ref) || '". Use a matrícula no Código Gestor ou o CPF na coluna Gestor; nome não identifica.');
          continue;
        end if;
        select p2.full_name into v_mgr_name from public.profiles p2 where p2.id = v_mgr;
      end if;

      v_unit_names := '{}';
      if jsonb_typeof(r->'units') = 'array' then
        select array_agg(trim(x)) into v_unit_names from jsonb_array_elements_text(r->'units') as x where nullif(trim(x), '') is not null;
      elsif nullif(trim(r->>'unit'), '') is not null then
        select array_agg(trim(x)) into v_unit_names from regexp_split_to_table(r->>'unit', '[;,/]') as x where nullif(trim(x), '') is not null;
      end if;

      -- função, setor e subsetor casam sem caixa e sem acento (o nome exato
      -- tem preferência), para a planilha não duplicar o cadastro
      v_dept := null; v_name := nullif(trim(r->>'department'), '');
      if v_name is not null then
        select id into v_dept from public.departments
         where tenant_id = v_tenant and lower(unaccent(name)) = lower(unaccent(v_name))
         order by (name = v_name) desc, name limit 1;
        if v_dept is null then insert into public.departments(tenant_id, name) values (v_tenant, v_name) returning id into v_dept; end if;
      end if;
      v_dept_given := v_dept is not null;

      v_sub := null; v_name := nullif(trim(r->>'subdepartment'), '');
      if v_dept is not null and v_name is not null and lower(v_name) not in ('não informado', 'nao informado', 'n/a', '-') then
        select id into v_sub from public.subdepartments
         where department_id = v_dept and lower(unaccent(name)) = lower(unaccent(v_name))
         order by (name = v_name) desc, name limit 1;
        if v_sub is null then insert into public.subdepartments(tenant_id, department_id, name) values (v_tenant, v_dept, v_name) returning id into v_sub; end if;
      end if;
      v_sub_given := v_sub is not null;

      v_pos := null; v_name := nullif(trim(r->>'position'), '');
      if v_name is not null then
        select id into v_pos from public.positions
         where tenant_id = v_tenant and lower(unaccent(name)) = lower(unaccent(v_name))
         order by (name = v_name) desc, name limit 1;
        if v_pos is null then insert into public.positions(tenant_id, name) values (v_tenant, v_name) returning id into v_pos; end if;
      end if;
      v_pos_given := v_pos is not null;

      v_lvl := null; v_lvl_label := null; v_name := nullif(trim(r->>'level'), '');
      if v_name is not null and length(v_name) <= 40 then
        -- sem caixa e sem acento: "Junior" é o JUNIOR que já existe
        select id, name into v_lvl, v_lvl_label from public.position_levels
         where tenant_id = v_tenant and lower(unaccent(name)) = lower(unaccent(v_name))
         order by name limit 1;
        if v_lvl is null then
          insert into public.position_levels(tenant_id, name) values (v_tenant, v_name)
          returning id, name into v_lvl, v_lvl_label;
        end if;
      end if;
      -- vazio não apaga o nível de quem já tem (como gestor e hierarquia)
      v_lvl_given := v_lvl is not null;

      v_gender := case lower(coalesce(trim(r->>'gender'), ''))
                    when 'masculino' then 'masculino' when 'm' then 'masculino'
                    when 'feminino' then 'feminino' when 'f' then 'feminino'
                    when 'outro' then 'outro' else 'nao_informado' end;

      v_email := nullif(lower(trim(r->>'email')), '');
      if v_email is not null and exists (select 1 from auth.users u where u.email = v_email and u.id is distinct from (select p2.id from public.profiles p2 where p2.cpf = v_cpf)) then v_email := null; end if;

      select id into v_existing_uid from public.profiles where cpf = v_cpf;

      if v_mgr_given and v_mgr is not null and v_mgr = v_existing_uid then
        v_errors := v_errors || jsonb_build_object('nome', trim(r->>'full_name'), 'cpf', v_cpf,
          'erro', 'O gestor não pode ser o próprio colaborador');
        continue;
      end if;

      if v_existing_uid is not null then
        select id, employee_code, admission_date, dismissed_at, department_id, subdepartment_id,
               position_id, position_level_id, manager_id, role, hierarchy_level_id
          into v_existing_mid, v_existing_code, v_existing_adm, v_ex_dis, v_ex_dept, v_ex_sub,
               v_ex_pos, v_ex_lvl, v_cur_mgr, v_cur_role, v_cur_hier
        from public.memberships where tenant_id = v_tenant and user_id = v_existing_uid;

        if v_role_given and v_existing_mid is not null and v_cur_role in ('owner', 'admin') then
          v_role_given := false;
        end if;

        if v_existing_mid is null then
          insert into public.memberships (tenant_id, user_id, role, employee_code, admission_date,
            department_id, subdepartment_id, position_id, position_level_id, hierarchy_level_id,
            manager_id, is_active, dismissed_at)
          values (v_tenant, v_existing_uid, coalesce(v_role, 'member'), v_code, v_adm,
            v_dept, v_sub, v_pos, v_lvl, v_hier, v_mgr, v_dismissed is null, v_dismissed)
          returning id into v_mid;
          v_created := v_created + 1;

        elsif v_code is not null and v_existing_code is distinct from v_code then
          if (v_adm is not null and v_existing_adm is not null and v_adm < v_existing_adm)
             or ((v_adm is null or v_existing_adm is null or v_adm = v_existing_adm)
                 and ((v_dismissed is not null and v_ex_dis is null)
                      or (v_dismissed is not null and v_ex_dis is not null and v_dismissed < v_ex_dis))) then
            insert into public.employee_contracts (tenant_id, user_id, employee_code, admission_date,
              dismissed_at, department_id, subdepartment_id, position_id, position_level_id, source)
            values (v_tenant, v_existing_uid, v_code, v_adm, v_dismissed, v_dept, v_sub, v_pos, v_lvl, 'import')
            on conflict do nothing;
            v_archived := v_archived + 1;
            v_skipped := v_skipped + 1;
            v_skipped_list := v_skipped_list || jsonb_build_object(
              'nome', trim(r->>'full_name'), 'cpf', v_cpf, 'codigo', v_code,
              'motivo', 'Contrato encerrado (matrícula ' || v_code || coalesce(', admissão ' || to_char(v_adm, 'DD/MM/YYYY'), '') || coalesce(', demissão ' || to_char(v_dismissed, 'DD/MM/YYYY'), '') ||
                        ') guardado no histórico. Cadastro atual mantido (matrícula ' || coalesce(v_existing_code, 'sem matrícula') || coalesce(', admissão ' || to_char(v_existing_adm, 'DD/MM/YYYY'), '') ||
                        ').');
            continue;
          end if;

          insert into public.employee_contracts (tenant_id, user_id, employee_code, admission_date,
            dismissed_at, department_id, subdepartment_id, position_id, position_level_id, source)
          values (v_tenant, v_existing_uid, v_existing_code, v_existing_adm, v_ex_dis, v_ex_dept, v_ex_sub, v_ex_pos, v_ex_lvl, 'import')
          on conflict do nothing;
          v_archived := v_archived + 1;

          update public.memberships set
            employee_code = v_code,
            admission_date = coalesce(v_adm, admission_date),
            department_id = coalesce(v_dept, department_id),
            subdepartment_id = coalesce(v_sub, subdepartment_id),
            position_id = coalesce(v_pos, position_id),
            position_level_id = coalesce(v_lvl, position_level_id),
            hierarchy_level_id = case when v_hier_given then v_hier else hierarchy_level_id end,
            manager_id = case when v_mgr_given then v_mgr else manager_id end,
            role = case when v_role_given then v_role else role end,
            dismissed_at = v_dismissed,
            is_active = (v_dismissed is null)
          where id = v_existing_mid;
          v_mid := v_existing_mid;
          v_updated := v_updated + 1;
          v_updated_list := v_updated_list || jsonb_build_object(
            'nome', trim(r->>'full_name'), 'cpf', v_cpf,
            'motivo', 'Recontratação: código ' || coalesce(v_existing_code, 'sem código') || ' -> ' || v_code ||
                      ' (contrato anterior guardado no histórico)');

        else
          -- ---------------------------------------- mesma matrícula: o que muda
          -- Campo vazio no sistema recebe o valor como PREENCHIMENTO (sem data).
          -- Trocar um valor que existia é MOVIMENTAÇÃO e pede a data da mudança.
          v_sub_final := case when v_sub_given then v_sub
                              when v_dept_given and v_dept is distinct from v_ex_dept then null
                              else v_ex_sub end;
          v_mov := '[]'::jsonb;
          v_fill := false;

          if v_pos_given and v_pos is distinct from v_ex_pos then
            if v_ex_pos is null then v_fill := true;
            else v_mov := v_mov || jsonb_build_object('campo', 'Função',
              'de', (select name from public.positions where id = v_ex_pos),
              'para', (select name from public.positions where id = v_pos));
            end if;
          end if;
          if v_lvl_given and v_lvl is distinct from v_ex_lvl then
            if v_ex_lvl is null then v_fill := true;
            else v_mov := v_mov || jsonb_build_object('campo', 'Nível',
              'de', (select name from public.position_levels where id = v_ex_lvl), 'para', v_lvl_label);
            end if;
          end if;
          if v_dept_given and v_dept is distinct from v_ex_dept then
            if v_ex_dept is null then v_fill := true;
            else v_mov := v_mov || jsonb_build_object('campo', 'Setor',
              'de', (select name from public.departments where id = v_ex_dept),
              'para', (select name from public.departments where id = v_dept));
            end if;
          end if;
          if v_sub_final is distinct from v_ex_sub then
            if v_ex_sub is null then v_fill := true;
            else v_mov := v_mov || jsonb_build_object('campo', 'Subsetor',
              'de', (select name from public.subdepartments where id = v_ex_sub),
              'para', coalesce((select name from public.subdepartments where id = v_sub_final), '(sem subsetor)'));
            end if;
          end if;
          if v_mgr_given and v_mgr is distinct from v_cur_mgr then
            if v_cur_mgr is null then v_fill := true;
            else v_mov := v_mov || jsonb_build_object('campo', 'Gestor',
              'de', (select full_name from public.profiles where id = v_cur_mgr),
              'para', coalesce(v_mgr_name, '(sem gestor)'));
            end if;
          end if;
          if v_hier_given and v_hier is distinct from v_cur_hier then
            if v_cur_hier is null then v_fill := true;
            else v_mov := v_mov || jsonb_build_object('campo', 'Hierarquia',
              'de', (select name from public.hierarchy_levels where id = v_cur_hier),
              'para', coalesce(v_hier_label, '(sem hierarquia)'));
            end if;
          end if;
          v_role_muda := v_role_given and v_cur_role is distinct from v_role;

          -- a data vem antes de qualquer gravação: sem ela, a linha inteira volta
          v_data_mud := null;
          if jsonb_array_length(v_mov) > 0 then
            select h.effective_from into v_desde from public.membership_history h
             where h.membership_id = v_existing_mid and h.effective_to is null;
            if p_simular then
              v_pendentes := v_pendentes || jsonb_build_object(
                'cpf', v_cpf, 'nome', trim(r->>'full_name'), 'matricula', v_existing_code,
                'unidade', array_to_string(v_unit_names, '; '),
                'desde', to_char(v_desde, 'YYYY-MM-DD'), 'mudancas', v_mov);
            else
              v_data_mud := case when coalesce(r->>'effective_date', '') ~ '^\d{4}-\d{2}-\d{2}$'
                                 then (r->>'effective_date')::date
                                 else public.parse_br_date(r->>'effective_date') end;
              if v_data_mud is null then
                raise exception 'Informe a data da mudança (%)',
                  (select string_agg(x->>'campo', ', ') from jsonb_array_elements(v_mov) x);
              end if;
              if v_data_mud > current_date then
                raise exception 'A data da mudança não pode ser futura';
              end if;
            end if;
          end if;

          -- O DESLIGAMENTO PASSA, mesmo com a matrícula igual: é o único fato
          -- aqui que só a folha conhece. Data preenchida desliga; data vazia
          -- não reativa ninguém.
          if v_dismissed is not null and v_ex_dis is distinct from v_dismissed then
            update public.memberships
               set dismissed_at = v_dismissed, is_active = false
             where id = v_existing_mid;
            v_updated := v_updated + 1;
            v_updated_list := v_updated_list || jsonb_build_object(
              'nome', trim(r->>'full_name'), 'cpf', v_cpf,
              'motivo', 'Desligado em ' || to_char(v_dismissed, 'DD/MM/YYYY') || ' pela planilha');
          end if;

          v_muda := jsonb_array_length(v_mov) > 0 or v_fill or v_role_muda;
          if v_muda then
            -- preenchimento: a situação atual do histórico recebe o que estava vazio
            if v_fill then
              update public.membership_history h set
                position_id = case when v_ex_pos is null and v_pos_given then v_pos else h.position_id end,
                position_level_id = case when v_ex_lvl is null and v_lvl_given then v_lvl else h.position_level_id end,
                department_id = case when v_ex_dept is null and v_dept_given then v_dept else h.department_id end,
                subdepartment_id = case when v_ex_sub is null then v_sub_final else h.subdepartment_id end,
                manager_id = case when v_cur_mgr is null and v_mgr_given then v_mgr else h.manager_id end,
                hierarchy_level_id = case when v_cur_hier is null and v_hier_given then v_hier else h.hierarchy_level_id end
              where h.membership_id = v_existing_mid and h.effective_to is null;
              v_fills := v_fills + 1;
            end if;

            update public.memberships set
              position_id = case when v_pos_given then v_pos else position_id end,
              position_level_id = case when v_lvl_given then v_lvl else position_level_id end,
              department_id = case when v_dept_given then v_dept else department_id end,
              subdepartment_id = v_sub_final,
              manager_id = case when v_mgr_given then v_mgr else manager_id end,
              role = case when v_role_given then v_role else role end,
              hierarchy_level_id = case when v_hier_given then v_hier else hierarchy_level_id end
            where id = v_existing_mid;

            -- movimentação com a data informada, gravada agora (ver o cabeçalho)
            if v_data_mud is not null then
              perform public.membership_history_registrar(v_existing_mid, v_data_mud);
              v_movs := v_movs + 1;
              v_movs_list := v_movs_list || jsonb_build_object(
                'nome', trim(r->>'full_name'), 'cpf', v_cpf,
                'motivo', (select string_agg((x->>'campo') || ': ' || coalesce(x->>'de', '?') || ' -> ' || coalesce(x->>'para', '?'), '; ')
                             from jsonb_array_elements(v_mov) x)
                          || ' (desde ' || to_char(v_data_mud, 'DD/MM/YYYY') || ')');
            end if;

            if v_mgr_given and v_cur_mgr is distinct from v_mgr then
              v_managers := v_managers + 1;
              v_managers_list := v_managers_list || jsonb_build_object(
                'nome', trim(r->>'full_name'), 'cpf', v_cpf,
                'motivo', case when v_mgr is null then 'Gestor removido'
                               else 'Gestor: ' || coalesce(v_mgr_name, '?') end);
            end if;
            if v_role_muda then
              v_roles := v_roles + 1;
              v_roles_list := v_roles_list || jsonb_build_object(
                'nome', trim(r->>'full_name'), 'cpf', v_cpf,
                'motivo', 'Perfil: ' || v_cur_role::text || ' -> ' || v_role::text);
            end if;
            if v_hier_given and v_cur_hier is distinct from v_hier then
              v_hiers := v_hiers + 1;
              v_hiers_list := v_hiers_list || jsonb_build_object(
                'nome', trim(r->>'full_name'), 'cpf', v_cpf,
                'motivo', case when v_hier is null then 'Hierarquia removida'
                               else 'Hierarquia: ' || coalesce(v_hier_label, '?') end);
            end if;
            if v_lvl_given and v_ex_lvl is distinct from v_lvl then
              v_levels := v_levels + 1;
              v_levels_list := v_levels_list || jsonb_build_object(
                'nome', trim(r->>'full_name'), 'cpf', v_cpf,
                'motivo', 'Nível: ' || coalesce(v_lvl_label, '?'));
            end if;
          end if;

          update public.profiles set
            full_name = trim(r->>'full_name'),
            email = coalesce(v_email, email),
            phone = coalesce(nullif(trim(r->>'phone'), ''), phone),
            birth_date = coalesce(public.parse_br_date(r->>'birth_date'), birth_date),
            gender = v_gender
          where id = v_existing_uid
            and (full_name, email, phone, birth_date, gender) is distinct from (
              trim(r->>'full_name'),
              coalesce(v_email, email),
              coalesce(nullif(trim(r->>'phone'), ''), phone),
              coalesce(public.parse_br_date(r->>'birth_date'), birth_date),
              v_gender);

          if found then
            v_updated := v_updated + 1;
            v_updated_list := v_updated_list || jsonb_build_object(
              'nome', trim(r->>'full_name'), 'cpf', v_cpf,
              'motivo', 'Dados do cadastro atualizados (e-mail, telefone, nascimento ou sexo)');
          elsif not v_muda
             and not (v_dismissed is not null and v_ex_dis is distinct from v_dismissed) then
            v_skipped := v_skipped + 1;
            v_skipped_list := v_skipped_list || jsonb_build_object(
              'nome', trim(r->>'full_name'), 'cpf', v_cpf, 'codigo', v_existing_code,
              'motivo', 'Já cadastrado, nada a mudar');
          end if;
          continue;
        end if;

        update public.profiles set
          full_name = trim(r->>'full_name'),
          email = coalesce(v_email, email),
          phone = coalesce(nullif(trim(r->>'phone'), ''), phone),
          birth_date = coalesce(public.parse_br_date(r->>'birth_date'), birth_date),
          gender = v_gender
        where id = v_existing_uid;

      else
        if coalesce(r->>'skip_if_new', '') <> '' and v_dismissed is not null then
          v_skipped := v_skipped + 1;
          v_skipped_list := v_skipped_list || jsonb_build_object(
            'nome', trim(r->>'full_name'), 'cpf', v_cpf, 'codigo', v_code,
            'motivo', 'Já desligado e sem cadastro: não foi criado. Desmarque "Importar apenas ativos" para trazer o histórico.');
          continue;
        end if;

        v_auth_email := coalesce(v_email, v_cpf || '@cpf.managerhub.local');
        if exists (select 1 from auth.users where email = v_auth_email) then
          v_errors := v_errors || jsonb_build_object('nome', trim(r->>'full_name'), 'cpf', v_cpf, 'erro', 'Conta já existe'); continue;
        end if;

        v_uid := gen_random_uuid();
        insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, email_change, email_change_token_new, recovery_token)
        values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_auth_email, v_hash, now(), now(), now(), '{"provider":"email","providers":["email"],"must_change_password":true}', jsonb_build_object('full_name', trim(r->>'full_name')), '', '', '', '');
        insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
        values (gen_random_uuid(), v_uid, jsonb_build_object('sub', v_uid::text, 'email', v_auth_email), 'email', v_uid::text, now(), now(), now());

        insert into public.profiles (id, email, full_name, cpf, phone, birth_date, gender)
        values (v_uid, v_email, trim(r->>'full_name'), v_cpf, nullif(trim(r->>'phone'), ''), public.parse_br_date(r->>'birth_date'), v_gender)
        on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, cpf = excluded.cpf, phone = excluded.phone, birth_date = excluded.birth_date, gender = excluded.gender;

        insert into public.memberships (tenant_id, user_id, role, employee_code, admission_date, department_id, subdepartment_id, position_id, position_level_id, hierarchy_level_id, manager_id, is_active, dismissed_at)
        values (v_tenant, v_uid, coalesce(v_role, 'member'), v_code, v_adm, v_dept, v_sub, v_pos, v_lvl, v_hier, v_mgr, v_dismissed is null, v_dismissed)
        returning id into v_mid;
        v_created := v_created + 1;
      end if;

      if v_unit_names is not null and v_mid is not null then
        foreach v_name in array v_unit_names loop
          v_kind := case when upper(v_name) = 'MATRIZ' then 'matriz' else 'filial' end;
          select id into v_unit from public.units where tenant_id = v_tenant and name = v_name;
          if not found then insert into public.units(tenant_id, name, kind) values (v_tenant, v_name, v_kind) returning id into v_unit; end if;
          insert into public.membership_units (membership_id, unit_id) values (v_mid, v_unit) on conflict do nothing;
        end loop;
      end if;

    exception when others then
      v_errors := v_errors || jsonb_build_object('nome', r->>'full_name', 'cpf', v_cpf, 'erro', SQLERRM);
    end;
  end loop;

  -- prévia: desfaz tudo o que a importação fez (as variáveis sobrevivem)
  if p_simular then
    raise exception using errcode = 'P0098', message = 'simulacao';
  end if;
  exception when sqlstate 'P0098' then
    null;
  end;

  return jsonb_build_object(
    'simulado', p_simular,
    'pendentes', v_pendentes,
    'created', v_created, 'updated', v_updated, 'skipped', v_skipped, 'archived', v_archived,
    'managers', v_managers, 'roles', v_roles, 'hierarchies', v_hiers, 'levels', v_levels,
    'movimentacoes', v_movs, 'preenchimentos', v_fills,
    'levelsList', v_levels_list, 'movimentacoesList', v_movs_list,
    'skippedList', v_skipped_list, 'updatedList', v_updated_list,
    'managersList', v_managers_list, 'rolesList', v_roles_list,
    'hierarchiesList', v_hiers_list, 'errors', v_errors);
end $function$;

revoke all on function public.admin_import_employees(jsonb, text, boolean) from public, anon;
grant execute on function public.admin_import_employees(jsonb, text, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
