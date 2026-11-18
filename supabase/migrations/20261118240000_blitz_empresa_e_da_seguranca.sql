-- Blitz: quem vê a empresa inteira é a equipe de segurança, não o avaliador
-- (LUIZ, 18/11/2026, corrigindo o pedido da manhã).
--
-- A migração 20261118210000 deu ao avaliador da blitz (memberships.is_avaliador_blitz)
-- a visão da empresa inteira, sucessores inclusive. O pedido era para a equipe de
-- segurança (seg_equipe), que no banco JÁ via tudo pelo `pode_tratar_seguranca`; o
-- que a prendia à própria unidade era o seletor do topo, e isso se resolve no app
-- (src/lib/tenant.ts).
--
-- Aqui o avaliador volta ao alcance de antes: as blitz que ele lançou (created_by,
-- na policy de seg_blitz_avaliacoes), as próprias e os veículos (sugestão do
-- formulário, via pode_avaliar_blitz). As Análises saem da tela dele.
--
-- A correção acompanha: o avaliador que não é da segurança corrige só as blitz que
-- ele lançou (as que ele enxerga). Segurança e administração corrigem qualquer uma.
--
-- O helper `is_avaliador_blitz` continua: a correção usa.

create or replace function public.ve_o_topo(p_tenant uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public.pode_tratar_seguranca(p_tenant)
      or (select auth.uid()) in (select public.seg_topo_da_hierarquia(p_tenant));
$function$;

create or replace function public.blitz_tenants_ve_tudo()
 returns setof uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select t.id from public.tenants t
   where public.pode_tratar_seguranca(t.id)
      or (public.has_tenant_role(t.id, '{manager}'::public.member_role[]) and public.ve_o_topo(t.id));
$function$;

create or replace function public.pode_ver_blitz(p_tenant uuid, p_user uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p_user = (select auth.uid())
      or public.manages_user(p_user, p_tenant)
      or public.pode_tratar_seguranca(p_tenant)
      or (public.has_tenant_role(p_tenant, '{owner,admin}'::public.member_role[]))
      or (public.has_tenant_role(p_tenant, '{manager}'::public.member_role[])
          and (public.ve_o_topo(p_tenant)
               or p_user not in (select public.seg_topo_da_hierarquia(p_tenant))));
$function$;

-- Análises e alertas do período: desfaz a linha do avaliador no v_amplo. A troca é
-- feita sobre a definição em produção e falha se o trecho não estiver lá uma vez só.
do $$
declare
  d text;
  n text;
  v_de constant text := E'          or public.pode_tratar_seguranca(v_tenant)\n          or public.is_avaliador_blitz(v_tenant);\n  v_lider';
  v_para constant text := E'          or public.pode_tratar_seguranca(v_tenant);\n  v_lider';
begin
  for d in
    select pg_get_functiondef(p)
      from unnest(array[
        'public.seg_blitz_analise(date,date,uuid[],boolean)'::regprocedure,
        'public.seg_blitz_alertas_do_periodo(date,date,uuid[],boolean)'::regprocedure
      ]) p
  loop
    if (length(d) - length(replace(d, v_de, ''))) / length(v_de) <> 1 then
      raise exception 'Trecho do v_amplo não encontrado (ou repetido): a função mudou desde a última migração.';
    end if;
    n := replace(d, v_de, v_para);
    execute n;
  end loop;
end $$;

-- Correção: o avaliador que não é da segurança corrige só o que ele lançou
do $$
declare
  d text;
  v_de constant text := E'  if v_old.id is null then\n    raise exception ''Blitz não encontrada.'';\n  end if;\n';
  v_para constant text := E'  if v_old.id is null then\n    raise exception ''Blitz não encontrada.'';\n  end if;\n'
    || E'  -- o avaliador corrige o que ele lançou; a empresa inteira é da segurança (LUIZ, 18/11/2026)\n'
    || E'  if not public.pode_tratar_seguranca(v_tenant) and v_old.created_by is distinct from (select auth.uid()) then\n'
    || E'    raise exception ''O avaliador corrige só as blitz que ele lançou.'' using errcode = ''42501'';\n'
    || E'  end if;\n';
begin
  d := pg_get_functiondef('public.seg_editar_blitz(uuid,jsonb,text)'::regprocedure);
  if (length(d) - length(replace(d, v_de, ''))) / length(v_de) <> 1 then
    raise exception 'Trecho da guarda de seg_editar_blitz não encontrado (ou repetido).';
  end if;
  execute replace(d, v_de, v_para);
end $$;

revoke execute on function public.ve_o_topo(uuid) from public, anon, authenticated;
revoke execute on function public.blitz_tenants_ve_tudo() from public, anon;
revoke execute on function public.pode_ver_blitz(uuid, uuid) from public, anon;
revoke execute on function public.seg_blitz_analise(date, date, uuid[], boolean) from public, anon;
revoke execute on function public.seg_blitz_alertas_do_periodo(date, date, uuid[], boolean) from public, anon;
revoke execute on function public.seg_editar_blitz(uuid, jsonb, text) from public, anon;

notify pgrst, 'reload schema';
