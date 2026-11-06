-- ---------------------------------------------------------------------------
-- RH deixa de ser perfil e vira atribuição (1ª parte de 2).
--
-- O perfil é um só por vínculo, e "RH" competia com Gestor e Gerencial: quem é
-- do DP E chefia gente (Josiane, 06/11/2026) tinha de escolher entre ver a
-- equipe e cuidar do departamento pessoal. Agora o RH é uma marca, como a de
-- gestão de treinamentos, e combina com qualquer perfil.
--
-- Como a regra chega a todo lugar sem reescrever 39 funções e 22 policies:
-- quase todas perguntam `has_tenant_role(..., '{...,hr,...}')` ou
-- `my_role_tenant_ids(...)`. As duas passam a responder "sim" para 'hr' também
-- a quem tem a marca. O que comparava `m.role` direto (os destinatários dos
-- avisos do DP) é ajustado um a um, abaixo.
--
-- Esta parte é aditiva: o perfil 'hr' continua valendo, e quem o tem ganha a
-- marca já. A 2ª parte (depois do app novo no ar) tira o perfil de quem o tem
-- e proíbe o valor dali em diante.
-- ---------------------------------------------------------------------------

-- 1) a marca
alter table public.memberships
  add column if not exists is_hr boolean not null default false;

comment on column public.memberships.is_hr is
  'RH (departamento pessoal). Atribuição, não perfil: combina com qualquer perfil. Só owner/admin concedem.';

-- quem já é RH pelo perfil ganha a marca (os triggers deixam passar: sem auth.uid())
update public.memberships set is_hr = true where role = 'hr' and not is_hr;

-- 2) as duas perguntas centrais passam a enxergar a marca
create or replace function public.has_tenant_role(p_tenant uuid, p_roles member_role[])
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public.is_super_admin() or exists (
    select 1 from public.memberships
    where user_id = auth.uid() and tenant_id = p_tenant
      and (role = any(p_roles) or (is_hr and 'hr' = any(p_roles)))
  );
$function$;

revoke execute on function public.has_tenant_role(uuid, member_role[]) from public, anon;

create or replace function public.my_role_tenant_ids(p_roles member_role[])
 returns setof uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select t.id from public.tenants t where public.is_super_admin()
  union
  select m.tenant_id from public.memberships m
  where m.user_id = (select auth.uid())
    and (m.role = any(p_roles) or (m.is_hr and 'hr' = any(p_roles)));
$function$;

revoke execute on function public.my_role_tenant_ids(member_role[]) from public, anon;

-- 3) quem recebe os avisos do DP: a comparação direta com o perfil vira marca.
-- A troca é feita sobre a definição em vigor, para não reescrever à mão corpos
-- longos (absenteísmo, punição); e falha alto se o trecho não estiver lá.
do $do$
declare
  v_fn text;
  v_def text;
  v_novo text;
begin
  foreach v_fn in array array[
    'public.absenteismo_confirmar(uuid)',
    'public.absenteismo_decidir(uuid, boolean, text)',
    'public.ferias_destinatarios_dp(uuid)',
    'public.punicao_submeter(uuid)',
    'public.recuperacao_avisar_dp(uuid, uuid)'
  ] loop
    v_def := pg_get_functiondef(v_fn::regprocedure);
    v_novo := replace(v_def,
      $q$m.role in ('owner', 'admin', 'hr')$q$,
      $q$(m.role in ('owner', 'admin') or m.is_hr)$q$);
    if v_novo = v_def then
      raise exception 'Trecho do perfil RH não encontrado em %', v_fn;
    end if;
    execute v_novo;
  end loop;

  -- importação: RH nunca veio por planilha; a mensagem agora diz o caminho certo
  v_def := pg_get_functiondef('public.admin_import_employees(jsonb, text)'::regprocedure);
  v_novo := replace(v_def,
    $q$if v_role_txt in ('administrador', 'admin', 'proprietario', 'owner', 'rh', 'hr', 'recursos humanos') then$q$,
    $q$if v_role_txt in ('rh', 'hr', 'recursos humanos') then
            v_errors := v_errors || jsonb_build_object('nome', trim(r->>'full_name'), 'cpf', v_cpf,
              'erro', 'RH não é perfil. Use Gestor, Gerencial ou Funcionário e marque a opção RH no cadastro do colaborador.');
          elsif v_role_txt in ('administrador', 'admin', 'proprietario', 'owner') then$q$);
  if v_novo = v_def then
    raise exception 'Trecho dos perfis recusados não encontrado em admin_import_employees';
  end if;
  execute v_novo;
end
$do$;

revoke execute on function public.absenteismo_confirmar(uuid) from public, anon;
revoke execute on function public.absenteismo_decidir(uuid, boolean, text) from public, anon;
revoke execute on function public.ferias_destinatarios_dp(uuid) from public, anon, authenticated;
revoke execute on function public.punicao_submeter(uuid) from public, anon;
revoke execute on function public.recuperacao_avisar_dp(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.admin_import_employees(jsonb, text) from public, anon;

-- 4) só a administração marca quem é do RH, por qualquer caminho (tela,
-- PostgREST, RPC). Mesmo molde de `so_administracao_concede_treinamentos`.
create or replace function public.so_administracao_concede_rh()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.is_hr)
     or (tg_op = 'UPDATE' and new.is_hr is distinct from old.is_hr) then
    if not public.has_tenant_role(new.tenant_id, '{owner,admin}'::public.member_role[]) then
      raise exception 'Só o proprietário ou um administrador marca quem é do RH';
    end if;
  end if;
  return new;
end;
$function$;

revoke execute on function public.so_administracao_concede_rh() from public, anon, authenticated;

drop trigger if exists memberships_so_administracao_concede_rh on public.memberships;
create trigger memberships_so_administracao_concede_rh
  before insert or update on public.memberships
  for each row execute function public.so_administracao_concede_rh();

notify pgrst, 'reload schema';
