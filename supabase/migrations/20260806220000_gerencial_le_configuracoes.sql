-- Gerencial passa a LER a tela de Configurações inteira, e a não escrever nada nela.
--
-- Até aqui /configuracoes exigia owner/admin, então o banco nunca precisou
-- distinguir "ver" de "mexer" nesta tela: quem entrava podia tudo. Ao abrir a
-- porta para o Gerencial, as duas metades passam a andar separadas, e cada uma
-- tem um ajuste próprio.
--
-- LEITURA (três buracos que deixariam a tela vazia, não é frescura de UI):
--   1. `tenant_dados_pessoais` — CPF, telefone, nascimento e sexo. A RPC existe
--      porque a RLS não tem granularidade de coluna (ver AGENTS.md); a guarda
--      dela era owner/admin.
--   2. `individual_rv_config` — só existia `irc_admin_all`, que é `for all`.
--      Sem policy de SELECT própria, o Gerencial lia zero linha e a aba
--      Remuneração variável saía em branco, sem erro nenhum.
--   3. `employee_absences` — a policy de leitura era owner/admin.
--
-- ESCRITA (dois grants que hoje são inofensivos e amanhã não seriam):
--   `rooms` e `holidays` já aceitavam `manager` no write. Isso nunca virou
--   edição de verdade porque a única tela que escreve nessas tabelas é
--   /configuracoes, e ela exigia admin. A partir do momento em que o Gerencial
--   entra na tela, esse grant vira o furo do "não está autorizado a editar" —
--   e seria o furo pior, o que a RLS deixa passar depois de a UI já ter
--   escondido o botão. Fecha agora, junto.
--
-- O que NÃO muda: nenhuma escrita ganha o Gerencial. Todo o resto da tela
-- (units, departments, subdepartments, positions, position_levels,
-- hierarchy_levels, sdpo_*, action_kpis, action_tools, ticket_*, feedback_*,
-- memberships, tenants) já tinha SELECT para qualquer membro e write travado em
-- owner/admin, então continua exatamente como está.

-- ---------------------------------------------------------------- 1. pessoais
create or replace function public.tenant_dados_pessoais(p_tenant uuid default null)
returns table(id uuid, cpf text, phone text, birth_date date, gender gender_type)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid := coalesce(p_tenant, public.my_active_tenant());
begin
  -- guarda real no corpo: nao adianta passar a empresa alheia
  if v_tenant is null
     or not public.has_tenant_role(v_tenant, array['owner','admin','manager']::member_role[]) then
    raise exception 'Sem permissão';
  end if;

  -- so quem tem vinculo com ESTA empresa
  return query
    select p.id, p.cpf, p.phone, p.birth_date, p.gender
    from public.profiles p
    join public.memberships m on m.user_id = p.id and m.tenant_id = v_tenant;
end;
$$;

revoke execute on function public.tenant_dados_pessoais(uuid) from public, anon;
grant execute on function public.tenant_dados_pessoais(uuid) to authenticated;

-- --------------------------------------------------------------------- 2. RV
-- Policy de SELECT à parte, e não `manager` acrescentado ao `irc_admin_all`:
-- aquela é `for all`, e `for all` não distingue comando. Somar o papel lá dentro
-- daria ao Gerencial o direito de reescrever o valor da remuneração variável de
-- qualquer pessoa da empresa.
create policy "irc_manager_select" on public.individual_rv_config
  for select
  using (tenant_id in (select public.my_role_tenant_ids('{owner,admin,manager}'::public.member_role[])));

-- ----------------------------------------------------------------- 3. férias
-- Aqui a leitura já era uma policy separada da escrita, então basta o papel.
alter policy "employee_absences_read" on public.employee_absences
  using (public.has_tenant_role(tenant_id, array['owner','admin','manager']::public.member_role[]));

-- -------------------------------------------------- 4. salas e feriados: write
alter policy "rooms_admin_write" on public.rooms
  using (tenant_id in (select public.my_role_tenant_ids(array['owner'::public.member_role, 'admin'::public.member_role])))
  with check (tenant_id in (select public.my_role_tenant_ids(array['owner'::public.member_role, 'admin'::public.member_role])));

alter policy "holidays_admin_write" on public.holidays
  using (tenant_id in (select public.my_role_tenant_ids(array['owner'::public.member_role, 'admin'::public.member_role])))
  with check (tenant_id in (select public.my_role_tenant_ids(array['owner'::public.member_role, 'admin'::public.member_role])));
