-- Anexo do atestado nos lançamentos importados (LUIZ, 17/11/2026).
--
-- A importação de histórico entra APROVADA e sem anexo, e a guarda tranca
-- qualquer alteração em lançamento aprovado. O DP (owner, admin ou RH) passa a
-- poder anexar, trocar ou remover o documento SÓ nesses lançamentos importados,
-- e SÓ o documento: qualquer outra coluna que mude junto continua recusada.
--
-- updated_at sai da comparação porque o gatilho set_updated_at roda antes deste
-- (ordem alfabética), e ausencia_inicio porque coluna gerada ainda não está
-- calculada no NEW de um gatilho BEFORE.

create or replace function public.guard_absenteismo_lancamento()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_adm boolean;
  v_so_anexo constant text[] := array[
    'doc_path', 'doc_filename', 'doc_size', 'doc_content_type', 'doc_uploaded_at', 'doc_uploaded_by',
    'updated_at', 'ausencia_inicio'
  ];
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
       or new.primeiro_dia is distinct from old.primeiro_dia
       or new.snap_requires_companion is distinct from old.snap_requires_companion
       or new.snap_requires_kinship is distinct from old.snap_requires_kinship
       or new.snap_full_name is distinct from old.snap_full_name
       or new.snap_department_name is distinct from old.snap_department_name
       or new.snap_position_name is distinct from old.snap_position_name
       or new.snap_manager_name is distinct from old.snap_manager_name
       or new.snap_unit_id is distinct from old.snap_unit_id
       or new.ausente_ate is distinct from old.ausente_ate)
  then
    raise exception 'Este lançamento está com o RH. Peça a reprovação para corrigir.';
  end if;

  -- "Continua ausente" registra o que já aconteceu, nunca o que virá
  if new.ausente_ate is distinct from old.ausente_ate
     and new.ausente_ate > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'O último dia sem comparecer não pode ser depois de hoje.';
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
    -- importado e aprovado: o DP anexa o atestado depois, e só o anexo muda
    if old.importado and old.status = 'aprovado'
       and (to_jsonb(new) - v_so_anexo) = (to_jsonb(old) - v_so_anexo) then
      if not v_adm then
        raise exception 'Só o DP anexa documento a lançamento importado.';
      end if;
    else
      raise exception 'Lançamento já encerrado. Não é possível alterá-lo.';
    end if;
  end if;

  return new;
end;
$function$;

revoke execute on function public.guard_absenteismo_lancamento() from public, anon, authenticated;
