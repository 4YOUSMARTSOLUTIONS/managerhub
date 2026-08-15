-- Abrir relato: uma chamada só, e o aviso à equipe junto.
--
-- Poderia ser insert por policy, como a mensagem do chat. Não é, por três
-- motivos que só uma função resolve de uma vez: o relato e a lista de
-- envolvidos precisam nascer na MESMA transação (senão um erro no meio deixa
-- relato sem envolvido, e a estatística por setor perde a linha); a natureza
-- tem que ser copiada do tipo pelo servidor, nunca escolhida pela tela; e a
-- equipe de segurança precisa ser avisada no mesmo instante, senão o relato
-- fica esperando alguém abrir a tela por acaso.
--
-- O texto do aviso NÃO cita quem relatou. Essa é a regra do módulo inteiro, e
-- ela começa aqui.

create or replace function public.seg_criar_relato(p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant     uuid := public.my_active_tenant();
  v_id         uuid;
  v_tipo       record;
  v_ocorrido   date;
  v_descricao  text;
  v_unit       uuid;
  v_local      uuid;
  v_area       uuid;
  v_envolvidos uuid[];
  v_avisar     uuid[];
begin
  if v_tenant is null or not public.is_tenant_member(v_tenant) then
    raise exception 'Você não tem acesso a esta empresa.';
  end if;

  v_ocorrido  := nullif(p_data->>'occurred_on', '')::date;
  v_descricao := btrim(coalesce(p_data->>'descricao', ''));
  v_unit      := nullif(p_data->>'unit_id', '')::uuid;
  v_local     := nullif(p_data->>'local_id', '')::uuid;
  v_area      := nullif(p_data->>'area_id', '')::uuid;

  if v_ocorrido is null then
    raise exception 'Informe a data do ocorrido.';
  end if;
  if v_ocorrido > current_date then
    raise exception 'A data do ocorrido não pode estar no futuro.';
  end if;
  if v_descricao = '' then
    raise exception 'Descreva o que aconteceu.';
  end if;

  select t.id, t.name, t.natureza into v_tipo
    from public.seg_tipos_relato t
   where t.id = nullif(p_data->>'tipo_id', '')::uuid
     and t.tenant_id = v_tenant
     and t.active;
  if v_tipo.id is null then
    raise exception 'Escolha um tipo de relato válido.';
  end if;

  -- catálogo de outra empresa vira nulo em silêncio, como nas demais RPCs do
  -- projeto: não é erro do usuário, é payload adulterado
  if v_local is not null and not exists (
    select 1 from public.seg_locais l where l.id = v_local and l.tenant_id = v_tenant
  ) then
    v_local := null;
  end if;
  if v_area is not null and not exists (
    select 1 from public.seg_areas a where a.id = v_area and a.tenant_id = v_tenant
  ) then
    v_area := null;
  end if;
  if v_unit is not null and not exists (
    select 1 from public.units u where u.id = v_unit and u.tenant_id = v_tenant
  ) then
    v_unit := null;
  end if;

  insert into public.seg_relatos (
    tenant_id, unit_id, occurred_on, tipo_id, snap_natureza,
    local_id, area_id, descricao, created_by
  ) values (
    v_tenant, v_unit, v_ocorrido, v_tipo.id, v_tipo.natureza,
    v_local, v_area, v_descricao, (select auth.uid())
  )
  returning id into v_id;

  -- envolvidos: só quem tem vínculo ativo na empresa. O relato pode não ter
  -- nenhum (condição insegura costuma ser sobre a coisa, não sobre a pessoa).
  select array_agg(distinct e.uid) into v_envolvidos
    from jsonb_array_elements_text(coalesce(p_data->'envolvidos', '[]'::jsonb)) as x(uid)
    cross join lateral (select x.uid::uuid as uid) e
   where exists (
     select 1 from public.memberships m
      where m.user_id = e.uid and m.tenant_id = v_tenant and m.is_active
   );

  if v_envolvidos is not null then
    insert into public.seg_relato_envolvidos (relato_id, tenant_id, user_id)
    select v_id, v_tenant, u from unnest(v_envolvidos) as u;
  end if;

  -- avisa a equipe de segurança e a administração
  select array_agg(distinct uid) into v_avisar from (
    select e.user_id as uid from public.seg_equipe e where e.tenant_id = v_tenant
    union
    select m.user_id from public.memberships m
     where m.tenant_id = v_tenant and m.role in ('owner', 'admin') and m.is_active
  ) todos;

  if v_avisar is not null then
    perform public.notify_users(
      v_tenant, v_avisar, 'seg_relato_novo',
      'Novo relato de segurança',
      v_tipo.name || ' em ' || to_char(v_ocorrido, 'DD/MM/YYYY') || '. Abra a fila para triar.',
      null
    );
  end if;

  return v_id;
end;
$$;

revoke execute on function public.seg_criar_relato(jsonb) from public, anon;
grant  execute on function public.seg_criar_relato(jsonb) to authenticated;

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
