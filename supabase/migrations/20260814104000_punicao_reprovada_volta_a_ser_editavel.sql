-- O congelamento do carimbo pegava cedo demais.
--
-- A guarda dizia "se saiu do rascunho, nada muda", e a própria mensagem manda
-- pedir a reprovação para corrigir. Só que `reprovada` também não é rascunho:
-- o RH devolvia o lançamento e o gestor não conseguia mexer em nada, ficando
-- com um caminho sem saída (a transição reprovada -> pendente existe, mas
-- reenviaria o mesmo erro que motivou a devolução).
--
-- Reprovada é o estado em que o lançamento voltou para as mãos de quem lançou.
-- O que precisa continuar congelado é o que já foi aprovado ou está sob análise
-- do RH.

create or replace function public.guard_punicao_lancamento()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_adm boolean;
begin
  v_adm := public.has_tenant_role(old.tenant_id, '{owner,admin,hr}'::public.member_role[]);

  if old.status not in ('rascunho', 'reprovada') and (
       new.user_id is distinct from old.user_id
       or new.applied_on is distinct from old.applied_on
       or new.infraction_type_id is distinct from old.infraction_type_id
       or new.infraction_code is distinct from old.infraction_code
       or new.infraction_name is distinct from old.infraction_name
       or new.infraction_description is distinct from old.infraction_description
       or new.severity is distinct from old.severity
       or new.sanction_type_id is distinct from old.sanction_type_id
       or new.sanction_name is distinct from old.sanction_name
       or new.extra_info is distinct from old.extra_info
       or new.snap_full_name is distinct from old.snap_full_name
       or new.snap_department_name is distinct from old.snap_department_name
       or new.snap_position_name is distinct from old.snap_position_name
       or new.snap_manager_name is distinct from old.snap_manager_name)
  then
    raise exception 'Este lançamento está com o RH. Peça a reprovação para corrigir.';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'rascunho'  and new.status = 'pendente')
      or (old.status = 'reprovada' and new.status = 'pendente')
      or (old.status = 'pendente'  and new.status in ('aprovada', 'reprovada') and v_adm)
      or (old.status = 'aprovada'  and new.status = 'cancelada'
          and public.has_tenant_role(old.tenant_id, '{owner,admin}'::public.member_role[]))
    ) then
      raise exception 'Transição de status inválida.';
    end if;
  elsif old.status in ('aprovada', 'cancelada') then
    raise exception 'Lançamento já encerrado. Não é possível alterá-lo.';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_punicao_lancamento() from public, anon, authenticated;

notify pgrst, 'reload schema';
