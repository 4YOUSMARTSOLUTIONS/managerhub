-- ---------------------------------------------------------------------------
-- Importação de colaboradores: unidade, desligamento e admissão.
--
-- Combinado com o LUIZ (09/11/2026), completando 20261109140000:
--
-- 1) UNIDADE (coluna Empresa) passa a ser movimentação com data, como função,
--    nível, setor, subsetor, gestor e hierarquia. Antes a planilha ignorava,
--    calada, a transferência de quem já estava cadastrado.
--    Só conta como transferência quando a planilha traz uma unidade que a
--    pessoa AINDA NÃO TEM. Dois gerentes têm MATRIZ e FILIAL, dadas pela tela;
--    a folha lista só uma, e ler isso como transferência tiraria o acesso à
--    outra. Na transferência, as unidades passam a ser as da planilha.
--    Sem unidade nenhuma no sistema, é preenchimento (sem data).
--    Nome de unidade que não existe é erro na linha: aqui não se cria unidade.
--
-- 2) DESLIGAMENTO: a vigência de inativo começa na própria data de demissão,
--    não no dia em que alguém registrou. Vale para a planilha E para a ficha,
--    porque a regra mora no trigger do histórico. A data é a mesma que a linha
--    do tempo já mostra em "Inativo desde". Se ela cair antes do início da
--    situação atual (ou depois de hoje), vale o momento do registro, como era.
--    Na planilha, o desligamento passa a ser aplicado DEPOIS da movimentação
--    da mesma linha, para cada uma ficar na sua data.
--
-- 3) ADMISSÃO diferente da planilha, para quem tem a mesma matrícula:
--    - vazia no sistema: preenche;
--    - diferente: a prévia lista em `admissoesDivergentes` e só corrige a linha
--      que vier com `corrigir_admissao = '1'` (a pessoa marca na tela).
--    Corrigir a admissão leva junto o início da primeira vigência do
--    histórico; se já houver movimentação antes da nova data, recusa a linha.
--
-- As trocas são feitas sobre a definição em vigor e falham alto se algum
-- trecho esperado não estiver lá.
-- ---------------------------------------------------------------------------

-- 1) trigger do histórico: desligamento na data de demissão
do $do$
declare
  v_def text;
  v_velho text := $q$  v_from := coalesce(nullif(current_setting('app.mov_effective_date', true), '')::date::timestamptz, now());$q$;
begin
  v_def := pg_get_functiondef('public.membership_history_capture()'::regprocedure);
  if strpos(v_def, v_velho) = 0 then
    raise exception 'trigger: trecho não encontrado';
  end if;
  v_def := replace(v_def, v_velho, $q$  v_from := nullif(current_setting('app.mov_effective_date', true), '')::date::timestamptz;
  -- desligamento sem data informada: o inativo começa na data de demissão,
  -- desde que ela caia depois do início da situação atual e não no futuro
  if v_from is null and v_tem_aberta and v_open.is_active and not m.is_active
     and m.dismissed_at is not null then
    v_from := least(m.dismissed_at, current_date)::timestamptz;
    if v_from <= v_open.effective_from then
      v_from := null;
    end if;
  end if;
  v_from := coalesce(v_from, now());$q$);
  execute v_def;
end
$do$;

revoke execute on function public.membership_history_capture() from public, anon, authenticated;

-- 2) importação
do $do$
declare
  v_def text;
  v_novo text;
begin
  v_def := pg_get_functiondef('public.admin_import_employees(jsonb, text, boolean)'::regprocedure);
  v_novo := v_def;

  -- a) variáveis
  if strpos(v_novo, $q$  v_data_mud date; v_desde timestamptz;$q$) = 0 then
    raise exception 'trecho a não encontrado';
  end if;
  v_novo := replace(v_novo, $q$  v_data_mud date; v_desde timestamptz;$q$, $q$  v_data_mud date; v_desde timestamptz;
  v_units_plan uuid[]; v_units_cur uuid[]; v_unit_fill boolean; v_unit_mov boolean;
  v_adm_fix boolean; v_first_id uuid; v_first_to timestamptz;
  v_admissoes int := 0; v_admissoes_list jsonb := '[]'::jsonb; v_adm_div jsonb := '[]'::jsonb;$q$);

  -- b) unidade e admissão entram na comparação (antes da lista de pendentes)
  if strpos(v_novo, $q$          v_role_muda := v_role_given and v_cur_role is distinct from v_role;$q$) = 0 then
    raise exception 'trecho b não encontrado';
  end if;
  v_novo := replace(v_novo, $q$          v_role_muda := v_role_given and v_cur_role is distinct from v_role;$q$, $q$          -- unidade: só é transferência quando a planilha traz unidade que a
          -- pessoa ainda não tem (a unidade extra dada pela tela fica)
          v_unit_fill := false; v_unit_mov := false; v_units_plan := null;
          if coalesce(array_length(v_unit_names, 1), 0) > 0 then
            v_units_plan := array(select u.id from public.units u
              where u.tenant_id = v_tenant
                and lower(unaccent(u.name)) in (select lower(unaccent(x)) from unnest(v_unit_names) x)
              order by u.id);
            if cardinality(v_units_plan) < (select count(distinct lower(unaccent(x))) from unnest(v_unit_names) x) then
              raise exception 'Unidade não encontrada: "%". Use o nome de uma unidade já cadastrada.',
                array_to_string(v_unit_names, '; ');
            end if;
            v_units_cur := array(select mu.unit_id from public.membership_units mu
              where mu.membership_id = v_existing_mid order by mu.unit_id);
            if not (v_units_plan <@ v_units_cur) then
              if cardinality(v_units_cur) = 0 then
                v_unit_fill := true; v_fill := true;
              else
                v_unit_mov := true;
                v_mov := v_mov || jsonb_build_object('campo', 'Unidade',
                  'de', (select string_agg(u.name, '; ' order by u.name) from public.units u where u.id = any(v_units_cur)),
                  'para', (select string_agg(u.name, '; ' order by u.name) from public.units u where u.id = any(v_units_plan)));
              end if;
            end if;
          end if;

          -- admissão diferente é correção, não movimentação: vazia preenche;
          -- trocar uma que existe só com a confirmação marcada na prévia
          v_adm_fix := false;
          if v_adm is not null and v_existing_adm is distinct from v_adm then
            if v_existing_adm is null then
              v_adm_fix := true;
            elsif p_simular then
              v_adm_div := v_adm_div || jsonb_build_object('cpf', v_cpf, 'nome', trim(r->>'full_name'),
                'matricula', v_existing_code, 'atual', to_char(v_existing_adm, 'YYYY-MM-DD'),
                'planilha', to_char(v_adm, 'YYYY-MM-DD'));
            elsif coalesce(r->>'corrigir_admissao', '') = '1' then
              v_adm_fix := true;
            end if;
          end if;

          v_role_muda := v_role_given and v_cur_role is distinct from v_role;$q$);

  -- c) o desligamento sai daqui (vai para depois da movimentação)
  if strpos(v_novo, $q$          if v_dismissed is not null and v_ex_dis is distinct from v_dismissed then
            update public.memberships
               set dismissed_at = v_dismissed, is_active = false
             where id = v_existing_mid;
            v_updated := v_updated + 1;
            v_updated_list := v_updated_list || jsonb_build_object(
              'nome', trim(r->>'full_name'), 'cpf', v_cpf,
              'motivo', 'Desligado em ' || to_char(v_dismissed, 'DD/MM/YYYY') || ' pela planilha');
          end if;

          v_muda := jsonb_array_length(v_mov) > 0 or v_fill or v_role_muda;$q$) = 0 then
    raise exception 'trecho c não encontrado';
  end if;
  v_novo := replace(v_novo, $q$          if v_dismissed is not null and v_ex_dis is distinct from v_dismissed then
            update public.memberships
               set dismissed_at = v_dismissed, is_active = false
             where id = v_existing_mid;
            v_updated := v_updated + 1;
            v_updated_list := v_updated_list || jsonb_build_object(
              'nome', trim(r->>'full_name'), 'cpf', v_cpf,
              'motivo', 'Desligado em ' || to_char(v_dismissed, 'DD/MM/YYYY') || ' pela planilha');
          end if;

          v_muda := jsonb_array_length(v_mov) > 0 or v_fill or v_role_muda;$q$,
    $q$          v_muda := jsonb_array_length(v_mov) > 0 or v_fill or v_role_muda;$q$);

  -- d) preenchimento de unidade na vigência aberta
  if strpos(v_novo, $q$                hierarchy_level_id = case when v_cur_hier is null and v_hier_given then v_hier else h.hierarchy_level_id end
              where h.membership_id = v_existing_mid and h.effective_to is null;$q$) = 0 then
    raise exception 'trecho d não encontrado';
  end if;
  v_novo := replace(v_novo, $q$                hierarchy_level_id = case when v_cur_hier is null and v_hier_given then v_hier else h.hierarchy_level_id end
              where h.membership_id = v_existing_mid and h.effective_to is null;$q$, $q$                hierarchy_level_id = case when v_cur_hier is null and v_hier_given then v_hier else h.hierarchy_level_id end,
                unit_ids = case when v_unit_fill then v_units_plan else h.unit_ids end
              where h.membership_id = v_existing_mid and h.effective_to is null;$q$);

  -- e) as unidades mudam junto com os outros campos, antes de registrar a data
  if strpos(v_novo, $q$            where id = v_existing_mid;

            if v_data_mud is not null then$q$) = 0 then
    raise exception 'trecho e não encontrado';
  end if;
  v_novo := replace(v_novo, $q$            where id = v_existing_mid;

            if v_data_mud is not null then$q$, $q$            where id = v_existing_mid;

            if v_unit_mov or v_unit_fill then
              delete from public.membership_units
               where membership_id = v_existing_mid and unit_id <> all(v_units_plan);
              insert into public.membership_units (membership_id, unit_id)
              select v_existing_mid, x from unnest(v_units_plan) as x
              on conflict do nothing;
            end if;

            if v_data_mud is not null then$q$);

  -- f) depois da movimentação: correção de admissão e desligamento
  if strpos(v_novo, $q$                'motivo', 'Nível: ' || coalesce(v_lvl_label, '?'));
            end if;
          end if;

          update public.profiles set$q$) = 0 then
    raise exception 'trecho f não encontrado';
  end if;
  v_novo := replace(v_novo, $q$                'motivo', 'Nível: ' || coalesce(v_lvl_label, '?'));
            end if;
          end if;

          update public.profiles set$q$, $q$                'motivo', 'Nível: ' || coalesce(v_lvl_label, '?'));
            end if;
          end if;

          if v_adm_fix then
            select h.id, h.effective_to into v_first_id, v_first_to
              from public.membership_history h
             where h.membership_id = v_existing_mid
             order by h.effective_from limit 1;
            if v_first_to is not null and v_first_to <= v_adm::timestamptz then
              raise exception 'A admissão da planilha (%) é posterior a movimentações já registradas. Corrija pela ficha do colaborador.',
                to_char(v_adm, 'DD/MM/YYYY');
            end if;
            update public.memberships set admission_date = v_adm where id = v_existing_mid;
            if v_first_id is not null then
              update public.membership_history set effective_from = v_adm::timestamptz where id = v_first_id;
            end if;
            v_admissoes := v_admissoes + 1;
            v_admissoes_list := v_admissoes_list || jsonb_build_object(
              'nome', trim(r->>'full_name'), 'cpf', v_cpf,
              'motivo', 'Admissão: ' || coalesce(to_char(v_existing_adm, 'DD/MM/YYYY'), '(vazia)')
                        || ' -> ' || to_char(v_adm, 'DD/MM/YYYY'));
          end if;

          -- depois da movimentação, para cada uma ficar na sua data: o trigger
          -- do histórico usa a data de demissão para o inativo
          if v_dismissed is not null and v_ex_dis is distinct from v_dismissed then
            update public.memberships
               set dismissed_at = v_dismissed, is_active = false
             where id = v_existing_mid;
            v_updated := v_updated + 1;
            v_updated_list := v_updated_list || jsonb_build_object(
              'nome', trim(r->>'full_name'), 'cpf', v_cpf,
              'motivo', 'Desligado em ' || to_char(v_dismissed, 'DD/MM/YYYY') || ' pela planilha');
          end if;

          update public.profiles set$q$);

  -- g) "nada a mudar" considera a admissão corrigida
  if strpos(v_novo, $q$          elsif not v_muda
             and not (v_dismissed is not null and v_ex_dis is distinct from v_dismissed) then$q$) = 0 then
    raise exception 'trecho g não encontrado';
  end if;
  v_novo := replace(v_novo, $q$          elsif not v_muda
             and not (v_dismissed is not null and v_ex_dis is distinct from v_dismissed) then$q$, $q$          elsif not v_muda and not v_adm_fix
             and not (v_dismissed is not null and v_ex_dis is distinct from v_dismissed) then$q$);

  -- h) o resultado
  if strpos(v_novo, $q$    'movimentacoes', v_movs, 'preenchimentos', v_fills,$q$) = 0 then
    raise exception 'trecho h não encontrado';
  end if;
  v_novo := replace(v_novo, $q$    'movimentacoes', v_movs, 'preenchimentos', v_fills,$q$, $q$    'movimentacoes', v_movs, 'preenchimentos', v_fills,
    'admissoes', v_admissoes, 'admissoesList', v_admissoes_list, 'admissoesDivergentes', v_adm_div,$q$);

  execute v_novo;
end
$do$;

revoke all on function public.admin_import_employees(jsonb, text, boolean) from public, anon;
grant execute on function public.admin_import_employees(jsonb, text, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
