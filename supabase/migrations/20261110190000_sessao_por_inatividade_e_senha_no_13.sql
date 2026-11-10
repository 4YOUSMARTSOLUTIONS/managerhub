-- Sessão encerrada por falta de uso + senha na escolha do 13º (LUIZ, 10/11/2026).
--
-- O mesmo celular passa de um motorista para outro. Quem esquece a sessão
-- aberta deixa as férias e a escolha DEFINITIVA do 13º na mão do próximo.
--
--  1. Tempo sem uso por nível de hierarquia, com padrão da empresa (8 horas
--     quando não configurado). O app conta o uso e o proxy recusa a sessão
--     vencida; aqui mora só a regra.
--  2. Aviso no celular de sessão parada sai sem conteúdo: o aparelho registra
--     o uso (`push_em_uso`) e a rota recebe `sessao_viva`.
--  3. A escolha do 13º exige a senha de quem escolhe, conferida aqui dentro
--     (o app não tem como pular), com trava de 5 erros em 15 minutos.

-- ── 1. tempo sem uso ──────────────────────────────────────────────────────
create table if not exists public.sessao_config (
  id uuid not null default gen_random_uuid() unique,  -- o audit_trigger usa
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  -- null = sem limite
  minutos_padrao int check (minutos_padrao between 5 and 1440),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.sessao_config enable row level security;
revoke all on table public.sessao_config from public, anon, authenticated;

create table if not exists public.sessao_inatividade_nivel (
  id uuid not null default gen_random_uuid() unique,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  hierarchy_level_id uuid not null references public.hierarchy_levels(id) on delete cascade,
  minutos int not null check (minutos between 5 and 1440),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (tenant_id, hierarchy_level_id)
);
alter table public.sessao_inatividade_nivel enable row level security;
revoke all on table public.sessao_inatividade_nivel from public, anon, authenticated;

create trigger audit_sessao_config
  after insert or update or delete on public.sessao_config
  for each row execute function public.audit_trigger();
create trigger audit_sessao_inatividade_nivel
  after insert or update or delete on public.sessao_inatividade_nivel
  for each row execute function public.audit_trigger();

-- regra de uma pessoa: o nível dela, senão o padrão da empresa (8 h sem configuração)
create or replace function public.inatividade_de(p_tenant uuid, p_user uuid)
returns int
language sql stable security definer set search_path to 'public'
as $$
  select coalesce(
    (select s.minutos from sessao_inatividade_nivel s
       join memberships m on m.tenant_id = s.tenant_id and m.hierarchy_level_id = s.hierarchy_level_id
      where s.tenant_id = p_tenant and m.user_id = p_user
      limit 1),
    case when exists (select 1 from sessao_config c where c.tenant_id = p_tenant)
         then (select c.minutos_padrao from sessao_config c where c.tenant_id = p_tenant)
         else 480 end
  );
$$;
-- só para uso interno (outras funções deste arquivo)
revoke execute on function public.inatividade_de(uuid, uuid) from public, anon, authenticated;

-- a do usuário logado (null = sem limite)
create or replace function public.minha_inatividade(p_tenant uuid)
returns int
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if auth.uid() is null or not (is_tenant_member(p_tenant) or is_super_admin()) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  return inatividade_de(p_tenant, auth.uid());
end $$;
revoke execute on function public.minha_inatividade(uuid) from public, anon;

create or replace function public.sessao_listar(p_tenant uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not (
    is_super_admin()
    or has_tenant_role(p_tenant, array['owner', 'admin', 'manager', 'team_lead']::member_role[])
    or exists (select 1 from memberships where tenant_id = p_tenant and user_id = auth.uid() and is_hr)
  ) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'padrao', case when exists (select 1 from sessao_config where tenant_id = p_tenant)
                   then (select to_jsonb(minutos_padrao) from sessao_config where tenant_id = p_tenant)
                   else to_jsonb(480) end,
    'niveis', coalesce((
      select jsonb_agg(jsonb_build_object('nivel', hierarchy_level_id, 'minutos', minutos))
        from sessao_inatividade_nivel where tenant_id = p_tenant), '[]'::jsonb)
  );
end $$;
revoke execute on function public.sessao_listar(uuid) from public, anon;

create or replace function public.sessao_definir_padrao(p_tenant uuid, p_minutos int)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not (is_super_admin() or has_tenant_role(p_tenant, array['owner', 'admin']::member_role[])) then
    raise exception 'Apenas proprietário e administrador definem o tempo da sessão.' using errcode = '42501';
  end if;
  if p_minutos is not null and (p_minutos < 5 or p_minutos > 1440) then
    raise exception 'Escolha entre 5 minutos e 24 horas.' using errcode = '22023';
  end if;
  insert into sessao_config (tenant_id, minutos_padrao, updated_by)
  values (p_tenant, p_minutos, auth.uid())
  on conflict (tenant_id) do update
    set minutos_padrao = excluded.minutos_padrao, updated_at = now(), updated_by = excluded.updated_by;
end $$;
revoke execute on function public.sessao_definir_padrao(uuid, int) from public, anon;

-- null = o nível volta ao padrão da empresa
create or replace function public.sessao_definir_nivel(p_tenant uuid, p_nivel uuid, p_minutos int)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not (is_super_admin() or has_tenant_role(p_tenant, array['owner', 'admin']::member_role[])) then
    raise exception 'Apenas proprietário e administrador definem o tempo da sessão.' using errcode = '42501';
  end if;
  if not exists (select 1 from hierarchy_levels where id = p_nivel and tenant_id = p_tenant) then
    raise exception 'Nível não encontrado nesta empresa.' using errcode = '22023';
  end if;
  if p_minutos is null then
    delete from sessao_inatividade_nivel where tenant_id = p_tenant and hierarchy_level_id = p_nivel;
    return;
  end if;
  if p_minutos < 5 or p_minutos > 1440 then
    raise exception 'Escolha entre 5 minutos e 24 horas.' using errcode = '22023';
  end if;
  insert into sessao_inatividade_nivel (tenant_id, hierarchy_level_id, minutos, updated_by)
  values (p_tenant, p_nivel, p_minutos, auth.uid())
  on conflict (tenant_id, hierarchy_level_id) do update
    set minutos = excluded.minutos, updated_at = now(), updated_by = excluded.updated_by;
end $$;
revoke execute on function public.sessao_definir_nivel(uuid, uuid, int) from public, anon;

-- ── 2. aviso no celular de sessão parada ──────────────────────────────────
alter table public.push_inscricoes add column if not exists ativo_em timestamptz not null default now();

-- o app avisa, no máximo a cada poucos minutos, que o aparelho está em uso
create or replace function public.push_em_uso(p_endpoint text)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if auth.uid() is null then return; end if;
  update push_inscricoes set ativo_em = now() where endpoint = p_endpoint and user_id = auth.uid();
end $$;
revoke execute on function public.push_em_uso(text) from public, anon;

create or replace function public.push_inscrever(p_endpoint text, p_p256dh text, p_auth text, p_aparelho text)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Sessão expirada. Faça login novamente.' using errcode = '42501';
  end if;
  -- só serviços de push conhecidos: a rota faz POST nesse endereço, e um
  -- endereço qualquer viraria o servidor do app chamando quem a pessoa quiser
  if p_endpoint is null or length(p_endpoint) > 1000
     or p_endpoint !~* '^https://([a-z0-9-]+\.)*(googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)/' then
    raise exception 'Serviço de notificação não reconhecido.' using errcode = '22023';
  end if;
  if coalesce(p_p256dh, '') !~ '^[A-Za-z0-9_-]{80,100}=*$' or coalesce(p_auth, '') !~ '^[A-Za-z0-9_-]{16,40}=*$' then
    raise exception 'Chave do aparelho inválida.' using errcode = '22023';
  end if;

  -- o aparelho passa a ser de quem ativou agora (outra pessoa pode ter usado antes)
  insert into push_inscricoes as i (user_id, endpoint, p256dh, auth, aparelho, ativo_em)
  values (v_user, p_endpoint, p_p256dh, p_auth, left(p_aparelho, 120), now())
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        aparelho = excluded.aparelho, ativo_em = now(),
        created_at = case when i.user_id = excluded.user_id then i.created_at else now() end;

  -- teto de 10 aparelhos por pessoa, os mais recentes
  delete from push_inscricoes
   where id in (select id from push_inscricoes where user_id = v_user order by created_at desc offset 10);
end $$;
revoke execute on function public.push_inscrever(text, text, text, text) from public, anon;

-- a saída mudou (sessao_viva): o Postgres exige recriar
drop function if exists public.push_para_enviar(text, uuid[]);
create function public.push_para_enviar(p_segredo text, p_ids uuid[])
returns table (
  notification_id uuid, type text, title text, body text,
  demanda_id uuid, planner_board_id uuid, endpoint text, p256dh text, chave_auth text,
  sessao_viva boolean
)
language plpgsql security definer set search_path to 'public'
as $$
#variable_conflict use_column
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if p_segredo is null or p_segredo is distinct from (
    select decrypted_secret from vault.decrypted_secrets where name = 'push_webhook_segredo'
  ) then
    raise exception 'Chamada recusada.' using errcode = '42501';
  end if;

  return query
  with reivindicadas as (
    insert into push_enviadas (notification_id)
    select n.id from notifications n
     where n.id = any (p_ids[1:1000]) and n.created_at > now() - interval '15 minutes'
    on conflict do nothing
    returning push_enviadas.notification_id
  )
  select n.id, n.type, n.title, n.body, n.demanda_id, n.planner_board_id, s.endpoint, s.p256dh, s.auth,
         -- aparelho parado além do tempo da pessoa: a sessão dela já venceu
         (l.limite is null or s.ativo_em > now() - make_interval(mins => l.limite))
    from reivindicadas r
    join notifications n on n.id = r.notification_id
    join push_inscricoes s on s.user_id = n.user_id
    cross join lateral (select inatividade_de(n.tenant_id, n.user_id) as limite) l;
end $$;
revoke execute on function public.push_para_enviar(text, uuid[]) from public, anon, authenticated;

-- ── 3. senha na escolha do 13º ────────────────────────────────────────────
create table if not exists public.senha_confirmacao_falhas (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  em timestamptz not null default now()
);
create index if not exists senha_confirmacao_falhas_user_idx on public.senha_confirmacao_falhas(user_id, em);
alter table public.senha_confirmacao_falhas enable row level security;
revoke all on table public.senha_confirmacao_falhas from public, anon, authenticated;

-- confere a senha da própria pessoa contra o hash do Auth (bcrypt). Erro NÃO
-- levanta exceção, devolve false: a falha registrada precisa sobreviver.
create or replace function public.senha_confere(p_user uuid, p_senha text)
returns boolean
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_hash text;
begin
  delete from senha_confirmacao_falhas where em < now() - interval '1 day';
  if (select count(*) from senha_confirmacao_falhas
       where user_id = p_user and em > now() - interval '15 minutes') >= 5 then
    raise exception 'Muitas tentativas com a senha errada. Espere 15 minutos e tente de novo.';
  end if;
  select u.encrypted_password into v_hash from auth.users u where u.id = p_user;
  if coalesce(p_senha, '') = '' or coalesce(v_hash, '') = ''
     or extensions.crypt(p_senha, v_hash) is distinct from v_hash then
    insert into senha_confirmacao_falhas (user_id) values (p_user);
    return false;
  end if;
  delete from senha_confirmacao_falhas where user_id = p_user;
  return true;
end $$;
revoke execute on function public.senha_confere(uuid, text) from public, anon, authenticated;

-- A escolha do 13º ganha a senha. Mesmo corpo de antes (20261110120000), com a
-- conferência logo depois do vínculo e o retorno 'ok' / 'senha_incorreta'.
do $$
declare
  v_def text := pg_get_functiondef('public.ferias_escolher_decimo(uuid,integer,boolean)'::regprocedure);
  v_cab text := 'public.ferias_escolher_decimo(p_tenant uuid, p_ano integer, p_quer boolean)';
  v_ret text := E'\n RETURNS void\n';
  v_vinc text := E'    raise exception ''Vínculo não encontrado nesta empresa.'';\n  end if;\n';
  v_fim text := E'\nend;\n$function$';
begin
  if position(v_cab in v_def) = 0 or position(v_ret in v_def) = 0
     or position(v_vinc in v_def) = 0 or position(v_fim in v_def) = 0 then
    raise exception 'ferias_escolher_decimo mudou: âncoras não encontradas';
  end if;
  v_def := replace(v_def, v_cab, 'public.ferias_escolher_decimo(p_tenant uuid, p_ano integer, p_quer boolean, p_senha text)');
  v_def := replace(v_def, v_ret, E'\n RETURNS text\n');
  v_def := replace(v_def, v_vinc, v_vinc || E'  -- celular compartilhado: a escolha é definitiva e sai com a senha de quem escolhe\n'
    || E'  if not public.senha_confere(v_uid, p_senha) then\n    return ''senha_incorreta'';\n  end if;\n');
  v_def := replace(v_def, v_fim, E'\n  return ''ok'';\nend;\n$function$');
  execute v_def;
end $$;
drop function public.ferias_escolher_decimo(uuid, integer, boolean);
revoke execute on function public.ferias_escolher_decimo(uuid, integer, boolean, text) from public, anon;

notify pgrst, 'reload schema';
