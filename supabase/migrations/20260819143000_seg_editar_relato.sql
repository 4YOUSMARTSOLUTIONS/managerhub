-- O autor corrige o próprio relato, enquanto ninguém o tocou.
--
-- Quem relata está no chão da operação, muitas vezes no celular, e erra a data
-- ou esquece de citar alguém. Sem edição a saída dele é abrir um segundo relato
-- do mesmo fato, que é exatamente o que a triagem depois tem que marcar como
-- duplicado. Melhor deixar consertar.
--
-- A janela fecha no primeiro toque da segurança: só `aberto` é editável. A
-- partir de `triado` o relato já é a base de uma conversa com o gestor ou de uma
-- ação, e mudar o texto por baixo disso reescreveria o histórico de quem já leu.
--
-- A regra mora aqui, e não na policy de update: a `seg_relatos_update` é da
-- equipe de segurança, e o autor não faz parte dela. Uma função SECURITY
-- DEFINER com guarda no corpo é o jeito de dar essa permissão estreita sem
-- alargar a policy para todo mundo.

create or replace function public.seg_editar_relato(p_id uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_r          record;
  v_tipo       record;
  v_ocorrido   date;
  v_descricao  text;
  v_local      uuid;
  v_area       uuid;
  v_unit       uuid;
  v_envolvidos uuid[];
begin
  select r.* into v_r from public.seg_relatos r where r.id = p_id;
  if v_r.id is null then
    raise exception 'Relato não encontrado.';
  end if;
  if v_r.created_by <> (select auth.uid()) then
    raise exception 'Só quem registrou o relato pode editá-lo.';
  end if;
  if v_r.status <> 'aberto' then
    raise exception 'A equipe de segurança já começou a tratar este relato, então ele não muda mais. Fale com ela se algo estiver errado.';
  end if;

  v_ocorrido  := nullif(p_data->>'occurred_on', '')::date;
  v_descricao := btrim(coalesce(p_data->>'descricao', ''));
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

  select t.id, t.natureza into v_tipo
    from public.seg_tipos_relato t
   where t.id = nullif(p_data->>'tipo_id', '')::uuid
     and t.tenant_id = v_r.tenant_id
     and t.active;
  if v_tipo.id is null then
    raise exception 'Escolha um tipo de relato válido.';
  end if;

  if v_local is not null and not exists (
    select 1 from public.seg_locais l where l.id = v_local and l.tenant_id = v_r.tenant_id
  ) then
    v_local := null;
  end if;
  if v_area is not null and not exists (
    select 1 from public.seg_areas a where a.id = v_area and a.tenant_id = v_r.tenant_id
  ) then
    v_area := null;
  end if;

  select array_agg(distinct e.uid) into v_envolvidos
    from jsonb_array_elements_text(coalesce(p_data->'envolvidos', '[]'::jsonb)) as x(uid)
    cross join lateral (select x.uid::uuid as uid) e
   where exists (
     select 1 from public.memberships m
      where m.user_id = e.uid and m.tenant_id = v_r.tenant_id and m.is_active
   );

  -- a unidade é rederivada: trocar o envolvido troca a unidade do relato
  select u.id into v_unit
    from public.memberships m
    join public.membership_units mu on mu.membership_id = m.id
    join public.units u on u.id = mu.unit_id
   where m.tenant_id = v_r.tenant_id
     and m.user_id = coalesce(v_envolvidos[1], v_r.created_by)
   order by u.name
   limit 1;

  update public.seg_relatos
     set occurred_on = v_ocorrido,
         tipo_id = v_tipo.id,
         -- a natureza acompanha o tipo escolhido AGORA; o relato ainda não
         -- entrou em estatística nenhuma, então não há histórico a preservar
         snap_natureza = v_tipo.natureza,
         local_id = v_local,
         area_id = v_area,
         unit_id = v_unit,
         descricao = v_descricao
   where id = p_id;

  -- envolvidos são substituídos por inteiro: é a lista que o autor mandou
  delete from public.seg_relato_envolvidos where relato_id = p_id;
  if v_envolvidos is not null then
    insert into public.seg_relato_envolvidos (relato_id, tenant_id, user_id)
    select p_id, v_r.tenant_id, u from unnest(v_envolvidos) as u;
  end if;
end;
$$;

revoke execute on function public.seg_editar_relato(uuid, jsonb) from public, anon;
grant  execute on function public.seg_editar_relato(uuid, jsonb) to authenticated;

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
