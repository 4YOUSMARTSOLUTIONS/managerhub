-- Área de Gente (LUIZ, 19/11/2026).
--
-- A marca de RH (`is_hr`) era um pacote só: quem a tinha aprovava atestado,
-- efetivava férias, editava a ficha, lia o chat de todo mundo e mexia nas
-- configurações do DP. A Cervantes separa duas funções: o Departamento Pessoal
-- (Josiane e Maira), que opera, e a Área de Gente (Beatriz e Jeane), que só
-- precisa ENXERGAR o pessoal da empresa inteira.
--
-- `is_hr` continua sendo o Departamento Pessoal (só o rótulo da tela muda: as
-- ~50 funções e 22 policies que respondem por ele ficam como estão). A marca
-- nova `is_gente` dá LEITURA, e só ela:
--   * Absenteísmo: os lançamentos da empresa, o CID, o atestado e o CPF
--     (decisão do LUIZ: a Área de Gente vê os dados de saúde e os pessoais);
--   * Férias: o painel, a agenda, as filas e a escolha do 13º;
--   * Colaboradores: a ficha, os dados pessoais, as situações, o histórico de
--     movimentações e de contratos, os afastamentos.
-- Nenhuma escrita: aprovar, efetivar, lançar, importar e editar continuam do DP,
-- e o banco recusa. Avisos de pendência, administração do chat e gestão de
-- treinamentos também não vêm com a marca.
--
-- Cuidado com `pode_ver_absenteismo`: apesar do nome, é a guarda de quem MEXE no
-- lançamento (confirmar, cancelar, continua ausente, anexar). Ela não muda; a
-- leitura ganha `pode_ler_absenteismo`.

-- ---------------------------------------------------------------- a marca
alter table public.memberships add column if not exists is_gente boolean not null default false;

comment on column public.memberships.is_gente is
  'Área de Gente: lê o pessoal da empresa inteira (absenteísmo, férias, colaboradores), sem agir. Só owner/admin concede.';

-- só owner/admin concede, como a de RH (so_administracao_concede_rh)
create or replace function public.so_administracao_concede_gente()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.is_gente)
     or (tg_op = 'UPDATE' and new.is_gente is distinct from old.is_gente) then
    if not public.has_tenant_role(new.tenant_id, '{owner,admin}'::public.member_role[]) then
      raise exception 'Só o proprietário ou um administrador marca quem é da Área de Gente';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists memberships_so_administracao_concede_gente on public.memberships;
create trigger memberships_so_administracao_concede_gente
  before insert or update on public.memberships
  for each row execute function public.so_administracao_concede_gente();

-- ---------------------------------------------------------------- ajudantes
-- Respondem só sobre o próprio usuário (auth.uid()), como my_role_tenant_ids:
-- a RLS precisa chamá-los como authenticated.
create or replace function public.is_area_de_gente(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.memberships m
     where m.tenant_id = p_tenant
       and m.user_id = (select auth.uid())
       and m.is_active
       and m.is_gente
  );
$$;

create or replace function public.my_gente_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select m.tenant_id from public.memberships m
   where m.user_id = (select auth.uid()) and m.is_active and m.is_gente;
$$;

-- quem LÊ o lançamento: quem mexe nele mais a Área de Gente
create or replace function public.pode_ler_absenteismo(p_tenant uuid, p_user uuid, p_created_by uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.pode_ver_absenteismo(p_tenant, p_user, p_created_by)
      or public.is_area_de_gente(p_tenant);
$$;

-- ---------------------------------------------------------------- RLS
-- absenteísmo: a linha
drop policy if exists absenteismo_select on public.absenteismo_lancamentos;
create policy absenteismo_select on public.absenteismo_lancamentos
  for select
  using (
    created_by = (select auth.uid())
    or (tenant_id, user_id) in (select c.tenant_id, c.user_id from public.my_managed_memberships() c(user_id, tenant_id))
    or tenant_id in (select public.my_role_tenant_ids('{owner,admin,hr}'::public.member_role[]))
    or tenant_id in (select public.my_gente_tenant_ids())
  );

-- absenteísmo: o atestado. A policy era uma só (ALL) e dizia "quem vê o
-- lançamento". Com a Área de Gente vendo, ela passaria a gravar: a escrita vai
-- para quem mexe no lançamento (a mesma alçada de antes).
drop policy if exists absenteismo_atestado_rw on public.absenteismo_atestados;
drop policy if exists absenteismo_atestado_select on public.absenteismo_atestados;
drop policy if exists absenteismo_atestado_insert on public.absenteismo_atestados;
drop policy if exists absenteismo_atestado_update on public.absenteismo_atestados;
drop policy if exists absenteismo_atestado_delete on public.absenteismo_atestados;

create policy absenteismo_atestado_select on public.absenteismo_atestados
  for select
  using (lancamento_id in (select l.id from public.absenteismo_lancamentos l));

create policy absenteismo_atestado_insert on public.absenteismo_atestados
  for insert
  with check (exists (
    select 1 from public.absenteismo_lancamentos l
     where l.id = lancamento_id
       and public.pode_ver_absenteismo(l.tenant_id, l.user_id, l.created_by)));

create policy absenteismo_atestado_update on public.absenteismo_atestados
  for update
  using (exists (
    select 1 from public.absenteismo_lancamentos l
     where l.id = lancamento_id
       and public.pode_ver_absenteismo(l.tenant_id, l.user_id, l.created_by)))
  with check (exists (
    select 1 from public.absenteismo_lancamentos l
     where l.id = lancamento_id
       and public.pode_ver_absenteismo(l.tenant_id, l.user_id, l.created_by)));

create policy absenteismo_atestado_delete on public.absenteismo_atestados
  for delete
  using (exists (
    select 1 from public.absenteismo_lancamentos l
     where l.id = lancamento_id
       and public.pode_ver_absenteismo(l.tenant_id, l.user_id, l.created_by)));

-- absenteísmo: o arquivo do documento. `absenteismo_doc_all` (quem mexe) fica;
-- a Área de Gente ganha só a leitura
drop policy if exists absenteismo_doc_select_gente on storage.objects;
create policy absenteismo_doc_select_gente on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'absenteismo-documentos'
    and exists (
      select 1 from public.absenteismo_lancamentos l
       where l.id = ((storage.foldername(objects.name))[2])::uuid
         and public.is_area_de_gente(l.tenant_id))
  );

-- férias: a linha
drop policy if exists ferias_select on public.ferias_solicitacoes;
create policy ferias_select on public.ferias_solicitacoes
  for select
  using (
    user_id = (select auth.uid())
    or created_by = (select auth.uid())
    or (tenant_id, user_id) in (select c.tenant_id, c.user_id from public.my_managed_memberships() c(user_id, tenant_id))
    or tenant_id in (select public.my_role_tenant_ids('{owner,admin,hr,manager}'::public.member_role[]))
    or tenant_id in (select public.my_gente_tenant_ids())
  );

-- afastamentos (Colaboradores > Absenteísmos e afastamentos, situação do colaborador)
drop policy if exists employee_absences_read on public.employee_absences;
create policy employee_absences_read on public.employee_absences
  for select
  using (
    tenant_id in (select public.my_role_tenant_ids('{owner,admin,manager,hr}'::public.member_role[]))
    or tenant_id in (select public.my_gente_tenant_ids())
  );

-- movimentações (linha do tempo da ficha)
drop policy if exists membership_history_select on public.membership_history;
create policy membership_history_select on public.membership_history
  for select
  using (
    tenant_id in (select public.my_role_tenant_ids('{owner,admin,hr}'::public.member_role[]))
    or tenant_id in (select public.my_gente_tenant_ids())
    or (tenant_id, user_id) in (select c.tenant_id, c.user_id from public.my_managed_memberships() c(user_id, tenant_id))
    or user_id = (select auth.uid())
  );

-- ---------------------------------------------------------------- RPCs de leitura
-- Troca exata de um trecho por função; cada trecho tem de aparecer uma vez só,
-- senão a migração para (molde de 20261119110000).
do $$
declare
  v record;
  v_def text;
begin
  for v in
    select * from (values
      ('public.absenteismo_atestado(uuid)',
       'not public.pode_ver_absenteismo(v_l.tenant_id, v_l.user_id, v_l.created_by)',
       'not public.pode_ler_absenteismo(v_l.tenant_id, v_l.user_id, v_l.created_by)'),
      ('public.absenteismo_cpf(uuid)',
       'not public.pode_ver_absenteismo(v_l.tenant_id, v_l.user_id, v_l.created_by)',
       'not public.pode_ler_absenteismo(v_l.tenant_id, v_l.user_id, v_l.created_by)'),
      ('public.absenteismo_relatorio(uuid, date, date, uuid[])',
       'if not public.has_tenant_role(p_tenant, ''{owner,admin,hr}''::public.member_role[]) then',
       'if not (public.has_tenant_role(p_tenant, ''{owner,admin,hr}''::public.member_role[]) or public.is_area_de_gente(p_tenant)) then'),
      ('public.absenteismo_inss(uuid, uuid, date)',
       'or public.has_tenant_role(p_tenant, ''{owner,admin,hr}''::public.member_role[])',
       'or public.has_tenant_role(p_tenant, ''{owner,admin,hr}''::public.member_role[]) or public.is_area_de_gente(p_tenant)'),
      ('public.colaboradores_situacoes(uuid)',
       'v_todos := public.has_tenant_role(p_tenant, ''{owner,admin,hr,manager}''::public.member_role[]);',
       'v_todos := public.has_tenant_role(p_tenant, ''{owner,admin,hr,manager}''::public.member_role[]) or public.is_area_de_gente(p_tenant);'),
      ('public.employee_contract_history(uuid)',
       'and (public.has_tenant_role(c.tenant_id, array[''owner'',''admin'',''manager'',''hr'']::member_role[])',
       'and (public.has_tenant_role(c.tenant_id, array[''owner'',''admin'',''manager'',''hr'']::member_role[]) or public.is_area_de_gente(c.tenant_id)'),
      ('public.employee_movement_history(uuid)',
       'public.has_tenant_role(h.tenant_id, array[''owner'',''admin'',''hr'',''manager'']::public.member_role[])',
       'public.has_tenant_role(h.tenant_id, array[''owner'',''admin'',''hr'',''manager'']::public.member_role[]) or public.is_area_de_gente(h.tenant_id)'),
      ('public.tenant_dados_pessoais(uuid)',
       'or not public.has_tenant_role(v_tenant, array[''owner'',''admin'',''manager'',''hr'']::member_role[]) then',
       'or not (public.has_tenant_role(v_tenant, array[''owner'',''admin'',''manager'',''hr'']::member_role[]) or public.is_area_de_gente(v_tenant)) then'),
      ('public.ferias_agenda(uuid, date, date, uuid[])',
       'if public.has_tenant_role(p_tenant, ''{owner,admin,hr,manager}''::public.member_role[]) then',
       'if public.has_tenant_role(p_tenant, ''{owner,admin,hr,manager}''::public.member_role[]) or public.is_area_de_gente(p_tenant) then'),
      ('public.ferias_painel(uuid, date, uuid[])',
       'if public.has_tenant_role(p_tenant, ''{owner,admin,hr,manager}''::public.member_role[]) then',
       'if public.has_tenant_role(p_tenant, ''{owner,admin,hr,manager}''::public.member_role[]) or public.is_area_de_gente(p_tenant) then'),
      ('public.ferias_painel_decimo(uuid, integer, uuid[])',
       'v_empresa := public.has_tenant_role(p_tenant, ''{owner,admin,hr,manager}''::public.member_role[]);',
       'v_empresa := public.has_tenant_role(p_tenant, ''{owner,admin,hr,manager}''::public.member_role[]) or public.is_area_de_gente(p_tenant);'),
      ('public.ferias_situacao_importacao(uuid)',
       'if not public.has_tenant_role(p_tenant, ''{owner,admin,hr}''::public.member_role[]) then',
       'if not (public.has_tenant_role(p_tenant, ''{owner,admin,hr}''::public.member_role[]) or public.is_area_de_gente(p_tenant)) then'),
      ('public.ferias_efetivacao_aguardando_decimo(uuid)',
       'if not public.has_tenant_role(p_tenant, ''{owner,admin,hr}''::public.member_role[]) then',
       'if not (public.has_tenant_role(p_tenant, ''{owner,admin,hr}''::public.member_role[]) or public.is_area_de_gente(p_tenant)) then')
    ) t(fn, de, para)
  loop
    v_def := pg_get_functiondef(v.fn::regprocedure);
    if (length(v_def) - length(replace(v_def, v.de, ''))) / length(v.de) <> 1 then
      raise exception 'trecho de % não encontrado exatamente uma vez', v.fn;
    end if;
    execute replace(v_def, v.de, v.para);
  end loop;
end $$;

-- ---------------------------------------------------------------- privilégios
-- gatilho: ninguém chama direto
revoke execute on function public.so_administracao_concede_gente() from public, anon, authenticated;
-- ajudantes da RLS: o app (authenticated) precisa; a chave pública não
revoke execute on function public.is_area_de_gente(uuid) from public, anon;
revoke execute on function public.my_gente_tenant_ids() from public, anon;
revoke execute on function public.pode_ler_absenteismo(uuid, uuid, uuid) from public, anon;
-- as RPCs reescritas acima mantêm o ACL (create or replace não mexe), mas o
-- revoke é a regra do projeto para toda SECURITY DEFINER tocada
revoke execute on function public.absenteismo_atestado(uuid) from public, anon;
revoke execute on function public.absenteismo_cpf(uuid) from public, anon;
revoke execute on function public.absenteismo_relatorio(uuid, date, date, uuid[]) from public, anon;
revoke execute on function public.absenteismo_inss(uuid, uuid, date) from public, anon;
revoke execute on function public.colaboradores_situacoes(uuid) from public, anon;
revoke execute on function public.employee_contract_history(uuid) from public, anon;
revoke execute on function public.employee_movement_history(uuid) from public, anon;
revoke execute on function public.tenant_dados_pessoais(uuid) from public, anon;
revoke execute on function public.ferias_agenda(uuid, date, date, uuid[]) from public, anon;
revoke execute on function public.ferias_painel(uuid, date, uuid[]) from public, anon;
revoke execute on function public.ferias_painel_decimo(uuid, integer, uuid[]) from public, anon;
revoke execute on function public.ferias_situacao_importacao(uuid) from public, anon;
revoke execute on function public.ferias_efetivacao_aguardando_decimo(uuid) from public, anon;

notify pgrst, 'reload schema';
