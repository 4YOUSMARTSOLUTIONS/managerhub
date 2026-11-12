-- Ausência parcial sem horário (LUIZ, 12/11/2026).
--
-- No "Ainda não sei o motivo", o gestor sabe que a pessoa trabalhou parte do
-- dia (chegou atrasada, saiu mais cedo), mas nem sempre sabe as horas. Até
-- aqui a parcialidade era deduzida das horas (as duas ou nenhuma), então não
-- dava para dizer "parcial, horário a confirmar". Agora:
--   * partial_day marca a ausência parcial, com ou sem horário;
--   * horário informado implica parcial (check);
--   * o envio ao RH exige o horário quando é parcial;
--   * depois de enviado, partial_day congela junto com as horas (guarda).

alter table public.absenteismo_lancamentos
  add column partial_day boolean not null default false;

update public.absenteismo_lancamentos set partial_day = true where hours_start is not null;

alter table public.absenteismo_lancamentos
  add constraint absenteismo_parcial_com_horas check (hours_start is null or partial_day);

-- ---------------------------------------------------------------- envio ao RH

create or replace function public.absenteismo_confirmar(p_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_l record;
  v_at record;
  v_adm uuid[];
begin
  select l.* into v_l from public.absenteismo_lancamentos l where l.id = p_id;
  if v_l.id is null or not public.pode_ver_absenteismo(v_l.tenant_id, v_l.user_id, v_l.created_by) then
    raise exception 'Lançamento não encontrado.';
  end if;
  if v_l.status not in ('aberto', 'reprovado') then
    raise exception 'Este lançamento já foi enviado ao RH.';
  end if;

  if v_l.absence_type_id is null then raise exception 'Escolha o tipo de absenteísmo.'; end if;
  if v_l.start_date is null or v_l.end_date is null then
    raise exception 'Informe o período de início e término.';
  end if;
  if v_l.end_date < v_l.start_date then
    raise exception 'O término não pode ser antes do início.';
  end if;
  if v_l.occurred_on not between v_l.start_date and v_l.end_date then
    raise exception 'O período informado precisa incluir o dia do não comparecimento (%).',
      to_char(v_l.occurred_on, 'DD/MM/YYYY');
  end if;
  if v_l.snap_requires_document and v_l.doc_path is null then
    raise exception 'Anexe o documento antes de enviar ao RH.';
  end if;

  select a.* into v_at from public.absenteismo_atestados a where a.lancamento_id = p_id;

  if v_l.snap_requires_medical then
    if v_at.lancamento_id is null
       or coalesce(btrim(v_at.doctor_name), '') = ''
       or v_at.issued_on is null then
      raise exception 'Preencha o nome do profissional e a data de emissão do atestado.';
    end if;
    if v_l.certificate_kind is null then
      raise exception 'Informe se o atestado é médico ou odontológico.';
    end if;
  end if;

  if v_l.snap_requires_companion
     and coalesce(btrim(v_at.companion_name), '') = '' then
    raise exception 'Informe quem foi o acompanhado.';
  end if;

  if v_l.snap_requires_kinship
     and coalesce(btrim(v_l.kinship_of_deceased), '') = '' then
    raise exception 'Informe o grau de parentesco do falecido.';
  end if;

  -- parcial sem horário só até aqui: o RH precisa das horas para a folha
  if v_l.partial_day and v_l.hours_start is null then
    raise exception 'Ausência parcial: informe o horário (das e até) antes de enviar ao RH.';
  end if;

  if (v_l.partial_day or v_l.hours_start is not null) and v_l.start_date <> v_l.end_date then
    raise exception 'Ausência de horas vale para um único dia: início e término precisam ser a mesma data.';
  end if;

  update public.absenteismo_lancamentos
     set status = 'pendente',
         submitted_at = now(),
         decision_note = null,
         decided_at = null,
         decided_by = null,
         updated_at = now()
   where id = p_id;

  select array_agg(m.user_id) into v_adm
    from public.memberships m
   where m.tenant_id = v_l.tenant_id
     and (m.role in ('owner', 'admin') or m.is_hr)
     and m.is_active;

  if v_adm is not null then
    perform public.notify_users_sistema(
      v_l.tenant_id, v_adm, 'absenteismo_pendente',
      'Absenteísmo aguardando aprovação',
      coalesce(v_l.snap_full_name, 'Colaborador') || ': ' ||
      coalesce(v_l.snap_type_name, 'ausência') || ' de ' ||
      to_char(v_l.start_date, 'DD/MM') || ' a ' || to_char(v_l.end_date, 'DD/MM') || '.');
  end if;
end;
$function$;

revoke execute on function public.absenteismo_confirmar(uuid) from public, anon;

-- ---------------------------------------------------------------- guarda

create or replace function public.guard_absenteismo_lancamento()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_adm boolean;
begin
  v_adm := public.has_tenant_role(old.tenant_id, '{owner,admin,hr}'::public.member_role[]);

  if old.status not in ('aberto', 'reprovado') and (
       new.user_id is distinct from old.user_id
       or new.occurred_on is distinct from old.occurred_on
       or new.absence_type_id is distinct from old.absence_type_id
       or new.snap_type_name is distinct from old.snap_type_name
       or new.snap_kind is distinct from old.snap_kind
       or new.start_date is distinct from old.start_date
       or new.end_date is distinct from old.end_date
       or new.discounts_rv is distinct from old.discounts_rv
       or new.note is distinct from old.note
       or new.reason_note is distinct from old.reason_note
       or new.kinship_of_deceased is distinct from old.kinship_of_deceased
       or new.work_accident is distinct from old.work_accident
       or new.certificate_kind is distinct from old.certificate_kind
       or new.waived is distinct from old.waived
       or new.hours_start is distinct from old.hours_start
       or new.hours_end is distinct from old.hours_end
       or new.partial_day is distinct from old.partial_day
       or new.snap_requires_companion is distinct from old.snap_requires_companion
       or new.snap_requires_kinship is distinct from old.snap_requires_kinship
       or new.snap_full_name is distinct from old.snap_full_name
       or new.snap_department_name is distinct from old.snap_department_name
       or new.snap_position_name is distinct from old.snap_position_name
       or new.snap_manager_name is distinct from old.snap_manager_name
       or new.snap_unit_id is distinct from old.snap_unit_id)
  then
    raise exception 'Este lançamento está com o RH. Peça a reprovação para corrigir.';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'aberto'    and new.status in ('pendente', 'cancelado'))
      or (old.status = 'reprovado' and new.status in ('pendente', 'cancelado'))
      or (old.status = 'pendente'  and new.status in ('aprovado', 'reprovado') and v_adm)
      or (old.status = 'aprovado'  and new.status = 'cancelado'
          and public.has_tenant_role(old.tenant_id, '{owner,admin}'::public.member_role[]))
    ) then
      raise exception 'Transição de status inválida.';
    end if;
  elsif old.status in ('aprovado', 'cancelado') then
    raise exception 'Lançamento já encerrado. Não é possível alterá-lo.';
  end if;

  return new;
end;
$function$;

-- função de gatilho: ninguém chama direto
revoke execute on function public.guard_absenteismo_lancamento() from public, anon, authenticated;

notify pgrst, 'reload schema';
