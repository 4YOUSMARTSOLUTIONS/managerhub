-- Sugestões (LUIZ, 18/11/2026): os usuários sugerem melhorias para o portal,
-- curtem e comentam as sugestões dos outros, e o Proprietário faz a triagem.
--
-- Decisões dele:
--   * comunidade ÚNICA entre empresas: as tabelas não têm recorte por empresa;
--     cada registro guarda a empresa do autor e um carimbo do nome, porque a
--     regra de profiles não deixa uma empresa ler o cadastro de outra;
--   * todos participam, inclusive o Operacional (a tela fica fora do acesso
--     por nível, no app);
--   * triagem só do Proprietário (mesma regra do Banco de conhecimento);
--   * autor sempre com o nome;
--   * um aviso por sugestão nova para a triagem (sem resumo diário).
--
-- Toda escrita passa por função SECURITY DEFINER com guarda no corpo: o cliente
-- só LÊ as tabelas. Isso mantém carimbo, contadores e avisos coerentes e impede
-- gravar em nome de outra pessoa.

create type public.sugestao_status as enum (
  'nova', 'em_analise', 'planejada', 'em_desenvolvimento', 'entregue', 'recusada', 'duplicada'
);

create table public.sugestoes (
  id uuid primary key default gen_random_uuid(),
  -- empresa do autor (nulo = equipe da plataforma, sem vínculo)
  tenant_id uuid references public.tenants(id) on delete set null,
  autor_id uuid references auth.users(id) on delete set null,
  autor_nome text not null,
  empresa_nome text not null,
  titulo text not null check (char_length(btrim(titulo)) between 5 and 120),
  descricao text not null check (char_length(btrim(descricao)) between 10 and 4000),
  -- key de src/lib/modules.ts; nulo = geral / módulo novo
  modulo text,
  -- arquivos no bucket "sugestoes" (<user_id>/<arquivo>)
  imagens text[] not null default '{}' check (cardinality(imagens) <= 3),
  status public.sugestao_status not null default 'nova',
  status_em timestamptz not null default now(),
  -- resposta oficial da triagem, destacada na ficha
  resposta text check (resposta is null or char_length(resposta) <= 4000),
  resposta_em timestamptz,
  resposta_por_nome text,
  duplicada_de uuid references public.sugestoes(id) on delete set null,
  -- artigo do Banco de conhecimento quando entregue
  artigo_slug text,
  oculta boolean not null default false,
  oculta_motivo text,
  curtidas integer not null default 0,
  comentarios integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sugestoes_status_idx on public.sugestoes (status, created_at desc);
create index sugestoes_autor_idx on public.sugestoes (autor_id);

create table public.sugestao_curtidas (
  sugestao_id uuid not null references public.sugestoes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_nome text not null,
  empresa_nome text not null,
  created_at timestamptz not null default now(),
  primary key (sugestao_id, user_id)
);
create index sugestao_curtidas_quando_idx on public.sugestao_curtidas (created_at);
create index sugestao_curtidas_user_idx on public.sugestao_curtidas (user_id);

create table public.sugestao_comentarios (
  id uuid primary key default gen_random_uuid(),
  sugestao_id uuid not null references public.sugestoes(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  autor_id uuid references auth.users(id) on delete set null,
  autor_nome text not null,
  empresa_nome text not null,
  -- nulo quando a moderação oculta; o texto vai para texto_moderado, que não
  -- tem grant de leitura
  texto text check (texto is null or char_length(btrim(texto)) between 1 and 2000),
  texto_moderado text,
  oculto boolean not null default false,
  editado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sugestao_comentarios_sug_idx on public.sugestao_comentarios (sugestao_id, created_at);

create table public.sugestao_seguidores (
  sugestao_id uuid not null references public.sugestoes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- false = deixou de seguir (e não volta a seguir sozinho ao curtir/comentar)
  segue boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (sugestao_id, user_id)
);
create index sugestao_seguidores_user_idx on public.sugestao_seguidores (user_id);

-- ---------------------------------------------------------------------------
-- Quem participa e quem faz a triagem
-- ---------------------------------------------------------------------------

create or replace function public.participa_sugestoes()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.is_super_admin()
      or exists (select 1 from public.memberships m where m.user_id = (select auth.uid()) and m.is_active);
$$;

-- triagem: o Proprietário (e o dono da plataforma), como no Banco de conhecimento
create or replace function public.pode_triar_sugestoes()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.is_super_admin()
      or exists (
        select 1 from public.memberships m
        where m.user_id = (select auth.uid()) and m.role = 'owner' and m.is_active
      );
$$;

-- ---------------------------------------------------------------------------
-- Leitura: o cliente só lê; escrita só pelas funções abaixo
-- ---------------------------------------------------------------------------

alter table public.sugestoes enable row level security;
alter table public.sugestao_curtidas enable row level security;
alter table public.sugestao_comentarios enable row level security;
alter table public.sugestao_seguidores enable row level security;

revoke all on table public.sugestoes, public.sugestao_curtidas, public.sugestao_comentarios, public.sugestao_seguidores
  from public, anon, authenticated;
grant select on table public.sugestoes, public.sugestao_curtidas, public.sugestao_seguidores to authenticated;
-- o texto que a moderação ocultou não é legível pelo cliente
grant select (id, sugestao_id, tenant_id, autor_id, autor_nome, empresa_nome, texto, oculto, editado_em, created_at, updated_at)
  on table public.sugestao_comentarios to authenticated;

create policy sugestoes_ler on public.sugestoes for select to authenticated
  using ((select public.participa_sugestoes())
         and (not oculta or autor_id = (select auth.uid()) or (select public.pode_triar_sugestoes())));

create policy sugestao_curtidas_ler on public.sugestao_curtidas for select to authenticated
  using ((select public.participa_sugestoes()));

create policy sugestao_comentarios_ler on public.sugestao_comentarios for select to authenticated
  using ((select public.participa_sugestoes()));

-- quem segue o quê é dado da própria pessoa
create policy sugestao_seguidores_ler on public.sugestao_seguidores for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Ajudantes internos (sem grant: só as funções abaixo chamam)
-- ---------------------------------------------------------------------------

-- empresa (primeiro vínculo ativo), nome da pessoa e nome da empresa
create or replace function public.sugestao_quem(p_user uuid, out tenant_id uuid, out pessoa text, out empresa text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select v.tenant_id,
         coalesce(nullif(btrim(p.full_name), ''), 'Usuário'),
         coalesce(t.name, 'Manager HUB')
  from (select 1) x
  left join lateral (
    select mm.tenant_id from public.memberships mm
    where mm.user_id = p_user and mm.is_active
    order by mm.created_at limit 1
  ) v on true
  left join public.profiles p on p.id = p_user
  left join public.tenants t on t.id = v.tenant_id;
$$;

-- aviso no sino (e push) de cada pessoa, na empresa dela
create or replace function public.sugestao_avisar(p_users uuid[], p_tipo text, p_titulo text, p_corpo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
begin
  if p_users is null or cardinality(p_users) = 0 then return; end if;
  for r in
    select v.tenant_id, array_agg(v.user_id) as us
    from (
      select distinct on (mm.user_id) mm.user_id, mm.tenant_id
      from public.memberships mm
      where mm.user_id = any(p_users) and mm.is_active
      order by mm.user_id, mm.created_at
    ) v
    group by v.tenant_id
  loop
    perform public.notify_users_sistema(r.tenant_id, r.us, p_tipo, p_titulo, p_corpo);
  end loop;
end;
$$;

create or replace function public.sugestao_recontar(p_sug uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.sugestoes s
     set curtidas = (select count(*) from public.sugestao_curtidas c where c.sugestao_id = s.id),
         comentarios = (select count(*) from public.sugestao_comentarios c where c.sugestao_id = s.id and not c.oculto)
   where s.id = p_sug;
$$;

-- passa a seguir, a menos que já tenha decidido (seguindo ou não)
create or replace function public.sugestao_seguir_auto(p_sug uuid, p_user uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into public.sugestao_seguidores (sugestao_id, user_id) values (p_sug, p_user)
  on conflict (sugestao_id, user_id) do nothing;
$$;

create or replace function public.sugestao_rotulo(p_status public.sugestao_status)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case p_status
    when 'nova' then 'nova'
    when 'em_analise' then 'em análise'
    when 'planejada' then 'planejada'
    when 'em_desenvolvimento' then 'em desenvolvimento'
    when 'entregue' then 'entregue'
    when 'recusada' then 'recusada'
    when 'duplicada' then 'marcada como duplicada'
  end;
$$;

-- imagens só da pasta da própria pessoa no bucket
create or replace function public.sugestao_imagens_ok(p_imagens text[], p_user uuid)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select coalesce(cardinality(p_imagens), 0) <= 3
     and not exists (
       select 1 from unnest(coalesce(p_imagens, '{}')) i
       where split_part(i, '/', 1) <> p_user::text or i !~ '^[0-9a-f-]+/[0-9a-f-]+\.(png|jpg|webp|gif)$'
     );
$$;

-- ---------------------------------------------------------------------------
-- Ações de quem participa
-- ---------------------------------------------------------------------------

create or replace function public.sugestao_criar(p_titulo text, p_descricao text, p_modulo text, p_imagens text[])
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_q record;
  v_id uuid;
  v_triagem uuid[];
begin
  if v_uid is null or not public.participa_sugestoes() then
    raise exception 'Sem acesso às sugestões.' using errcode = '42501';
  end if;
  if not public.sugestao_imagens_ok(p_imagens, v_uid) then
    raise exception 'Imagem inválida.' using errcode = '22023';
  end if;
  select * into v_q from public.sugestao_quem(v_uid);

  insert into public.sugestoes (tenant_id, autor_id, autor_nome, empresa_nome, titulo, descricao, modulo, imagens)
  values (v_q.tenant_id, v_uid, v_q.pessoa, v_q.empresa, btrim(p_titulo), btrim(p_descricao),
          nullif(btrim(p_modulo), ''), coalesce(p_imagens, '{}'))
  returning id into v_id;

  insert into public.sugestao_seguidores (sugestao_id, user_id) values (v_id, v_uid);

  -- um aviso por sugestão nova para a triagem (LUIZ, 18/11/2026)
  select array_agg(distinct m.user_id) into v_triagem
    from public.memberships m
   where m.role = 'owner' and m.is_active and m.user_id <> v_uid;
  perform public.sugestao_avisar(v_triagem, 'sugestao_nova', 'Nova sugestão',
    v_q.pessoa || ' (' || v_q.empresa || '): ' || btrim(p_titulo));

  return v_id;
end;
$$;

-- devolve as imagens que saíram, para o app apagar do bucket
create or replace function public.sugestao_editar(p_id uuid, p_titulo text, p_descricao text, p_modulo text, p_imagens text[])
returns text[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_s public.sugestoes;
begin
  select * into v_s from public.sugestoes where id = p_id for update;
  if v_s.id is null or v_s.autor_id is distinct from v_uid or not public.participa_sugestoes() then
    raise exception 'Sugestão não encontrada.' using errcode = '42501';
  end if;
  if v_s.status <> 'nova' or v_s.oculta then
    raise exception 'A sugestão só pode ser editada enquanto está Nova.';
  end if;
  if not public.sugestao_imagens_ok(p_imagens, v_uid) then
    raise exception 'Imagem inválida.' using errcode = '22023';
  end if;
  update public.sugestoes
     set titulo = btrim(p_titulo), descricao = btrim(p_descricao), modulo = nullif(btrim(p_modulo), ''),
         imagens = coalesce(p_imagens, '{}'), updated_at = now()
   where id = p_id;
  return array(select i from unnest(v_s.imagens) i where not (i = any(coalesce(p_imagens, '{}'))));
end;
$$;

-- o autor apaga enquanto ninguém curtiu nem comentou; a triagem, sempre
create or replace function public.sugestao_apagar(p_id uuid)
returns text[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_s public.sugestoes;
begin
  select * into v_s from public.sugestoes where id = p_id for update;
  if v_s.id is null or not public.participa_sugestoes() then
    raise exception 'Sugestão não encontrada.' using errcode = '42501';
  end if;
  if not public.pode_triar_sugestoes() then
    if v_s.autor_id is distinct from v_uid then
      raise exception 'Sugestão não encontrada.' using errcode = '42501';
    end if;
    if v_s.status <> 'nova' or v_s.curtidas > 0 or v_s.comentarios > 0 then
      raise exception 'Depois que alguém curte ou comenta, só a triagem apaga a sugestão.';
    end if;
  end if;
  -- quem a apontava como original volta a não ter original
  update public.sugestoes set duplicada_de = null where duplicada_de = p_id;
  delete from public.sugestoes where id = p_id;
  return v_s.imagens;
end;
$$;

create or replace function public.sugestao_curtir(p_id uuid, p_curtir boolean)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_s public.sugestoes;
  v_q record;
begin
  select * into v_s from public.sugestoes where id = p_id;
  if v_s.id is null or v_s.oculta or not public.participa_sugestoes() then
    raise exception 'Sugestão não encontrada.' using errcode = '42501';
  end if;
  if p_curtir then
    if v_s.autor_id = v_uid then raise exception 'Você não precisa curtir a sua própria sugestão.'; end if;
    if v_s.status in ('recusada', 'duplicada') then raise exception 'Esta sugestão está encerrada.'; end if;
    select * into v_q from public.sugestao_quem(v_uid);
    insert into public.sugestao_curtidas (sugestao_id, user_id, user_nome, empresa_nome)
    values (p_id, v_uid, v_q.pessoa, v_q.empresa)
    on conflict (sugestao_id, user_id) do nothing;
    perform public.sugestao_seguir_auto(p_id, v_uid);
  else
    delete from public.sugestao_curtidas where sugestao_id = p_id and user_id = v_uid;
  end if;
  perform public.sugestao_recontar(p_id);
  return (select curtidas from public.sugestoes where id = p_id);
end;
$$;

create or replace function public.sugestao_comentar(p_id uuid, p_texto text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_s public.sugestoes;
  v_q record;
  v_c uuid;
begin
  select * into v_s from public.sugestoes where id = p_id;
  if v_s.id is null or v_s.oculta or not public.participa_sugestoes() then
    raise exception 'Sugestão não encontrada.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_texto), '') = '' then raise exception 'Escreva o comentário.'; end if;
  select * into v_q from public.sugestao_quem(v_uid);
  insert into public.sugestao_comentarios (sugestao_id, tenant_id, autor_id, autor_nome, empresa_nome, texto)
  values (p_id, v_q.tenant_id, v_uid, v_q.pessoa, v_q.empresa, btrim(p_texto))
  returning id into v_c;
  perform public.sugestao_seguir_auto(p_id, v_uid);
  perform public.sugestao_recontar(p_id);
  if v_s.autor_id is not null and v_s.autor_id <> v_uid then
    perform public.sugestao_avisar(array[v_s.autor_id], 'sugestao_comentario', 'Novo comentário na sua sugestão',
      v_q.pessoa || ': ' || left(btrim(p_texto), 140));
  end if;
  return v_c;
end;
$$;

create or replace function public.sugestao_editar_comentario(p_id uuid, p_texto text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_c public.sugestao_comentarios;
begin
  select * into v_c from public.sugestao_comentarios where id = p_id for update;
  if v_c.id is null or v_c.autor_id is distinct from (select auth.uid()) or v_c.oculto or not public.participa_sugestoes() then
    raise exception 'Comentário não encontrado.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_texto), '') = '' then raise exception 'Escreva o comentário.'; end if;
  update public.sugestao_comentarios set texto = btrim(p_texto), editado_em = now(), updated_at = now() where id = p_id;
end;
$$;

create or replace function public.sugestao_apagar_comentario(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_c public.sugestao_comentarios;
begin
  select * into v_c from public.sugestao_comentarios where id = p_id for update;
  if v_c.id is null or v_c.autor_id is distinct from (select auth.uid()) or not public.participa_sugestoes() then
    raise exception 'Comentário não encontrado.' using errcode = '42501';
  end if;
  delete from public.sugestao_comentarios where id = p_id;
  perform public.sugestao_recontar(v_c.sugestao_id);
end;
$$;

create or replace function public.sugestao_seguir(p_id uuid, p_segue boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if not public.participa_sugestoes() or not exists (select 1 from public.sugestoes where id = p_id) then
    raise exception 'Sugestão não encontrada.' using errcode = '42501';
  end if;
  insert into public.sugestao_seguidores (sugestao_id, user_id, segue) values (p_id, v_uid, p_segue)
  on conflict (sugestao_id, user_id) do update set segue = excluded.segue;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triagem
-- ---------------------------------------------------------------------------

create or replace function public.sugestao_triar(
  p_id uuid, p_status public.sugestao_status, p_resposta text, p_duplicada_de uuid, p_artigo_slug text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_s public.sugestoes;
  v_o public.sugestoes;
  v_q record;
  v_resposta text := nullif(btrim(p_resposta), '');
  v_mudou_status boolean;
  v_mudou_resposta boolean;
  v_dest uuid[];
begin
  if not public.pode_triar_sugestoes() then
    raise exception 'Só o Proprietário faz a triagem das sugestões.' using errcode = '42501';
  end if;
  select * into v_s from public.sugestoes where id = p_id for update;
  if v_s.id is null then raise exception 'Sugestão não encontrada.'; end if;
  if p_status = 'recusada' and v_resposta is null then
    raise exception 'Escreva na resposta o motivo da recusa.';
  end if;
  if p_status = 'duplicada' then
    select * into v_o from public.sugestoes where id = p_duplicada_de;
    if v_o.id is null or v_o.id = p_id then raise exception 'Escolha a sugestão original.'; end if;
    if v_o.status = 'duplicada' then raise exception 'A original não pode ser outra duplicada.'; end if;
  end if;

  v_mudou_status := v_s.status is distinct from p_status;
  v_mudou_resposta := v_s.resposta is distinct from v_resposta;
  select * into v_q from public.sugestao_quem(v_uid);

  update public.sugestoes
     set status = p_status,
         status_em = case when v_mudou_status then now() else status_em end,
         resposta = v_resposta,
         resposta_em = case when v_mudou_resposta then now() else resposta_em end,
         resposta_por_nome = case when v_mudou_resposta then v_q.pessoa else resposta_por_nome end,
         duplicada_de = case when p_status = 'duplicada' then p_duplicada_de else null end,
         artigo_slug = nullif(btrim(p_artigo_slug), ''),
         updated_at = now()
   where id = p_id;

  -- duplicada: curtidas e seguidores passam para a original, e o autor da
  -- duplicada passa a apoiar a original
  if p_status = 'duplicada' and v_mudou_status then
    insert into public.sugestao_curtidas (sugestao_id, user_id, user_nome, empresa_nome, created_at)
    select v_o.id, c.user_id, c.user_nome, c.empresa_nome, c.created_at
      from public.sugestao_curtidas c
     where c.sugestao_id = p_id and c.user_id is distinct from v_o.autor_id
    on conflict (sugestao_id, user_id) do nothing;
    if v_s.autor_id is not null and v_s.autor_id is distinct from v_o.autor_id then
      insert into public.sugestao_curtidas (sugestao_id, user_id, user_nome, empresa_nome)
      values (v_o.id, v_s.autor_id, v_s.autor_nome, v_s.empresa_nome)
      on conflict (sugestao_id, user_id) do nothing;
    end if;
    insert into public.sugestao_seguidores (sugestao_id, user_id)
    select v_o.id, f.user_id from public.sugestao_seguidores f where f.sugestao_id = p_id and f.segue
    on conflict (sugestao_id, user_id) do nothing;
    perform public.sugestao_recontar(v_o.id);
  end if;

  -- autor e seguidores sabem da mudança (quem triou não avisa a si mesmo)
  if v_mudou_status or v_mudou_resposta then
    select array_agg(distinct u) into v_dest
      from (
        select f.user_id as u from public.sugestao_seguidores f where f.sugestao_id = p_id and f.segue
        union select v_s.autor_id
      ) x
     where u is not null and u <> v_uid;
    perform public.sugestao_avisar(
      v_dest, 'sugestao_situacao',
      case when v_mudou_status then 'Sugestão ' || public.sugestao_rotulo(p_status) else 'Resposta na sugestão' end,
      v_s.titulo || coalesce(': ' || left(v_resposta, 140), '')
    );
  end if;
end;
$$;

create or replace function public.sugestao_moderar(p_id uuid, p_ocultar boolean, p_motivo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.pode_triar_sugestoes() then
    raise exception 'Só o Proprietário modera as sugestões.' using errcode = '42501';
  end if;
  update public.sugestoes
     set oculta = p_ocultar,
         oculta_motivo = case when p_ocultar then nullif(btrim(p_motivo), '') else null end,
         updated_at = now()
   where id = p_id;
  if not found then raise exception 'Sugestão não encontrada.'; end if;
end;
$$;

create or replace function public.sugestao_moderar_comentario(p_id uuid, p_ocultar boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_c public.sugestao_comentarios;
begin
  if not public.pode_triar_sugestoes() then
    raise exception 'Só o Proprietário modera os comentários.' using errcode = '42501';
  end if;
  select * into v_c from public.sugestao_comentarios where id = p_id for update;
  if v_c.id is null then raise exception 'Comentário não encontrado.'; end if;
  if p_ocultar and not v_c.oculto then
    update public.sugestao_comentarios
       set oculto = true, texto_moderado = texto, texto = null, updated_at = now() where id = p_id;
  elsif not p_ocultar and v_c.oculto then
    update public.sugestao_comentarios
       set oculto = false, texto = texto_moderado, texto_moderado = null, updated_at = now() where id = p_id;
  end if;
  perform public.sugestao_recontar(v_c.sugestao_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Logs: o que muda de verdade (curtida e contador não entram)
-- ---------------------------------------------------------------------------

create trigger sugestoes_audit_ins_del
  after insert or delete on public.sugestoes
  for each row execute function public.audit_trigger();
create trigger sugestoes_audit_upd
  after update of titulo, descricao, modulo, imagens, status, resposta, duplicada_de, artigo_slug, oculta, oculta_motivo
  on public.sugestoes
  for each row execute function public.audit_trigger();
create trigger sugestao_comentarios_audit
  after insert or update or delete on public.sugestao_comentarios
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- Prints das sugestões: privado; lê quem participa; envia na própria pasta
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sugestoes', 'sugestoes', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists sugestoes_imagem_ler on storage.objects;
create policy sugestoes_imagem_ler on storage.objects for select to authenticated
  using (bucket_id = 'sugestoes' and public.participa_sugestoes());

drop policy if exists sugestoes_imagem_enviar on storage.objects;
create policy sugestoes_imagem_enviar on storage.objects for insert to authenticated
  with check (
    bucket_id = 'sugestoes'
    and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
    and public.participa_sugestoes()
  );

drop policy if exists sugestoes_imagem_apagar on storage.objects;
create policy sugestoes_imagem_apagar on storage.objects for delete to authenticated
  using (
    bucket_id = 'sugestoes'
    and ((storage.foldername(storage.objects.name))[1] = (select auth.uid())::text or public.pode_triar_sugestoes())
  );

-- ---------------------------------------------------------------------------
-- Privilégios (AGENTS.md): nada SECURITY DEFINER ao alcance da chave pública;
-- ajudantes internos fora do alcance do app também
-- ---------------------------------------------------------------------------

revoke execute on function public.participa_sugestoes() from public, anon;
revoke execute on function public.pode_triar_sugestoes() from public, anon;
grant execute on function public.participa_sugestoes() to authenticated;
grant execute on function public.pode_triar_sugestoes() to authenticated;

revoke execute on function public.sugestao_quem(uuid) from public, anon, authenticated;
revoke execute on function public.sugestao_avisar(uuid[], text, text, text) from public, anon, authenticated;
revoke execute on function public.sugestao_recontar(uuid) from public, anon, authenticated;
revoke execute on function public.sugestao_seguir_auto(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.sugestao_rotulo(public.sugestao_status) from public, anon;
revoke execute on function public.sugestao_imagens_ok(text[], uuid) from public, anon;

revoke execute on function public.sugestao_criar(text, text, text, text[]) from public, anon;
revoke execute on function public.sugestao_editar(uuid, text, text, text, text[]) from public, anon;
revoke execute on function public.sugestao_apagar(uuid) from public, anon;
revoke execute on function public.sugestao_curtir(uuid, boolean) from public, anon;
revoke execute on function public.sugestao_comentar(uuid, text) from public, anon;
revoke execute on function public.sugestao_editar_comentario(uuid, text) from public, anon;
revoke execute on function public.sugestao_apagar_comentario(uuid) from public, anon;
revoke execute on function public.sugestao_seguir(uuid, boolean) from public, anon;
revoke execute on function public.sugestao_triar(uuid, public.sugestao_status, text, uuid, text) from public, anon;
revoke execute on function public.sugestao_moderar(uuid, boolean, text) from public, anon;
revoke execute on function public.sugestao_moderar_comentario(uuid, boolean) from public, anon;

grant execute on function public.sugestao_criar(text, text, text, text[]) to authenticated;
grant execute on function public.sugestao_editar(uuid, text, text, text, text[]) to authenticated;
grant execute on function public.sugestao_apagar(uuid) to authenticated;
grant execute on function public.sugestao_curtir(uuid, boolean) to authenticated;
grant execute on function public.sugestao_comentar(uuid, text) to authenticated;
grant execute on function public.sugestao_editar_comentario(uuid, text) to authenticated;
grant execute on function public.sugestao_apagar_comentario(uuid) to authenticated;
grant execute on function public.sugestao_seguir(uuid, boolean) to authenticated;
grant execute on function public.sugestao_triar(uuid, public.sugestao_status, text, uuid, text) to authenticated;
grant execute on function public.sugestao_moderar(uuid, boolean, text) to authenticated;
grant execute on function public.sugestao_moderar_comentario(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
