-- Visão de equipe: recursiva na cadeia abaixo e TRAVADA por papel.
--
-- Duas mudanças de comportamento num ponto só. Estas duas funções já são por onde
-- toda a visão de equipe passa: as policies de `individual_goals`,
-- `individual_goal_entries`, `feedbacks`, `feedback_sessions`, `pdi_actions`,
-- `checklist_runs` e `checklist_tasks` chamam uma ou outra. Trocando o corpo
-- delas, as 15 policies herdam tudo sem uma linha de `alter policy`.
--
-- 1) TRAVA POR PAPEL. Antes, ter alguém apontando para você em `manager_id` já
--    bastava para ler as metas, feedbacks e PDI dessa pessoa, qualquer que fosse
--    o seu perfil. Com o preenchimento em lote dos ~987 gestores isso ligaria
--    sozinho para uma centena de pessoas. Agora exige as DUAS coisas: ser o
--    gestor E ter papel de `team_lead` (Gestor) ou acima. A guarda é por empresa:
--    quem é Gestor numa e Funcionário noutra só enxerga equipe na primeira.
--
--    `manager` (Gerencial), `admin` e `owner` entram na lista por estarem ACIMA
--    de Gestor na hierarquia. Tirá-los seria remover acesso que eles têm hoje,
--    o que ninguém pediu.
--
-- 2) CADEIA INTEIRA. Antes era um nível só. Agora desce a árvore toda, então um
--    gerente de área alcança os operadores abaixo dos seus coordenadores.
--
-- O teto de 10 níveis não é estética: `manager_id` não tem proteção contra ciclo
-- (A chefia B, B chefia A), e o `union` NÃO resolve isso aqui porque `nivel`
-- entra na chave de deduplicação e muda a cada volta. Sem o teto, um ciclo faria
-- a consulta rodar até estourar. Dez níveis cobre qualquer organograma real.
--
-- Formato set-returning mantido de propósito: usada em `IN (select ...)`, ela
-- vira um SubPlan hasheado uma vez pelo planner, em vez de ser reavaliada por
-- linha. É o mesmo padrão adotado na onda de desempenho da RLS.

create or replace function public.my_managed_memberships()
returns table(user_id uuid, tenant_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with recursive equipe as (
    -- nível 1: quem responde diretamente a mim, e só se eu tiver o papel
    select m.user_id, m.tenant_id, 1 as nivel
      from public.memberships m
      join public.memberships eu
        on eu.user_id = (select auth.uid())
       and eu.tenant_id = m.tenant_id
       and eu.role in ('owner', 'admin', 'manager', 'team_lead')
     where m.manager_id = (select auth.uid())
    union
    -- níveis seguintes: quem responde a alguém que já está na equipe
    select f.user_id, f.tenant_id, e.nivel + 1
      from public.memberships f
      join equipe e
        on f.manager_id = e.user_id
       and f.tenant_id = e.tenant_id
     where e.nivel < 10
  )
  select distinct user_id, tenant_id from equipe;
$function$;

-- Escrita sobre a de cima para as duas não poderem divergir: qualquer ajuste de
-- regra acontece num lugar só.
create or replace function public.manages_user(p_owner uuid, p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.my_managed_memberships() t
    where t.user_id = p_owner and t.tenant_id = p_tenant
  );
$function$;

-- AGENTS.md: toda SECURITY DEFINER em public sai do alcance da chave pública.
-- `authenticated` fica porque as telas de Metas, Feedbacks, Checklists, Tempos e
-- movimentos e Diário de bordo passam a chamar my_managed_memberships por RPC.
revoke execute on function public.my_managed_memberships() from public, anon;
revoke execute on function public.manages_user(uuid, uuid) from public, anon;
grant execute on function public.my_managed_memberships() to authenticated;
grant execute on function public.manages_user(uuid, uuid) to authenticated;
