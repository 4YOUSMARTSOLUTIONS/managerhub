-- Matrícula única POR UNIDADE, não por empresa.
--
-- O índice memberships_emp_code_key impunha matrícula única no tenant inteiro,
-- e o modelo decidido é outro: o SaaS atende empresas em que a MESMA matrícula
-- existe em unidades diferentes (pessoas diferentes), e a identificação nas
-- planilhas é por unidade + matrícula. O que não pode existir é a mesma
-- matrícula DUAS vezes dentro da MESMA unidade, porque aí nem unidade +
-- matrícula resolve.
--
-- Como as unidades do vínculo vivem em `membership_units` (N:N), essa regra
-- não cabe num índice único; vira trigger nas duas pontas: ao ligar um vínculo
-- a uma unidade, e ao trocar a matrícula de um vínculo já ligado.
--
-- A função NÃO é security definer de propósito: toda escrita nessas tabelas
-- passa pelas RPCs administrativas (que são secdef), então a checagem roda com
-- visão completa; e sem secdef ela fica fora da superfície que o revoke de
-- anon precisa vigiar. `returns trigger` tampouco é chamável pelo PostgREST.

drop index if exists public.memberships_emp_code_key;

create or replace function public.guard_matricula_unidade()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_code text;
  v_tenant uuid;
begin
  if tg_table_name = 'membership_units' then
    select employee_code, tenant_id into v_code, v_tenant
      from public.memberships where id = new.membership_id;
    if v_code is null then return new; end if;
    if exists (
      select 1 from public.memberships m
      join public.membership_units mu on mu.membership_id = m.id and mu.unit_id = new.unit_id
      where m.tenant_id = v_tenant and m.employee_code = v_code and m.id <> new.membership_id
    ) then
      raise exception 'Matrícula % já usada por outro colaborador nesta unidade', v_code;
    end if;
    return new;
  end if;

  -- memberships: a matrícula nova tem de estar livre em TODAS as unidades do vínculo
  if new.employee_code is null then return new; end if;
  if exists (
    select 1 from public.memberships m
    join public.membership_units mu on mu.membership_id = m.id
    join public.membership_units minha on minha.membership_id = new.id and minha.unit_id = mu.unit_id
    where m.tenant_id = new.tenant_id and m.employee_code = new.employee_code and m.id <> new.id
  ) then
    raise exception 'Matrícula % já usada por outro colaborador nesta unidade', new.employee_code;
  end if;
  return new;
end $$;

drop trigger if exists guard_matricula_unidade_mu on public.membership_units;
create trigger guard_matricula_unidade_mu
  before insert on public.membership_units
  for each row execute function public.guard_matricula_unidade();

drop trigger if exists guard_matricula_unidade_m on public.memberships;
create trigger guard_matricula_unidade_m
  before insert or update of employee_code on public.memberships
  for each row execute function public.guard_matricula_unidade();

-- o EXECUTE de trigger é conferido na criação do trigger, não no disparo:
-- revogar depois não quebra o disparo e tira a função da superfície pública
revoke execute on function public.guard_matricula_unidade() from public, anon, authenticated;

-- consulta de manutenção do índice que saiu: busca por matrícula na importação
create index if not exists idx_memberships_tenant_emp_code
  on public.memberships (tenant_id, employee_code)
  where employee_code is not null;
