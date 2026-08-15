-- Segurança: quem é a equipe de segurança do trabalho.
--
-- O módulo tem duas plateias muito diferentes. A operação inteira RELATA; um
-- punhado de gente TRIA, alerta o gestor e cadastra acidente. Esse punhado não
-- cabe no enum de papéis do sistema (`member_role`): o técnico de segurança
-- costuma ser um `member` comum, e criar um papel novo mexeria em toda a
-- hierarquia por causa de uma tela.
--
-- O molde é o `ticket_manager_sectors`, sem a dimensão de setor: aqui não há o
-- que recortar, quem é da segurança vê a empresa toda.
--
-- Duas funções, de propósito:
--   `is_safety_member`      = está na lista, e só isso.
--   `pode_tratar_seguranca` = está na lista OU é owner/admin.
-- As policies das levas seguintes chamam a segunda; a primeira existe para a
-- tela conseguir dizer "você é da equipe" sem confundir com "você é admin".

create table public.seg_equipe (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index seg_equipe_user_idx on public.seg_equipe (user_id);

alter table public.seg_equipe enable row level security;

-- Quem é da segurança não é segredo: o relator precisa saber a quem seu relato
-- chega, e a tela mostra "triado por" para a própria equipe.
create policy seg_equipe_select on public.seg_equipe
  for select using (tenant_id in (select public.my_tenant_ids()));

create policy seg_equipe_write on public.seg_equipe
  for all
  using      (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])));

revoke all on table public.seg_equipe from public, anon;

drop trigger if exists audit_seg_equipe on public.seg_equipe;
create trigger audit_seg_equipe after insert or update or delete on public.seg_equipe
  for each row execute function public.audit_trigger();

/** Está na lista da equipe de segurança da empresa. */
create or replace function public.is_safety_member(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.seg_equipe e
     where e.tenant_id = p_tenant and e.user_id = (select auth.uid())
  );
$$;

revoke execute on function public.is_safety_member(uuid) from public, anon;
grant  execute on function public.is_safety_member(uuid) to authenticated;

/** Alcance de tratativa: a equipe de segurança mais a administração da empresa. */
create or replace function public.pode_tratar_seguranca(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.is_safety_member(p_tenant)
      or public.has_tenant_role(p_tenant, '{owner,admin}'::public.member_role[]);
$$;

revoke execute on function public.pode_tratar_seguranca(uuid) from public, anon;
grant  execute on function public.pode_tratar_seguranca(uuid) to authenticated;

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
