-- Fecha o mesmo problema nas outras 108 politicas do sistema.
--
-- is_tenant_member / has_tenant_role / manages_user / is_super_admin sao
-- SECURITY DEFINER, e o planner NUNCA as incorpora: viravam uma consulta por
-- linha lida. Aqui a troca e mecanica e logicamente equivalente, termo a termo:
--
--   is_tenant_member(X)          ->  X in (select my_tenant_ids())
--   has_tenant_role(X, papeis)   ->  X in (select my_role_tenant_ids(papeis))
--   manages_user(A, T)           ->  (A, T) in (select ... my_managed_memberships())
--   is_super_admin()             ->  (select is_super_admin())
--   auth.uid()                   ->  (select auth.uid())
--
-- Cada auxiliar devolve um CONJUNTO sem correlacao com a linha, entao o planner
-- resolve uma vez por consulta em vez de uma vez por linha.
--
-- A reescrita e GERADA a partir do texto das proprias politicas, nao redigida a
-- mao: e a unica forma de mexer em 108 regras de acesso sem mudar nenhuma sem
-- querer. Rodar de novo nao faz efeito (o que ja esta envolvido nao casa com os
-- padroes). As politicas de acoes, demandas, audit_logs, profiles e memberships
-- ja tinham sido tratadas nas migracoes anteriores.

-- pares (subordinado, empresa) que eu gerencio. Espelha manages_user, que NAO tem
-- atalho de super admin.
create or replace function public.my_managed_memberships()
returns table(user_id uuid, tenant_id uuid)
language sql stable security definer set search_path to 'public'
as $function$
  select m.user_id, m.tenant_id from public.memberships m
  where m.manager_id = (select auth.uid());
$function$;

revoke execute on function public.my_managed_memberships() from public, anon;

create or replace function pg_temp.reescreve(e text) returns text language sql immutable as $$
  select case when e is null then null else
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
      e,
      'has_tenant_role\(([a-z_0-9]+\.)?([a-z_0-9]+), (ARRAY\[[^\]]*\]|''\{[^'']*\}''::member_role\[\])\)',
      '\1\2 in (select public.my_role_tenant_ids(\3))', 'g'),
      'is_tenant_member\(([a-z_0-9]+\.)?([a-z_0-9]+)\)',
      '\1\2 in (select public.my_tenant_ids())', 'g'),
      'manages_user\((([a-z_0-9]+\.)?[a-z_0-9]+), (([a-z_0-9]+\.)?[a-z_0-9]+)\)',
      '(\1, \3) in (select user_id, tenant_id from public.my_managed_memberships())', 'g'),
      '(?<!select )is_super_admin\(\)',
      '(select public.is_super_admin())', 'g'),
      '(?<!select )auth\.uid\(\)',
      '(select auth.uid())', 'g')
  end;
$$;

do $$
declare r record; novo_u text; novo_c text; sentenca text;
begin
  for r in
    select p.tablename as tb, p.policyname as pol, p.qual as q, p.with_check as wc
    from pg_policies p
    where p.schemaname='public'
      and (coalesce(p.qual,'')||coalesce(p.with_check,'')) ~ '(has_tenant_role|is_tenant_member|manages_user|is_super_admin)\('
      and p.tablename not in ('actions','action_demandas','action_demanda_assignees',
                              'audit_logs','demanda_events','profiles','memberships','membership_units')
  loop
    novo_u := pg_temp.reescreve(r.q);
    novo_c := pg_temp.reescreve(r.wc);
    sentenca := format('alter policy %I on public.%I', r.pol, r.tb);
    if novo_u is not null then sentenca := sentenca || format(' using (%s)', novo_u); end if;
    if novo_c is not null then sentenca := sentenca || format(' with check (%s)', novo_c); end if;
    execute sentenca;
  end loop;
end $$;
