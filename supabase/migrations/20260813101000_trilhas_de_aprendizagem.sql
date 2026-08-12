-- Trilhas de aprendizagem: programas que encadeiam cursos do catálogo em ordem.
--
-- O caso que motivou: a integração de um novo colaborador não é um curso, é
-- quatro, numa ordem que importa. Hoje isso vira quatro regras soltas, e
-- ninguém consegue responder "o João já terminou a integração?" sem conferir
-- quatro linhas uma a uma.
--
-- A trilha REFERENCIA o catálogo, não copia. `training_path_steps` aponta para
-- `trainings`, então o mesmo curso continua existindo avulso, pode estar em
-- várias trilhas, e todo o maquinário que já existe (materiais, provas, turmas,
-- certificado, recertificação) segue funcionando sem uma linha de mudança: a
-- matrícula continua sendo de um CURSO. A trilha só diz quais, em que ordem e
-- para quem.
--
-- `training_path_rules` repete o shape polimórfico de
-- `training_assignment_rules` (kind + ref_id, sem FK) em vez de reaproveitar a
-- tabela do curso. São perguntas diferentes: uma diz quem deve fazer AQUELE
-- curso, a outra quem deve cumprir O PROGRAMA. Misturá-las obrigaria a
-- distinguir por uma coluna nula e a torcer para ninguém esquecer o filtro.
--
-- PRAZO ÚNICO. `training_paths.prazo_dias` vale para todos os passos: a data
-- que a empresa cobra é a do programa ("integração completa em 30 dias"), e
-- fatiar o prazo por passo criaria atraso intermediário mesmo quando o total
-- ainda cabe. Sem prazo na trilha, cada passo cai no prazo do próprio curso.

create table public.training_paths (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  /** prazo do PROGRAMA, em dias a partir da atribuição; null = usa o do curso */
  prazo_dias smallint check (prazo_dias is null or prazo_dias > 0),
  active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index training_paths_tenant_idx
  on public.training_paths (tenant_id) where deleted_at is null;

-- O passo. `sort` é reescrito por inteiro a cada save (molde de
-- `checklist_items`): a ordem visual da tela É a ordem persistida.
create table public.training_path_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  path_id uuid not null references public.training_paths(id) on delete cascade,
  training_id uuid not null references public.trainings(id) on delete cascade,
  sort integer not null default 0,
  /**
   * Passo opcional não trava os seguintes nem entra na conta de "trilha
   * completa". Serve para o material de apoio que a empresa quer oferecer
   * dentro do programa sem torná-lo condição.
   */
  required boolean not null default true,
  created_at timestamptz not null default now(),
  -- o mesmo curso duas vezes na mesma trilha não é ordem, é engano
  unique (path_id, training_id)
);
create index training_path_steps_path_idx on public.training_path_steps (path_id, sort);

create table public.training_path_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  path_id uuid not null references public.training_paths(id) on delete cascade,
  kind text not null check (kind in ('user', 'position', 'department', 'subdepartment', 'unit')),
  ref_id uuid not null,
  mandatory boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (path_id, kind, ref_id)
);
create index training_path_rules_path_idx on public.training_path_rules (path_id) where active;

-- De qual trilha a matrícula veio. `on delete set null` de propósito: excluir a
-- trilha não pode apagar o histórico de quem já fez os cursos dela.
--
-- Não existe coluna de posição aqui: a ordem mora em `training_path_steps`, e
-- reordenar a trilha não deve sair atualizando matrícula de ninguém.
alter table public.training_enrollments
  add column path_id uuid references public.training_paths(id) on delete set null;
create index training_enrollments_path_idx
  on public.training_enrollments (path_id) where path_id is not null;

-- ---------------------------------------------------------------- helper
-- Trilha é desenho de programa de formação, decisão de RH: sem responsáveis
-- próprios por enquanto, o mesmo grupo que cadastra treinamento cadastra trilha.
create or replace function public.pode_gerir_trilha(p_path uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.training_paths p
     where p.id = p_path
       and public.is_tenant_member(p.tenant_id)
       and public.has_tenant_role(p.tenant_id, '{owner,admin,hr}'::public.member_role[])
  );
$$;

revoke execute on function public.pode_gerir_trilha(uuid) from public, anon;
grant execute on function public.pode_gerir_trilha(uuid) to authenticated;

-- ---------------------------------------------------------------- RLS
alter table public.training_paths enable row level security;
alter table public.training_path_steps enable row level security;
alter table public.training_path_rules enable row level security;

-- todo mundo da empresa enxerga o programa: o colaborador precisa ver o nome da
-- trilha e a ordem dos passos na própria tela
create policy training_paths_select on public.training_paths
  for select using (public.is_tenant_member(tenant_id));
-- insert olha o PAPEL, não a linha: a trilha ainda não existe para
-- `pode_gerir_trilha` consultar
create policy training_paths_insert on public.training_paths
  for insert with check (
    public.is_tenant_member(tenant_id)
    and public.has_tenant_role(tenant_id, '{owner,admin,hr}'::public.member_role[])
  );
create policy training_paths_update on public.training_paths
  for update using (public.pode_gerir_trilha(id))
  with check (public.pode_gerir_trilha(id));
create policy training_paths_delete on public.training_paths
  for delete using (public.pode_gerir_trilha(id));

create policy training_path_steps_select on public.training_path_steps
  for select using (public.is_tenant_member(tenant_id));
create policy training_path_steps_write on public.training_path_steps
  for all using (public.pode_gerir_trilha(path_id))
  with check (public.pode_gerir_trilha(path_id));

create policy training_path_rules_select on public.training_path_rules
  for select using (public.is_tenant_member(tenant_id));
create policy training_path_rules_write on public.training_path_rules
  for all using (public.pode_gerir_trilha(path_id))
  with check (public.pode_gerir_trilha(path_id));

-- O ACL padrão do Supabase concede tudo em tabela nova de `public`; sem estes
-- revokes a RLS seria a única barreira (AGENTS.md).
revoke all on table public.training_paths from public, anon;
revoke all on table public.training_path_steps from public, anon;
revoke all on table public.training_path_rules from public, anon;

do $$
declare t text;
begin
  foreach t in array array['training_paths','training_path_steps','training_path_rules'] loop
    execute format(
      'drop trigger if exists %I on public.%I; create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_trigger();',
      'audit_' || t, t, 'audit_' || t, t);
  end loop;
end $$;

-- a verificação do AGENTS.md, no próprio corpo da migração
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
