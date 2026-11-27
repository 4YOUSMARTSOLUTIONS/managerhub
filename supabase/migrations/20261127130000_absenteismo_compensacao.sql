-- Compensação no banco de horas, ao lado do abono (LUIZ, 27/11/2026).
--
-- Abono: o dia não é descontado e o colaborador não repõe as horas.
-- Compensação: o dia não é descontado, mas as horas viram débito no banco de
-- horas, e o colaborador repõe depois.
--
-- Decisões do LUIZ: a compensação, como o abono, NÃO pesa na remuneração
-- variável e NÃO reduz férias (art. 130). Por isso `waived` continua dizendo
-- "não é falta descontada" para os dois, e a RV, as férias e a aba do ponto
-- seguem lendo `waived` sem mudança. O que distingue é `tratamento`.
--
--   absenteismo_lancamentos.tratamento: 'abono' | 'compensacao' | nulo,
--     sempre coerente com waived (o gatilho acerta, a constraint garante);
--   absence_types.compensacao: o motivo "Compensação", um por empresa, como o
--     "Abono" (período inteiro compensado e destino dos dias separados);
--   absenteismo_confirmar_e_separar ganha p_tratamento ("Abonar ou compensar
--     parte dos dias").

-- ---------------------------------------------------------------------------
-- Catálogo: o motivo Compensação
-- ---------------------------------------------------------------------------
alter table public.absence_types add column if not exists compensacao boolean not null default false;
create unique index if not exists absence_types_uma_compensacao on public.absence_types (tenant_id) where compensacao;
alter table public.absence_types drop constraint if exists absence_types_compensacao_coerente;
alter table public.absence_types add constraint absence_types_compensacao_coerente check (
  not compensacao or (kind = 'falta' and not abono and not requires_document and not requires_medical
                      and not requires_companion and not requires_kinship)
);

insert into public.absence_types (
  tenant_id, name, description, kind, requires_document, requires_medical, requires_companion,
  requires_kinship, discounts_rv_default, counts_as_absenteeism, active, sort, abono, compensacao)
select t.id, 'Compensação',
       'Dias ou horas que o colaborador vai repor no banco de horas: não são descontados na folha, não pesam na remuneração variável e vão para Abonos e compensações.',
       'falta', false, false, false, false, false, true, true, 52, false, true
  from public.tenants t
 where not exists (select 1 from public.absence_types a where a.tenant_id = t.id and a.compensacao)
   and not exists (select 1 from public.absence_types a where a.tenant_id = t.id and a.name = 'Compensação');

update public.absence_types
   set description = 'Dias abonados pela empresa, sem reposição de horas: não são descontados na folha, não pesam na remuneração variável e vão para Abonos e compensações.'
 where abono
   and description = 'Dias abonados pela empresa: ficam registrados, não pesam na remuneração variável e vão para Abonos no ponto.';

-- ---------------------------------------------------------------------------
-- Lançamento: o tratamento
-- ---------------------------------------------------------------------------
alter table public.absenteismo_lancamentos add column if not exists tratamento text;
comment on column public.absenteismo_lancamentos.tratamento is
  'abono: não desconta e não repõe; compensacao: não desconta e vira débito no banco de horas. Nulo = falta descontada. waived = (tratamento não nulo).';
update public.absenteismo_lancamentos set tratamento = 'abono' where waived and tratamento is null;
alter table public.absenteismo_lancamentos drop constraint if exists absenteismo_tratamento_valido;
alter table public.absenteismo_lancamentos add constraint absenteismo_tratamento_valido
  check (tratamento in ('abono', 'compensacao'));
alter table public.absenteismo_lancamentos drop constraint if exists absenteismo_tratamento_coerente;
alter table public.absenteismo_lancamentos add constraint absenteismo_tratamento_coerente
  check ((tratamento is not null) = waived);

-- O gatilho acerta tratamento e waived juntos. O motivo especial manda (Abono
-- abona, Compensação compensa); quem só mexe em waived (caminho antigo) fica
-- com abono. Roda antes da guarda (ordem alfabética dos gatilhos).
create or replace function public.absenteismo_abono_sempre_abonado()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_abono boolean;
  v_comp boolean;
begin
  if tg_op = 'INSERT' then
    if new.tratamento is null and new.waived then
      new.tratamento := 'abono';
    end if;
  elsif new.tratamento is not distinct from old.tratamento
        and new.waived is distinct from old.waived then
    new.tratamento := case when new.waived then 'abono' end;
  end if;

  if new.absence_type_id is not null then
    select t.abono, t.compensacao into v_abono, v_comp
      from public.absence_types t where t.id = new.absence_type_id;
    if v_abono then
      new.tratamento := 'abono';
    elsif v_comp then
      new.tratamento := 'compensacao';
    end if;
  end if;

  new.waived := new.tratamento is not null;
  return new;
end;
$function$;
revoke execute on function public.absenteismo_abono_sempre_abonado() from public, anon, authenticated;

drop trigger if exists trg_absenteismo_abono_sempre_abonado on public.absenteismo_lancamentos;
create trigger trg_absenteismo_abono_sempre_abonado
  before insert or update of absence_type_id, waived, tratamento on public.absenteismo_lancamentos
  for each row execute function public.absenteismo_abono_sempre_abonado();

-- ---------------------------------------------------------------------------
-- Patches pela âncora (o corpo vivo pode ter ajustes que um recopiado perderia)
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  a text;
  b text;
begin
  -- guarda: com o DP, o tratamento também não muda
  v_def := pg_get_functiondef('public.guard_absenteismo_lancamento()'::regprocedure);
  a := E'       or new.waived is distinct from old.waived\n';
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then
    raise exception 'guard_absenteismo_lancamento mudou: âncora não confere';
  end if;
  execute replace(v_def, a, a || E'       or new.tratamento is distinct from old.tratamento\n');

  -- relatório completo: a coluna "abonada" passa a dizer qual dos dois
  v_def := pg_get_functiondef('public.absenteismo_relatorio'::regproc);
  a := $q$case when l.waived then 'Sim' else 'Não' end,$q$;
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then
    raise exception 'absenteismo_relatorio mudou: âncora não confere';
  end if;
  execute replace(v_def, a, $q$case when l.tratamento = 'compensacao' then 'Compensação' when l.waived then 'Abono' else 'Não' end,$q$);

  -- aba do ponto
  v_def := pg_get_functiondef('public.absenteismo_marcar_ponto(uuid,boolean)'::regprocedure);
  a := $q$'Só falta abonada e aprovada pelo DP vai para o ponto.'$q$;
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then
    raise exception 'absenteismo_marcar_ponto mudou: âncora não confere';
  end if;
  execute replace(v_def, a, $q$'Só abono ou compensação aprovados pelo DP vão para o ponto.'$q$);

  -- importação de histórico: coluna "tratamento" (abono | compensacao); o
  -- motivo especial decide sozinho, também na ausência gravada
  v_def := pg_get_functiondef('public.absenteismo_importar'::regproc);
  a := E'  v_abonada boolean;\n';
  b := $q$v_abonada := v_tipo.kind = 'falta' and coalesce((v_l ->> 'abonada')::boolean, false);$q$;
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1
     or (length(v_def) - length(replace(v_def, b, ''))) / length(b) <> 1
     or (length(v_def) - length(replace(v_def, 'certificate_kind, waived,', ''))) / length('certificate_kind, waived,') <> 1
     or (length(v_def) - length(replace(v_def, E'\n          v_abonada,\n', ''))) / length(E'\n          v_abonada,\n') <> 1 then
    raise exception 'absenteismo_importar mudou: âncoras não conferem';
  end if;
  v_def := replace(v_def, a, a || E'  v_tratamento text;\n');
  v_def := replace(v_def, b, $q$v_tratamento := case
          when v_tipo.abono then 'abono'
          when v_tipo.compensacao then 'compensacao'
          when v_tipo.kind = 'falta' and v_l ->> 'tratamento' in ('abono', 'compensacao') then v_l ->> 'tratamento'
          when v_tipo.kind = 'falta' and coalesce((v_l ->> 'abonada')::boolean, false) then 'abono'
        end;
        v_abonada := v_tratamento is not null;$q$);
  v_def := replace(v_def, 'certificate_kind, waived,', 'certificate_kind, waived, tratamento,');
  v_def := replace(v_def, E'\n          v_abonada,\n', E'\n          v_abonada, v_tratamento,\n');
  execute v_def;

  -- a regra da casa: fechar de novo o que foi recriado
  execute format('revoke execute on function %s from public, anon', 'public.absenteismo_relatorio'::regproc::regprocedure);
  execute format('revoke execute on function %s from public, anon', 'public.absenteismo_importar'::regproc::regprocedure);
end $$;

revoke execute on function public.guard_absenteismo_lancamento() from public, anon, authenticated;
revoke execute on function public.absenteismo_marcar_ponto(uuid, boolean) from public, anon;

-- ---------------------------------------------------------------------------
-- Abonar ou compensar parte dos dias
-- ---------------------------------------------------------------------------
drop function if exists public.absenteismo_confirmar_e_separar(uuid, date, date);

create or replace function public.absenteismo_confirmar_e_separar(
  p_id uuid, p_abono_inicio date default null, p_abono_fim date default null,
  p_tratamento text default 'abono'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_l record;
  v_t record;
  v_esp record;
  v_ini date;
  v_fim date;
  v_cob_ini date;
  v_blocos daterange[] := '{}';
  v_b daterange;
  v_novo uuid;
  v_criados uuid[] := '{}';
  v_hist text;
  v_abono uuid;
  v_novo_ini date;
  v_novo_fim date;
  v_dias_abono int;
  -- as palavras do tratamento escolhido
  v_trat text := coalesce(nullif(btrim(p_tratamento), ''), 'abono');
  v_inf text;
  v_part text;
  v_parts text;
  v_subst text;
  v_padrao text;
begin
  select l.* into v_l from public.absenteismo_lancamentos l where l.id = p_id;
  if v_l.id is null or not public.pode_ver_absenteismo(v_l.tenant_id, v_l.user_id, v_l.created_by) then
    raise exception 'Lançamento não encontrado.';
  end if;

  -- ---------- conferência, antes de mexer em qualquer coisa ----------
  if p_abono_inicio is not null or p_abono_fim is not null then
    if v_trat not in ('abono', 'compensacao') then
      raise exception 'Escolha abonar ou compensar os dias.';
    end if;
    v_inf   := case v_trat when 'abono' then 'abonar' else 'compensar' end;
    v_part  := case v_trat when 'abono' then 'abonado' else 'compensado' end;
    v_parts := case v_trat when 'abono' then 'abonados' else 'compensados' end;
    v_subst := case v_trat when 'abono' then 'abono' else 'compensação' end;
    v_padrao := case v_trat when 'abono' then 'Abono' else 'Compensação' end;

    select t.* into v_esp
      from public.absence_types t
     where t.tenant_id = v_l.tenant_id
       and case v_trat when 'abono' then t.abono else t.compensacao end;

    if p_abono_inicio is null or p_abono_fim is null then
      raise exception 'Informe o primeiro e o último dia %.', v_part;
    end if;
    if v_l.status not in ('aberto', 'reprovado') then
      raise exception 'Só dá para % parte dos dias antes do envio ao DP.', v_inf;
    end if;
    if v_l.start_date is null or v_l.end_date is null or v_l.end_date <= v_l.start_date then
      raise exception '% parte dos dias pede um período de pelo menos dois dias.', initcap(v_inf);
    end if;
    if v_l.falta_continua or v_l.end_date = '9999-12-31'::date then
      raise exception 'A falta sem data de término não aceita % de parte dos dias.', v_subst;
    end if;
    if v_l.partial_day then
      raise exception 'A ausência de horas não aceita % de parte dos dias.', v_subst;
    end if;
    if v_l.waived then
      raise exception 'A falta já está toda abonada ou compensada.';
    end if;
    if p_abono_fim < p_abono_inicio then
      raise exception 'O último dia % não pode ser antes do primeiro.', v_part;
    end if;
    if p_abono_inicio < v_l.start_date or p_abono_fim > v_l.end_date then
      raise exception 'Os dias % precisam estar dentro do período (% a %).', v_parts,
        to_char(v_l.start_date, 'DD/MM/YYYY'), to_char(v_l.end_date, 'DD/MM/YYYY');
    end if;
    if p_abono_inicio = v_l.start_date and p_abono_fim = v_l.end_date then
      raise exception 'Para % o período inteiro, escolha o motivo %.', v_inf, coalesce(v_esp.name, v_padrao);
    end if;
    if p_abono_inicio <> v_l.start_date and p_abono_fim <> v_l.end_date then
      raise exception 'Os dias % precisam ser os do começo ou os do fim do período.', v_parts;
    end if;
    if p_abono_inicio = v_l.start_date and v_l.primeiro_dia <> 'integral' then
      raise exception 'Com o primeiro dia trabalhado, os dias % precisam ser os do fim do período.', v_parts;
    end if;
    v_novo_ini := case when p_abono_inicio = v_l.start_date then p_abono_fim + 1 else v_l.start_date end;
    v_novo_fim := case when p_abono_fim = v_l.end_date then p_abono_inicio - 1 else v_l.end_date end;
    if v_l.primeiro_dia = 'trabalhou' and v_novo_fim <= v_novo_ini then
      raise exception 'Com o primeiro dia trabalhado, sobraria só ele no lançamento. Deixe pelo menos um dia de ausência fora do %.', v_subst;
    end if;
    if v_esp.id is null or not v_esp.active then
      raise exception 'Os dias % são lançados com o motivo %, que está desativado. Ative-o em Configurações, na aba Absenteísmos.',
        v_parts, coalesce(v_esp.name, v_padrao);
    end if;
  end if;

  -- ---------- dias sem comparecer fora do documento (17/11/2026) ----------
  if v_l.status in ('aberto', 'reprovado')
     and v_l.ausente_ate is not null and v_l.ausente_ate > v_l.occurred_on
     and v_l.start_date is not null and v_l.end_date is not null
     and v_l.end_date >= v_l.start_date then
    v_ini := v_l.occurred_on;
    v_fim := v_l.ausente_ate;
    v_cob_ini := case when v_l.primeiro_dia = 'trabalhou' then v_l.start_date + 1 else v_l.start_date end;

    if v_l.primeiro_dia = 'trabalhou' and v_l.start_date between v_ini and v_fim then
      raise exception 'O colaborador estava sem comparecer em %, mas o primeiro dia do documento está marcado como trabalhado.',
        to_char(v_l.start_date, 'DD/MM/YYYY');
    end if;
    if not (daterange(v_cob_ini, v_l.end_date, '[]') && daterange(v_ini, v_fim, '[]')) then
      raise exception 'O período do documento (% a %) não cobre nenhum dos dias sem comparecer (% a %).',
        to_char(v_l.start_date, 'DD/MM/YYYY'), to_char(v_l.end_date, 'DD/MM/YYYY'),
        to_char(v_ini, 'DD/MM/YYYY'), to_char(v_fim, 'DD/MM/YYYY');
    end if;

    if v_ini < v_cob_ini then
      v_blocos := v_blocos || daterange(v_ini, v_cob_ini - 1, '[]');
    end if;
    if v_fim > v_l.end_date then
      v_blocos := v_blocos || daterange(v_l.end_date + 1, v_fim, '[]');
    end if;

    if cardinality(v_blocos) > 0 then
      -- a falta comum: nunca o Abono nem a Compensação
      select t.* into v_t
        from public.absence_types t
       where t.tenant_id = v_l.tenant_id and t.active and t.kind = 'falta' and not t.requires_document
         and not t.abono and not t.compensacao
       order by t.sort nulls last, t.name
       limit 1;
      if v_t.id is null then
        raise exception 'Os dias que o documento não cobre seriam lançados como falta, mas o catálogo não tem motivo de falta sem documento obrigatório. Cadastre um em Configurações, na aba Absenteísmos.';
      end if;

      v_hist := 'Sem comparecer de ' || to_char(v_ini, 'DD/MM/YYYY') || ' a ' || to_char(v_fim, 'DD/MM/YYYY') || '.';

      update public.absenteismo_lancamentos
         set occurred_on = greatest(v_ini, v_cob_ini),
             ausente_ate = least(v_fim, v_l.end_date),
             note = concat_ws(' ', nullif(btrim(coalesce(note, '')), ''),
                    v_hist || ' Os dias fora do documento foram lançados à parte como ' || v_t.name || '.'),
             updated_at = now()
       where id = p_id;

      foreach v_b in array v_blocos loop
        begin
          insert into public.absenteismo_lancamentos (
            tenant_id, user_id, created_by, status, occurred_on, reason_note,
            absence_type_id, snap_type_name, snap_kind, snap_requires_document, snap_requires_medical,
            snap_requires_companion, snap_requires_kinship, snap_discounts_rv_default, discounts_rv,
            start_date, end_date, note,
            snap_full_name, snap_employee_code, snap_department_id, snap_department_name,
            snap_subdepartment_id, snap_subdepartment_name, snap_position_id, snap_position_name,
            snap_manager_id, snap_manager_name, snap_unit_id, snap_unit_name)
          values (
            v_l.tenant_id, v_l.user_id, (select auth.uid()), 'aberto', lower(v_b), v_l.reason_note,
            v_t.id, v_t.name, v_t.kind, v_t.requires_document, v_t.requires_medical,
            v_t.requires_companion, v_t.requires_kinship, v_t.discounts_rv_default, v_t.discounts_rv_default,
            lower(v_b), upper(v_b) - 1,
            v_hist || ' Dias sem cobertura do documento (' || coalesce(v_l.snap_type_name, 'motivo') || ' de '
              || to_char(v_l.start_date, 'DD/MM/YYYY') || ' a ' || to_char(v_l.end_date, 'DD/MM/YYYY') || ').',
            v_l.snap_full_name, v_l.snap_employee_code, v_l.snap_department_id, v_l.snap_department_name,
            v_l.snap_subdepartment_id, v_l.snap_subdepartment_name, v_l.snap_position_id, v_l.snap_position_name,
            v_l.snap_manager_id, v_l.snap_manager_name, v_l.snap_unit_id, v_l.snap_unit_name)
          returning id into v_novo;
        exception when unique_violation then
          raise exception 'Já existe outro lançamento deste colaborador em %. Cancele-o antes de efetivar este.',
            to_char(lower(v_b), 'DD/MM/YYYY');
        end;
        perform public.absenteismo_confirmar(v_novo);
        v_criados := v_criados || v_novo;
      end loop;
    end if;
  end if;

  -- ---------- abono ou compensação de parte dos dias ----------
  if p_abono_inicio is not null then
    -- relê: a separação acima pode ter mudado o dia lançado e os dias sem comparecer
    select l.* into v_l from public.absenteismo_lancamentos l where l.id = p_id;

    v_dias_abono := p_abono_fim - p_abono_inicio + 1;

    -- o original fica com os dias que o motivo cobre (antes do insert: o dia
    -- lançado pode ser um dos separados, e a chave é por pessoa e dia)
    update public.absenteismo_lancamentos
       set start_date = v_novo_ini,
           end_date = v_novo_fim,
           occurred_on = least(greatest(occurred_on, v_novo_ini), v_novo_fim),
           ausente_ate = case when ausente_ate is null then null
                              else greatest(least(ausente_ate, v_novo_fim), least(greatest(occurred_on, v_novo_ini), v_novo_fim)) end,
           note = concat_ws(' ', nullif(btrim(coalesce(note, '')), ''),
                  'Documento de ' || to_char(v_l.start_date, 'DD/MM/YYYY') || ' a ' || to_char(v_l.end_date, 'DD/MM/YYYY') || '.'
                  || ' O motivo cobre ' || case when v_novo_ini = v_novo_fim then to_char(v_novo_ini, 'DD/MM/YYYY')
                                               else to_char(v_novo_ini, 'DD/MM/YYYY') || ' a ' || to_char(v_novo_fim, 'DD/MM/YYYY') end || ';'
                  || ' ' || case when v_dias_abono = 1 then to_char(p_abono_inicio, 'DD/MM/YYYY') || ' foi ' || v_part
                                 else to_char(p_abono_inicio, 'DD/MM/YYYY') || ' a ' || to_char(p_abono_fim, 'DD/MM/YYYY') || ' foram ' || v_parts end
                  || ' num lançamento à parte.'),
           updated_at = now()
     where id = p_id;

    begin
      insert into public.absenteismo_lancamentos (
        tenant_id, user_id, created_by, status, occurred_on, reason_note,
        absence_type_id, snap_type_name, snap_kind, snap_requires_document, snap_requires_medical,
        snap_requires_companion, snap_requires_kinship, snap_discounts_rv_default, discounts_rv,
        start_date, end_date, waived, tratamento, note,
        snap_full_name, snap_employee_code, snap_department_id, snap_department_name,
        snap_subdepartment_id, snap_subdepartment_name, snap_position_id, snap_position_name,
        snap_manager_id, snap_manager_name, snap_unit_id, snap_unit_name)
      values (
        v_l.tenant_id, v_l.user_id, (select auth.uid()), 'aberto', p_abono_inicio, v_l.reason_note,
        v_esp.id, v_esp.name, v_esp.kind, v_esp.requires_document, v_esp.requires_medical,
        v_esp.requires_companion, v_esp.requires_kinship, v_esp.discounts_rv_default, false,
        p_abono_inicio, p_abono_fim, true, v_trat,
        case v_trat when 'abono' then 'Dias abonados pela empresa. ' else 'Dias compensados no banco de horas. ' end
          || coalesce(v_l.snap_type_name, 'Motivo') || ' com documento de '
          || to_char(v_l.start_date, 'DD/MM/YYYY') || ' a ' || to_char(v_l.end_date, 'DD/MM/YYYY')
          || '; o motivo cobre ' || case when v_novo_ini = v_novo_fim then to_char(v_novo_ini, 'DD/MM/YYYY')
                                        else to_char(v_novo_ini, 'DD/MM/YYYY') || ' a ' || to_char(v_novo_fim, 'DD/MM/YYYY') end || '.',
        v_l.snap_full_name, v_l.snap_employee_code, v_l.snap_department_id, v_l.snap_department_name,
        v_l.snap_subdepartment_id, v_l.snap_subdepartment_name, v_l.snap_position_id, v_l.snap_position_name,
        v_l.snap_manager_id, v_l.snap_manager_name, v_l.snap_unit_id, v_l.snap_unit_name)
      returning id into v_abono;
    exception when unique_violation then
      raise exception 'Já existe outro lançamento deste colaborador em %. Cancele-o antes de % esses dias.',
        to_char(p_abono_inicio, 'DD/MM/YYYY'), v_inf;
    end;
    perform public.absenteismo_confirmar(v_abono);
  end if;

  perform public.absenteismo_confirmar(p_id);
  return jsonb_build_object('faltas', to_jsonb(v_criados), 'abono', v_abono, 'tratamento', v_trat);
end;
$function$;

revoke execute on function public.absenteismo_confirmar_e_separar(uuid, date, date, text) from public, anon;
grant execute on function public.absenteismo_confirmar_e_separar(uuid, date, date, text) to authenticated;

notify pgrst, 'reload schema';
