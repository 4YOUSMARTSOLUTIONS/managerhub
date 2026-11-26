-- Motivo próprio "Abono" (LUIZ, 26/11/2026), no dia em que o abono de parte
-- dos dias entrou: os dias abonados não saem mais como "Falta sem
-- justificativa" abonada, e sim com o motivo Abono.
--
-- `absence_types.abono` marca o motivo de abono da empresa (um por empresa).
-- Ele é do comportamento Falta, sem documento: assim herda tudo o que a falta
-- abonada já tinha (fora da remuneração variável e da redução de férias, que
-- descartam `waived`; entra em Abonos no ponto, que lista `waived` aprovado).
-- Todo lançamento com ele sai abonado: o gatilho força `waived`, por qualquer
-- caminho (Efetivar, abono de parte dos dias, importação).
--
-- A separação dos dias fora do documento continua usando a falta comum (o
-- primeiro motivo de falta sem documento que NÃO é o Abono).

alter table public.absence_types add column abono boolean not null default false;

create unique index absence_types_um_abono on public.absence_types (tenant_id) where abono;

alter table public.absence_types add constraint absence_types_abono_coerente check (
  not abono or (kind = 'falta' and not requires_document and not requires_medical
                and not requires_companion and not requires_kinship)
);

insert into public.absence_types (
  tenant_id, name, description, kind, requires_document, requires_medical, requires_companion,
  requires_kinship, discounts_rv_default, counts_as_absenteeism, active, sort, abono)
select t.id, 'Abono',
       'Dias abonados pela empresa: ficam registrados, não pesam na remuneração variável e vão para Abonos no ponto.',
       'falta', false, false, false, false, false, true, true, 51, true
  from public.tenants t
 where not exists (select 1 from public.absence_types a where a.tenant_id = t.id and a.abono);

-- Lançamento com o motivo Abono é sempre abonado. Roda antes da guarda
-- (ordem alfabética dos gatilhos), que compara o NEW já corrigido.
create or replace function public.absenteismo_abono_sempre_abonado()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.absence_type_id is not null and not new.waived
     and exists (select 1 from public.absence_types t where t.id = new.absence_type_id and t.abono) then
    new.waived := true;
  end if;
  return new;
end;
$function$;

revoke execute on function public.absenteismo_abono_sempre_abonado() from public, anon, authenticated;

create trigger trg_absenteismo_abono_sempre_abonado
  before insert or update of absence_type_id, waived on public.absenteismo_lancamentos
  for each row execute function public.absenteismo_abono_sempre_abonado();

-- O abono de parte dos dias passa a usar o motivo Abono, e a separação dos dias
-- fora do documento deixa o Abono de fora.
create or replace function public.absenteismo_confirmar_e_separar(
  p_id uuid, p_abono_inicio date default null, p_abono_fim date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_l record;
  v_t record;
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
begin
  select l.* into v_l from public.absenteismo_lancamentos l where l.id = p_id;
  if v_l.id is null or not public.pode_ver_absenteismo(v_l.tenant_id, v_l.user_id, v_l.created_by) then
    raise exception 'Lançamento não encontrado.';
  end if;

  -- ---------- conferência do abono, antes de mexer em qualquer coisa ----------
  if p_abono_inicio is not null or p_abono_fim is not null then
    if p_abono_inicio is null or p_abono_fim is null then
      raise exception 'Informe o primeiro e o último dia abonado.';
    end if;
    if v_l.status not in ('aberto', 'reprovado') then
      raise exception 'Só dá para abonar parte dos dias antes do envio ao DP.';
    end if;
    if v_l.start_date is null or v_l.end_date is null or v_l.end_date <= v_l.start_date then
      raise exception 'Abonar parte dos dias pede um período de pelo menos dois dias.';
    end if;
    if v_l.falta_continua or v_l.end_date = '9999-12-31'::date then
      raise exception 'A falta sem data de término não aceita abono de parte dos dias.';
    end if;
    if v_l.partial_day then
      raise exception 'A ausência de horas não aceita abono de parte dos dias.';
    end if;
    if v_l.waived then
      raise exception 'A falta já está toda abonada.';
    end if;
    if p_abono_fim < p_abono_inicio then
      raise exception 'O último dia abonado não pode ser antes do primeiro.';
    end if;
    if p_abono_inicio < v_l.start_date or p_abono_fim > v_l.end_date then
      raise exception 'Os dias abonados precisam estar dentro do período (% a %).',
        to_char(v_l.start_date, 'DD/MM/YYYY'), to_char(v_l.end_date, 'DD/MM/YYYY');
    end if;
    if p_abono_inicio = v_l.start_date and p_abono_fim = v_l.end_date then
      raise exception 'Para abonar o período inteiro, escolha o motivo Abono.';
    end if;
    if p_abono_inicio <> v_l.start_date and p_abono_fim <> v_l.end_date then
      raise exception 'Os dias abonados precisam ser os do começo ou os do fim do período.';
    end if;
    if p_abono_inicio = v_l.start_date and v_l.primeiro_dia <> 'integral' then
      raise exception 'Com o primeiro dia trabalhado, os dias abonados precisam ser os do fim do período.';
    end if;
    -- o que sobra precisa ter pelo menos um dia de ausência
    v_novo_ini := case when p_abono_inicio = v_l.start_date then p_abono_fim + 1 else v_l.start_date end;
    v_novo_fim := case when p_abono_fim = v_l.end_date then p_abono_inicio - 1 else v_l.end_date end;
    if v_l.primeiro_dia = 'trabalhou' and v_novo_fim <= v_novo_ini then
      raise exception 'Com o primeiro dia trabalhado, sobraria só ele no lançamento. Deixe pelo menos um dia de ausência fora do abono.';
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
      select t.* into v_t
        from public.absence_types t
       where t.tenant_id = v_l.tenant_id and t.active and t.kind = 'falta' and not t.requires_document and not t.abono
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

  -- ---------- abono de parte dos dias (26/11/2026) ----------
  if p_abono_inicio is not null then
    -- relê: a separação acima pode ter mudado o dia lançado e os dias sem comparecer
    select l.* into v_l from public.absenteismo_lancamentos l where l.id = p_id;

    select t.* into v_t
      from public.absence_types t
     where t.tenant_id = v_l.tenant_id and t.abono;
    if v_t.id is null or not v_t.active then
      raise exception 'Os dias abonados são lançados com o motivo Abono, que está desativado. Ative-o em Configurações, na aba Absenteísmos.';
    end if;

    v_dias_abono := p_abono_fim - p_abono_inicio + 1;

    -- o original fica com os dias que o motivo cobre (antes do insert: o dia
    -- lançado pode ser um dos abonados, e a chave é por pessoa e dia)
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
                  || ' ' || case when v_dias_abono = 1 then to_char(p_abono_inicio, 'DD/MM/YYYY') || ' foi abonado'
                                 else to_char(p_abono_inicio, 'DD/MM/YYYY') || ' a ' || to_char(p_abono_fim, 'DD/MM/YYYY') || ' foram abonados' end
                  || ' num lançamento à parte.'),
           updated_at = now()
     where id = p_id;

    begin
      insert into public.absenteismo_lancamentos (
        tenant_id, user_id, created_by, status, occurred_on, reason_note,
        absence_type_id, snap_type_name, snap_kind, snap_requires_document, snap_requires_medical,
        snap_requires_companion, snap_requires_kinship, snap_discounts_rv_default, discounts_rv,
        start_date, end_date, waived, note,
        snap_full_name, snap_employee_code, snap_department_id, snap_department_name,
        snap_subdepartment_id, snap_subdepartment_name, snap_position_id, snap_position_name,
        snap_manager_id, snap_manager_name, snap_unit_id, snap_unit_name)
      values (
        v_l.tenant_id, v_l.user_id, (select auth.uid()), 'aberto', p_abono_inicio, v_l.reason_note,
        v_t.id, v_t.name, v_t.kind, v_t.requires_document, v_t.requires_medical,
        v_t.requires_companion, v_t.requires_kinship, v_t.discounts_rv_default, false,
        p_abono_inicio, p_abono_fim, true,
        'Dias abonados pela empresa. ' || coalesce(v_l.snap_type_name, 'Motivo') || ' com documento de '
          || to_char(v_l.start_date, 'DD/MM/YYYY') || ' a ' || to_char(v_l.end_date, 'DD/MM/YYYY')
          || '; o motivo cobre ' || case when v_novo_ini = v_novo_fim then to_char(v_novo_ini, 'DD/MM/YYYY')
                                        else to_char(v_novo_ini, 'DD/MM/YYYY') || ' a ' || to_char(v_novo_fim, 'DD/MM/YYYY') end || '.',
        v_l.snap_full_name, v_l.snap_employee_code, v_l.snap_department_id, v_l.snap_department_name,
        v_l.snap_subdepartment_id, v_l.snap_subdepartment_name, v_l.snap_position_id, v_l.snap_position_name,
        v_l.snap_manager_id, v_l.snap_manager_name, v_l.snap_unit_id, v_l.snap_unit_name)
      returning id into v_abono;
    exception when unique_violation then
      raise exception 'Já existe outro lançamento deste colaborador em %. Cancele-o antes de abonar esses dias.',
        to_char(p_abono_inicio, 'DD/MM/YYYY');
    end;
    perform public.absenteismo_confirmar(v_abono);
  end if;

  perform public.absenteismo_confirmar(p_id);
  return jsonb_build_object('faltas', to_jsonb(v_criados), 'abono', v_abono);
end;
$function$;

revoke execute on function public.absenteismo_confirmar_e_separar(uuid, date, date) from public, anon;
grant execute on function public.absenteismo_confirmar_e_separar(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
