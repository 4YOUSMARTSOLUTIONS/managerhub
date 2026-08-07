-- Gerencial (`manager`) passa a LER as metas individuais da empresa inteira,
-- inclusive o valor de RV, e continua SEM poder escrever nada fora da cadeia dele.
--
-- POR QUE NÃO BASTA ACRESCENTAR `manager` NA LISTA DE PAPÉIS:
--
-- `individual_goal_entries_rw` é uma policy `for all`, e `for all` não distingue
-- comando: o mesmo predicado libera SELECT, INSERT, UPDATE e DELETE. Pôr `manager`
-- ali daria a dez pessoas o direito de reescrever o realizado e apagar o lançamento
-- de qualquer colaborador da empresa. Por isso a policy única é quebrada em quatro,
-- exatamente como já foi feito com `individual_goals` em
-- 20260707235816_individual_goals_monthly_closure.sql.
--
-- E O CASO QUE NÃO ESTÁ À VISTA: as policies de individual_goal_entry_attachments
-- não têm condição própria, perguntam só "eu enxergo esse lançamento?". Herdar por
-- visibilidade funcionava enquanto ver e escrever eram a mesma coisa. A partir daqui
-- não são: sem o bloco 4 deste arquivo, o Gerencial ganharia junto o direito de
-- anexar e de APAGAR a evidência de qualquer competência aberta da empresa.
--
-- O trigger guard_goal_entry_closure NÃO substitui isto: ele é `before update` e só
-- guarda a transição de approval_status e a alteração de valores quando a linha já
-- está `aprovada`. Mexer no realizado de uma competência ABERTA passa reto por ele.

-- ------------------------------------------------------- 1) definição da meta
alter policy individual_goals_select on public.individual_goals
  using (
    tenant_id in (select public.my_tenant_ids())
    and (
      owner_id = (select auth.uid())
      or tenant_id in (select public.my_role_tenant_ids('{owner,admin,manager}'::public.member_role[]))
      or (owner_id, tenant_id) in (
        select user_id, tenant_id from public.my_managed_memberships()
      )
    )
  );

-- individual_goals_insert / _update / _delete não são tocadas: seguem
-- '{owner,admin}' + cadeia. Ler não é cadastrar.

-- ------------------------------------------- 2) a regra de ESCRITA, num lugar só
--
-- SECURITY DEFINER de propósito: a pergunta é "posso ESCREVER neste lançamento", e
-- ela não pode depender de "eu ENXERGO a meta", que é justamente o que acaba de ser
-- afrouxado. A guarda no corpo é is_tenant_member, e o resultado é sempre sobre o
-- próprio auth.uid(): a função não aceita um terceiro como parâmetro nem devolve
-- dado nenhum, só um booleano sobre quem chamou.
create or replace function public.pode_lancar_meta_individual(p_goal uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.individual_goals g
     where g.id = p_goal
       and public.is_tenant_member(g.tenant_id)
       and (
         g.owner_id = (select auth.uid())
         or public.has_tenant_role(g.tenant_id, '{owner,admin}'::public.member_role[])
         or public.manages_user(g.owner_id, g.tenant_id)
       )
  );
$function$;

comment on function public.pode_lancar_meta_individual(uuid) is
  'true = auth.uid() pode lançar, alterar ou apagar o realizado e a evidência desta meta individual (dono, owner/admin, ou gestor na cadeia). NÃO é a regra de leitura: o papel manager lê a empresa inteira e esta função devolve false para ele fora da cadeia.';

-- AGENTS.md: SECURITY DEFINER em public sai do alcance da chave pública.
-- `authenticated` fica porque a função é avaliada DENTRO das policies, e expressão
-- de policy roda com os privilégios de quem consulta.
revoke execute on function public.pode_lancar_meta_individual(uuid) from public, anon;
grant  execute on function public.pode_lancar_meta_individual(uuid) to authenticated;

-- ------------------------------------------------------------ 3) lançamentos
drop policy if exists individual_goal_entries_rw on public.individual_goal_entries;

-- LEITURA: dono, owner/admin, GERENCIAL, ou gestor na cadeia. Em forma de conjunto
-- (`in (select ...)`), não por chamada de função: é o caminho quente, mesmo motivo
-- da onda de 20260804005430_rls_em_conjunto_nas_demais_tabelas.sql.
create policy individual_goal_entries_select on public.individual_goal_entries
  for select using (
    tenant_id in (select public.my_tenant_ids())
    and exists (
      select 1 from public.individual_goals g
       where g.id = individual_goal_entries.goal_id
         and (
           g.owner_id = (select auth.uid())
           or g.tenant_id in (select public.my_role_tenant_ids('{owner,admin,manager}'::public.member_role[]))
           or (g.owner_id, g.tenant_id) in (
             select user_id, tenant_id from public.my_managed_memberships()
           )
         )
    )
  );

-- ESCRITA: o que já valia, agora dito uma vez só. Escrita é sempre uma linha (ou as
-- poucas de um fechamento de mês), então a chamada por linha não pesa.
create policy individual_goal_entries_insert on public.individual_goal_entries
  for insert with check (
    tenant_id in (select public.my_tenant_ids())
    and public.pode_lancar_meta_individual(goal_id)
  );

create policy individual_goal_entries_update on public.individual_goal_entries
  for update using (
    tenant_id in (select public.my_tenant_ids())
    and public.pode_lancar_meta_individual(goal_id)
  ) with check (
    tenant_id in (select public.my_tenant_ids())
    and public.pode_lancar_meta_individual(goal_id)
  );

create policy individual_goal_entries_delete on public.individual_goal_entries
  for delete using (
    tenant_id in (select public.my_tenant_ids())
    and public.pode_lancar_meta_individual(goal_id)
  );

-- ---------------------------------------------------------------- 4) anexos
-- SELECT continua herdando a visibilidade do lançamento: quem lê o número lê a prova
-- dele, e é isso que se quer para o Gerencial.
--
-- INSERT e DELETE param de herdar. "Enxergo o lançamento" deixou de significar "posso
-- mexer nele" no exato momento em que o Gerencial passou a enxergar a empresa inteira.
drop policy if exists iga_att_insert on public.individual_goal_entry_attachments;
create policy iga_att_insert on public.individual_goal_entry_attachments
  for insert with check (
    exists (
      select 1 from public.individual_goal_entries e
       where e.id = entry_id
         and e.approval_status <> 'aprovada'
         and public.pode_lancar_meta_individual(e.goal_id)
    )
  );

-- Competência aprovada = registro. Dá para baixar, não dá para apagar; quem precisar
-- corrigir reabre a competência, que já exige senha de admin.
drop policy if exists iga_att_delete on public.individual_goal_entry_attachments;
create policy iga_att_delete on public.individual_goal_entry_attachments
  for delete using (
    exists (
      select 1 from public.individual_goal_entries e
       where e.id = entry_id
         and e.approval_status <> 'aprovada'
         and public.pode_lancar_meta_individual(e.goal_id)
    )
  );

notify pgrst, 'reload schema';
