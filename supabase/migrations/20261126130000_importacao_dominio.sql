-- Importação do arquivo do Domínio (LUIZ, 26/11/2026).
--
-- O DP montava a planilha de importação à mão: exportava o Domínio, e uma
-- planilha de 8 abas completava subsetor, gestor, hierarquia e e-mail a partir
-- de cadastros paralelos ao sistema. Agora o arquivo do Domínio sobe como sai,
-- e o que ele não traz vem de duas regras guardadas aqui, que a tela usa como
-- SUGESTÃO (o DP confirma):
--
--   - função → hierarquia;
--   - subsetor + unidade → gestor padrão.
--
-- As duas nascem dos ativos de hoje. Em 26/11 na Cervantes: 96 de 96 funções
-- com hierarquia única, e 294 de 296 pessoas seguindo o gestor do grupo.
--
-- A importação ganha três coisas, valendo para qualquer formato de arquivo:
--   - `createdList` na prévia (antes era só a contagem de admissões);
--   - e-mail com cara de digitação errada ("gmal.com", ".com") não entra, e
--     vira aviso;
--   - o e-mail corporativo cadastrado não é trocado por um de fora do domínio
--     da empresa (o Domínio guarda o pessoal; o DP prefere o corporativo).

-- ---------------------------------------------------------------------------
-- 1. Configuração por empresa
-- ---------------------------------------------------------------------------
create table if not exists public.importacao_config (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  -- código de empresa do Domínio ("Cód Emp") → nome da unidade
  empresas_dominio jsonb not null default '{}'::jsonb,
  -- domínios do e-mail corporativo, sem @ ("cervantes.com.br")
  dominios_email_corporativo text[] not null default '{}',
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint importacao_config_empresas_objeto check (jsonb_typeof(empresas_dominio) = 'object')
);

comment on table public.importacao_config is
  'Parâmetros da importação de colaboradores por empresa: códigos de empresa do Domínio e domínios do e-mail corporativo.';

-- ---------------------------------------------------------------------------
-- 2. Regras de sugestão
-- ---------------------------------------------------------------------------
create table if not exists public.regra_funcao_hierarquia (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  position_id uuid not null references public.positions(id) on delete cascade,
  hierarchy_level_id uuid not null references public.hierarchy_levels(id) on delete cascade,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint regra_funcao_hierarquia_uk unique (tenant_id, position_id)
);

comment on table public.regra_funcao_hierarquia is
  'Hierarquia sugerida para cada função na importação de colaboradores (admissão e mudança de função). Só sugestão: quem importa confirma.';

create table if not exists public.regra_subsetor_gestor (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subdepartment_id uuid not null references public.subdepartments(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  manager_id uuid not null references public.profiles(id) on delete cascade,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint regra_subsetor_gestor_uk unique (tenant_id, subdepartment_id, unit_id)
);

comment on table public.regra_subsetor_gestor is
  'Gestor sugerido para quem entra num subsetor de uma unidade, na importação de colaboradores. Só sugestão: quem importa confirma.';

-- Tudo o que a regra aponta precisa ser da mesma empresa: a RLS confere o
-- tenant_id da linha, não o dos ids que ela carrega.
create or replace function public.regra_importacao_confere_empresa()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_table_name = 'regra_funcao_hierarquia' then
    if not exists (select 1 from public.positions where id = new.position_id and tenant_id = new.tenant_id)
       or not exists (select 1 from public.hierarchy_levels where id = new.hierarchy_level_id and tenant_id = new.tenant_id) then
      raise exception 'A função e a hierarquia precisam ser desta empresa.';
    end if;
  else
    if not exists (select 1 from public.subdepartments where id = new.subdepartment_id and tenant_id = new.tenant_id)
       or not exists (select 1 from public.units where id = new.unit_id and tenant_id = new.tenant_id)
       or not exists (select 1 from public.memberships where user_id = new.manager_id and tenant_id = new.tenant_id) then
      raise exception 'O subsetor, a unidade e o gestor precisam ser desta empresa.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.regra_importacao_confere_empresa() from public, anon, authenticated;

drop trigger if exists regra_funcao_hierarquia_confere on public.regra_funcao_hierarquia;
create trigger regra_funcao_hierarquia_confere
  before insert or update on public.regra_funcao_hierarquia
  for each row execute function public.regra_importacao_confere_empresa();
drop trigger if exists regra_subsetor_gestor_confere on public.regra_subsetor_gestor;
create trigger regra_subsetor_gestor_confere
  before insert or update on public.regra_subsetor_gestor
  for each row execute function public.regra_importacao_confere_empresa();

-- ---------------------------------------------------------------------------
-- 3. RLS, grants e auditoria (o molde de ferias_config)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['importacao_config', 'regra_funcao_hierarquia', 'regra_subsetor_gestor'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_tenant_member(tenant_id))', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using (public.has_tenant_role(tenant_id, '{owner,admin,hr}'::public.member_role[]))
      with check (public.has_tenant_role(tenant_id, '{owner,admin,hr}'::public.member_role[]))$p$, t || '_write', t);
    execute format('drop trigger if exists %I on public.%I', 'audit_' || t, t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_trigger()', 'audit_' || t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Semente: as regras saem dos ativos de hoje
-- ---------------------------------------------------------------------------
-- a hierarquia mais comum de cada função
insert into public.regra_funcao_hierarquia (tenant_id, position_id, hierarchy_level_id)
select distinct on (m.tenant_id, m.position_id) m.tenant_id, m.position_id, m.hierarchy_level_id
  from public.memberships m
 where m.is_active and m.position_id is not null and m.hierarchy_level_id is not null
 group by m.tenant_id, m.position_id, m.hierarchy_level_id
 order by m.tenant_id, m.position_id, count(*) desc, m.hierarchy_level_id
on conflict (tenant_id, position_id) do nothing;

-- o gestor mais comum de cada subsetor em cada unidade, desde que siga ativo
insert into public.regra_subsetor_gestor (tenant_id, subdepartment_id, unit_id, manager_id)
select t.tenant_id, t.subdepartment_id, t.unit_id, t.manager_id
  from (
    select distinct on (m.tenant_id, m.subdepartment_id, mu.unit_id)
           m.tenant_id, m.subdepartment_id, mu.unit_id, m.manager_id
      from public.memberships m
      join public.membership_units mu on mu.membership_id = m.id
     where m.is_active and m.subdepartment_id is not null and m.manager_id is not null
     group by m.tenant_id, m.subdepartment_id, mu.unit_id, m.manager_id
     order by m.tenant_id, m.subdepartment_id, mu.unit_id, count(*) desc, m.manager_id
  ) t
 where exists (select 1 from public.memberships g
                where g.tenant_id = t.tenant_id and g.user_id = t.manager_id and g.is_active)
on conflict (tenant_id, subdepartment_id, unit_id) do nothing;

-- Cervantes: no Domínio a empresa 1 é a MATRIZ e a 2 a FILIAL (LUIZ, 26/11)
insert into public.importacao_config (tenant_id, empresas_dominio, dominios_email_corporativo)
values ('373d5ce2-9c41-4cad-bfe7-24b80616ffa9', '{"1": "MATRIZ", "2": "FILIAL"}'::jsonb, array['cervantes.com.br'])
on conflict (tenant_id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. E-mail: válido e corporativo
-- ---------------------------------------------------------------------------
-- Endereço com estrutura de e-mail e sem os erros de digitação mais comuns.
-- Não é validação de existência: é barrar o que certamente não chega.
create or replace function public.email_valido(p text)
returns boolean
language sql immutable set search_path to 'public'
as $$
  select p is not null
     and lower(btrim(p)) ~ '^[^@\s]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$'
     and split_part(lower(btrim(p)), '@', 2) not in (
       'gmal.com', 'gmial.com', 'gamil.com', 'gmai.com', 'gmail.co', 'gmail.com.com', 'gnail.com',
       'hotmal.com', 'hotmial.com', 'hotmai.com', 'hotmail.co', 'homail.com',
       'outlok.com', 'outloo.com', 'yaho.com', 'yaho.com.br', 'yahoo.co');
$$;

-- O e-mail é de um dos domínios corporativos configurados para a empresa?
create or replace function public.email_corporativo(p_tenant uuid, p_email text)
returns boolean
language sql stable set search_path to 'public'
as $$
  select coalesce(
    (select split_part(lower(btrim(p_email)), '@', 2) = any (c.dominios_email_corporativo)
       from public.importacao_config c where c.tenant_id = p_tenant),
    false)
  and p_email is not null and position('@' in p_email) > 0;
$$;

revoke execute on function public.email_valido(text) from public, anon;
revoke execute on function public.email_corporativo(uuid, text) from public, anon;
grant execute on function public.email_valido(text) to authenticated, service_role;
grant execute on function public.email_corporativo(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. admin_import_employees: admissões na prévia, avisos e e-mail
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef('public.admin_import_employees(jsonb,text,boolean)'::regprocedure);
  v_n int;
  a_decl text := $q$  v_pendentes jsonb := '[]'::jsonb;$q$;
  a_email text := $q$      if v_email is not null and exists (select 1 from auth.users u where u.email = v_email and u.id is distinct from (select p2.id from public.profiles p2 where p2.cpf = v_cpf)) then v_email := null; end if;$q$;
  a_criado text := $q$v_created := v_created + 1;$q$;
  a_deslig text := $q$'motivo', 'Desligado em ' || to_char(v_dismissed, 'DD/MM/YYYY') || ' pela planilha');$q$;
  a_dados text := $q$'motivo', 'Dados do cadastro atualizados (e-mail, telefone, nascimento ou sexo)');$q$;
  a_ret text := $q$'hierarchiesList', v_hiers_list, 'errors', v_errors);$q$;
begin
  -- cada âncora precisa existir exatamente quantas vezes se espera
  if (length(v_def) - length(replace(v_def, a_decl, ''))) / length(a_decl) <> 1
     or (length(v_def) - length(replace(v_def, a_email, ''))) / length(a_email) <> 1
     or (length(v_def) - length(replace(v_def, a_criado, ''))) / length(a_criado) <> 2
     or (length(v_def) - length(replace(v_def, a_deslig, ''))) / length(a_deslig) <> 1
     or (length(v_def) - length(replace(v_def, a_dados, ''))) / length(a_dados) <> 1
     or (length(v_def) - length(replace(v_def, a_ret, ''))) / length(a_ret) <> 1 then
    raise exception 'admin_import_employees mudou: âncoras da importação do Domínio não conferem';
  end if;

  v_def := replace(v_def, a_decl, a_decl || $q$
  v_created_list jsonb := '[]'::jsonb;
  v_avisos jsonb := '[]'::jsonb;$q$);

  v_def := replace(v_def, a_email, a_email || $q$
      -- e-mail que certamente não chega ("gmal.com", ".com") não entra e vira
      -- aviso; virar login ou receber a recuperação de senha seria pior
      if v_email is not null and not public.email_valido(v_email) then
        v_avisos := v_avisos || jsonb_build_object('nome', trim(r->>'full_name'), 'cpf', v_cpf,
          'aviso', 'E-mail "' || v_email || '" ignorado: endereço inválido');
        v_email := null;
      end if;
      -- o e-mail corporativo cadastrado não é trocado por um de fora do domínio
      -- da empresa (o arquivo da folha costuma trazer o pessoal)
      if v_email is not null and not public.email_corporativo(v_tenant, v_email)
         and exists (select 1 from public.profiles p3
                      where p3.cpf = v_cpf and public.email_corporativo(v_tenant, p3.email)) then
        v_email := null;
      end if;$q$);

  v_def := replace(v_def, a_criado, a_criado || $q$
          v_created_list := v_created_list || jsonb_build_object('cpf', v_cpf, 'nome', trim(r->>'full_name'),
            'codigo', v_code, 'unidade', array_to_string(v_unit_names, '; '), 'desligado', v_dismissed is not null);$q$);

  v_def := replace(v_def, a_deslig,
    $q$'motivo', 'Desligado em ' || to_char(v_dismissed, 'DD/MM/YYYY') || ' pela planilha',
              'tipo', case when v_ex_dis is null then 'desligamento' else 'data_demissao' end);$q$);

  v_def := replace(v_def, a_dados,
    $q$'motivo', 'Dados do cadastro atualizados (e-mail, telefone, nascimento ou sexo)', 'tipo', 'dados');$q$);

  v_def := replace(v_def, a_ret,
    $q$'hierarchiesList', v_hiers_list, 'createdList', v_created_list, 'avisos', v_avisos, 'errors', v_errors);$q$);

  execute v_def;
end $$;

revoke execute on function public.admin_import_employees(jsonb, text, boolean) from public, anon;

notify pgrst, 'reload schema';
