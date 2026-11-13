-- Perguntas da blitz: excluir pergunta já respondida passa a desativar, e a
-- equipe de segurança inclui e liga/desliga perguntas (LUIZ, 13/11/2026).
--
-- (1) A resposta apontava para a pergunta com `on delete set null`. Com isso o
-- banco nunca recusava a exclusão, o `deleteSegCatalogo` nunca caía no
-- "desativa no lugar" e a pergunta já respondida era apagada de verdade (a
-- resposta ficava com o texto carimbado, mas sem a pergunta). Meios e motivos
-- já recusam (`restrict`); aqui fica `no action`, que recusa do mesmo jeito a
-- exclusão direta e, por ser conferido no fim do comando, não atrapalha a
-- exclusão em cascata de uma empresa inteira.
--
-- (2) A equipe de segurança (`seg_equipe`) passa a incluir pergunta (com os
-- meios) e a desativar/reativar. Por RPC com a trava no corpo, e não por
-- policy: a policy de escrita na tabela continua só owner/admin, então editar
-- o texto, trocar os meios de pergunta existente e excluir seguem com eles,
-- nem pela tela nem pela API. A RLS não tem granularidade de coluna, e liberar
-- UPDATE para a equipe liberaria o texto junto com o `active`.

alter table public.seg_blitz_respostas
  drop constraint seg_blitz_respostas_pergunta_id_fkey;
alter table public.seg_blitz_respostas
  add constraint seg_blitz_respostas_pergunta_id_fkey
  foreign key (pergunta_id) references public.seg_blitz_perguntas(id);

create or replace function public.seg_blitz_pergunta_incluir(p_name text, p_meio_ids uuid[] default '{}')
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid := public.my_active_tenant();
  v_name   text := btrim(coalesce(p_name, ''));
  v_id     uuid;
begin
  if v_tenant is null then
    raise exception 'Você não tem acesso a esta empresa.';
  end if;
  if not public.pode_tratar_seguranca(v_tenant) then
    raise exception 'Só a equipe de segurança, o proprietário e o administrador incluem perguntas da blitz.'
      using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'Escreva a pergunta.';
  end if;
  -- meio de outra empresa ou inexistente é recusado, não ignorado
  if exists (
    select 1 from unnest(coalesce(p_meio_ids, '{}'::uuid[])) as m(id)
     where m.id is null
        or not exists (select 1 from public.seg_blitz_meios x where x.id = m.id and x.tenant_id = v_tenant)
  ) then
    raise exception 'Meio de transporte inválido.';
  end if;

  insert into public.seg_blitz_perguntas (tenant_id, name)
  values (v_tenant, v_name)
  returning id into v_id;

  -- sem meio = vale para todos (regra da cascata)
  insert into public.seg_blitz_pergunta_meios (tenant_id, pergunta_id, meio_id)
  select v_tenant, v_id, d.id
    from (select distinct unnest(coalesce(p_meio_ids, '{}'::uuid[])) as id) d;

  return v_id;
end;
$$;

create or replace function public.seg_blitz_pergunta_ativar(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid := public.my_active_tenant();
begin
  if v_tenant is null then
    raise exception 'Você não tem acesso a esta empresa.';
  end if;
  if not public.pode_tratar_seguranca(v_tenant) then
    raise exception 'Só a equipe de segurança, o proprietário e o administrador desativam perguntas da blitz.'
      using errcode = '42501';
  end if;
  if p_active is null then
    raise exception 'Informe se a pergunta fica ativa.';
  end if;

  update public.seg_blitz_perguntas
     set active = p_active
   where id = p_id and tenant_id = v_tenant;
  if not found then
    raise exception 'Pergunta não encontrada.';
  end if;
end;
$$;

revoke execute on function public.seg_blitz_pergunta_incluir(text, uuid[]) from public, anon;
revoke execute on function public.seg_blitz_pergunta_ativar(uuid, boolean) from public, anon;
grant execute on function public.seg_blitz_pergunta_incluir(text, uuid[]) to authenticated;
grant execute on function public.seg_blitz_pergunta_ativar(uuid, boolean) to authenticated;

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
