-- O Gestor passa a VER Configurações, sem alterar nada, e nas partes com dado de
-- pessoa vê só a própria equipe.
--
-- Decisão do LUIZ (04/11/2026): Gestor (team_lead) entra em Configurações em
-- modo consulta. Regras e cadastros sem dado de pessoa ficam visíveis inteiros;
-- onde há dado de cada pessoa, "só a própria equipe" (a cadeia de
-- `my_managed_memberships`, a mesma de Minha equipe):
--   - Colaboradores > Cadastro: a lista (recorte na página) e CPF/telefone/
--     nascimento/sexo (já servidos por `equipe_dados_pessoais`);
--   - Absenteísmos e afastamentos e Férias > Registro direto: `employee_absences`;
--   - Punições > Registro direto: `employee_sanctions`;
--   - Remuneração variável > Valores: `individual_rv_config` (o valor individual
--     de quem está na cadeia e o valor das funções que a equipe ocupa);
--   - a ficha do colaborador: contratos anteriores.
-- As policies novas são só de LEITURA e se SOMAM às que já existiam (as do
-- DP/Gerencial continuam iguais). Escrita não muda: continua owner/admin/hr.

-- ---------------------------------------------------------------------------
-- 1. Ausências (férias, afastamentos, atestados) da equipe
-- ---------------------------------------------------------------------------
drop policy if exists employee_absences_read_equipe on public.employee_absences;
create policy employee_absences_read_equipe on public.employee_absences
  for select to authenticated
  using (public.manages_user(user_id, tenant_id));

-- ---------------------------------------------------------------------------
-- 2. Punições registradas da equipe
-- ---------------------------------------------------------------------------
drop policy if exists employee_sanctions_read_equipe on public.employee_sanctions;
create policy employee_sanctions_read_equipe on public.employee_sanctions
  for select to authenticated
  using (public.manages_user(user_id, tenant_id));

-- ---------------------------------------------------------------------------
-- 3. Remuneração variável: o individual da equipe e o das funções da equipe
-- ---------------------------------------------------------------------------
drop policy if exists irc_equipe_select on public.individual_rv_config;
create policy irc_equipe_select on public.individual_rv_config
  for select to authenticated
  using (
    (scope = 'user' and user_id is not null and public.manages_user(user_id, tenant_id))
    or (scope = 'position' and position_id is not null and exists (
      select 1
        from public.memberships m
        join public.my_managed_memberships() mm
          on mm.user_id = m.user_id and mm.tenant_id = m.tenant_id
       where m.tenant_id = individual_rv_config.tenant_id
         and m.position_id = individual_rv_config.position_id))
  );

-- ---------------------------------------------------------------------------
-- 4. Contratos anteriores na ficha: o gestor da cadeia (e o RH, que faltava)
-- ---------------------------------------------------------------------------
do $migr$
declare
  v_def text;
  v_de text := $a$and public.has_tenant_role(c.tenant_id, array['owner','admin','manager']::member_role[])$a$;
  v_para text := $a$and (public.has_tenant_role(c.tenant_id, array['owner','admin','manager','hr']::member_role[])
           or public.manages_user(p_user, c.tenant_id))$a$;
begin
  v_def := pg_get_functiondef('public.employee_contract_history(uuid)'::regprocedure);
  if (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 then
    raise exception 'employee_contract_history: trecho da guarda não encontrado uma única vez';
  end if;
  execute replace(v_def, v_de, v_para);
end
$migr$;

revoke execute on function public.employee_contract_history(uuid) from public, anon;

notify pgrst, 'reload schema';
