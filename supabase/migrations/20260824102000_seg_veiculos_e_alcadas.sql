-- Veículos dos colaboradores + as duas alçadas da blitz.
--
-- O VEÍCULO é cadastro formal, mas se alimenta sozinho: salvar uma blitz com
-- placa faz upsert aqui, e a blitz seguinte do mesmo colaborador já vem com
-- placa, tipo e propriedade sugeridos. Configurações serve para corrigir e
-- desativar, não para digitar a frota inteira antes de começar.
--
-- AS ALÇADAS:
--   pode_avaliar_blitz  quem lança: gestor para cima (team_lead, manager,
--                       admin, owner) OU equipe de segurança. É quem fica na
--                       portaria no dia da blitz.
--   pode_ver_blitz      quem lê: o próprio colaborador (transparência: ele
--                       sabe que passou e no que deu), o gestor da cadeia dele
--                       (manages_user), a gerência e a segurança. Por VALORES,
--                       para a policy não ler a própria tabela e recursar.
--
-- Diferente dos relatos, aqui NÃO há anonimato: a blitz é assinada pelo
-- avaliador na frente do colaborador.

create table public.seg_veiculos (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  meio_id      uuid references public.seg_blitz_meios(id) on delete set null,
  placa        text not null,
  tipo_descricao text,
  propriedade  public.seg_veiculo_propriedade not null default 'proprio',
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint seg_veiculos_placa_nao_vazia check (btrim(placa) <> ''),
  -- a placa identifica o veículo dentro da empresa; MAIÚSCULA por trigger
  constraint seg_veiculos_placa_unica unique (tenant_id, placa)
);
create index seg_veiculos_user_idx on public.seg_veiculos (tenant_id, user_id, active);

create trigger trg_seg_veiculos_updated before update on public.seg_veiculos
  for each row execute function public.set_updated_at();

/** Placa sempre normalizada: sem espaço, maiúscula. "abc1d23" e "ABC1D23" são o mesmo carro. */
create or replace function public.seg_veiculo_normaliza()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  new.placa := upper(regexp_replace(new.placa, '[^A-Za-z0-9]', '', 'g'));
  if new.placa = '' then
    raise exception 'Informe a placa do veículo.';
  end if;
  return new;
end;
$$;

revoke execute on function public.seg_veiculo_normaliza() from public, anon, authenticated;

create trigger seg_veiculos_normaliza
  before insert or update of placa on public.seg_veiculos
  for each row execute function public.seg_veiculo_normaliza();

/** Quem lança blitz: gestor para cima, ou equipe de segurança. */
create or replace function public.pode_avaliar_blitz(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.has_tenant_role(p_tenant, '{owner,admin,manager,team_lead}'::public.member_role[])
      or public.is_safety_member(p_tenant);
$$;

revoke execute on function public.pode_avaliar_blitz(uuid) from public, anon;
grant  execute on function public.pode_avaliar_blitz(uuid) to authenticated;

/**
 * Quem lê a blitz de um colaborador. Recebe VALORES, não o id da linha, para a
 * policy não ler a própria tabela e recursar (mesmo desenho de pode_ver_relato).
 */
create or replace function public.pode_ver_blitz(p_tenant uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_user = (select auth.uid())
      or public.manages_user(p_user, p_tenant)
      or public.has_tenant_role(p_tenant, '{owner,admin,manager}'::public.member_role[])
      or public.pode_tratar_seguranca(p_tenant);
$$;

revoke execute on function public.pode_ver_blitz(uuid, uuid) from public, anon;
grant  execute on function public.pode_ver_blitz(uuid, uuid) to authenticated;

alter table public.seg_veiculos enable row level security;

create policy seg_veiculos_select on public.seg_veiculos
  for select using (public.pode_ver_blitz(tenant_id, user_id));

-- quem avalia blitz mantém o cadastro em dia; owner/admin já entram por papel
create policy seg_veiculos_write on public.seg_veiculos
  for all
  using      (public.pode_avaliar_blitz(tenant_id))
  with check (public.pode_avaliar_blitz(tenant_id));

revoke all on table public.seg_veiculos from public, anon;

drop trigger if exists audit_seg_veiculos on public.seg_veiculos;
create trigger audit_seg_veiculos after insert or update or delete on public.seg_veiculos
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
