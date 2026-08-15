-- O acidente de trabalho: o registro que a empresa precisa e o que a lei pede.
--
-- Diferente do relato em três coisas:
--
--  1. QUEM ESCREVE. Só a equipe de segurança e a administração. Acidente não é
--     relato: ele é apurado por quem tem formação para isso, e o registro vira
--     documento legal.
--  2. QUEM LÊ. Ninguém além dessa mesma turma, nem a própria pessoa acidentada
--     por aqui. A linha carrega CID, que é dado de saúde; o precedente é o
--     `absenteismo_atestados`, que também não é lido pelo gestor.
--  3. O CARIMBO É OBRIGATÓRIO. Setor, função, gestor e unidade do dia do
--     acidente ficam gravados, porque o documento e a estatística de anos
--     depois precisam do vínculo da época, não do atual.
--
-- Campos legais: CAT (número e data de emissão), CID-10 (código e descrição
-- carimbada da tabela oficial), dias de afastamento e data de retorno, além de
-- parte do corpo, agente causador e natureza da lesão, que são a linguagem da
-- própria CAT.
--
-- A regra de negócio que o banco garante: LTI é, por definição, acidente COM
-- afastamento, então sem dias de afastamento ele não entra. É o que impede a
-- pirâmide de ganhar um LTI que ninguém sabe medir.

create table public.seg_acidentes (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  unit_id            uuid references public.units(id) on delete set null,
  occurred_on        date not null,
  occurred_at        time,
  turno              text,
  classe             public.seg_acidente_class not null,
  status             public.seg_acidente_status not null default 'aberto',
  user_id            uuid not null references public.profiles(id) on delete restrict,

  -- vínculo da época, preenchido por trigger
  snap_full_name          text,
  snap_employee_code      text,
  snap_department_id      uuid,
  snap_department_name    text,
  snap_subdepartment_id   uuid,
  snap_subdepartment_name text,
  snap_position_id        uuid,
  snap_position_name      text,
  snap_manager_id         uuid,
  snap_manager_name       text,
  snap_unit_id            uuid,
  snap_unit_name          text,

  local_id           uuid references public.seg_locais(id) on delete restrict,
  area_id            uuid references public.seg_areas(id) on delete restrict,
  descricao          text not null,
  testemunhas        text,
  parte_corpo        text,
  agente_causador    text,
  natureza_lesao     text,
  analise_causa      text,

  cat_numero         text,
  cat_emitida_em     date,
  cid_code           text,
  cid_descricao      text,
  dias_afastamento   integer,
  afastamento_de     date,
  retorno_em         date,

  encerrado_por      uuid references public.profiles(id) on delete set null,
  encerrado_em       timestamptz,
  created_by         uuid not null default auth.uid() references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint seg_acidente_descricao_nao_vazia check (btrim(descricao) <> ''),
  constraint seg_acidente_lti_tem_afastamento
    check (classe <> 'lti' or (dias_afastamento is not null and dias_afastamento > 0)),
  constraint seg_acidente_afastamento_positivo
    check (dias_afastamento is null or dias_afastamento >= 0),
  constraint seg_acidente_encerrado_tem_carimbo
    check (status = 'aberto' or encerrado_em is not null)
);
create index seg_acidentes_fila_idx    on public.seg_acidentes (tenant_id, status, occurred_on desc);
create index seg_acidentes_classe_idx  on public.seg_acidentes (tenant_id, classe, occurred_on desc);
create index seg_acidentes_pessoa_idx  on public.seg_acidentes (tenant_id, user_id);
create index seg_acidentes_setor_idx   on public.seg_acidentes (tenant_id, snap_department_id);

create trigger trg_seg_acidentes_updated before update on public.seg_acidentes
  for each row execute function public.set_updated_at();

create table public.seg_acidente_anexos (
  id           uuid primary key default gen_random_uuid(),
  acidente_id  uuid not null references public.seg_acidentes(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  path         text not null,
  filename     text not null,
  size         bigint,
  content_type text,
  uploaded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index seg_acidente_anexos_acidente_idx on public.seg_acidente_anexos (acidente_id);

/** Carimba o vínculo do acidentado quando ele não veio pronto. */
create or replace function public.stamp_seg_acidente()
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

    -- a unidade do acidente é a informada; sem ela, a do vínculo
    if new.unit_id is not null then
      select u.id, u.name into new.snap_unit_id, new.snap_unit_name
        from public.units u where u.id = new.unit_id;
    else
      select u.id, u.name into new.snap_unit_id, new.snap_unit_name
        from public.memberships m
        join public.membership_units mu on mu.membership_id = m.id
        join public.units u on u.id = mu.unit_id
       where m.user_id = new.user_id and m.tenant_id = new.tenant_id
       order by u.name limit 1;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.stamp_seg_acidente() from public, anon, authenticated;

create trigger seg_acidentes_stamp
  before insert on public.seg_acidentes
  for each row execute function public.stamp_seg_acidente();

alter table public.seg_acidentes       enable row level security;
alter table public.seg_acidente_anexos enable row level security;

-- Leitura e escrita são da mesma mão: equipe de segurança mais owner/admin.
-- A linha carrega CID, e dado de saúde não circula por conveniência de tela.
create policy seg_acidentes_select on public.seg_acidentes
  for select using (public.pode_tratar_seguranca(tenant_id));
create policy seg_acidentes_insert on public.seg_acidentes
  for insert with check (public.pode_tratar_seguranca(tenant_id) and created_by = (select auth.uid()));
create policy seg_acidentes_update on public.seg_acidentes
  for update using (public.pode_tratar_seguranca(tenant_id))
  with check (public.pode_tratar_seguranca(tenant_id));
create policy seg_acidentes_delete on public.seg_acidentes
  for delete using (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])));

create policy seg_acidente_anexos_select on public.seg_acidente_anexos
  for select using (public.pode_tratar_seguranca(tenant_id));
create policy seg_acidente_anexos_write on public.seg_acidente_anexos
  for all
  using      (public.pode_tratar_seguranca(tenant_id))
  with check (public.pode_tratar_seguranca(tenant_id));

revoke all on table public.seg_acidentes       from public, anon;
revoke all on table public.seg_acidente_anexos from public, anon;

-- Acidente é registro legal: tudo auditado, inclusive quem mudou o quê.
drop trigger if exists audit_seg_acidentes on public.seg_acidentes;
create trigger audit_seg_acidentes after insert or update or delete on public.seg_acidentes
  for each row execute function public.audit_trigger();

drop trigger if exists audit_seg_acidente_anexos on public.seg_acidente_anexos;
create trigger audit_seg_acidente_anexos after insert or update or delete on public.seg_acidente_anexos
  for each row execute function public.audit_trigger();

/**
 * Encerra o caso. Exige o que faltava: LTI sem data de retorno continua aberto,
 * porque enquanto a pessoa não voltou o caso não acabou.
 */
create or replace function public.seg_encerrar_acidente(p_id uuid, p_retorno date default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_a record;
begin
  select a.* into v_a from public.seg_acidentes a where a.id = p_id;
  if v_a.id is null then
    raise exception 'Acidente não encontrado.';
  end if;
  if not public.pode_tratar_seguranca(v_a.tenant_id) then
    raise exception 'Só a equipe de segurança pode fazer isso.';
  end if;
  if v_a.status = 'encerrado' then
    raise exception 'Este acidente já está encerrado.';
  end if;

  if v_a.classe = 'lti' and coalesce(p_retorno, v_a.retorno_em) is null then
    raise exception 'Informe a data de retorno ao trabalho para encerrar um acidente com afastamento.';
  end if;

  update public.seg_acidentes
     set status = 'encerrado',
         retorno_em = coalesce(p_retorno, retorno_em),
         encerrado_por = (select auth.uid()),
         encerrado_em = now()
   where id = p_id;
end;
$$;

revoke execute on function public.seg_encerrar_acidente(uuid, date) from public, anon;
grant  execute on function public.seg_encerrar_acidente(uuid, date) to authenticated;

/** Reabre o caso quando algo novo aparece (laudo, prorrogação do afastamento). */
create or replace function public.seg_reabrir_acidente(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_a record;
begin
  select a.* into v_a from public.seg_acidentes a where a.id = p_id;
  if v_a.id is null then
    raise exception 'Acidente não encontrado.';
  end if;
  if not public.pode_tratar_seguranca(v_a.tenant_id) then
    raise exception 'Só a equipe de segurança pode fazer isso.';
  end if;

  update public.seg_acidentes
     set status = 'aberto', encerrado_por = null, encerrado_em = null
   where id = p_id;
end;
$$;

revoke execute on function public.seg_reabrir_acidente(uuid) from public, anon;
grant  execute on function public.seg_reabrir_acidente(uuid) to authenticated;

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
