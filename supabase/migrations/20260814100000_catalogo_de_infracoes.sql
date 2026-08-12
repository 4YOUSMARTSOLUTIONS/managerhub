-- Catálogo de infrações: o que a empresa considera falta, com a gravidade junto.
--
-- Hoje a punição entra por uma tela de quatro campos (colaborador, tipo, data,
-- observação) e vai direto para `employee_sanctions`, que é o fato que reduz a
-- remuneração variável. Falta o que veio ANTES da punição: qual infração, com
-- que código, descrita como e de que gravidade.
--
-- GRAVIDADE MORA AQUI, e não no lançamento. Se o gestor escolhesse a gravidade
-- ao aplicar, o mesmo atraso seria leve para um gestor e grave para outro, e a
-- primeira reclamação trabalhista encontraria dois pesos para o mesmo fato. No
-- catálogo, quem define é o regulamento da empresa, uma vez.
--
-- `code` existe porque é assim que o regulamento fala: as empresas numeram as
-- infrações ("3.2 Atraso reiterado"), e o documento assinado precisa citar o
-- número. É único por empresa, como o nome.
--
-- Sem seed. Infração é o regulamento interno de cada cliente, e chutar uma
-- lista genérica só criaria cadastro para alguém apagar depois.

create type public.infraction_severity as enum ('leve', 'media', 'grave');

create table public.infraction_types (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  code        text not null,
  name        text not null,
  description text,
  severity    public.infraction_severity not null default 'leve',
  active      boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint infraction_types_codigo_unico unique (tenant_id, code),
  constraint infraction_types_nome_unico   unique (tenant_id, name),
  constraint infraction_types_codigo_nao_vazio check (btrim(code) <> ''),
  constraint infraction_types_nome_nao_vazio   check (btrim(name) <> '')
);
create index infraction_types_tenant_idx on public.infraction_types (tenant_id, sort, name);

create trigger trg_infraction_types_updated
  before update on public.infraction_types
  for each row execute function public.set_updated_at();

alter table public.infraction_types enable row level security;

-- Leitura é de qualquer membro: o gestor precisa do catálogo para preencher o
-- lançamento, e o texto da infração vai impresso no documento que ele assina.
create policy infraction_types_select on public.infraction_types
  for select using (tenant_id in (select public.my_tenant_ids()));

-- Escrita é do departamento pessoal, mesmo grupo de `sanction_types`.
create policy infraction_types_write on public.infraction_types
  for all
  using (tenant_id in (select public.my_role_tenant_ids('{owner,admin,hr}'::member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin,hr}'::member_role[])));

-- O ACL padrão do Supabase concede tudo em tabela nova de `public`; sem o revoke
-- a RLS seria a única barreira (AGENTS.md). `authenticated` fica, senão a policy
-- vira inalcançável.
revoke all on table public.infraction_types from public, anon;

drop trigger if exists audit_infraction_types on public.infraction_types;
create trigger audit_infraction_types
  after insert or update or delete on public.infraction_types
  for each row execute function public.audit_trigger();

do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_n <> 0 then
    raise exception 'ha % funcoes SECURITY DEFINER alcancaveis por anon', v_n;
  end if;
end $$;

notify pgrst, 'reload schema';
