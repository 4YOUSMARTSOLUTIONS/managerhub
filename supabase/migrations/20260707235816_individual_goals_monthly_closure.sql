-- 1) status de fechamento por entry (meta+competência)
create type public.goal_entry_status as enum ('aberta', 'aprovada', 'reprovada');

alter table public.individual_goal_entries
  add column approval_status public.goal_entry_status not null default 'aberta',
  add column approved_by uuid references public.profiles(id),
  add column approved_at timestamptz,
  add column reproval_note text;

-- 2) trava + governança de transições no fechamento
create or replace function public.guard_goal_entry_closure()
returns trigger language plpgsql as $$
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

  -- realizado/meta/parcial/peso imutáveis enquanto aprovada
  if OLD.approval_status = 'aprovada' and NEW.approval_status = 'aprovada'
     and (NEW.actual_value is distinct from OLD.actual_value
       or NEW.target_value is distinct from OLD.target_value
       or NEW.partial_value is distinct from OLD.partial_value
       or NEW.weight is distinct from OLD.weight) then
    raise exception 'Meta aprovada. Reabra com senha de adm/owner antes de alterar.';
  end if;

  -- só gestor/admin fecham (aprovar/reprovar); só admin reabre (aprovada -> aberta)
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

create trigger trg_guard_goal_entry_closure
  before update on public.individual_goal_entries
  for each row execute function public.guard_goal_entry_closure();

-- 3) cadastro/edição da DEFINIÇÃO da meta só por gestor/admin (colaborador não escreve;
--    mantém a leitura das próprias metas). Substitui a policy ALL única.
drop policy if exists individual_goals_rw on public.individual_goals;

create policy individual_goals_select on public.individual_goals
  for select using (
    public.is_tenant_member(tenant_id) and (
      owner_id = auth.uid()
      or public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[])
      or public.manages_user(owner_id, tenant_id)
    )
  );

create policy individual_goals_insert on public.individual_goals
  for insert with check (
    public.is_tenant_member(tenant_id) and (
      public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[])
      or public.manages_user(owner_id, tenant_id)
    )
  );

create policy individual_goals_update on public.individual_goals
  for update using (
    public.is_tenant_member(tenant_id) and (
      public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[])
      or public.manages_user(owner_id, tenant_id)
    )
  ) with check (
    public.is_tenant_member(tenant_id) and (
      public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[])
      or public.manages_user(owner_id, tenant_id)
    )
  );

create policy individual_goals_delete on public.individual_goals
  for delete using (
    public.is_tenant_member(tenant_id) and (
      public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[])
      or public.manages_user(owner_id, tenant_id)
    )
  );
