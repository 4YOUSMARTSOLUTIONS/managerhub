-- Histórico de movimentações do vínculo (registros efetivo-datados).
--
-- Hoje `memberships` guarda só o estado ATUAL: transferir alguém de setor
-- reescreve o passado nas telas (metas e feedbacks antigos passam a exibir o
-- setor novo) e mudar de unidade não deixa rastro nenhum, porque nem
-- `employee_contracts` nem o audit cobrem `membership_units`.
--
-- Este é o desenho padrão de sistemas de RH (registro efetivo-datado, SCD 2):
-- cada MOVIMENTAÇÃO fecha a vigência aberta e abre outra, com data de início e
-- fim. "Onde essa pessoa estava em março" vira um WHERE por intervalo.
--
-- Uma linha por VIGÊNCIA (retrato completo do vínculo), e não uma linha por
-- campo alterado: a consulta point-in-time precisa do retrato inteiro, e o
-- diff campo a campo já existe em `audit_logs`. As unidades entram como array
-- ORDENADO na própria linha: o app sempre as lê como conjunto, e uma tabela
-- filha de história dobraria o trigger sem comprar nada.
--
-- Papéis distintos de `employee_contracts`, que continua igual: contratos são
-- VÍNCULOS ENCERRADOS com outra matrícula (recontratação); aqui são as
-- movimentações DENTRO do vínculo vigente.

create table public.membership_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  effective_from timestamptz not null,
  -- null = vigência atual. Intervalo semiaberto [from, to).
  effective_to timestamptz,
  department_id uuid references public.departments(id) on delete set null,
  subdepartment_id uuid references public.subdepartments(id) on delete set null,
  position_id uuid references public.positions(id) on delete set null,
  position_level_id uuid references public.position_levels(id) on delete set null,
  hierarchy_level_id uuid references public.hierarchy_levels(id) on delete set null,
  manager_id uuid references public.profiles(id) on delete set null,
  role public.member_role not null,
  employee_code text,
  is_active boolean not null,
  dismissed_at date,
  -- retrato ordenado das unidades do vínculo (ordenar torna a comparação de
  -- igualdade entre estado atual e vigência aberta estável)
  unit_ids uuid[] not null default '{}',
  changed_by uuid references public.profiles(id) on delete set null,
  -- 'backfill' = linha sintética criada nesta migração; 'trigger' = movimentação real
  source text not null default 'trigger',
  created_at timestamptz not null default now(),
  constraint membership_history_intervalo check (effective_to is null or effective_to >= effective_from)
);

-- uma única vigência aberta por vínculo
create unique index membership_history_vigente_uidx
  on public.membership_history (membership_id) where effective_to is null;
create index membership_history_user_idx
  on public.membership_history (tenant_id, user_id, effective_from desc);

alter table public.membership_history enable row level security;

-- leitura: administração e RH, a cadeia de gestão, e a própria pessoa
create policy membership_history_select on public.membership_history
  for select using (
    public.has_tenant_role(tenant_id, array['owner','admin','hr']::public.member_role[])
    or public.manages_user(user_id, tenant_id)
    or user_id = (select auth.uid())
  );

-- escrita: NENHUMA policy. Só o trigger SECURITY DEFINER escreve. O revoke é
-- obrigatório porque o ACL padrão do Supabase concede tudo a anon/authenticated
-- em tabela nova de public (AGENTS.md).
revoke all on table public.membership_history from public, anon;
revoke insert, update, delete on table public.membership_history from authenticated;

-- Captura idempotente do estado FINAL do vínculo.
--
-- Chamado por CONSTRAINT TRIGGERs DIFERIDOS (rodam no COMMIT): o
-- `admin_update_employee` faz UPDATE em memberships e depois DELETE+INSERT das
-- MESMAS unidades na mesma transação; triggers imediatos gerariam 3+ versões
-- espúrias por edição. Diferido, a primeira invocação enfileirada grava o
-- retrato final e as seguintes veem estado igual à vigência aberta e não fazem
-- nada. Delete+reinsert das mesmas unidades neta em zero mudança.
create or replace function public.membership_history_capture()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_mid uuid;
  m public.memberships%rowtype;
  v_units uuid[];
  v_open public.membership_history%rowtype;
  v_tem_aberta boolean;
  v_from timestamptz;
begin
  if tg_table_name = 'memberships' then
    v_mid := new.id;
  else
    v_mid := coalesce(new.membership_id, old.membership_id);
  end if;

  select * into m from public.memberships where id = v_mid;
  if not found then
    -- vínculo excluído na mesma transação: a história foi junto pelo cascade
    return null;
  end if;

  select coalesce(array_agg(u.unit_id order by u.unit_id), '{}') into v_units
  from public.membership_units u where u.membership_id = v_mid;

  select * into v_open from public.membership_history h
  where h.membership_id = v_mid and h.effective_to is null;
  v_tem_aberta := found;

  if v_tem_aberta
     and v_open.department_id is not distinct from m.department_id
     and v_open.subdepartment_id is not distinct from m.subdepartment_id
     and v_open.position_id is not distinct from m.position_id
     and v_open.position_level_id is not distinct from m.position_level_id
     and v_open.hierarchy_level_id is not distinct from m.hierarchy_level_id
     and v_open.manager_id is not distinct from m.manager_id
     and v_open.role = m.role
     and v_open.employee_code is not distinct from m.employee_code
     and v_open.is_active = m.is_active
     and v_open.dismissed_at is not distinct from m.dismissed_at
     and v_open.unit_ids = v_units then
    return null; -- nada mudou (ou já capturado nesta transação)
  end if;

  -- data de vigência informada pelo RH via GUC de sessão; sem ela, agora.
  -- O RH informa uma DATA; movimentação vale desde o começo do dia.
  v_from := coalesce(nullif(current_setting('app.mov_effective_date', true), '')::date::timestamptz, now());

  if not v_tem_aberta then
    -- primeira vigência de um vínculo novo começa na admissão
    v_from := coalesce(m.admission_date::timestamptz, v_from);
  else
    if v_from < v_open.effective_from then
      raise exception 'A data de vigência (%) não pode ser anterior ao início da vigência atual (%)',
        v_from::date, v_open.effective_from::date;
    end if;
    update public.membership_history set effective_to = v_from where id = v_open.id;
  end if;

  insert into public.membership_history (
    tenant_id, membership_id, user_id, effective_from,
    department_id, subdepartment_id, position_id, position_level_id,
    hierarchy_level_id, manager_id, role, employee_code, is_active,
    dismissed_at, unit_ids, changed_by, source
  ) values (
    m.tenant_id, m.id, m.user_id, v_from,
    m.department_id, m.subdepartment_id, m.position_id, m.position_level_id,
    m.hierarchy_level_id, m.manager_id, m.role, m.employee_code, m.is_active,
    m.dismissed_at, v_units, (select auth.uid()), 'trigger'
  );
  return null;
end;
$$;

-- helper interno de trigger: ninguém chama direto
revoke execute on function public.membership_history_capture() from public, anon, authenticated;

create constraint trigger membership_history_on_membership
  after insert or update on public.memberships
  deferrable initially deferred
  for each row execute function public.membership_history_capture();

create constraint trigger membership_history_on_units
  after insert or delete on public.membership_units
  deferrable initially deferred
  for each row execute function public.membership_history_capture();

-- Backfill: uma vigência aberta por vínculo existente, começando na admissão
-- (ou na criação do vínculo, quando não há admissão registrada).
insert into public.membership_history (
  tenant_id, membership_id, user_id, effective_from,
  department_id, subdepartment_id, position_id, position_level_id,
  hierarchy_level_id, manager_id, role, employee_code, is_active,
  dismissed_at, unit_ids, changed_by, source
)
select
  m.tenant_id, m.id, m.user_id,
  coalesce(m.admission_date::timestamptz, m.created_at),
  m.department_id, m.subdepartment_id, m.position_id, m.position_level_id,
  m.hierarchy_level_id, m.manager_id, m.role, m.employee_code, m.is_active,
  m.dismissed_at,
  coalesce(u.ids, '{}'), null, 'backfill'
from public.memberships m
left join lateral (
  select array_agg(x.unit_id order by x.unit_id) as ids
  from public.membership_units x where x.membership_id = m.id
) u on true;

-- Linha do tempo para a ficha do colaborador, com os nomes resolvidos.
-- Molde de `employee_contract_history`, com a guarda ampliada: RH e a própria
-- pessoa também enxergam (a mesma regra da policy de select).
create or replace function public.employee_movement_history(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(x order by x.effective_from desc), '[]'::jsonb)
  from (
    select h.effective_from, h.effective_to, h.source, h.employee_code,
           h.is_active, h.dismissed_at,
           d.name as setor, sd.name as subsetor,
           po.name as funcao, pl.name as nivel,
           hl.name as hierarquia, h.role::text as perfil,
           pg.full_name as gestor,
           coalesce((
             select array_agg(u.name order by u.name)
             from public.units u where u.id = any(h.unit_ids)
           ), '{}') as unidades,
           pc.full_name as alterado_por
    from public.membership_history h
    left join public.departments d on d.id = h.department_id
    left join public.subdepartments sd on sd.id = h.subdepartment_id
    left join public.positions po on po.id = h.position_id
    left join public.position_levels pl on pl.id = h.position_level_id
    left join public.hierarchy_levels hl on hl.id = h.hierarchy_level_id
    left join public.profiles pg on pg.id = h.manager_id
    left join public.profiles pc on pc.id = h.changed_by
    where h.tenant_id = public.my_active_tenant()
      and h.user_id = p_user
      and (
        public.has_tenant_role(h.tenant_id, array['owner','admin','hr','manager']::public.member_role[])
        or public.manages_user(p_user, h.tenant_id)
        or p_user = (select auth.uid())
      )
  ) x;
$function$;

revoke execute on function public.employee_movement_history(uuid) from public, anon;
grant execute on function public.employee_movement_history(uuid) to authenticated;
