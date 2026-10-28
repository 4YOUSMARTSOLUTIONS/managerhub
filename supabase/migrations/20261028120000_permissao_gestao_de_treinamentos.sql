-- Permissão "Gestão de treinamentos", marcada na ficha, independente do papel.
--
-- Quem cuida de treinamento na empresa costuma ser uma analista, sem perfil de
-- acesso especial. As alternativas não serviam: o perfil RH levaria junto CPF,
-- telefone, absenteísmos, punições e a importação de colaboradores; um perfil
-- novo obrigaria a decidir o menu inteiro dela; e ser "responsável" treinamento
-- a treinamento não deixa criar curso nem trilha.
--
-- O padrão já existia: `is_ticket_manager` é uma capacidade na ficha, ortogonal
-- ao papel. Esta é a mesma ideia para treinamentos: quem tem a marca faz no
-- módulo exatamente o que o RH faz, e nada fora dele.

alter table public.memberships
  add column if not exists is_training_manager boolean not null default false;

comment on column public.memberships.is_training_manager is
  'Gestão de treinamentos: faz no módulo de treinamentos o que o RH faz (cursos, trilhas, turmas, provas, convocação, acompanhamento). Só owner/admin concede.';

-- ---------------------------------------------------------------------------
-- O ponto único da regra
-- ---------------------------------------------------------------------------
-- Antes cada policy e cada função repetia "owner, admin ou hr". Agora todas
-- perguntam a esta, e a marca entra num lugar só.
create or replace function public.gere_treinamentos(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.has_tenant_role(p_tenant, '{owner,admin,hr}'::public.member_role[])
      or exists (
           select 1 from public.memberships m
            where m.tenant_id = p_tenant
              and m.user_id = (select auth.uid())
              and m.is_active
              and m.is_training_manager
         );
$function$;

-- usada dentro de policies, então `authenticated` precisa executar; a guarda é
-- o próprio corpo (só responde sobre o usuário que pergunta)
revoke execute on function public.gere_treinamentos(uuid) from public, anon;

create or replace function public.pode_gerir_treinamento(p_training uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.trainings t
     where t.id = p_training
       and public.is_tenant_member(t.tenant_id)
       and (
         public.gere_treinamentos(t.tenant_id)
         or exists (select 1 from public.training_owners o
                     where o.training_id = t.id and o.user_id = (select auth.uid()))
       )
  );
$function$;
revoke execute on function public.pode_gerir_treinamento(uuid) from public, anon;

create or replace function public.pode_gerir_trilha(p_path uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.training_paths p
     where p.id = p_path
       and public.is_tenant_member(p.tenant_id)
       and public.gere_treinamentos(p.tenant_id)
  );
$function$;
revoke execute on function public.pode_gerir_trilha(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- As três policies que perguntavam o papel direto
-- ---------------------------------------------------------------------------
-- As demais (conteúdo, provas, tentativas, certificados, progresso, turmas) já
-- passavam por `pode_gerir_treinamento` ou `pode_gerir_turma`, então herdam a
-- marca sem mudança.
alter policy trainings_insert on public.trainings
  with check (public.is_tenant_member(tenant_id) and public.gere_treinamentos(tenant_id));

alter policy training_paths_insert on public.training_paths
  with check (public.is_tenant_member(tenant_id) and public.gere_treinamentos(tenant_id));

alter policy training_enrollments_select on public.training_enrollments
  using (
    public.is_tenant_member(tenant_id)
    and (
      user_id = (select auth.uid())
      or public.manages_user(user_id, tenant_id)
      or public.gere_treinamentos(tenant_id)
      or exists (select 1 from public.training_owners o
                  where o.training_id = training_enrollments.training_id
                    and o.user_id = (select auth.uid()))
    )
  );

-- ---------------------------------------------------------------------------
-- Quem concede
-- ---------------------------------------------------------------------------
-- O RH tem UPDATE em `memberships` (corrige cadastro) e, sem esta trava,
-- poderia marcar a si mesmo ou a qualquer um pelo PostgREST. Conceder acesso é
-- da administração, como o perfil (ver `rh_nao_define_papel`). Escrita sem
-- usuário (chave de serviço, migração, rotina agendada) passa: é o servidor.
create or replace function public.so_administracao_concede_treinamentos()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.is_training_manager)
     or (tg_op = 'UPDATE' and new.is_training_manager is distinct from old.is_training_manager) then
    if not public.has_tenant_role(new.tenant_id, '{owner,admin}'::public.member_role[]) then
      raise exception 'Só o proprietário ou um administrador concede a gestão de treinamentos';
    end if;
  end if;
  return new;
end;
$function$;

revoke execute on function public.so_administracao_concede_treinamentos() from public, anon, authenticated;

drop trigger if exists memberships_so_administracao_concede_treinamentos on public.memberships;
create trigger memberships_so_administracao_concede_treinamentos
  before insert or update on public.memberships
  for each row execute function public.so_administracao_concede_treinamentos();

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
