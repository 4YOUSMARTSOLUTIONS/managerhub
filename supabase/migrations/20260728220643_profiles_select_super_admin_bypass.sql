drop policy if exists profiles_self_select on public.profiles;

create policy profiles_self_select on public.profiles
for select
using (
  is_super_admin()
  or id = auth.uid()
  or exists (
    select 1
    from memberships m1
    join memberships m2 on m1.tenant_id = m2.tenant_id
    where m1.user_id = auth.uid() and m2.user_id = profiles.id
  )
);
