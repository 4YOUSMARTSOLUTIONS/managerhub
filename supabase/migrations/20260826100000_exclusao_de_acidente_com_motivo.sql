-- Excluir acidente passa a exigir o motivo.
--
-- Acidente é registro legal: tem CAT, CID, afastamento e entra na pirâmide.
-- Apagar já era exclusivo do proprietário, mas o `audit_logs` guardava só O QUE
-- sumiu, nunca POR QUÊ. Meses depois, "por que este acidente não está na base?"
-- não tinha resposta — e essa é justamente a pergunta que aparece em auditoria.
--
-- ONDE O MOTIVO FICA. Numa coluna do próprio acidente, preenchida no instante
-- anterior ao delete. Parece indireto e é o contrário: o `audit_trigger` grava a
-- LINHA INTEIRA no DELETE, então o motivo viaja junto com tudo o que foi
-- apagado, no mesmo registro de log, sem tabela nova para consultar e sem mexer
-- no trigger genérico (que serve outras 40 tabelas).
--
-- A coluna nunca é lida em operação: nasce nula, vive nula e só é escrita para
-- morrer junto com a linha, um instante depois.
alter table public.seg_acidentes
  add column if not exists motivo_exclusao text;

comment on column public.seg_acidentes.motivo_exclusao is
  'Preenchida só no instante da exclusão, para o motivo entrar no audit_logs junto com a linha apagada. Sempre nula em registro vivo.';

-- Assinatura nova: parâmetro com default criaria uma SEGUNDA função, e a antiga
-- (sem motivo) continuaria valendo e alcançável. Derrubar primeiro é o que
-- garante que não sobra caminho para apagar sem justificar.
drop function if exists public.seg_excluir_acidente(uuid);

create or replace function public.seg_excluir_acidente(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid;
  v_paths  text[];
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  select a.tenant_id into v_tenant from public.seg_acidentes a where a.id = p_id;
  if v_tenant is null then
    raise exception 'Acidente não encontrado.';
  end if;
  perform public.seg_exige_proprietario(v_tenant);

  if v_motivo is null then
    raise exception 'Informe o motivo da exclusão.';
  end if;
  if length(v_motivo) < 10 then
    raise exception 'Descreva o motivo da exclusão com um pouco mais de detalhe.';
  end if;

  -- o motivo entra na linha ANTES do delete, para o log do DELETE carregá-lo
  update public.seg_acidentes set motivo_exclusao = v_motivo where id = p_id;

  select array_agg(x.path) into v_paths
    from public.seg_acidente_anexos x where x.acidente_id = p_id;

  if v_paths is not null then
    delete from storage.objects
     where bucket_id = 'seg-acidentes' and name = any(v_paths);
  end if;

  delete from public.seg_acidentes where id = p_id;
end;
$$;

revoke execute on function public.seg_excluir_acidente(uuid, text) from public, anon;
grant  execute on function public.seg_excluir_acidente(uuid, text) to authenticated;

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
