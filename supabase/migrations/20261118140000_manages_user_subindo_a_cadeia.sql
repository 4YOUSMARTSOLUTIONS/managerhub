-- `manages_user` subindo a cadeia (desempenho, fase 2, LUIZ 18/11/2026).
--
-- `manages_user(p_owner, p_tenant)` responde "esta pessoa é da minha equipe?"
-- e roda dentro das regras de acesso, LINHA A LINHA (histórico de
-- movimentações, afastamentos, férias, absenteísmo, punições, blitz,
-- treinamentos...). Antes ela remontava a cadeia INTEIRA para baixo do gestor
-- (`my_managed_memberships`, recursiva) a cada linha: ~0,7 ms por chamada;
-- o histórico de movimentações (1.771 linhas) levava 1,6 s para um gestor.
--
-- Agora sobe a partir da pessoa pelo `manager_id` (no máximo 10 níveis, o
-- mesmo limite de antes) e confere se o usuário logado está no caminho. Cada
-- pessoa tem um gestor só, então o caminho para cima é único: é a mesma
-- resposta. Continua exigindo que quem pergunta tenha papel de gestão na
-- empresa (owner, admin, manager ou team_lead), como antes.
--
-- Conferido antes de aplicar: 49.931 pares (todo usuário com papel de gestão ×
-- todo colaborador da empresa, mais 5 colaboradores comuns), 938 relações de
-- gestão, 0 diferenças. Tempo somado: 35,6 s → 3,3 s.

create or replace function public.manages_user(p_owner uuid, p_tenant uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with recursive acima as (
    select m.manager_id as chefe, 1 as nivel
      from public.memberships m
     where m.user_id = p_owner and m.tenant_id = p_tenant
    union all
    select m.manager_id, a.nivel + 1
      from acima a
      join public.memberships m on m.user_id = a.chefe and m.tenant_id = p_tenant
     where a.nivel < 10 and a.chefe is not null and a.chefe <> (select auth.uid())
  )
  select exists (
      select 1 from public.memberships eu
       where eu.user_id = (select auth.uid()) and eu.tenant_id = p_tenant
         and eu.role in ('owner', 'admin', 'manager', 'team_lead'))
     and exists (select 1 from acima where chefe = (select auth.uid()));
$function$;

revoke execute on function public.manages_user(uuid, uuid) from public, anon;
grant execute on function public.manages_user(uuid, uuid) to authenticated;
