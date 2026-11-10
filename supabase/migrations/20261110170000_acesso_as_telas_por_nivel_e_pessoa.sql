-- Acesso às telas por nível, com exceção por pessoa (LUIZ, 10/11/2026).
--
-- Antes, uma tela aparecia para quem a unidade contratou e o perfil permitia.
-- Agora a empresa pode restringir mais: cada nível de hierarquia (ex.:
-- Operacional) vê só as telas escolhidas, e uma pessoa pode ter regra própria.
--
-- Precedência: exceção da pessoa > regra do nível > sem restrição.
-- Nunca restringidos: proprietário, administrador, RH e o dono da plataforma.
-- São eles que configuram o sistema, e restringi-los poderia trancar a própria
-- tela de configuração.
--
-- A restrição só TIRA telas: o que a unidade não contratou ou o perfil não
-- permite continua de fora, esteja ou não na lista.

-- `id` porque o audit_trigger identifica o registro por ele
create table if not exists public.acesso_telas_nivel (
  id uuid not null default gen_random_uuid() unique,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  hierarchy_level_id uuid not null references public.hierarchy_levels(id) on delete cascade,
  modulos text[] not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (tenant_id, hierarchy_level_id)
);
alter table public.acesso_telas_nivel enable row level security;
revoke all on table public.acesso_telas_nivel from public, anon, authenticated;

create table if not exists public.acesso_telas_pessoa (
  id uuid not null default gen_random_uuid() unique,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- true: todas as telas contratadas, ignorando o nível
  livre boolean not null default false,
  modulos text[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (tenant_id, user_id)
);
alter table public.acesso_telas_pessoa enable row level security;
revoke all on table public.acesso_telas_pessoa from public, anon, authenticated;

-- toda mudança aparece em Logs do sistema, com o de→para
create trigger audit_acesso_telas_nivel
  after insert or update or delete on public.acesso_telas_nivel
  for each row execute function public.audit_trigger();
create trigger audit_acesso_telas_pessoa
  after insert or update or delete on public.acesso_telas_pessoa
  for each row execute function public.audit_trigger();

-- ── o que vale para quem está logado ──────────────────────────────────────
-- null = sem restrição; array = só estas telas
create or replace function public.minhas_telas(p_tenant uuid)
returns text[]
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_m record;
  v_p record;
  v_lista text[];
begin
  if v_user is null then
    raise exception 'Sessão expirada. Faça login novamente.' using errcode = '42501';
  end if;
  if is_super_admin() then
    return null;
  end if;

  select role, is_hr, hierarchy_level_id into v_m
    from memberships where tenant_id = p_tenant and user_id = v_user
   order by created_at limit 1;
  if not found then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if v_m.role in ('owner', 'admin') or v_m.is_hr then
    return null;
  end if;

  select livre, modulos into v_p from acesso_telas_pessoa where tenant_id = p_tenant and user_id = v_user;
  if found then
    return case when v_p.livre then null else v_p.modulos end;
  end if;

  select modulos into v_lista from acesso_telas_nivel
   where tenant_id = p_tenant and hierarchy_level_id = v_m.hierarchy_level_id;
  return v_lista;  -- null quando o nível não tem regra
end $$;
revoke execute on function public.minhas_telas(uuid) from public, anon;

-- ── leitura para Configurações (quem vê a aba Colaboradores) ──────────────
create or replace function public.acesso_telas_listar(p_tenant uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not (
    is_super_admin()
    or has_tenant_role(p_tenant, array['owner', 'admin', 'manager', 'team_lead']::member_role[])
    or exists (select 1 from memberships where tenant_id = p_tenant and user_id = auth.uid() and is_hr)
  ) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'niveis', coalesce((
      select jsonb_agg(jsonb_build_object('nivel', hierarchy_level_id, 'modulos', modulos))
        from acesso_telas_nivel where tenant_id = p_tenant), '[]'::jsonb),
    'pessoas', coalesce((
      select jsonb_agg(jsonb_build_object('user', user_id, 'livre', livre, 'modulos', modulos, 'em', updated_at))
        from acesso_telas_pessoa where tenant_id = p_tenant), '[]'::jsonb)
  );
end $$;
revoke execute on function public.acesso_telas_listar(uuid) from public, anon;

-- ── escrita: só proprietário e administrador (conceder acesso é da administração) ──
create or replace function public.acesso_telas_definir_nivel(p_tenant uuid, p_nivel uuid, p_modulos text[])
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not (is_super_admin() or has_tenant_role(p_tenant, array['owner', 'admin']::member_role[])) then
    raise exception 'Apenas proprietário e administrador definem o acesso às telas.' using errcode = '42501';
  end if;
  if not exists (select 1 from hierarchy_levels where id = p_nivel and tenant_id = p_tenant) then
    raise exception 'Nível não encontrado nesta empresa.' using errcode = '22023';
  end if;

  -- null = o nível volta a ver todas as telas contratadas
  if p_modulos is null then
    delete from acesso_telas_nivel where tenant_id = p_tenant and hierarchy_level_id = p_nivel;
    return;
  end if;
  if cardinality(p_modulos) = 0 then
    raise exception 'Escolha ao menos uma tela.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_modulos) k where k !~ '^[a-z_]{2,40}$') then
    raise exception 'Tela inválida.' using errcode = '22023';
  end if;

  insert into acesso_telas_nivel (tenant_id, hierarchy_level_id, modulos, updated_by)
  values (p_tenant, p_nivel, (select array_agg(distinct k order by k) from unnest(p_modulos) k), auth.uid())
  on conflict (tenant_id, hierarchy_level_id) do update
    set modulos = excluded.modulos, updated_at = now(), updated_by = excluded.updated_by;
end $$;
revoke execute on function public.acesso_telas_definir_nivel(uuid, uuid, text[]) from public, anon;

-- p_modo: 'nivel' (apaga a exceção), 'livre' (todas as contratadas), 'lista'
create or replace function public.acesso_telas_definir_pessoa(p_tenant uuid, p_user uuid, p_modo text, p_modulos text[])
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not (is_super_admin() or has_tenant_role(p_tenant, array['owner', 'admin']::member_role[])) then
    raise exception 'Apenas proprietário e administrador definem o acesso às telas.' using errcode = '42501';
  end if;
  if not exists (select 1 from memberships where tenant_id = p_tenant and user_id = p_user) then
    raise exception 'Colaborador não encontrado nesta empresa.' using errcode = '22023';
  end if;

  if p_modo = 'nivel' then
    delete from acesso_telas_pessoa where tenant_id = p_tenant and user_id = p_user;
    return;
  end if;
  if p_modo not in ('livre', 'lista') then
    raise exception 'Modo de acesso inválido.' using errcode = '22023';
  end if;
  if p_modo = 'lista' then
    if coalesce(cardinality(p_modulos), 0) = 0 then
      raise exception 'Escolha ao menos uma tela.' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(p_modulos) k where k !~ '^[a-z_]{2,40}$') then
      raise exception 'Tela inválida.' using errcode = '22023';
    end if;
  end if;

  insert into acesso_telas_pessoa (tenant_id, user_id, livre, modulos, updated_by)
  values (
    p_tenant, p_user, p_modo = 'livre',
    case when p_modo = 'livre' then '{}'::text[]
         else (select array_agg(distinct k order by k) from unnest(p_modulos) k) end,
    auth.uid()
  )
  on conflict (tenant_id, user_id) do update
    set livre = excluded.livre, modulos = excluded.modulos, updated_at = now(), updated_by = excluded.updated_by;
end $$;
revoke execute on function public.acesso_telas_definir_pessoa(uuid, uuid, text, text[]) from public, anon;

notify pgrst, 'reload schema';
