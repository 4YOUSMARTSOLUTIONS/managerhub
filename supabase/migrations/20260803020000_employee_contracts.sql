-- Histórico de contratos do colaborador.
--
-- Uma pessoa (CPF) tem UM vínculo vigente por empresa, mas pode ter tido contratos
-- anteriores com outro código (estágio encerrado, recontratação, etc.). Esses contratos
-- ficam aqui e são exibidos na ficha do colaborador, sem interferir no vínculo atual.
--
-- Alimentado pela importação em dois momentos:
--   1) linha da planilha reconhecida como contrato ANTIGO (admissão anterior à do cadastro);
--   2) recontratação: antes de sobrescrever o vínculo, o estado atual é arquivado aqui.

create table if not exists public.employee_contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  employee_code text,
  admission_date date,
  dismissed_at date,
  department_id uuid references public.departments(id) on delete set null,
  subdepartment_id uuid references public.subdepartments(id) on delete set null,
  position_id uuid references public.positions(id) on delete set null,
  position_level_id uuid references public.position_levels(id) on delete set null,
  source text not null default 'import',
  created_at timestamptz not null default now()
);

-- evita duplicar o mesmo contrato ao reimportar a planilha
create unique index if not exists employee_contracts_uidx
  on public.employee_contracts (tenant_id, user_id, coalesce(employee_code, ''), coalesce(admission_date, 'epoch'::date));

create index if not exists employee_contracts_user_idx
  on public.employee_contracts (tenant_id, user_id, admission_date desc);

alter table public.employee_contracts enable row level security;

-- leitura: quem administra a empresa (a ficha do colaborador vive em Configurações)
drop policy if exists employee_contracts_read on public.employee_contracts;
create policy employee_contracts_read on public.employee_contracts
  for select using (public.has_tenant_role(tenant_id, array['owner','admin','manager']::member_role[]));

-- escrita: apenas owner/admin (a importação roda como SECURITY DEFINER)
drop policy if exists employee_contracts_write on public.employee_contracts;
create policy employee_contracts_write on public.employee_contracts
  for all using (public.has_tenant_role(tenant_id, array['owner','admin']::member_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner','admin']::member_role[]));

-- histórico de contratos de um colaborador, com os nomes já resolvidos
create or replace function public.employee_contract_history(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(x order by x.admission_date desc nulls last), '[]'::jsonb)
  from (
    select c.employee_code, c.admission_date, c.dismissed_at,
           d.name as departamento, sd.name as subsetor, po.name as funcao, pl.name as perfil
    from public.employee_contracts c
    left join public.departments d on d.id = c.department_id
    left join public.subdepartments sd on sd.id = c.subdepartment_id
    left join public.positions po on po.id = c.position_id
    left join public.position_levels pl on pl.id = c.position_level_id
    where c.tenant_id = public.my_active_tenant()
      and c.user_id = p_user
      and public.has_tenant_role(c.tenant_id, array['owner','admin','manager']::member_role[])
  ) x;
$function$;
