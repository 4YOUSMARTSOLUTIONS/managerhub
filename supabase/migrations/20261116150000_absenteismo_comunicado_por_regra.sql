-- Comunicado de absenteísmo por hierarquia e por cargo (LUIZ, 16/11/2026).
--
-- A lista de destinatários era só de e-mails, cadastrados um a um. Agora cada
-- linha é uma regra:
--   * 'email'      o de sempre, para quem está fora do sistema;
--   * 'hierarquia' um nível (Gerência, Supervisão...), com dois alcances:
--                  'cadeia'  só quem tem esse nível ACIMA do colaborador na
--                            cadeia de gestão (o gerente da área, não todos);
--                  'unidade' todos desse nível na unidade do lançamento;
--   * 'cargo'      todos os ativos com a função (da unidade da regra, se houver).
-- A unidade da regra continua dizendo de quais lançamentos ela vale.
--
-- E, fora das regras, SEMPRE recebem: o gestor imediato do cadastro atual, o
-- gestor carimbado no lançamento e quem lançou (decisão do LUIZ). As regras são
-- resolvidas a cada envio, pelo cadastro do momento.

-- ---------------------------------------------------------------------------
-- 1. a regra
-- ---------------------------------------------------------------------------
alter table public.absenteismo_email_recipients
  add column tipo text not null default 'email',
  add column hierarchy_level_id uuid references public.hierarchy_levels(id) on delete cascade,
  add column alcance text,
  add column position_id uuid references public.positions(id) on delete cascade,
  alter column email drop not null;

alter table public.absenteismo_email_recipients
  drop constraint absenteismo_dest_email_valido,
  add constraint absenteismo_dest_email_valido
    check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  add constraint absenteismo_dest_tipo check (
       (tipo = 'email' and email is not null
          and hierarchy_level_id is null and alcance is null and position_id is null)
    or (tipo = 'hierarquia' and email is null
          and hierarchy_level_id is not null and alcance in ('cadeia', 'unidade') and position_id is null)
    or (tipo = 'cargo' and email is null
          and position_id is not null and hierarchy_level_id is null and alcance is null));

create unique index absenteismo_dest_hierarquia_uk
  on public.absenteismo_email_recipients (tenant_id, unit_id, hierarchy_level_id, alcance) nulls not distinct
  where tipo = 'hierarquia';
create unique index absenteismo_dest_cargo_uk
  on public.absenteismo_email_recipients (tenant_id, unit_id, position_id) nulls not distinct
  where tipo = 'cargo';

comment on column public.absenteismo_email_recipients.tipo is
  'email = endereço avulso; hierarquia = um nível (com alcance); cargo = uma função.';
comment on column public.absenteismo_email_recipients.alcance is
  'Só na hierarquia: cadeia = o superior do colaborador nesse nível; unidade = todos do nível na unidade do lançamento.';

-- ---------------------------------------------------------------------------
-- 2. o e-mail de contato de uma pessoa
-- ---------------------------------------------------------------------------
-- profiles.email nulo NÃO é "sem e-mail": a maioria só tem o de acesso
-- (auth.users). O sintético do login por CPF não existe e volta.
create or replace function public.email_de_contato(p_user uuid)
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case when e ~* '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then e end
    from (
      select lower(btrim(coalesce(
               nullif(btrim(p.email), ''),
               case when u.email ilike '%@cpf.managerhub.local' then null else u.email end))) as e
        from public.profiles p
        left join auth.users u on u.id = p.id
       where p.id = p_user
    ) x;
$function$;

-- helper interno: só as funções abaixo chamam (sob o dono)
revoke execute on function public.email_de_contato(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. quem recebe o comunicado deste lançamento (chamada do servidor)
-- ---------------------------------------------------------------------------
create or replace function public.absenteismo_destinatarios(p_lancamento uuid)
 returns table(email text, nome text, origem text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  -- só o servidor (service role) monta a lista: ela traz e-mail pessoal
  if coalesce(auth.role(), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Sem permissão';
  end if;

  return query
  with recursive
  l as (
    select a.* from public.absenteismo_lancamentos a where a.id = p_lancamento
  ),
  regras as (
    select r.* from public.absenteismo_email_recipients r, l
     where r.tenant_id = l.tenant_id and r.active
       and (r.unit_id is null or r.unit_id = l.snap_unit_id)
  ),
  ativos as (
    select m.* from public.memberships m, l
     where m.tenant_id = l.tenant_id and m.is_active
  ),
  -- os superiores do colaborador, pela cadeia de gestores do cadastro
  cadeia(user_id, passo) as (
    select m.manager_id, 1
      from public.memberships m, l
     where m.tenant_id = l.tenant_id and m.user_id = l.user_id and m.manager_id is not null
    union
    select m.manager_id, c.passo + 1
      from cadeia c
      join l on true
      join public.memberships m on m.tenant_id = l.tenant_id and m.user_id = c.user_id
     where m.manager_id is not null and c.passo < 15
  ),
  pessoas(user_id, origem, prioridade) as (
    -- sempre: o gestor do cadastro, o carimbado no lançamento e quem lançou
    select m.manager_id, 'gestor', 1
      from public.memberships m, l
     where m.tenant_id = l.tenant_id and m.user_id = l.user_id and m.manager_id is not null
    union all
    select l.snap_manager_id, 'gestor', 1 from l where l.snap_manager_id is not null
    union all
    select l.created_by, 'lancou', 2 from l where l.created_by is not null
    union all
    -- hierarquia, só o superior
    select a.user_id, 'hierarquia', 3
      from regras r
      join ativos a on a.hierarchy_level_id = r.hierarchy_level_id
      join cadeia c on c.user_id = a.user_id
     where r.tipo = 'hierarquia' and r.alcance = 'cadeia'
    union all
    -- hierarquia, todos da unidade do lançamento
    select a.user_id, 'hierarquia', 3
      from regras r
      join l on true
      join ativos a on a.hierarchy_level_id = r.hierarchy_level_id
     where r.tipo = 'hierarquia' and r.alcance = 'unidade'
       and exists (select 1 from public.membership_units mu
                    where mu.membership_id = a.id and mu.unit_id = l.snap_unit_id)
    union all
    -- cargo: quem tem a função (na unidade da regra, se ela tiver uma)
    select a.user_id, 'cargo', 3
      from regras r
      join ativos a on a.position_id = r.position_id
     where r.tipo = 'cargo'
       and (r.unit_id is null or exists (select 1 from public.membership_units mu
                                          where mu.membership_id = a.id and mu.unit_id = r.unit_id))
  ),
  validas as (
    select p.user_id, p.origem, p.prioridade
      from pessoas p, l
     where p.user_id is not null
       -- o próprio ausente não recebe o aviso sobre ele
       and p.user_id <> l.user_id
       -- desligado não recebe (quem não tem vínculo, como o administrador da plataforma, recebe)
       and not exists (select 1 from public.memberships m
                        where m.tenant_id = l.tenant_id and m.user_id = p.user_id and not m.is_active)
  ),
  todos as (
    select public.email_de_contato(v.user_id) as email, pr.full_name as nome, v.origem, v.prioridade
      from validas v
      join public.profiles pr on pr.id = v.user_id
    union all
    select lower(btrim(r.email)), r.name, 'email', 4
      from regras r
     where r.tipo = 'email' and r.email is not null
  )
  select distinct on (t.email) t.email, t.nome, t.origem
    from todos t
   where t.email is not null
   order by t.email, t.prioridade;
end;
$function$;

revoke execute on function public.absenteismo_destinatarios(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. quem cada regra alcança hoje (tela de Configurações, do DP)
-- ---------------------------------------------------------------------------
-- Não devolve o e-mail, só se a pessoa tem um. regra_id nulo = os gestores
-- (a linha fixa da tela).
create or replace function public.absenteismo_alcance_das_regras(p_tenant uuid)
 returns table(regra_id uuid, user_id uuid, nome text, tem_email boolean)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not public.has_tenant_role(p_tenant, '{owner,admin,hr}'::public.member_role[]) then
    raise exception 'Apenas proprietário, administrador e RH veem os destinatários.' using errcode = '42501';
  end if;

  return query
  with ativos as (
    select m.* from public.memberships m where m.tenant_id = p_tenant and m.is_active
  ),
  alcance(regra_id, user_id) as (
    -- hierarquia: quem tem o nível (filtrado pela unidade da regra, se houver)
    select r.id, a.user_id
      from public.absenteismo_email_recipients r
      join ativos a on a.hierarchy_level_id = r.hierarchy_level_id
     where r.tenant_id = p_tenant and r.tipo = 'hierarquia'
       and (r.unit_id is null or exists (select 1 from public.membership_units mu
                                          where mu.membership_id = a.id and mu.unit_id = r.unit_id))
    union all
    select r.id, a.user_id
      from public.absenteismo_email_recipients r
      join ativos a on a.position_id = r.position_id
     where r.tenant_id = p_tenant and r.tipo = 'cargo'
       and (r.unit_id is null or exists (select 1 from public.membership_units mu
                                          where mu.membership_id = a.id and mu.unit_id = r.unit_id))
    union all
    -- os gestores imediatos de quem está ativo
    select distinct null::uuid, a.manager_id
      from ativos a
     where a.manager_id is not null
       and exists (select 1 from ativos g where g.user_id = a.manager_id)
  )
  select x.regra_id, x.user_id, p.full_name, public.email_de_contato(x.user_id) is not null
    from alcance x
    join public.profiles p on p.id = x.user_id;
end;
$function$;

revoke execute on function public.absenteismo_alcance_das_regras(uuid) from public, anon;
grant execute on function public.absenteismo_alcance_das_regras(uuid) to authenticated;

notify pgrst, 'reload schema';
