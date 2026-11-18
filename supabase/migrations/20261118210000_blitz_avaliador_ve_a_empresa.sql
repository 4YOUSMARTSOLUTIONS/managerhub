-- Blitz: o avaliador vê a empresa inteira, sucessores inclusive (LUIZ, 18/11/2026).
--
-- Antes o avaliador (marca memberships.is_avaliador_blitz) via só as blitz que
-- ele mesmo lançou, e sem as Análises. Agora ele enxerga a blitz como a equipe
-- de segurança: todas as unidades, todas as pessoas (o topo da hierarquia, os
-- sucessores, também), Análises, Colaboradores, Recorrência, Alertas e
-- Registros. Registrar tratativa continua só com o gestor alertado.
--
-- Só a blitz: Relatos e Acidentes NÃO passam a ser vistos (relator anônimo e
-- CID ficam com a equipe de segurança). Por isso a marca entra nas funções da
-- blitz, e não no `pode_tratar_seguranca`.
--
-- O recorte por unidade é o seletor do topo, que deixa de travar o avaliador
-- na unidade dele (src/lib/tenant.ts).

-- a marca de quem pergunta, ativa, nesta empresa
create or replace function public.is_avaliador_blitz(p_tenant uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.memberships m
     where m.tenant_id = p_tenant and m.user_id = (select auth.uid())
       and m.is_active and m.is_avaliador_blitz
  );
$function$;

-- quem vê os sucessores (o topo) nas análises e nas listas da blitz
create or replace function public.ve_o_topo(p_tenant uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public.pode_tratar_seguranca(p_tenant)
      or public.is_avaliador_blitz(p_tenant)
      or (select auth.uid()) in (select public.seg_topo_da_hierarquia(p_tenant));
$function$;

-- RLS de seg_blitz_avaliacoes (e, por ela, de seg_blitz_respostas): empresa inteira
create or replace function public.blitz_tenants_ve_tudo()
 returns setof uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select t.id from public.tenants t
   where public.pode_tratar_seguranca(t.id)
      or public.is_avaliador_blitz(t.id)
      or (public.has_tenant_role(t.id, '{manager}'::public.member_role[]) and public.ve_o_topo(t.id));
$function$;

-- RLS de seg_veiculos
create or replace function public.pode_ver_blitz(p_tenant uuid, p_user uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p_user = (select auth.uid())
      or public.manages_user(p_user, p_tenant)
      or public.pode_tratar_seguranca(p_tenant)
      or public.is_avaliador_blitz(p_tenant)
      or (public.has_tenant_role(p_tenant, '{owner,admin}'::public.member_role[]))
      or (public.has_tenant_role(p_tenant, '{manager}'::public.member_role[])
          and (public.ve_o_topo(p_tenant)
               or p_user not in (select public.seg_topo_da_hierarquia(p_tenant))));
$function$;

-- Análises e alertas do período: o avaliador entra em "vê a empresa". As duas
-- funções são longas e mudam só nesta linha, então a troca é feita sobre a
-- definição em produção (e falha se o trecho não estiver lá).
do $$
declare
  d text;
  n text;
begin
  for d in
    select pg_get_functiondef(p)
      from unnest(array[
        'public.seg_blitz_analise(date,date,uuid[],boolean)'::regprocedure,
        'public.seg_blitz_alertas_do_periodo(date,date,uuid[],boolean)'::regprocedure
      ]) p
  loop
    n := replace(d,
      E'          or public.pode_tratar_seguranca(v_tenant);\n  v_lider',
      E'          or public.pode_tratar_seguranca(v_tenant)\n          or public.is_avaliador_blitz(v_tenant);\n  v_lider');
    if n = d then
      raise exception 'Trecho do v_amplo não encontrado: a função mudou desde a última migração.';
    end if;
    execute n;
  end loop;
end $$;

-- helper interno: só as funções acima chamam (o app lê a marca na própria membership)
revoke execute on function public.is_avaliador_blitz(uuid) from public, anon, authenticated;
revoke execute on function public.ve_o_topo(uuid) from public, anon, authenticated;
revoke execute on function public.blitz_tenants_ve_tudo() from public, anon;
revoke execute on function public.pode_ver_blitz(uuid, uuid) from public, anon;
revoke execute on function public.seg_blitz_analise(date, date, uuid[], boolean) from public, anon;
revoke execute on function public.seg_blitz_alertas_do_periodo(date, date, uuid[], boolean) from public, anon;

notify pgrst, 'reload schema';
