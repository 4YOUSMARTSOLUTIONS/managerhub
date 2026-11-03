-- Férias: antecedência mínima também para o lançamento do gestor e do DP, cada
-- um com o seu valor.
--
-- Pedido do LUIZ (03/11/2026): a antecedência do colaborador
-- (20261103120000) passa a valer também para o gestor, numa opção separada, e
-- o DP ganha a dele. Três valores em `ferias_config`:
--   - antecedencia_minima_dias: o colaborador (pedido próprio, correção do
--     próprio pedido, reagendamento próprio);
--   - antecedencia_gestor_dias: o gestor lançando para a equipe (tela, planilha,
--     correção do que ele lançou, reagendamento da equipe);
--   - antecedencia_dp_dias: o departamento pessoal (owner, admin, RH) lançando.
-- Quem é DP conta como DP mesmo quando também é gestor da pessoa.
-- Cervantes: gestor 30 (o pedido), DP 0 (regularizações e férias em dobro).

alter table public.ferias_config
  add column if not exists antecedencia_gestor_dias integer not null default 0,
  add column if not exists antecedencia_dp_dias integer not null default 0;

alter table public.ferias_config drop constraint if exists ferias_config_antecedencia_gestor;
alter table public.ferias_config add constraint ferias_config_antecedencia_gestor
  check (antecedencia_gestor_dias between 0 and 180);
alter table public.ferias_config drop constraint if exists ferias_config_antecedencia_dp;
alter table public.ferias_config add constraint ferias_config_antecedencia_dp
  check (antecedencia_dp_dias between 0 and 180);

update public.ferias_config
   set antecedencia_gestor_dias = 30
 where tenant_id = '373d5ce2-9c41-4cad-bfe7-24b80616ffa9';

-- ---------------------------------------------------------------------------
-- A checagem passa a saber QUEM lança. Sem o terceiro argumento, é o
-- colaborador (a chamada de `ferias_solicitar` continua igual).
-- ---------------------------------------------------------------------------
drop function if exists public.ferias_checar_antecedencia(uuid, date);

create or replace function public.ferias_checar_antecedencia(
  p_tenant uuid, p_inicio date, p_quem text default 'colaborador'
) returns void
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_min int;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_inicio is null then
    return; -- a validação dos períodos acusa a data em branco
  end if;
  select case p_quem
           when 'gestor' then c.antecedencia_gestor_dias
           when 'dp' then c.antecedencia_dp_dias
           else c.antecedencia_minima_dias
         end
    into v_min
    from public.ferias_config c where c.tenant_id = p_tenant;
  if coalesce(v_min, 0) > 0 and p_inicio < v_hoje + v_min then
    raise exception '%', format(
      case p_quem
        when 'gestor' then 'Férias lançadas pelo gestor precisam começar com pelo menos %s dias de antecedência, para o departamento pessoal calcular e pagar a tempo. O início mais próximo possível é %s.'
        when 'dp' then 'Férias lançadas pelo departamento pessoal precisam começar com pelo menos %s dias de antecedência. O início mais próximo possível é %s.'
        else 'As férias precisam ser solicitadas com pelo menos %s dias de antecedência, para o departamento pessoal calcular e pagar a tempo. O início mais próximo possível é %s.'
      end,
      v_min, to_char(v_hoje + v_min, 'DD/MM/YYYY'));
  end if;
end;
$$;

revoke execute on function public.ferias_checar_antecedencia(uuid, date, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- As portas do gestor e do DP chamam a checagem com quem lança
-- ---------------------------------------------------------------------------
do $migr$
declare
  v_def text;
  v_de text;
  v_para text;
  v_qtd int;
begin
  -- lançar (tela e planilha, que chama esta por pessoa)
  v_def := pg_get_functiondef('public.ferias_lancar(uuid, uuid, jsonb, date, text)'::regprocedure);
  v_de := '  v_val := public.ferias_validar_periodos(p_tenant, p_user, p_periodos, p_hoje, null, v_just is not null);';
  v_qtd := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  if v_qtd <> 1 then raise exception 'ferias_lancar: âncora encontrada % vezes', v_qtd; end if;
  execute replace(v_def, v_de,
    '  perform public.ferias_checar_antecedencia(p_tenant,' || chr(10) ||
    '    (select min((e->>''inicio'')::date) from jsonb_array_elements(p_periodos) e),' || chr(10) ||
    '    case when v_eh_dp then ''dp'' else ''gestor'' end);' || chr(10) || chr(10) ||
    v_de);

  -- reenviar: o pedido do colaborador ou o que o gestor/DP lançou
  v_def := pg_get_functiondef('public.ferias_reenviar(uuid, date, date, integer, boolean, date)'::regprocedure);
  v_de := '  if not v_l.lancada_pelo_gestor then' || chr(10) ||
          '    perform public.ferias_checar_antecedencia(v_l.tenant_id, p_inicio);' || chr(10) ||
          '  end if;';
  v_qtd := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  if v_qtd <> 1 then raise exception 'ferias_reenviar: trecho encontrado % vezes', v_qtd; end if;
  v_para := '  perform public.ferias_checar_antecedencia(v_l.tenant_id, p_inicio,' || chr(10) ||
            '    case when not v_l.lancada_pelo_gestor then ''colaborador''' || chr(10) ||
            '         when public.has_tenant_role(v_l.tenant_id, ''{owner,admin,hr}''::public.member_role[]) then ''dp''' || chr(10) ||
            '         else ''gestor'' end);';
  execute replace(v_def, v_de, v_para);

  -- reagendar: o dono, o gestor ou o DP
  v_def := pg_get_functiondef('public.ferias_reagendar(uuid, date, date, integer, boolean, date)'::regprocedure);
  v_de := '  if v_dono and not (v_gestor or v_dp) then' || chr(10) ||
          '    perform public.ferias_checar_antecedencia(v_o.tenant_id, p_inicio);' || chr(10) ||
          '  end if;';
  v_qtd := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  if v_qtd <> 1 then raise exception 'ferias_reagendar: trecho encontrado % vezes', v_qtd; end if;
  v_para := '  perform public.ferias_checar_antecedencia(v_o.tenant_id, p_inicio,' || chr(10) ||
            '    case when v_dp then ''dp'' when v_gestor then ''gestor'' else ''colaborador'' end);';
  execute replace(v_def, v_de, v_para);
end
$migr$;

revoke execute on function public.ferias_lancar(uuid, uuid, jsonb, date, text) from public, anon;
revoke execute on function public.ferias_reenviar(uuid, date, date, integer, boolean, date) from public, anon;
revoke execute on function public.ferias_reagendar(uuid, date, date, integer, boolean, date) from public, anon;

notify pgrst, 'reload schema';
