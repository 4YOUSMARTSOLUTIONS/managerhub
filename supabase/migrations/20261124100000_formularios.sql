-- Formulários (LUIZ, 24/11/2026): construtor de formulários da operação.
--
-- Decisões dele:
--   * qualquer usuário cria formulário;
--   * quem cria escolhe quem responde: todos da empresa, níveis de hierarquia,
--     cargos (funções) ou pessoas específicas, com recorte opcional por unidade;
--   * o máximo de tipos de pergunta que faz sentido (benchmark Google Forms,
--     Microsoft Forms, Typeform, Jotform e o sistema antigo);
--   * por enquanto as respostas aparecem em tabela e saem em planilha completa.
--
-- Desenho:
--   * as perguntas moram num jsonb do formulário (o editor grava o formulário
--     inteiro de uma vez). Pergunta que já tem resposta nunca some: ao ser
--     tirada do formulário ela volta marcada como `removido`, para a resposta
--     antiga continuar legível e exportável;
--   * o público é calculado na hora (níveis, cargos e unidades de hoje): quem
--     entra no cargo depois passa a ver o formulário, quem sai deixa de ver;
--   * anonimato é estrutural, não de tela: na resposta anônima a pessoa NÃO é
--     gravada. Quem respondeu fica em `formulario_respondentes`, só para barrar
--     a segunda resposta, sem horário e legível apenas pela própria pessoa;
--   * o cliente só LÊ; toda escrita passa por função SECURITY DEFINER com guarda;
--   * arquivos (fotos, anexos e assinaturas) vão para o bucket privado
--     `formularios`, sem policy para o cliente: o app autoriza pela função
--     `formulario_pode_enviar` e assina subida e leitura com a chave de serviço.

create table public.formularios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  criado_por uuid references auth.users(id) on delete set null,
  titulo text not null default 'Formulário sem título'
    check (char_length(btrim(titulo)) between 1 and 150),
  descricao text check (descricao is null or char_length(descricao) <= 4000),
  campos jsonb not null default '[]'::jsonb
    check (jsonb_typeof(campos) = 'array' and octet_length(campos::text) <= 400000),
  status text not null default 'rascunho' check (status in ('rascunho', 'publicado', 'encerrado')),
  anonimo boolean not null default false,
  varias_respostas boolean not null default false,
  permite_editar boolean not null default false,
  -- depois dele o formulário para de receber respostas sozinho
  prazo timestamptz,
  mensagem_final text check (mensagem_final is null or char_length(mensagem_final) <= 1000),
  publico_todos boolean not null default false,
  publico_niveis uuid[] not null default '{}',
  publico_cargos uuid[] not null default '{}',
  publico_pessoas uuid[] not null default '{}',
  -- recorte por unidade para todos/níveis/cargos; vazio = todas as unidades
  unidades uuid[] not null default '{}',
  publicado_em timestamptz,
  encerrado_em timestamptz,
  -- o aviso de "formulário para responder" sai uma vez só, na primeira publicação
  avisado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index formularios_tenant_idx on public.formularios (tenant_id, status, updated_at desc);
create index formularios_criador_idx on public.formularios (criado_por);

create table public.formulario_respostas (
  id uuid primary key default gen_random_uuid(),
  formulario_id uuid not null references public.formularios(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- nulos na resposta anônima
  respondente_id uuid references auth.users(id) on delete set null,
  respondente_nome text,
  unidade_id uuid references public.units(id) on delete set null,
  respostas jsonb not null default '{}'::jsonb
    check (jsonb_typeof(respostas) = 'object' and octet_length(respostas::text) <= 500000),
  -- caminhos no bucket `formularios` citados nas respostas
  arquivos text[] not null default '{}' check (cardinality(arquivos) <= 200),
  enviada_em timestamptz not null default now(),
  editada_em timestamptz
);
create index formulario_respostas_form_idx on public.formulario_respostas (formulario_id, enviada_em desc);
create index formulario_respostas_pessoa_idx on public.formulario_respostas (respondente_id);
create index formulario_respostas_tenant_idx on public.formulario_respostas (tenant_id);

-- quem já respondeu, inclusive nos anônimos. Sem horário de propósito: cruzar o
-- horário daqui com o da resposta desfaria o anonimato.
create table public.formulario_respondentes (
  formulario_id uuid not null references public.formularios(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  respostas integer not null default 1,
  primary key (formulario_id, user_id)
);
create index formulario_respondentes_user_idx on public.formulario_respondentes (user_id);

-- ---------------------------------------------------------------------------
-- Quem gere e quem responde
-- ---------------------------------------------------------------------------

-- gere: o autor (ainda ativo na empresa), o Proprietário e o Administrador
create or replace function public.formulario_gere_linha(p_tenant uuid, p_criador uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.is_super_admin()
      or exists (
        select 1 from public.memberships m
        where m.user_id = (select auth.uid()) and m.tenant_id = p_tenant and m.is_active
          and (m.role in ('owner', 'admin') or m.user_id = p_criador)
      );
$$;

create or replace function public.formulario_gere(p_form uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.formularios f
    where f.id = p_form and public.formulario_gere_linha(f.tenant_id, f.criado_por)
  );
$$;

-- a regra do público, para uma pessoa (ajudante interno)
create or replace function public.formulario_no_publico_de(p_form uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.formularios f
    join public.memberships m on m.tenant_id = f.tenant_id and m.user_id = p_user
    where f.id = p_form
      and m.is_active
      and (m.dismissed_at is null or m.dismissed_at > (now() at time zone 'America/Sao_Paulo')::date)
      and (
        m.user_id = any(f.publico_pessoas)
        or (
          (f.publico_todos or m.hierarchy_level_id = any(f.publico_niveis) or m.position_id = any(f.publico_cargos))
          and (
            cardinality(f.unidades) = 0
            or exists (
              select 1 from public.membership_units mu
              where mu.membership_id = m.id and mu.unit_id = any(f.unidades)
            )
          )
        )
      )
  );
$$;

-- a mesma regra para quem está logado (é o que a policy chama)
create or replace function public.formulario_sou_publico(p_form uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.formulario_no_publico_de(p_form, (select auth.uid()));
$$;

-- todo o público de hoje (ajudante interno)
create or replace function public.formulario_publico_ids(p_form uuid)
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select distinct m.user_id
  from public.formularios f
  join public.memberships m on m.tenant_id = f.tenant_id
  where f.id = p_form
    and m.is_active
    and (m.dismissed_at is null or m.dismissed_at > (now() at time zone 'America/Sao_Paulo')::date)
    and (
      m.user_id = any(f.publico_pessoas)
      or (
        (f.publico_todos or m.hierarchy_level_id = any(f.publico_niveis) or m.position_id = any(f.publico_cargos))
        and (
          cardinality(f.unidades) = 0
          or exists (
            select 1 from public.membership_units mu
            where mu.membership_id = m.id and mu.unit_id = any(f.unidades)
          )
        )
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- Leitura: o cliente só lê; escrita só pelas funções abaixo
-- ---------------------------------------------------------------------------

alter table public.formularios enable row level security;
alter table public.formulario_respostas enable row level security;
alter table public.formulario_respondentes enable row level security;

revoke all on table public.formularios, public.formulario_respostas, public.formulario_respondentes
  from public, anon, authenticated;
grant select on table public.formularios, public.formulario_respostas, public.formulario_respondentes
  to authenticated;

-- rascunho só para quem gere; publicado e encerrado também para o público
create policy formularios_ler on public.formularios for select to authenticated
  using (
    (select public.formulario_gere_linha(tenant_id, criado_por))
    or (status <> 'rascunho' and (select public.formulario_sou_publico(id)))
  );

-- a resposta: quem gere o formulário e a própria pessoa (a anônima não tem pessoa)
create policy formulario_respostas_ler on public.formulario_respostas for select to authenticated
  using (
    respondente_id = (select auth.uid())
    or (select public.formulario_gere(formulario_id))
  );

create policy formulario_respondentes_ler on public.formulario_respondentes for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Escrita
-- ---------------------------------------------------------------------------

create or replace function public.formulario_criar()
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid := public.my_active_tenant();
  v_id uuid;
begin
  if (select auth.uid()) is null or v_tenant is null then
    raise exception 'Sessão expirada. Faça login novamente.';
  end if;
  if not (
    public.is_super_admin()
    or exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid()) and m.tenant_id = v_tenant and m.is_active
    )
  ) then
    raise exception 'Sem acesso a esta empresa.';
  end if;
  insert into public.formularios (tenant_id, criado_por)
  values (v_tenant, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.formulario_salvar(p_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  f public.formularios%rowtype;
  v_campos jsonb := coalesce(p_dados->'campos', '[]'::jsonb);
  v_titulo text := btrim(coalesce(p_dados->>'titulo', ''));
  v_anonimo boolean := coalesce((p_dados->>'anonimo')::boolean, false);
  v_varias boolean := coalesce((p_dados->>'varias_respostas')::boolean, false);
  v_prazo timestamptz := nullif(p_dados->>'prazo', '')::timestamptz;
  v_tem_respostas boolean;
  v_sobras jsonb;
begin
  select * into f from public.formularios where id = p_id for update;
  if not found or not public.formulario_gere_linha(f.tenant_id, f.criado_por) then
    raise exception 'Formulário não encontrado ou sem permissão para editar.';
  end if;
  if v_titulo = '' then
    raise exception 'Dê um título ao formulário.';
  end if;
  if jsonb_typeof(v_campos) <> 'array' then
    raise exception 'Perguntas inválidas.';
  end if;
  if jsonb_array_length(v_campos) > 300 then
    raise exception 'O formulário passa de 300 perguntas.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_campos) c
    where jsonb_typeof(c) <> 'object' or coalesce(c->>'id', '') = '' or coalesce(c->>'tipo', '') = ''
  ) then
    raise exception 'Perguntas inválidas.';
  end if;
  if (select count(*) from jsonb_array_elements(v_campos))
     <> (select count(distinct c->>'id') from jsonb_array_elements(v_campos) c) then
    raise exception 'Há perguntas repetidas.';
  end if;

  v_tem_respostas := exists (select 1 from public.formulario_respostas r where r.formulario_id = p_id);
  if v_tem_respostas and v_anonimo <> f.anonimo then
    raise exception 'O formulário já tem respostas: anônimo ou identificado não muda mais.';
  end if;

  -- pergunta que já tem resposta não some: volta marcada como removida
  if v_tem_respostas then
    select coalesce(jsonb_agg(c || '{"removido": true}'::jsonb), '[]'::jsonb) into v_sobras
    from jsonb_array_elements(f.campos) c
    where not exists (select 1 from jsonb_array_elements(v_campos) n where n->>'id' = c->>'id')
      and exists (
        select 1 from public.formulario_respostas r
        where r.formulario_id = p_id and r.respostas ? (c->>'id')
      );
    v_campos := v_campos || v_sobras;
  end if;

  update public.formularios set
    titulo = left(v_titulo, 150),
    descricao = left(nullif(btrim(coalesce(p_dados->>'descricao', '')), ''), 4000),
    campos = v_campos,
    anonimo = v_anonimo,
    varias_respostas = v_varias,
    -- editar depois de enviar só faz sentido com a pessoa identificada e uma resposta
    permite_editar = coalesce((p_dados->>'permite_editar')::boolean, false) and not v_anonimo and not v_varias,
    prazo = v_prazo,
    mensagem_final = left(nullif(btrim(coalesce(p_dados->>'mensagem_final', '')), ''), 1000),
    publico_todos = coalesce((p_dados->>'publico_todos')::boolean, false),
    publico_niveis = array(
      select h.id from public.hierarchy_levels h
      where h.tenant_id = f.tenant_id
        and h.id::text in (select jsonb_array_elements_text(coalesce(p_dados->'publico_niveis', '[]'::jsonb)))
    ),
    publico_cargos = array(
      select p.id from public.positions p
      where p.tenant_id = f.tenant_id
        and p.id::text in (select jsonb_array_elements_text(coalesce(p_dados->'publico_cargos', '[]'::jsonb)))
    ),
    publico_pessoas = array(
      select distinct m.user_id from public.memberships m
      where m.tenant_id = f.tenant_id
        and m.user_id::text in (select jsonb_array_elements_text(coalesce(p_dados->'publico_pessoas', '[]'::jsonb)))
    ),
    unidades = array(
      select u.id from public.units u
      where u.tenant_id = f.tenant_id
        and u.id::text in (select jsonb_array_elements_text(coalesce(p_dados->'unidades', '[]'::jsonb)))
    ),
    updated_at = now()
  where id = p_id;
end;
$$;

-- publica (ou reabre). Devolve quantas pessoas foram avisadas.
create or replace function public.formulario_publicar(p_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  f public.formularios%rowtype;
  v_publico uuid[];
  v_avisar uuid[];
begin
  select * into f from public.formularios where id = p_id for update;
  if not found or not public.formulario_gere_linha(f.tenant_id, f.criado_por) then
    raise exception 'Formulário não encontrado ou sem permissão.';
  end if;
  if f.status = 'publicado' then
    raise exception 'O formulário já está publicado.';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(f.campos) c
    where c->>'tipo' not in ('secao', 'texto') and not coalesce((c->>'removido')::boolean, false)
  ) then
    raise exception 'Inclua pelo menos uma pergunta antes de publicar.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(f.campos) c
    where not coalesce((c->>'removido')::boolean, false)
      and c->>'tipo' not in ('secao', 'texto')
      and btrim(coalesce(c->>'titulo', '')) = ''
  ) then
    raise exception 'Há pergunta sem enunciado. Preencha antes de publicar.';
  end if;
  if f.prazo is not null and f.prazo <= now() then
    raise exception 'O prazo já passou. Ajuste o prazo antes de publicar.';
  end if;

  v_publico := array(select public.formulario_publico_ids(p_id));
  if coalesce(cardinality(v_publico), 0) = 0 then
    raise exception 'Ninguém está no público escolhido. Revise quem vai responder.';
  end if;

  update public.formularios
     set status = 'publicado', publicado_em = coalesce(publicado_em, now()),
         encerrado_em = null, updated_at = now()
   where id = p_id;

  if f.avisado_em is null then
    v_avisar := array(select u from unnest(v_publico) u where u is distinct from (select auth.uid()));
    if coalesce(cardinality(v_avisar), 0) > 0 then
      perform public.notify_users_sistema(
        f.tenant_id, v_avisar, 'formulario_novo', 'Formulário para responder',
        f.titulo || case
          when f.prazo is not null
            then ' (até ' || to_char(f.prazo at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI') || ')'
          else '' end
      );
    end if;
    update public.formularios set avisado_em = now() where id = p_id;
    return coalesce(cardinality(v_avisar), 0);
  end if;
  return 0;
end;
$$;

create or replace function public.formulario_encerrar(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  f public.formularios%rowtype;
begin
  select * into f from public.formularios where id = p_id for update;
  if not found or not public.formulario_gere_linha(f.tenant_id, f.criado_por) then
    raise exception 'Formulário não encontrado ou sem permissão.';
  end if;
  if f.status <> 'publicado' then
    raise exception 'Só um formulário publicado pode ser encerrado.';
  end if;
  update public.formularios
     set status = 'encerrado', encerrado_em = now(), updated_at = now()
   where id = p_id;
end;
$$;

-- apaga o formulário e as respostas; devolve os arquivos para o app limpar o bucket
create or replace function public.formulario_apagar(p_id uuid)
returns text[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  f public.formularios%rowtype;
  v_arquivos text[];
begin
  select * into f from public.formularios where id = p_id for update;
  if not found or not public.formulario_gere_linha(f.tenant_id, f.criado_por) then
    raise exception 'Formulário não encontrado ou sem permissão.';
  end if;
  select coalesce(array_agg(a), '{}') into v_arquivos
  from public.formulario_respostas r, unnest(r.arquivos) a
  where r.formulario_id = p_id;
  delete from public.formularios where id = p_id;
  return v_arquivos;
end;
$$;

create or replace function public.formulario_duplicar(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  f public.formularios%rowtype;
  v_id uuid;
begin
  select * into f from public.formularios where id = p_id;
  if not found or not public.formulario_gere_linha(f.tenant_id, f.criado_por) then
    raise exception 'Formulário não encontrado ou sem permissão.';
  end if;
  insert into public.formularios (
    tenant_id, criado_por, titulo, descricao, campos, anonimo, varias_respostas, permite_editar,
    prazo, mensagem_final, publico_todos, publico_niveis, publico_cargos, publico_pessoas, unidades
  )
  values (
    f.tenant_id, (select auth.uid()), left('Cópia de ' || f.titulo, 150), f.descricao,
    -- a cópia nasce sem as perguntas removidas do original
    coalesce((
      select jsonb_agg(c order by o)
      from jsonb_array_elements(f.campos) with ordinality as x(c, o)
      where not coalesce((c->>'removido')::boolean, false)
    ), '[]'::jsonb),
    f.anonimo, f.varias_respostas, f.permite_editar,
    case when f.prazo > now() then f.prazo end, f.mensagem_final,
    f.publico_todos, f.publico_niveis, f.publico_cargos, f.publico_pessoas, f.unidades
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- pode subir arquivo para este formulário? Devolve a empresa (o 1º segmento do caminho)
create or replace function public.formulario_pode_enviar(p_form uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select f.tenant_id
  from public.formularios f
  where f.id = p_form
    and f.status = 'publicado'
    and (f.prazo is null or f.prazo > now())
    and public.formulario_no_publico_de(p_form, (select auth.uid()));
$$;

create or replace function public.formulario_responder(p_form uuid, p_respostas jsonb, p_arquivos text[])
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  f public.formularios%rowtype;
  v_uid uuid := (select auth.uid());
  v_prefixo text;
  v_inseriu integer;
  v_nome text;
  v_unidade uuid;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Sessão expirada. Faça login novamente.';
  end if;
  select * into f from public.formularios where id = p_form;
  if not found or f.status = 'rascunho' or not public.formulario_no_publico_de(p_form, v_uid) then
    raise exception 'Este formulário não foi enviado para você.';
  end if;
  if f.status <> 'publicado' or (f.prazo is not null and f.prazo <= now()) then
    raise exception 'Este formulário não está mais recebendo respostas.';
  end if;
  if p_respostas is null or jsonb_typeof(p_respostas) <> 'object' then
    raise exception 'Respostas inválidas.';
  end if;
  v_prefixo := f.tenant_id::text || '/' || f.id::text || '/';
  if exists (
    select 1 from unnest(coalesce(p_arquivos, '{}')) a
    where left(a, char_length(v_prefixo)) <> v_prefixo
  ) then
    raise exception 'Arquivo inválido.';
  end if;

  -- a trava da segunda resposta é a chave primária, não uma consulta antes
  if f.varias_respostas then
    insert into public.formulario_respondentes (formulario_id, user_id) values (p_form, v_uid)
    on conflict (formulario_id, user_id)
      do update set respostas = public.formulario_respondentes.respostas + 1;
  else
    insert into public.formulario_respondentes (formulario_id, user_id) values (p_form, v_uid)
    on conflict do nothing;
    get diagnostics v_inseriu = row_count;
    if v_inseriu = 0 then
      raise exception 'Você já respondeu este formulário.';
    end if;
  end if;

  if not f.anonimo then
    select nullif(btrim(p.full_name), '') into v_nome from public.profiles p where p.id = v_uid;
    select mu.unit_id into v_unidade
    from public.memberships m
    join public.membership_units mu on mu.membership_id = m.id
    where m.tenant_id = f.tenant_id and m.user_id = v_uid
    order by (cardinality(f.unidades) > 0 and mu.unit_id = any(f.unidades)) desc, mu.unit_id
    limit 1;
  end if;

  insert into public.formulario_respostas
    (formulario_id, tenant_id, respondente_id, respondente_nome, unidade_id, respostas, arquivos)
  values (
    p_form, f.tenant_id,
    case when f.anonimo then null else v_uid end,
    case when f.anonimo then null else v_nome end,
    case when f.anonimo then null else v_unidade end,
    p_respostas, coalesce(p_arquivos, '{}')
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- a própria pessoa corrige a resposta (formulário que permite); devolve os arquivos que saíram
create or replace function public.formulario_editar_resposta(p_resposta uuid, p_respostas jsonb, p_arquivos text[])
returns text[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r public.formulario_respostas%rowtype;
  f public.formularios%rowtype;
  v_prefixo text;
  v_saiu text[];
begin
  select * into r from public.formulario_respostas where id = p_resposta for update;
  if not found or r.respondente_id is distinct from (select auth.uid()) then
    raise exception 'Resposta não encontrada.';
  end if;
  select * into f from public.formularios where id = r.formulario_id;
  if not f.permite_editar or f.anonimo then
    raise exception 'Este formulário não permite editar a resposta.';
  end if;
  if f.status <> 'publicado' or (f.prazo is not null and f.prazo <= now())
     or not public.formulario_no_publico_de(f.id, (select auth.uid())) then
    raise exception 'Este formulário não está mais recebendo respostas.';
  end if;
  if p_respostas is null or jsonb_typeof(p_respostas) <> 'object' then
    raise exception 'Respostas inválidas.';
  end if;
  v_prefixo := f.tenant_id::text || '/' || f.id::text || '/';
  if exists (
    select 1 from unnest(coalesce(p_arquivos, '{}')) a
    where left(a, char_length(v_prefixo)) <> v_prefixo
  ) then
    raise exception 'Arquivo inválido.';
  end if;
  v_saiu := array(select a from unnest(r.arquivos) a where not (a = any(coalesce(p_arquivos, '{}'))));
  update public.formulario_respostas
     set respostas = p_respostas, arquivos = coalesce(p_arquivos, '{}'), editada_em = now()
   where id = p_resposta;
  return v_saiu;
end;
$$;

-- quem gere apaga uma resposta (ex.: a de teste); devolve os arquivos dela
create or replace function public.formulario_apagar_resposta(p_resposta uuid)
returns text[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r public.formulario_respostas%rowtype;
begin
  select * into r from public.formulario_respostas where id = p_resposta for update;
  if not found or not public.formulario_gere(r.formulario_id) then
    raise exception 'Resposta não encontrada ou sem permissão.';
  end if;
  delete from public.formulario_respostas where id = p_resposta;
  -- identificada: a pessoa pode responder de novo. Na anônima não há como saber
  -- quem foi, e a trava dela continua.
  if r.respondente_id is not null then
    update public.formulario_respondentes
       set respostas = respostas - 1
     where formulario_id = r.formulario_id and user_id = r.respondente_id;
    delete from public.formulario_respondentes
     where formulario_id = r.formulario_id and user_id = r.respondente_id and respostas <= 0;
  end if;
  return r.arquivos;
end;
$$;

-- contagens do painel de respostas
create or replace function public.formulario_resumo(p_form uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_publico uuid[];
begin
  if not public.formulario_gere(p_form) then
    raise exception 'Sem permissão.';
  end if;
  v_publico := array(select public.formulario_publico_ids(p_form));
  return jsonb_build_object(
    'publico', coalesce(cardinality(v_publico), 0),
    'responderam', (
      select count(*) from public.formulario_respondentes x
      where x.formulario_id = p_form and x.user_id = any(v_publico)
    ),
    'respostas', (select count(*) from public.formulario_respostas r where r.formulario_id = p_form)
  );
end;
$$;

-- quem do público ainda não respondeu (só no identificado: no anônimo isso revelaria quem respondeu)
create or replace function public.formulario_pendentes(p_form uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.formulario_gere(p_form) then
    raise exception 'Sem permissão.';
  end if;
  if (select anonimo from public.formularios where id = p_form) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', u.id, 'nome', coalesce(nullif(btrim(p.full_name), ''), p.email, 'Sem nome'))
                     order by coalesce(nullif(btrim(p.full_name), ''), p.email))
    from public.formulario_publico_ids(p_form) as u(id)
    left join public.profiles p on p.id = u.id
    where not exists (
      select 1 from public.formulario_respondentes x
      where x.formulario_id = p_form and x.user_id = u.id
    )
  ), '[]'::jsonb);
end;
$$;

-- o que o editor precisa para montar o público: níveis, cargos, unidades e pessoas
create or replace function public.formulario_opcoes_publico()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with ctx as materialized (
    select public.my_active_tenant() as tenant,
           (now() at time zone 'America/Sao_Paulo')::date as hoje
  ), ok as materialized (
    select ctx.*, (
      public.is_super_admin()
      or exists (
        select 1 from public.memberships m
        where m.user_id = (select auth.uid()) and m.tenant_id = ctx.tenant and m.is_active
      )
    ) as membro
    from ctx
  )
  select case when ok.membro then jsonb_build_object(
    'niveis', coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'nome', h.name) order by h.rank, h.name)
      from public.hierarchy_levels h where h.tenant_id = ok.tenant and h.active
    ), '[]'::jsonb),
    'cargos', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.name) order by p.name)
      from public.positions p where p.tenant_id = ok.tenant and p.active
    ), '[]'::jsonb),
    'unidades', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'nome', u.name) order by u.name)
      from public.units u where u.tenant_id = ok.tenant
    ), '[]'::jsonb),
    'pessoas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.user_id,
               'nome', coalesce(nullif(btrim(pr.full_name), ''), pr.email, 'Sem nome'),
               'nivel', m.hierarchy_level_id,
               'cargo', m.position_id,
               'unidades', coalesce((
                 select jsonb_agg(mu.unit_id) from public.membership_units mu where mu.membership_id = m.id
               ), '[]'::jsonb)
             ) order by coalesce(nullif(btrim(pr.full_name), ''), pr.email))
      from public.memberships m
      join public.profiles pr on pr.id = m.user_id
      where m.tenant_id = ok.tenant
        and m.is_active
        and (m.dismissed_at is null or m.dismissed_at > ok.hoje)
    ), '[]'::jsonb)
  ) else '{"niveis": [], "cargos": [], "unidades": [], "pessoas": []}'::jsonb end
  from ok;
$$;

-- ---------------------------------------------------------------------------
-- Logs do sistema: criação, exclusão e mudança de situação do formulário, e a
-- exclusão de resposta. Envio de resposta NÃO entra: o log grava quem fez, e
-- isso desfaria o anonimato.
-- ---------------------------------------------------------------------------

create trigger formularios_audit
  after insert or delete or update of status on public.formularios
  for each row execute function public.audit_trigger();

create trigger formulario_respostas_audit
  after delete on public.formulario_respostas
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- Bucket: privado e sem policy para o cliente (o app assina com a chave de serviço)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('formularios', 'formularios', false, 20971520, array[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv',
  'video/mp4', 'video/quicktime', 'video/webm',
  'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg', 'audio/wav', 'audio/x-m4a'
])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Privilégios (AGENTS.md)
-- ---------------------------------------------------------------------------

-- chamadas pela policy: precisam de execute para quem está logado
revoke execute on function public.formulario_gere_linha(uuid, uuid) from public, anon;
revoke execute on function public.formulario_gere(uuid) from public, anon;
revoke execute on function public.formulario_sou_publico(uuid) from public, anon;
-- internas: só outras funções chamam
revoke execute on function public.formulario_no_publico_de(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.formulario_publico_ids(uuid) from public, anon, authenticated;
-- expostas ao app, com guarda no corpo
revoke execute on function public.formulario_criar() from public, anon;
revoke execute on function public.formulario_salvar(uuid, jsonb) from public, anon;
revoke execute on function public.formulario_publicar(uuid) from public, anon;
revoke execute on function public.formulario_encerrar(uuid) from public, anon;
revoke execute on function public.formulario_apagar(uuid) from public, anon;
revoke execute on function public.formulario_duplicar(uuid) from public, anon;
revoke execute on function public.formulario_pode_enviar(uuid) from public, anon;
revoke execute on function public.formulario_responder(uuid, jsonb, text[]) from public, anon;
revoke execute on function public.formulario_editar_resposta(uuid, jsonb, text[]) from public, anon;
revoke execute on function public.formulario_apagar_resposta(uuid) from public, anon;
revoke execute on function public.formulario_resumo(uuid) from public, anon;
revoke execute on function public.formulario_pendentes(uuid) from public, anon;
revoke execute on function public.formulario_opcoes_publico() from public, anon;

grant execute on function public.formulario_gere_linha(uuid, uuid) to authenticated;
grant execute on function public.formulario_gere(uuid) to authenticated;
grant execute on function public.formulario_sou_publico(uuid) to authenticated;
grant execute on function public.formulario_criar() to authenticated;
grant execute on function public.formulario_salvar(uuid, jsonb) to authenticated;
grant execute on function public.formulario_publicar(uuid) to authenticated;
grant execute on function public.formulario_encerrar(uuid) to authenticated;
grant execute on function public.formulario_apagar(uuid) to authenticated;
grant execute on function public.formulario_duplicar(uuid) to authenticated;
grant execute on function public.formulario_pode_enviar(uuid) to authenticated;
grant execute on function public.formulario_responder(uuid, jsonb, text[]) to authenticated;
grant execute on function public.formulario_editar_resposta(uuid, jsonb, text[]) to authenticated;
grant execute on function public.formulario_apagar_resposta(uuid) to authenticated;
grant execute on function public.formulario_resumo(uuid) to authenticated;
grant execute on function public.formulario_pendentes(uuid) to authenticated;
grant execute on function public.formulario_opcoes_publico() to authenticated;

notify pgrst, 'reload schema';
