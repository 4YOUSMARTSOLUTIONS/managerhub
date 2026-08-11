-- Ação: a Seção passa a ser DERIVADA e o responsável vira obrigatório.
--
-- 1. Seção. Ela saiu do formulário: quem informa Pilar, Bloco e Item já disse
--    qual é a Seção, porque item e bloco a carregam. A função para de confiar
--    no `secao_id` do payload e passa a derivá-la do item (ou do bloco, quando
--    a ação não tem item). Assim ela continua indo para o banco e para as
--    telas, sem o usuário digitar, e sem chance de vir divergente do item.
--
-- 2. Responsável. Uma demanda sem responsável nasce órfã: não aparece na lista
--    de ninguém e não cobra ninguém. A função recusa, dizendo qual demanda
--    está sem gente. A tela recusa antes, esta é a rede de segurança.
--    Hoje a base tem 0 demandas sem responsável, então nada existente conflita.
--
-- O corpo é remendado a partir do banco (molde da 20260807162000): a função é
-- longa e uma cópia à mão perderia linha em silêncio.
do $do$
declare
  v_def text;
  v_new text;

  -- (1) a Seção deixa de vir do payload
  c_secao_velha constant text := $q$case when v_sdpo then (select id from public.sdpo_secoes where id = nullif(p_data->>'secao_id','')::uuid and tenant_id = v_tenant) end,$q$;
  c_secao_nova constant text := $q$case when v_sdpo then coalesce(
      (select i.secao_id from public.sdpo_itens i where i.id = nullif(p_data->>'item_id','')::uuid and i.tenant_id = v_tenant),
      (select b.secao_id from public.sdpo_blocos b where b.id = nullif(p_data->>'bloco_id','')::uuid and b.tenant_id = v_tenant)
    ) end,$q$;

  -- (2) demanda sem responsável é recusada, com o número da linha na mensagem
  c_dem_velha constant text := $q$    if coalesce(trim(d->>'description'),'') = '' then continue; end if;$q$;
  c_dem_nova constant text := $q$    if coalesce(trim(d->>'description'),'') = '' then continue; end if;
    v_dem_n := v_dem_n + 1;
    if (select count(*) from jsonb_array_elements_text(coalesce(d->'assignees','[]'::jsonb)) x
         where exists (select 1 from public.memberships m where m.tenant_id = v_tenant and m.user_id = x::uuid)) = 0 then
      raise exception 'Informe ao menos um responsável na demanda %', v_dem_n;
    end if;$q$;

  -- contador das demandas, para a mensagem citar qual delas
  c_decl_velha constant text := $q$  v_dem_ids uuid[] := '{}';$q$;
  c_decl_nova constant text := $q$  v_dem_ids uuid[] := '{}';
  v_dem_n int := 0;$q$;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_action';

  if (length(v_def) - length(replace(v_def, c_secao_velha, ''))) / length(c_secao_velha) <> 1
     or (length(v_def) - length(replace(v_def, c_dem_velha, ''))) / length(c_dem_velha) <> 1
     or (length(v_def) - length(replace(v_def, c_decl_velha, ''))) / length(c_decl_velha) <> 1 then
    raise exception 'create_action: trechos esperados não estão exatamente uma vez no corpo';
  end if;

  v_new := replace(v_def, c_secao_velha, c_secao_nova);
  v_new := replace(v_new, c_decl_velha, c_decl_nova);
  v_new := replace(v_new, c_dem_velha, c_dem_nova);
  execute v_new;
end
$do$;

revoke execute on function public.create_action(jsonb) from public, anon;

-- Backfill: ações SDPO que têm item (ou bloco) mas ficaram sem seção gravada.
-- São poucas; as demais 6k são ações antigas importadas sem classificação
-- nenhuma, e para essas não há de onde derivar.
update public.actions a set secao_id = coalesce(
    (select i.secao_id from public.sdpo_itens i where i.id = a.item_id),
    (select b.secao_id from public.sdpo_blocos b where b.id = a.bloco_id)
  )
where a.is_sdpo and a.secao_id is null and (a.item_id is not null or a.bloco_id is not null);
