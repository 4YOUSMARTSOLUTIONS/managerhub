-- Segurança: os três catálogos que o relato usa (tipo, local e área).
--
-- Tudo é do cliente. O que numa distribuidora é "Armazém / Área de descarga",
-- noutra é "Pátio / Doca 3", e nenhuma lista chutada aqui sobreviveria ao
-- primeiro cadastro real. Por isso a única coisa fixa é a NATUREZA do tipo
-- (a camada da pirâmide); o nome, a ordem e até a figura são do cliente.
--
-- `image_path` é a figura ilustrativa que o próprio admin sobe em Configurações
-- (bucket `seg-icones`, migração seguinte). É opcional de propósito: a tela tem
-- que funcionar bonita sem nenhuma imagem cadastrada, senão o cliente é obrigado
-- a virar designer antes de usar o módulo.
--
-- ÁREA PENDURADA NO LOCAL: `local_id` é opcional e serve à cascata do
-- formulário (escolheu Armazém, só aparecem as áreas do armazém). Área sem
-- local vale para qualquer um, o que evita obrigar o cliente a duplicar
-- "Escritório" em cada local. O `on delete restrict` existe para ninguém apagar
-- um local que ainda tem área pendurada; a tela oferece desativar.

create table public.seg_tipos_relato (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  natureza    public.seg_relato_natureza not null default 'desvio',
  description text,
  image_path  text,
  active      boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint seg_tipos_relato_nome_unico    unique (tenant_id, name),
  constraint seg_tipos_relato_nome_nao_vazio check (btrim(name) <> '')
);
create index seg_tipos_relato_tenant_idx on public.seg_tipos_relato (tenant_id, sort, name);

create table public.seg_locais (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  description text,
  image_path  text,
  active      boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint seg_locais_nome_unico     unique (tenant_id, name),
  constraint seg_locais_nome_nao_vazio check (btrim(name) <> '')
);
create index seg_locais_tenant_idx on public.seg_locais (tenant_id, sort, name);

create table public.seg_areas (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  local_id    uuid references public.seg_locais(id) on delete restrict,
  name        text not null,
  description text,
  image_path  text,
  active      boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint seg_areas_nome_nao_vazio check (btrim(name) <> '')
);
-- o mesmo nome de área pode existir em locais diferentes ("Área de descarga" no
-- armazém e na revenda); o que não pode é repetir dentro do mesmo local. Com
-- `local_id` nulo o unique comum não pegaria, daí o coalesce.
create unique index seg_areas_nome_unico
  on public.seg_areas (tenant_id, name, coalesce(local_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index seg_areas_tenant_idx on public.seg_areas (tenant_id, sort, name);
create index seg_areas_local_idx  on public.seg_areas (local_id);

create trigger trg_seg_tipos_relato_updated before update on public.seg_tipos_relato
  for each row execute function public.set_updated_at();
create trigger trg_seg_locais_updated before update on public.seg_locais
  for each row execute function public.set_updated_at();
create trigger trg_seg_areas_updated before update on public.seg_areas
  for each row execute function public.set_updated_at();

alter table public.seg_tipos_relato enable row level security;
alter table public.seg_locais       enable row level security;
alter table public.seg_areas        enable row level security;

-- Leitura de qualquer membro: quem relata é a operação inteira, e o formulário
-- precisa dos três catálogos para ser preenchido.
create policy seg_tipos_relato_select on public.seg_tipos_relato
  for select using (tenant_id in (select public.my_tenant_ids()));
create policy seg_locais_select on public.seg_locais
  for select using (tenant_id in (select public.my_tenant_ids()));
create policy seg_areas_select on public.seg_areas
  for select using (tenant_id in (select public.my_tenant_ids()));

-- Escrita é de owner/admin, como os demais catálogos de Configurações. O RH não
-- entra aqui: segurança do trabalho não é departamento pessoal.
create policy seg_tipos_relato_write on public.seg_tipos_relato
  for all
  using      (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])));
create policy seg_locais_write on public.seg_locais
  for all
  using      (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])));
create policy seg_areas_write on public.seg_areas
  for all
  using      (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])));

-- O ACL padrão do Supabase concede tudo em tabela nova de `public`; sem o revoke
-- a RLS seria a única barreira (AGENTS.md). `authenticated` fica, senão a policy
-- vira inalcançável.
revoke all on table public.seg_tipos_relato from public, anon;
revoke all on table public.seg_locais       from public, anon;
revoke all on table public.seg_areas        from public, anon;

drop trigger if exists audit_seg_tipos_relato on public.seg_tipos_relato;
create trigger audit_seg_tipos_relato after insert or update or delete on public.seg_tipos_relato
  for each row execute function public.audit_trigger();
drop trigger if exists audit_seg_locais on public.seg_locais;
create trigger audit_seg_locais after insert or update or delete on public.seg_locais
  for each row execute function public.audit_trigger();
drop trigger if exists audit_seg_areas on public.seg_areas;
create trigger audit_seg_areas after insert or update or delete on public.seg_areas
  for each row execute function public.audit_trigger();

-- Seed só dos TIPOS, e só destes quatro: são as quatro categorias que o dono do
-- produto definiu e das quais a pirâmide depende. Local e área ficam vazios de
-- propósito (é planta de cada cliente).
insert into public.seg_tipos_relato (tenant_id, name, natureza, sort)
select t.id, v.name, v.natureza::public.seg_relato_natureza, v.sort
  from public.tenants t
 cross join (values
   ('Ato inseguro',        'desvio',    10),
   ('Condição insegura',   'desvio',    20),
   ('Incidente',           'incidente', 30),
   ('Comportamento seguro','positivo',  40)
 ) as v(name, natureza, sort)
on conflict (tenant_id, name) do nothing;

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
