-- Importação de chamados passa a gerar o número, como em Ações (LUIZ, 23/11/2026).
--
-- O ID da planilha fica só em `origem_id`, para repetir o arquivo não duplicar. Se
-- ele continuasse virando o número, uma importação futura traria um #136500 e a
-- numeração da empresa saltaria para lá, porque o próximo é sempre o maior + 1.

do $migracao$
declare
  v_def text := pg_get_functiondef('public.chamados_importar(uuid, jsonb, boolean)'::regprocedure);
  v_de text := $a$          -- o número é o ID da planilha; sem ID, ou já usado nesta empresa, o sistema numera
          case when v_id_planilha is null
                 or exists (select 1 from public.tickets t where t.tenant_id = p_tenant and t.code = v_id_planilha)
               then null else v_id_planilha end,$a$;
  v_para text := $b$          -- o número é sempre gerado, como nas ações; o ID da planilha fica só em origem_id
          null,$b$;
begin
  if position(v_de in v_def) = 0 then
    raise exception 'chamados_importar: trecho do número não encontrado';
  end if;
  execute replace(v_def, v_de, v_para);
end
$migracao$;

revoke execute on function public.chamados_importar(uuid, jsonb, boolean) from public, anon;
grant execute on function public.chamados_importar(uuid, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
