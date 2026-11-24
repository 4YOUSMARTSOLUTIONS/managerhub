-- Formulário privado (LUIZ, 24/11/2026): quem cria pode marcar o formulário
-- como privado, e aí SÓ ELE vê as respostas. Proprietário, Administrador e o
-- dono da plataforma veem apenas que o formulário existe (título, situação e
-- quantas respostas tem), sem abrir.
--
--   * vale no banco, não só na tela: a regra de "quem gere" passa a olhar a
--     coluna `privado`, e tudo o que dependia dela (ler respostas, resumo, quem
--     falta, editar, publicar, links dos arquivos) fica só com o autor;
--   * a administração ainda ENCERRA e EXCLUI um formulário privado, sem ler as
--     respostas: sem isso, um formulário de quem saiu da empresa ficaria
--     recebendo respostas para ninguém, para sempre;
--   * só o autor liga ou desliga o privado, e depois da primeira resposta ele
--     não volta a ser aberto (quem respondeu confiou que seria privado);
--   * a lista da administração vem de `formularios_privados_empresa`, que não
--     entrega perguntas nem respostas: a RLS da tabela não deixa a linha chegar.
--
-- Junto: a exclusão de resposta deixa de gravar o CONTEÚDO dela nos Logs do
-- sistema. O log genérico copiava a linha inteira, e quem lê os logs leria a
-- resposta de um formulário privado.

alter table public.formularios add column privado boolean not null default false;

-- a policy depende da regra antiga: sai antes e volta com a nova
drop policy formularios_ler on public.formularios;

create or replace function public.formulario_gere_linha(p_tenant uuid, p_criador uuid, p_privado boolean)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when p_privado then
      -- privado: só o autor
      p_criador = (select auth.uid())
      and (
        public.is_super_admin()
        or exists (
          select 1 from public.memberships m
          where m.user_id = (select auth.uid()) and m.tenant_id = p_tenant and m.is_active
        )
      )
    else
      public.is_super_admin()
      or exists (
        select 1 from public.memberships m
        where m.user_id = (select auth.uid()) and m.tenant_id = p_tenant and m.is_active
          and (m.role in ('owner', 'admin') or m.user_id = p_criador)
      )
  end;
$$;

-- administração da empresa: encerra e exclui formulário privado sem ler
create or replace function public.formulario_admin_da_empresa(p_tenant uuid)
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
          and m.role in ('owner', 'admin')
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
    where f.id = p_form and public.formulario_gere_linha(f.tenant_id, f.criado_por, f.privado)
  );
$$;

create policy formularios_ler on public.formularios for select to authenticated
  using (
    (select public.formulario_gere_linha(tenant_id, criado_por, privado))
    or (status <> 'rascunho' and (select public.formulario_sou_publico(id)))
  );

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
  v_privado boolean;
  v_tem_respostas boolean;
  v_sobras jsonb;
begin
  select * into f from public.formularios where id = p_id for update;
  if not found or not public.formulario_gere_linha(f.tenant_id, f.criado_por, f.privado) then
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

  v_privado := coalesce((p_dados->>'privado')::boolean, f.privado);
  if v_privado <> f.privado then
    if f.criado_por is distinct from (select auth.uid()) then
      raise exception 'Só quem criou o formulário escolhe se as respostas são privadas.';
    end if;
    if not v_privado and v_tem_respostas then
      raise exception 'O formulário já tem respostas: as respostas continuam privadas.';
    end if;
  end if;

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
    privado = v_privado,
    varias_respostas = v_varias,
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
  if not found or not public.formulario_gere_linha(f.tenant_id, f.criado_por, f.privado) then
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

-- encerrar: quem gere e, no privado, também a administração (sem ler nada)
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
  if not found or not (
    public.formulario_gere_linha(f.tenant_id, f.criado_por, f.privado)
    or (f.privado and public.formulario_admin_da_empresa(f.tenant_id))
  ) then
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
  if not found or not (
    public.formulario_gere_linha(f.tenant_id, f.criado_por, f.privado)
    or (f.privado and public.formulario_admin_da_empresa(f.tenant_id))
  ) then
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
  if not found or not public.formulario_gere_linha(f.tenant_id, f.criado_por, f.privado) then
    raise exception 'Formulário não encontrado ou sem permissão.';
  end if;
  insert into public.formularios (
    tenant_id, criado_por, titulo, descricao, campos, anonimo, privado, varias_respostas, permite_editar,
    prazo, mensagem_final, publico_todos, publico_niveis, publico_cargos, publico_pessoas, unidades
  )
  values (
    f.tenant_id, (select auth.uid()), left('Cópia de ' || f.titulo, 150), f.descricao,
    coalesce((
      select jsonb_agg(c order by o)
      from jsonb_array_elements(f.campos) with ordinality as x(c, o)
      where not coalesce((c->>'removido')::boolean, false)
    ), '[]'::jsonb),
    f.anonimo, f.privado, f.varias_respostas, f.permite_editar,
    case when f.prazo > now() then f.prazo end, f.mensagem_final,
    f.publico_todos, f.publico_niveis, f.publico_cargos, f.publico_pessoas, f.unidades
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- o que a administração vê dos privados dos outros: que existem, e nada de dentro
create or replace function public.formularios_privados_empresa()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with ctx as materialized (select public.my_active_tenant() as tenant)
  select case when public.formulario_admin_da_empresa(ctx.tenant) then coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', f.id, 'titulo', f.titulo, 'status', f.status, 'prazo', f.prazo,
             'unidades', f.unidades, 'anonimo', f.anonimo, 'criado_por', f.criado_por,
             'criado_por_nome', coalesce(nullif(btrim(p.full_name), ''), p.email, 'Sem nome'),
             'publicado_em', f.publicado_em, 'created_at', f.created_at, 'updated_at', f.updated_at,
             'respostas', (select count(*) from public.formulario_respostas r where r.formulario_id = f.id)
           ) order by f.updated_at desc)
    from public.formularios f
    left join public.profiles p on p.id = f.criado_por
    where f.tenant_id = ctx.tenant
      and f.privado
      and f.criado_por is distinct from (select auth.uid())
  ), '[]'::jsonb) else '[]'::jsonb end
  from ctx;
$$;

-- a regra antiga sai de vez (tudo acima já usa a nova)
drop function public.formulario_gere_linha(uuid, uuid);

-- Logs do sistema: a exclusão de resposta registra QUE foi apagada, não o que dizia
create or replace function public.formulario_resposta_audit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, entity_label, changes)
  values (
    old.tenant_id, auth.uid(), 'DELETE', 'formulario_respostas', old.id::text,
    (select f.titulo from public.formularios f where f.id = old.formulario_id),
    jsonb_build_object('formulario_id', old.formulario_id)
  );
  return old;
end;
$$;

drop trigger formulario_respostas_audit on public.formulario_respostas;
create trigger formulario_respostas_audit
  after delete on public.formulario_respostas
  for each row execute function public.formulario_resposta_audit();

revoke execute on function public.formulario_gere_linha(uuid, uuid, boolean) from public, anon;
grant execute on function public.formulario_gere_linha(uuid, uuid, boolean) to authenticated;
revoke execute on function public.formulario_admin_da_empresa(uuid) from public, anon, authenticated;
revoke execute on function public.formulario_resposta_audit() from public, anon, authenticated;
revoke execute on function public.formularios_privados_empresa() from public, anon;
grant execute on function public.formularios_privados_empresa() to authenticated;
-- recriadas acima: o revoke de anon continua (o create or replace mantém o ACL),
-- repetido aqui para a migração valer sozinha
revoke execute on function public.formulario_gere(uuid) from public, anon;
revoke execute on function public.formulario_salvar(uuid, jsonb) from public, anon;
revoke execute on function public.formulario_publicar(uuid) from public, anon;
revoke execute on function public.formulario_encerrar(uuid) from public, anon;
revoke execute on function public.formulario_apagar(uuid) from public, anon;
revoke execute on function public.formulario_duplicar(uuid) from public, anon;

notify pgrst, 'reload schema';
