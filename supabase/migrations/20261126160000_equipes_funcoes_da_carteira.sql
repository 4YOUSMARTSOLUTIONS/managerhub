-- Equipes do setor: só as funções da carteira (LUIZ, 26/11/2026).
--
-- A subaba mostrava o setor inteiro (gerentes, marketing, comercial...). O foco
-- é a carteira: em VENDAS, representantes de negócios e promotores. As funções
-- da carteira ficam configuradas por setor, pelo NOME BASE da função (sem o
-- nível do fim: "REPRESENTANTE DE NEGOCIOS MASTER" é "REPRESENTANTE DE
-- NEGOCIOS"), para um nível novo entrar sozinho.
--   - a tela mostra só essas pessoas (setor sem configuração: todo mundo);
--   - quem tem só a marca move só essas pessoas (trava em equipe_transferir);
--   - o gestor novo continua podendo ser qualquer pessoa do setor (decisão do
--     LUIZ).

-- o nome base da função: sem acento, maiúsculo e sem o nível do fim
create or replace function public.funcao_base(p text)
returns text
language sql stable set search_path to 'public', 'extensions'
as $$
  select regexp_replace(
    upper(extensions.unaccent(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')))),
    ' (I|II|III|IV|V|JR|JUNIOR|PLENO|SENIOR|MASTER)$', '');
$$;
revoke execute on function public.funcao_base(text) from public, anon;
grant execute on function public.funcao_base(text) to authenticated, service_role;

create table if not exists public.equipe_setor_config (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  -- nomes base das funções da carteira (funcao_base)
  funcoes text[] not null default '{}',
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint equipe_setor_config_uk unique (tenant_id, department_id)
);
comment on table public.equipe_setor_config is
  'Funções da carteira de cada setor em Equipes do setor (nome base, sem o nível). Sem linha ou lista vazia: o setor inteiro.';

create or replace function public.equipe_setor_config_confere()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.departments where id = new.department_id and tenant_id = new.tenant_id) then
    raise exception 'O setor precisa ser desta empresa.';
  end if;
  -- guarda sempre o nome base, para a comparação não depender de como foi digitado
  new.funcoes := coalesce((select array_agg(distinct public.funcao_base(x) order by public.funcao_base(x))
                             from unnest(new.funcoes) x where nullif(btrim(x), '') is not null), '{}');
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.equipe_setor_config_confere() from public, anon, authenticated;

drop trigger if exists equipe_setor_config_confere on public.equipe_setor_config;
create trigger equipe_setor_config_confere
  before insert or update on public.equipe_setor_config
  for each row execute function public.equipe_setor_config_confere();

alter table public.equipe_setor_config enable row level security;
revoke all on table public.equipe_setor_config from public, anon;
drop policy if exists equipe_setor_config_select on public.equipe_setor_config;
create policy equipe_setor_config_select on public.equipe_setor_config
  for select to authenticated using (public.is_tenant_member(tenant_id));
drop policy if exists equipe_setor_config_write on public.equipe_setor_config;
create policy equipe_setor_config_write on public.equipe_setor_config
  for all to authenticated
  using (public.has_tenant_role(tenant_id, '{owner,admin,hr}'::public.member_role[]))
  with check (public.has_tenant_role(tenant_id, '{owner,admin,hr}'::public.member_role[]));
drop trigger if exists audit_equipe_setor_config on public.equipe_setor_config;
create trigger audit_equipe_setor_config
  after insert or update or delete on public.equipe_setor_config
  for each row execute function public.audit_trigger();

-- Cervantes: em VENDAS a carteira é de representantes e promotores (LUIZ, 26/11)
insert into public.equipe_setor_config (tenant_id, department_id, funcoes)
select d.tenant_id, d.id, array['REPRESENTANTE DE NEGOCIOS', 'PROMOTOR DE VENDAS']
  from public.departments d
 where d.tenant_id = '373d5ce2-9c41-4cad-bfe7-24b80616ffa9' and d.name = 'VENDAS'
on conflict (tenant_id, department_id) do nothing;

-- quem tem só a marca move só quem é da carteira do setor
do $$
declare
  v_def text := pg_get_functiondef('public.equipe_transferir(uuid,uuid[],uuid,uuid,date)'::regprocedure);
  a text := $q$      if v_m.department_id is distinct from v_eu.department_id then
        raise exception '% não é do seu setor.', v_m.nome;
      end if;$q$;
begin
  if position(a in v_def) = 0 then
    raise exception 'equipe_transferir mudou: âncora da carteira não encontrada';
  end if;
  v_def := replace(v_def, a, a || $q$
      -- só a carteira do setor, quando o setor tem as funções configuradas
      if exists (select 1 from public.equipe_setor_config c
                  where c.tenant_id = p_tenant and c.department_id = v_m.department_id
                    and cardinality(c.funcoes) > 0)
         and not exists (select 1 from public.equipe_setor_config c
                          join public.positions po on po.id = v_m.position_id
                         where c.tenant_id = p_tenant and c.department_id = v_m.department_id
                           and public.funcao_base(po.name) = any (c.funcoes)) then
        raise exception '% não é da carteira do setor.', v_m.nome;
      end if;$q$);
  execute v_def;
end $$;
revoke execute on function public.equipe_transferir(uuid, uuid[], uuid, uuid, date) from public, anon;

notify pgrst, 'reload schema';
