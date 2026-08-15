-- Excluir relato e acidente: só o proprietário, e com o rastro que sobra.
--
-- Nem todo lançamento errado se conserta editando. Um relato duplicado que já
-- foi triado, um acidente lançado na pessoa errada e já encerrado: em ambos os
-- casos a saída é apagar, e hoje a tela não oferece isso.
--
-- POR QUE SÓ O PROPRIETÁRIO. A equipe de segurança tria, classifica e encerra,
-- que é o trabalho dela. Apagar não é trabalho de rotina: é reconhecer que o
-- registro não deveria existir, e acidente é registro legal (tem CAT, tem CID,
-- tem afastamento). Deixar isso na mão de quem opera a fila transformaria um
-- clique errado em prova perdida. Mesmo raciocínio do módulo de Ações, onde
-- excluir também é exclusivo do proprietário.
--
-- O QUE FICA. O `audit_trigger` grava o DELETE com a linha inteira em
-- `audit_logs`, então a exclusão é reversível na marra e visível em Logs do
-- sistema. E a AÇÃO de tratamento aberta a partir do relato NÃO é apagada
-- junto: ela já foi delegada, tem responsável e prazo, e vive no módulo de
-- Ações. Some o vínculo, não a ação.

create or replace function public.seg_exige_proprietario(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (public.is_super_admin()
          or public.has_tenant_role(p_tenant, '{owner}'::public.member_role[])) then
    raise exception 'Só o proprietário da empresa pode excluir este registro.';
  end if;
end;
$$;

revoke execute on function public.seg_exige_proprietario(uuid) from public, anon, authenticated;

/**
 * Apaga o relato. Envolvidos e o vínculo com a ação saem por cascata; a ação
 * de tratamento permanece.
 */
create or replace function public.seg_excluir_relato(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_tenant uuid;
begin
  select r.tenant_id into v_tenant from public.seg_relatos r where r.id = p_id;
  if v_tenant is null then
    raise exception 'Relato não encontrado.';
  end if;
  perform public.seg_exige_proprietario(v_tenant);

  -- um relato apagado não pode continuar sendo o "original" de outro
  update public.seg_relatos set duplicado_de = null where duplicado_de = p_id;

  delete from public.seg_relatos where id = p_id;
end;
$$;

revoke execute on function public.seg_excluir_relato(uuid) from public, anon;
grant  execute on function public.seg_excluir_relato(uuid) to authenticated;

/**
 * Apaga o acidente e os documentos dele.
 *
 * Os arquivos saem do bucket na mesma transação: linha apagada com PDF órfão no
 * storage é o pior dos dois mundos, porque o documento continua existindo sem
 * nada que diga a que caso pertencia.
 */
create or replace function public.seg_excluir_acidente(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid;
  v_paths  text[];
begin
  select a.tenant_id into v_tenant from public.seg_acidentes a where a.id = p_id;
  if v_tenant is null then
    raise exception 'Acidente não encontrado.';
  end if;
  perform public.seg_exige_proprietario(v_tenant);

  select array_agg(x.path) into v_paths
    from public.seg_acidente_anexos x where x.acidente_id = p_id;

  if v_paths is not null then
    delete from storage.objects
     where bucket_id = 'seg-acidentes' and name = any(v_paths);
  end if;

  delete from public.seg_acidentes where id = p_id;
end;
$$;

revoke execute on function public.seg_excluir_acidente(uuid) from public, anon;
grant  execute on function public.seg_excluir_acidente(uuid) to authenticated;

-- A policy de DELETE acompanha a regra da RPC. Sem isso, um administrador
-- continuaria apagando pelo PostgREST o que a tela não lhe oferece, que é
-- exatamente o tipo de porta lateral que o AGENTS.md manda fechar.
drop policy if exists seg_relatos_delete on public.seg_relatos;
create policy seg_relatos_delete on public.seg_relatos
  for delete using (tenant_id in (select public.my_role_tenant_ids('{owner}'::member_role[])));

drop policy if exists seg_acidentes_delete on public.seg_acidentes;
create policy seg_acidentes_delete on public.seg_acidentes
  for delete using (tenant_id in (select public.my_role_tenant_ids('{owner}'::member_role[])));

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
