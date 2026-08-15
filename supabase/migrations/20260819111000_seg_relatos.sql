-- O relato de segurança, e a regra que protege quem relata.
--
-- ANONIMATO. A promessa feita ao colaborador é que ele pode apontar um risco
-- sem virar alvo. Isso não se resolve escondendo o nome na tela: a RLS decide
-- LINHA, não coluna, e a chave pública está no navegador (AGENTS.md). Se o
-- gestor pudesse ler a linha do relato, leria `created_by` chamando o PostgREST
-- direto, por mais bonita que fosse a interface.
--
-- Então o alcance é desenhado para que ninguém além da segurança precise da
-- linha:
--   * quem relatou vê os PRÓPRIOS relatos (é a linha dele, e ele precisa
--     acompanhar o desfecho);
--   * a equipe de segurança, o administrador e o proprietário veem tudo,
--     inclusive o relator, porque alguém precisa poder voltar e perguntar;
--   * o gestor do envolvido NÃO vê relato nenhum. Ele recebe alerta e ação, e o
--     texto dessas notificações nunca cita o relator (leva 3).
-- Nenhum caminho de leitura precisa mascarar coluna, que é o único jeito de
-- isso ser verdade e não boa intenção.
--
-- CARIMBO DE ÉPOCA nos envolvidos. Setor, função, gestor e unidade são copiados
-- na hora do registro. Um ano depois, quando alguém abrir a estatística de
-- desvios por setor, o número tem que refletir onde a pessoa estava no dia do
-- fato, e não onde ela foi promovida depois. O carimbo é por TRIGGER, e não na
-- server action: assim vale para qualquer caminho de escrita, inclusive uma
-- importação futura, sem depender de cada chamador lembrar.

create table public.seg_relatos (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  unit_id       uuid references public.units(id) on delete set null,
  occurred_on   date not null,
  tipo_id       uuid not null references public.seg_tipos_relato(id) on delete restrict,
  -- cópia da natureza do tipo no dia do relato: reclassificar o tipo amanhã não
  -- pode remexer a pirâmide de ontem
  snap_natureza public.seg_relato_natureza not null,
  local_id      uuid references public.seg_locais(id) on delete restrict,
  area_id       uuid references public.seg_areas(id) on delete restrict,
  descricao     text not null,
  status        public.seg_relato_status not null default 'aberto',
  triado_por    uuid references public.profiles(id) on delete set null,
  triado_em     timestamptz,
  nota_triagem  text,
  duplicado_de  uuid references public.seg_relatos(id) on delete set null,
  created_by    uuid not null default auth.uid() references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint seg_relato_descricao_nao_vazia check (btrim(descricao) <> ''),
  constraint seg_relato_triado_tem_carimbo  check (status = 'aberto' or triado_em is not null),
  constraint seg_relato_duplicado_aponta    check (duplicado_de is null or status = 'duplicado'),
  constraint seg_relato_nao_duplica_a_si    check (duplicado_de is null or duplicado_de <> id)
);
create index seg_relatos_fila_idx   on public.seg_relatos (tenant_id, status, occurred_on desc);
create index seg_relatos_data_idx   on public.seg_relatos (tenant_id, occurred_on desc);
create index seg_relatos_autor_idx  on public.seg_relatos (created_by, created_at desc);
create index seg_relatos_tipo_idx   on public.seg_relatos (tipo_id);

create trigger trg_seg_relatos_updated before update on public.seg_relatos
  for each row execute function public.set_updated_at();

create table public.seg_relato_envolvidos (
  id                     uuid primary key default gen_random_uuid(),
  relato_id              uuid not null references public.seg_relatos(id) on delete cascade,
  tenant_id              uuid not null references public.tenants(id) on delete cascade,
  user_id                uuid not null references public.profiles(id) on delete cascade,
  snap_full_name         text,
  snap_employee_code     text,
  snap_department_id     uuid,
  snap_department_name   text,
  snap_subdepartment_id  uuid,
  snap_subdepartment_name text,
  snap_position_id       uuid,
  snap_position_name     text,
  snap_manager_id        uuid,
  snap_manager_name      text,
  snap_unit_id           uuid,
  snap_unit_name         text,
  created_at             timestamptz not null default now(),
  constraint seg_envolvido_unico unique (relato_id, user_id)
);
create index seg_relato_envolvidos_relato_idx  on public.seg_relato_envolvidos (relato_id);
create index seg_relato_envolvidos_pessoa_idx  on public.seg_relato_envolvidos (tenant_id, user_id);
create index seg_relato_envolvidos_gestor_idx  on public.seg_relato_envolvidos (tenant_id, snap_manager_id);

/** Preenche o vínculo da época quando ele não veio pronto. */
create or replace function public.stamp_seg_envolvido()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.snap_full_name is null and new.snap_department_id is null then
    select
      p.full_name, m.employee_code,
      m.department_id, d.name,
      m.subdepartment_id, sd.name,
      m.position_id, pos.name,
      m.manager_id, mg.full_name
    into
      new.snap_full_name, new.snap_employee_code,
      new.snap_department_id, new.snap_department_name,
      new.snap_subdepartment_id, new.snap_subdepartment_name,
      new.snap_position_id, new.snap_position_name,
      new.snap_manager_id, new.snap_manager_name
    from public.memberships m
    join public.profiles p on p.id = m.user_id
    left join public.departments d on d.id = m.department_id
    left join public.subdepartments sd on sd.id = m.subdepartment_id
    left join public.positions pos on pos.id = m.position_id
    left join public.profiles mg on mg.id = m.manager_id
    where m.user_id = new.user_id and m.tenant_id = new.tenant_id;

    -- a unidade não é coluna do vínculo, é a ponte membership_units
    select u.id, u.name
      into new.snap_unit_id, new.snap_unit_name
    from public.memberships m
    join public.membership_units mu on mu.membership_id = m.id
    join public.units u on u.id = mu.unit_id
    where m.user_id = new.user_id and m.tenant_id = new.tenant_id
    order by u.name
    limit 1;
  end if;
  return new;
end;
$$;

revoke execute on function public.stamp_seg_envolvido() from public, anon, authenticated;

create trigger seg_relato_envolvidos_stamp
  before insert on public.seg_relato_envolvidos
  for each row execute function public.stamp_seg_envolvido();

/**
 * Quem enxerga o relato. Recebe VALORES, e não o id, para a policy não ler a
 * própria tabela e cair em recursão (mesmo desenho de `pode_ver_absenteismo`).
 */
create or replace function public.pode_ver_relato(p_tenant uuid, p_created_by uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_created_by = (select auth.uid())
      or public.pode_tratar_seguranca(p_tenant);
$$;

revoke execute on function public.pode_ver_relato(uuid, uuid) from public, anon;
grant  execute on function public.pode_ver_relato(uuid, uuid) to authenticated;

alter table public.seg_relatos            enable row level security;
alter table public.seg_relato_envolvidos  enable row level security;

create policy seg_relatos_select on public.seg_relatos
  for select using (public.pode_ver_relato(tenant_id, created_by));

-- Qualquer membro relata, e só como autor: `created_by` fixado em auth.uid()
-- impede abrir relato no nome de outra pessoa, e `aberto` impede nascer já
-- triado.
create policy seg_relatos_insert on public.seg_relatos
  for insert with check (
    public.is_tenant_member(tenant_id)
    and created_by = (select auth.uid())
    and status = 'aberto'
  );

-- Alterar é da segurança. As transições válidas são conferidas na RPC de
-- triagem; a policy só define a mão.
create policy seg_relatos_update on public.seg_relatos
  for update using (public.pode_tratar_seguranca(tenant_id))
  with check (public.pode_tratar_seguranca(tenant_id));

create policy seg_relatos_delete on public.seg_relatos
  for delete using (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])));

create policy seg_relato_envolvidos_select on public.seg_relato_envolvidos
  for select using (
    exists (
      select 1 from public.seg_relatos r
       where r.id = seg_relato_envolvidos.relato_id
         and public.pode_ver_relato(r.tenant_id, r.created_by)
    )
  );

create policy seg_relato_envolvidos_insert on public.seg_relato_envolvidos
  for insert with check (
    exists (
      select 1 from public.seg_relatos r
       where r.id = seg_relato_envolvidos.relato_id
         and r.created_by = (select auth.uid())
         and r.status = 'aberto'
    )
    or public.pode_tratar_seguranca(tenant_id)
  );

create policy seg_relato_envolvidos_delete on public.seg_relato_envolvidos
  for delete using (public.pode_tratar_seguranca(tenant_id));

revoke all on table public.seg_relatos           from public, anon;
revoke all on table public.seg_relato_envolvidos from public, anon;

drop trigger if exists audit_seg_relatos on public.seg_relatos;
create trigger audit_seg_relatos after insert or update or delete on public.seg_relatos
  for each row execute function public.audit_trigger();

drop trigger if exists audit_seg_relato_envolvidos on public.seg_relato_envolvidos;
create trigger audit_seg_relato_envolvidos after insert or update or delete on public.seg_relato_envolvidos
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
