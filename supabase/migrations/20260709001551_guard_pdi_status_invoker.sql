create or replace function public.guard_pdi_status()
returns trigger language plpgsql
security invoker set search_path to 'public' as $$
declare v_priv boolean;
begin
  if NEW.status is distinct from OLD.status and NEW.status in ('concluida','cancelada') then
    v_priv := public.has_tenant_role(NEW.tenant_id, '{owner,admin}'::public.member_role[])
              or public.manages_user(NEW.subject_user_id, NEW.tenant_id);
    if not v_priv then
      raise exception 'Apenas o gestor do colaborador ou um administrador pode concluir/cancelar a ação do PDI.';
    end if;
  end if;
  return NEW;
end $$;
