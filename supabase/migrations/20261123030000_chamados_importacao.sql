-- Importação dos chamados do sistema anterior, só do Proprietário (LUIZ, 22/11/2026).
--
-- O arquivo traz nomes, setores e categorias como texto. O que casa com o cadastro
-- vira vínculo; o que não casa fica guardado em legacy_*, para o histórico não
-- perder quem pediu e quem atendeu. `origem_id` é o ID lá de fora: repetir a
-- importação pula o que já entrou, em vez de duplicar.

alter table public.tickets
  add column if not exists origem_id text,
  add column if not exists legacy_requester text,
  add column if not exists legacy_assignee text,
  add column if not exists legacy_unit text,
  add column if not exists legacy_cc text;

create unique index if not exists tickets_origem_unica
  on public.tickets (tenant_id, origem_id) where origem_id is not null;

alter table public.ticket_comments
  add column if not exists author_label text;

-- A leitura de chamado passa a seguir o que a tela já mostrava.
--
-- A policy antiga liberava a linha para qualquer membro da empresa, e a restrição
-- existia só na consulta da página. Com a chave pública do navegador, qualquer
-- funcionário leria o histórico inteiro, e as mensagens importadas têm pedidos de
-- acesso, senha e CPF. `ticket_comments` herda: a policy dela lê `tickets`.
drop policy if exists tickets_member_select on public.tickets;
drop policy if exists tickets_select on public.tickets;
create policy tickets_select on public.tickets
  for select to authenticated
  using (
    tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::public.member_role[]))
    or (
      tenant_id in (select public.my_tenant_ids())
      and (
        requester_id = (select auth.uid())
        or sector_id in (select public.my_ticket_sector_ids())
      )
    )
  );

create or replace function public.chamado_chave(p text)
returns text
language sql
stable
set search_path to 'public'
as $$
  select regexp_replace(public.mh_norm(btrim(coalesce(p, ''))), '\s+', ' ', 'g')
$$;

create or replace function public.chamados_importar(
  p_tenant uuid,
  p_linhas jsonb,
  p_simular boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_eu uuid := auth.uid();
  v_pessoas jsonb;
  v_unidades jsonb;
  v_setores jsonb;
  v_categorias jsonb;
  v_l jsonb;
  v_m jsonb;
  v_n int;
  v_origem text;
  v_titulo text;
  v_status public.ticket_status;
  v_criado timestamptz;
  v_prazo timestamptz;
  v_concl timestamptz;
  v_req_txt text;
  v_req uuid;
  v_resp_txt text;
  v_resp uuid;
  v_autor_txt text;
  v_autor uuid;
  v_un_txt text;
  v_un_chave text;
  v_unit uuid;
  v_un_legado text;
  v_setor_txt text;
  v_setor_chave text;
  v_setor uuid;
  v_cat_txt text;
  v_cat_chave text;
  v_cat uuid;
  v_id uuid;
  v_novos int := 0;
  v_existiam int := 0;
  v_comentarios int := 0;
  v_recusas jsonb := '[]'::jsonb;
  v_sem_cadastro jsonb := '{}'::jsonb;
  v_setores_novos jsonb := '{}'::jsonb;
  v_categorias_novas jsonb := '{}'::jsonb;
  v_unidades_texto jsonb := '{}'::jsonb;
begin
  if v_eu is null or not public.has_tenant_role(p_tenant, '{owner}'::public.member_role[]) then
    raise exception 'Apenas o proprietário importa chamados.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_linhas) is distinct from 'array' then
    raise exception 'Formato inválido.';
  end if;
  if jsonb_array_length(p_linhas) > 500 then
    raise exception 'No máximo 500 linhas por lote.';
  end if;

  -- homônimo não vincula: na dúvida fica o texto, nunca a pessoa errada
  select coalesce(jsonb_object_agg(x.nome, x.uid), '{}'::jsonb) into v_pessoas
  from (
    select public.chamado_chave(p.full_name) as nome, min(m.user_id::text) as uid
    from public.memberships m
    join public.profiles p on p.id = m.user_id
    where m.tenant_id = p_tenant and p.full_name is not null
    group by 1
    having count(distinct m.user_id) = 1
  ) x;

  select coalesce(jsonb_object_agg(x.nome, x.id), '{}'::jsonb) into v_unidades
  from (select public.chamado_chave(u.name) as nome, min(u.id::text) as id
        from public.units u where u.tenant_id = p_tenant group by 1) x;

  select coalesce(jsonb_object_agg(x.nome, x.id), '{}'::jsonb) into v_setores
  from (select public.chamado_chave(s.name) as nome, min(s.id::text) as id
        from public.ticket_sectors s where s.tenant_id = p_tenant group by 1) x;

  select coalesce(jsonb_object_agg(x.chave, x.id), '{}'::jsonb) into v_categorias
  from (select c.sector_id::text || '|' || public.chamado_chave(c.name) as chave, min(c.id::text) as id
        from public.ticket_categories c where c.tenant_id = p_tenant group by 1) x;

  for v_l in select * from jsonb_array_elements(p_linhas) loop
    v_n := nullif(v_l ->> 'linha', '')::int;
    begin
      v_origem := nullif(btrim(v_l ->> 'id'), '');
      v_titulo := nullif(btrim(v_l ->> 'titulo'), '');
      if v_origem is null then raise exception 'Sem ID.'; end if;
      if v_titulo is null then raise exception 'Chamado % sem título.', v_origem; end if;

      if exists (select 1 from public.tickets t where t.tenant_id = p_tenant and t.origem_id = v_origem) then
        v_existiam := v_existiam + 1;
        continue;
      end if;

      v_status := (v_l ->> 'status')::public.ticket_status;
      v_criado := nullif(v_l ->> 'criado_em', '')::timestamp at time zone 'America/Sao_Paulo';
      v_prazo := nullif(v_l ->> 'prazo', '')::timestamp at time zone 'America/Sao_Paulo';
      v_concl := nullif(v_l ->> 'concluido_em', '')::timestamp at time zone 'America/Sao_Paulo';
      if v_criado is null then raise exception 'Chamado % sem data de criação.', v_origem; end if;
      if v_status not in ('resolved', 'closed', 'cancelled') then v_concl := null; end if;

      v_req_txt := nullif(btrim(v_l ->> 'criador'), '');
      v_req := nullif(v_pessoas ->> public.chamado_chave(v_req_txt), '')::uuid;
      if v_req_txt is not null and v_req is null then
        v_sem_cadastro := v_sem_cadastro || jsonb_build_object(v_req_txt, coalesce((v_sem_cadastro ->> v_req_txt)::int, 0) + 1);
      end if;

      v_resp_txt := nullif(btrim(v_l ->> 'responsavel'), '');
      v_resp := nullif(v_pessoas ->> public.chamado_chave(v_resp_txt), '')::uuid;
      if v_resp_txt is not null and v_resp is null then
        v_sem_cadastro := v_sem_cadastro || jsonb_build_object(v_resp_txt, coalesce((v_sem_cadastro ->> v_resp_txt)::int, 0) + 1);
      end if;

      v_unit := null;
      v_un_legado := null;
      v_un_txt := nullif(btrim(v_l ->> 'unidade'), '');
      v_un_chave := public.chamado_chave(v_un_txt);
      if v_un_txt is not null and v_un_chave not in ('todas', 'todas as unidades') then
        v_unit := nullif(v_unidades ->> v_un_chave, '')::uuid;
        if v_unit is null then
          v_un_legado := v_un_txt;
          v_unidades_texto := v_unidades_texto || jsonb_build_object(v_un_txt, coalesce((v_unidades_texto ->> v_un_txt)::int, 0) + 1);
        end if;
      end if;

      -- setor e categoria que faltam entram INATIVOS: servem ao histórico e não
      -- aparecem em "Abrir chamado" até alguém ativar e definir o SLA
      v_setor := null;
      v_setor_txt := nullif(btrim(v_l ->> 'setor'), '');
      v_setor_chave := public.chamado_chave(v_setor_txt);
      if v_setor_txt is not null then
        v_setor := nullif(v_setores ->> v_setor_chave, '')::uuid;
        if v_setor is null then
          v_setores_novos := v_setores_novos || jsonb_build_object(v_setor_chave, v_setor_txt);
          if not p_simular then
            insert into public.ticket_sectors (tenant_id, name, active)
            values (p_tenant, v_setor_txt, false)
            returning id into v_setor;
            v_setores := v_setores || jsonb_build_object(v_setor_chave, v_setor);
          end if;
        end if;
      end if;

      v_cat := null;
      v_cat_txt := nullif(btrim(v_l ->> 'categoria'), '');
      v_cat_chave := public.chamado_chave(v_cat_txt);
      if v_cat_txt is not null and v_setor_txt is not null then
        if v_setor is not null then
          v_cat := nullif(v_categorias ->> (v_setor::text || '|' || v_cat_chave), '')::uuid;
        end if;
        if v_cat is null then
          v_categorias_novas := v_categorias_novas
            || jsonb_build_object(v_setor_chave || '|' || v_cat_chave, v_setor_txt || ' > ' || v_cat_txt);
          if not p_simular then
            insert into public.ticket_categories (tenant_id, sector_id, name, active)
            values (p_tenant, v_setor, v_cat_txt, false)
            returning id into v_cat;
            v_categorias := v_categorias || jsonb_build_object(v_setor::text || '|' || v_cat_chave, v_cat);
          end if;
        end if;
      end if;

      for v_m in select * from jsonb_array_elements(coalesce(v_l -> 'mensagens', '[]'::jsonb)) loop
        v_autor_txt := nullif(btrim(v_m ->> 'autor'), '');
        if v_autor_txt is not null and (v_pessoas ->> public.chamado_chave(v_autor_txt)) is null then
          v_sem_cadastro := v_sem_cadastro || jsonb_build_object(v_autor_txt, coalesce((v_sem_cadastro ->> v_autor_txt)::int, 0) + 1);
        end if;
        perform nullif(v_m ->> 'em', '')::timestamp;
        v_comentarios := v_comentarios + 1;
      end loop;

      if not p_simular then
        insert into public.tickets (
          tenant_id, code, origem_id, title, description, requester_id, assignee_id,
          status, due_date, resolved_at, created_by, created_at, updated_at,
          sector_id, category_id, unit_id,
          legacy_requester, legacy_assignee, legacy_unit, legacy_cc
        ) values (
          p_tenant,
          -- o código é o ID de lá; se outra empresa já o usa, cai na numeração normal
          case when exists (select 1 from public.tickets t where t.code = v_origem) then null else v_origem end,
          v_origem, v_titulo, nullif(btrim(v_l ->> 'descricao'), ''), v_req, v_resp,
          v_status, v_prazo, v_concl, coalesce(v_req, v_eu), v_criado, coalesce(v_concl, v_criado),
          v_setor, v_cat, v_unit,
          case when v_req is null then v_req_txt end,
          case when v_resp is null then v_resp_txt end,
          v_un_legado,
          nullif(btrim(v_l ->> 'copia'), '')
        )
        returning id into v_id;

        for v_m in select * from jsonb_array_elements(coalesce(v_l -> 'mensagens', '[]'::jsonb)) loop
          v_autor_txt := nullif(btrim(v_m ->> 'autor'), '');
          v_autor := nullif(v_pessoas ->> public.chamado_chave(v_autor_txt), '')::uuid;
          insert into public.ticket_comments (ticket_id, author_id, author_label, body, created_at)
          values (
            v_id, v_autor,
            case when v_autor is null then v_autor_txt end,
            v_m ->> 'texto',
            coalesce(nullif(v_m ->> 'em', '')::timestamp at time zone 'America/Sao_Paulo', v_criado)
          );
        end loop;
      end if;

      v_novos := v_novos + 1;
    exception when others then
      v_recusas := v_recusas || jsonb_build_object('linha', v_n, 'motivo', sqlerrm);
      -- a linha desfeita leva junto o setor ou a categoria que ela criou: os mapas
      -- voltam a refletir o banco, senão a próxima apontaria para um id que sumiu
      select coalesce(jsonb_object_agg(x.nome, x.id), '{}'::jsonb) into v_setores
      from (select public.chamado_chave(s.name) as nome, min(s.id::text) as id
            from public.ticket_sectors s where s.tenant_id = p_tenant group by 1) x;
      select coalesce(jsonb_object_agg(x.chave, x.id), '{}'::jsonb) into v_categorias
      from (select c.sector_id::text || '|' || public.chamado_chave(c.name) as chave, min(c.id::text) as id
            from public.ticket_categories c where c.tenant_id = p_tenant group by 1) x;
    end;
  end loop;

  return jsonb_build_object(
    'novos', v_novos,
    'ja_existiam', v_existiam,
    'comentarios', v_comentarios,
    'recusadas', v_recusas,
    'sem_cadastro', v_sem_cadastro,
    'setores_novos', (select coalesce(jsonb_agg(value), '[]'::jsonb) from jsonb_each_text(v_setores_novos)),
    'categorias_novas', (select coalesce(jsonb_agg(value), '[]'::jsonb) from jsonb_each_text(v_categorias_novas)),
    'unidades_texto', v_unidades_texto
  );
end;
$function$;

revoke execute on function public.chamados_importar(uuid, jsonb, boolean) from public, anon;
grant execute on function public.chamados_importar(uuid, jsonb, boolean) to authenticated;
revoke execute on function public.chamado_chave(text) from public, anon, authenticated;

notify pgrst, 'reload schema';
