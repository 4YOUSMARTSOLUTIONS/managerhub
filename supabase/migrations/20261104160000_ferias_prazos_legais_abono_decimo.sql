-- Férias: prazos legais do pedido de abono pecuniário e do adiantamento do 13º.
--
-- - ABONO (art. 143 §1º CLT): o empregado pede até 15 dias antes do fim do
--   período aquisitivo. Ex. do LUIZ: aquisitivo termina 01/02 → pedir até
--   18/01 (fim − 14 dias). Fora disso a empresa PODE recusar.
-- - 13º (Lei 4.749/65, art. 2º §2º; Decreto 10.854/2021, art. 79): o
--   adiantamento sai com as férias quando pedido no mês de janeiro do ano
--   delas. Pedido antes também vale (já manifestou); depois de 31/01 do ano das
--   férias a empresa PODE recusar.
--
-- Decisão do LUIZ (04/11/2026): configurável por empresa, para cada regra:
--   'alerta'   = o colaborador consegue pedir, e o pedido chega marcado como
--                fora do prazo para quem aprova decidir;
--   'bloquear' = o colaborador não consegue; só o gestor ou o DP lançam (o
--                lançamento deles é o aceite da empresa).
-- Cervantes começa em 'bloquear' nas duas (a escolha inicial dele).
--
-- A data do pedido é a do servidor (fuso do Brasil). Na correção de um pedido
-- devolvido e no reagendamento, o que já vinha pedido conta pela data do pedido
-- original. O lançamento do gestor/DP nunca é bloqueado, mas grava a marca, para
-- o DP saber que pagou fora do prazo por liberalidade.

-- ---------------------------------------------------------------------------
-- 1. Configuração e marcas
-- ---------------------------------------------------------------------------
alter table public.ferias_config
  add column if not exists abono_fora_prazo text not null default 'alerta',
  add column if not exists decimo_fora_prazo text not null default 'alerta';

alter table public.ferias_config drop constraint if exists ferias_config_abono_fora_prazo;
alter table public.ferias_config add constraint ferias_config_abono_fora_prazo
  check (abono_fora_prazo in ('alerta', 'bloquear'));
alter table public.ferias_config drop constraint if exists ferias_config_decimo_fora_prazo;
alter table public.ferias_config add constraint ferias_config_decimo_fora_prazo
  check (decimo_fora_prazo in ('alerta', 'bloquear'));

update public.ferias_config
   set abono_fora_prazo = 'bloquear', decimo_fora_prazo = 'bloquear'
 where tenant_id = '373d5ce2-9c41-4cad-bfe7-24b80616ffa9';

alter table public.ferias_solicitacoes
  add column if not exists abono_fora_prazo boolean not null default false,
  add column if not exists decimo_fora_prazo boolean not null default false;

comment on column public.ferias_solicitacoes.abono_fora_prazo is
  'O abono foi pedido depois de 15 dias antes do fim do aquisitivo (art. 143 §1º): a empresa podia recusar.';
comment on column public.ferias_solicitacoes.decimo_fora_prazo is
  'O adiantamento do 13º foi pedido depois de 31/01 do ano das férias (Lei 4.749/65): a empresa podia recusar.';

-- ---------------------------------------------------------------------------
-- 2. A regra (interna): marca cada período e recusa o colaborador quando a
--    empresa escolheu bloquear
-- ---------------------------------------------------------------------------
create or replace function public.ferias_aplicar_prazos_legais(
  p_tenant uuid, p_validado jsonb, p_quem text,
  p_pedido_abono date default null, p_pedido_decimo date default null
) returns jsonb
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_modo_abono text := 'alerta';
  v_modo_decimo text := 'alerta';
  v_res jsonb := '[]'::jsonb;
  e jsonb;
  v_prazo date;
  v_ano int;
  v_fora_abono boolean;
  v_fora_decimo boolean;
begin
  select c.abono_fora_prazo, c.decimo_fora_prazo into v_modo_abono, v_modo_decimo
    from public.ferias_config c where c.tenant_id = p_tenant;
  v_modo_abono := coalesce(v_modo_abono, 'alerta');
  v_modo_decimo := coalesce(v_modo_decimo, 'alerta');

  for e in select * from jsonb_array_elements(p_validado) loop
    v_fora_abono := false;
    v_fora_decimo := false;

    if coalesce((e->>'abono')::int, 0) > 0 then
      v_prazo := (e->>'aquisitivo_fim')::date - 14;
      v_fora_abono := coalesce(p_pedido_abono, v_hoje) > v_prazo;
      if v_fora_abono and p_quem = 'colaborador' and v_modo_abono = 'bloquear' then
        raise exception '%', format(
          'O abono pecuniário do aquisitivo %s/%s precisava ser pedido até %s, 15 dias antes do fim do período aquisitivo (art. 143 §1º). Fora desse prazo, só o gestor ou o departamento pessoal podem lançar.',
          extract(year from (e->>'aquisitivo_inicio')::date)::int,
          extract(year from (e->>'aquisitivo_fim')::date)::int,
          to_char(v_prazo, 'DD/MM/YYYY'));
      end if;
    end if;

    if coalesce((e->>'decimo')::boolean, false) then
      v_ano := extract(year from (e->>'inicio')::date)::int;
      v_prazo := make_date(v_ano, 1, 31);
      v_fora_decimo := coalesce(p_pedido_decimo, v_hoje) > v_prazo;
      if v_fora_decimo and p_quem = 'colaborador' and v_modo_decimo = 'bloquear' then
        raise exception '%', format(
          'O adiantamento da 1ª parcela do 13º com férias em %s precisava ser pedido até 31/01/%s (Lei 4.749/65). Fora desse prazo, só o gestor ou o departamento pessoal podem lançar.',
          v_ano, v_ano);
      end if;
    end if;

    v_res := v_res || (e || jsonb_build_object(
      'abono_fora_prazo', v_fora_abono, 'decimo_fora_prazo', v_fora_decimo));
  end loop;

  return v_res;
end;
$$;

revoke execute on function public.ferias_aplicar_prazos_legais(uuid, jsonb, text, date, date)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. As linhas gravam as marcas
-- ---------------------------------------------------------------------------
create or replace function public.ferias_criar_linhas(
  p_tenant uuid, p_user uuid, p_validado jsonb, p_snaps jsonb,
  p_status public.ferias_status, p_lancada boolean
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  e jsonb;
  v_n int := 0;
begin
  for e in select * from jsonb_array_elements(p_validado) loop
    insert into public.ferias_solicitacoes (
      tenant_id, user_id, status,
      start_date, end_date, abono_dias, adiantar_decimo_terceiro,
      aquisitivo_inicio, aquisitivo_fim, snap_admission_date,
      snap_full_name, snap_employee_code,
      snap_department_id, snap_department_name,
      snap_subdepartment_id, snap_subdepartment_name,
      snap_position_id, snap_position_name,
      snap_manager_id, snap_manager_name,
      snap_unit_id, snap_unit_name, snap_hierarchy_name,
      created_by, lancada_pelo_gestor,
      decided_at, decided_by,
      em_dobro, justificativa_dobro,
      abono_fora_prazo, decimo_fora_prazo)
    values (
      p_tenant, p_user, p_status,
      (e->>'inicio')::date, (e->>'fim')::date,
      coalesce((e->>'abono')::int, 0), coalesce((e->>'decimo')::boolean, false),
      (e->>'aquisitivo_inicio')::date, (e->>'aquisitivo_fim')::date,
      (p_snaps->>'admission_date')::date,
      p_snaps->>'full_name', p_snaps->>'employee_code',
      (p_snaps->>'department_id')::uuid, p_snaps->>'department_name',
      (p_snaps->>'subdepartment_id')::uuid, p_snaps->>'subdepartment_name',
      (p_snaps->>'position_id')::uuid, p_snaps->>'position_name',
      (p_snaps->>'manager_id')::uuid, p_snaps->>'manager_name',
      (p_snaps->>'unit_id')::uuid, p_snaps->>'unit_name', p_snaps->>'hierarchy_name',
      (select auth.uid()), p_lancada,
      case when p_status = 'aprovada' then now() end,
      case when p_status = 'aprovada' then (select auth.uid()) end,
      coalesce((e->>'em_dobro')::boolean, false),
      case when coalesce((e->>'em_dobro')::boolean, false) then e->>'justificativa_dobro' end,
      coalesce((e->>'abono_fora_prazo')::boolean, false),
      coalesce((e->>'decimo_fora_prazo')::boolean, false));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

revoke execute on function public.ferias_criar_linhas(uuid, uuid, jsonb, jsonb, public.ferias_status, boolean)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. As portas de criação aplicam a regra
-- ---------------------------------------------------------------------------
do $migr$
declare
  v_def text;
  v_de text;
  v_para text;
  v_qtd int;
begin
  -- solicitar: sempre o colaborador, pedido feito hoje
  v_def := pg_get_functiondef('public.ferias_solicitar(uuid, jsonb, date)'::regprocedure);
  v_de := '  v_val := public.ferias_validar_periodos(p_tenant, v_uid, p_periodos, p_hoje);';
  v_qtd := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  if v_qtd <> 1 then raise exception 'ferias_solicitar: âncora encontrada % vezes', v_qtd; end if;
  execute replace(v_def, v_de, v_de || chr(10) ||
    '  v_val := public.ferias_aplicar_prazos_legais(p_tenant, v_val, ''colaborador'');');

  -- lançar (tela e planilha): gestor ou DP, nunca bloqueia, só marca
  v_def := pg_get_functiondef('public.ferias_lancar(uuid, uuid, jsonb, date, text)'::regprocedure);
  v_de := '  v_val := public.ferias_validar_periodos(p_tenant, p_user, p_periodos, p_hoje, null, v_just is not null);';
  v_qtd := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  if v_qtd <> 1 then raise exception 'ferias_lancar: âncora encontrada % vezes', v_qtd; end if;
  execute replace(v_def, v_de, v_de || chr(10) ||
    '  v_val := public.ferias_aplicar_prazos_legais(p_tenant, v_val, case when v_eh_dp then ''dp'' else ''gestor'' end);');

  -- reenviar: o que já vinha pedido conta pela data do pedido original
  v_def := pg_get_functiondef('public.ferias_reenviar(uuid, date, date, integer, boolean, date)'::regprocedure);
  v_de := '    p_hoje, p_id);';
  v_qtd := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  if v_qtd <> 1 then raise exception 'ferias_reenviar: âncora 1 encontrada % vezes', v_qtd; end if;
  v_def := replace(v_def, v_de, v_de || chr(10) ||
    '  v_val := public.ferias_aplicar_prazos_legais(v_l.tenant_id, v_val,' || chr(10) ||
    '    case when not v_l.lancada_pelo_gestor then ''colaborador''' || chr(10) ||
    '         when public.has_tenant_role(v_l.tenant_id, ''{owner,admin,hr}''::public.member_role[]) then ''dp''' || chr(10) ||
    '         else ''gestor'' end,' || chr(10) ||
    '    case when v_l.abono_dias > 0 then (v_l.created_at at time zone ''America/Sao_Paulo'')::date end,' || chr(10) ||
    '    case when v_l.adiantar_decimo_terceiro then (v_l.created_at at time zone ''America/Sao_Paulo'')::date end);');
  v_de := '         adiantar_decimo_terceiro = coalesce((v_val->0->>''decimo'')::boolean, false),';
  v_qtd := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  if v_qtd <> 1 then raise exception 'ferias_reenviar: âncora 2 encontrada % vezes', v_qtd; end if;
  execute replace(v_def, v_de, v_de || chr(10) ||
    '         abono_fora_prazo = coalesce((v_val->0->>''abono_fora_prazo'')::boolean, false),' || chr(10) ||
    '         decimo_fora_prazo = coalesce((v_val->0->>''decimo_fora_prazo'')::boolean, false),');

  -- reagendar: idem, pela data do pedido das férias originais
  v_def := pg_get_functiondef('public.ferias_reagendar(uuid, date, date, integer, boolean, date)'::regprocedure);
  v_de := '    p_hoje, p_id);';
  v_qtd := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  if v_qtd <> 1 then raise exception 'ferias_reagendar: âncora 1 encontrada % vezes', v_qtd; end if;
  v_def := replace(v_def, v_de, v_de || chr(10) ||
    '  v_val := public.ferias_aplicar_prazos_legais(v_o.tenant_id, v_val,' || chr(10) ||
    '    case when v_dp then ''dp'' when v_gestor then ''gestor'' else ''colaborador'' end,' || chr(10) ||
    '    case when v_o.abono_dias > 0 then (v_o.created_at at time zone ''America/Sao_Paulo'')::date end,' || chr(10) ||
    '    case when v_o.adiantar_decimo_terceiro then (v_o.created_at at time zone ''America/Sao_Paulo'')::date end);');
  v_de := '    created_by, lancada_pelo_gestor, decided_at, decided_by)';
  v_qtd := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  if v_qtd <> 1 then raise exception 'ferias_reagendar: âncora 2 encontrada % vezes', v_qtd; end if;
  v_def := replace(v_def, v_de,
    '    created_by, lancada_pelo_gestor, decided_at, decided_by, abono_fora_prazo, decimo_fora_prazo)');
  v_de := '    case when v_status = ''aprovada'' then v_uid end);';
  v_qtd := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  if v_qtd <> 1 then raise exception 'ferias_reagendar: âncora 3 encontrada % vezes', v_qtd; end if;
  execute replace(v_def, v_de,
    '    case when v_status = ''aprovada'' then v_uid end,' || chr(10) ||
    '    coalesce((v_val->0->>''abono_fora_prazo'')::boolean, false),' || chr(10) ||
    '    coalesce((v_val->0->>''decimo_fora_prazo'')::boolean, false));');
end
$migr$;

revoke execute on function public.ferias_solicitar(uuid, jsonb, date) from public, anon;
revoke execute on function public.ferias_lancar(uuid, uuid, jsonb, date, text) from public, anon;
revoke execute on function public.ferias_reenviar(uuid, date, date, integer, boolean, date) from public, anon;
revoke execute on function public.ferias_reagendar(uuid, date, date, integer, boolean, date) from public, anon;

notify pgrst, 'reload schema';
