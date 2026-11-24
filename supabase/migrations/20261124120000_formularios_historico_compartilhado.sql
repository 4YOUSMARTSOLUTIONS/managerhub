-- Histórico de respostas (LUIZ, 24/11/2026), corrigindo o desenho da migração
-- anterior (20261124110000), que tirava o Proprietário e o Administrador do
-- formulário privado. O que ele quer:
--
--   * formulário COMUM: quem está no público vê o histórico de todas as
--     respostas, como um livro de registros compartilhado;
--   * formulário PRIVADO ("Histórico privado"): só quem gere vê as respostas,
--     ou seja, o autor, o Proprietário e o Administrador. Cada pessoa continua
--     vendo a própria resposta.
--
-- A regra de "quem gere" volta a ser a original (sem olhar `privado`), a
-- leitura das respostas ganha o caminho do público no formulário comum, e a
-- lista especial de privados para a administração sai (ela volta a gerir
-- todos). Depois da primeira resposta, privado não vira comum: quem respondeu
-- contou que só a gestão leria.
--
-- Fica da migração anterior: a coluna `privado` e o log da exclusão de resposta
-- sem o conteúdo.

drop policy formularios_ler on public.formularios;
drop policy formulario_respostas_ler on public.formulario_respostas;

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

-- histórico compartilhado: o público lê as respostas do formulário comum
create or replace function public.formulario_historico_aberto(p_form uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.formularios f
    where f.id = p_form and not f.privado and f.status <> 'rascunho'
  )
  and public.formulario_no_publico_de(p_form, (select auth.uid()));
$$;

create policy formularios_ler on public.formularios for select to authenticated
  using (
    (select public.formulario_gere_linha(tenant_id, criado_por))
    or (status <> 'rascunho' and (select public.formulario_sou_publico(id)))
  );

create policy formulario_respostas_ler on public.formulario_respostas for select to authenticated
  using (
    respondente_id = (select auth.uid())
    or (select public.formulario_gere(formulario_id))
    or (select public.formulario_historico_aberto(formulario_id))
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
  v_privado := coalesce((p_dados->>'privado')::boolean, f.privado);
  if f.privado and not v_privado and v_tem_respostas then
    raise exception 'O formulário já tem respostas: o histórico continua privado.';
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

-- o que só servia ao desenho anterior
drop function public.formularios_privados_empresa();
drop function public.formulario_admin_da_empresa(uuid);
drop function public.formulario_gere_linha(uuid, uuid, boolean);

revoke execute on function public.formulario_gere_linha(uuid, uuid) from public, anon;
revoke execute on function public.formulario_gere(uuid) from public, anon;
revoke execute on function public.formulario_historico_aberto(uuid) from public, anon;
grant execute on function public.formulario_gere_linha(uuid, uuid) to authenticated;
grant execute on function public.formulario_gere(uuid) to authenticated;
grant execute on function public.formulario_historico_aberto(uuid) to authenticated;
revoke execute on function public.formulario_salvar(uuid, jsonb) from public, anon;
revoke execute on function public.formulario_publicar(uuid) from public, anon;
revoke execute on function public.formulario_encerrar(uuid) from public, anon;
revoke execute on function public.formulario_apagar(uuid) from public, anon;
revoke execute on function public.formulario_duplicar(uuid) from public, anon;

notify pgrst, 'reload schema';
