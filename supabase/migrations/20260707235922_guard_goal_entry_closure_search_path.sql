create or replace function public.guard_goal_entry_closure()
returns trigger language plpgsql
security definer set search_path to 'public' as $$
declare
  v_owner uuid;
  v_tenant uuid;
  v_is_admin boolean;
  v_is_mgr boolean;
begin
  select owner_id, tenant_id into v_owner, v_tenant
    from public.individual_goals where id = NEW.goal_id;
  v_is_admin := public.has_tenant_role(v_tenant, '{owner,admin}'::public.member_role[]);
  v_is_mgr := public.manages_user(v_owner, v_tenant);

  if OLD.approval_status = 'aprovada' and NEW.approval_status = 'aprovada'
     and (NEW.actual_value is distinct from OLD.actual_value
       or NEW.target_value is distinct from OLD.target_value
       or NEW.partial_value is distinct from OLD.partial_value
       or NEW.weight is distinct from OLD.weight) then
    raise exception 'Meta aprovada. Reabra com senha de adm/owner antes de alterar.';
  end if;

  if NEW.approval_status is distinct from OLD.approval_status then
    if NEW.approval_status in ('aprovada','reprovada') then
      if not (v_is_admin or v_is_mgr) then
        raise exception 'Apenas o gestor do colaborador ou um administrador pode fechar a meta.';
      end if;
    elsif NEW.approval_status = 'aberta' and OLD.approval_status = 'aprovada' then
      if not v_is_admin then
        raise exception 'Apenas adm/owner pode reabrir uma meta aprovada.';
      end if;
    end if;
  end if;

  return NEW;
end $$;
