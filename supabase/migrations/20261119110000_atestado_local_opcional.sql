-- Atestado: o local de atendimento volta a ser OPCIONAL (LUIZ, 19/11/2026).
-- A migração 20261118270000 passou a exigir o CRM e o local; o CRM continua
-- obrigatório, mas nem todo atestado traz hospital, clínica ou local.
--
-- A validação mora em absenteismo_confirmar (absenteismo_confirmar_e_separar
-- também chama): um lugar só.

do $$
declare
  v_def text := pg_get_functiondef('public.absenteismo_confirmar(uuid)'::regprocedure);
  v_de text := $q$       or coalesce(btrim(v_at.doctor_crm), '') = ''
       or coalesce(btrim(v_at.facility), '') = ''
       or v_at.issued_on is null then
      raise exception 'Preencha o profissional, o CRM ou registro, o hospital, clínica ou local e a data de emissão do atestado.';$q$;
  v_para text := $q$       or coalesce(btrim(v_at.doctor_crm), '') = ''
       or v_at.issued_on is null then
      raise exception 'Preencha o profissional, o CRM ou registro e a data de emissão do atestado.';$q$;
begin
  if (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 then
    raise exception 'trecho de absenteismo_confirmar não encontrado exatamente uma vez';
  end if;
  execute replace(v_def, v_de, v_para);
end $$;

-- exposta ao app (o envio ao RH): fica para authenticated, fora do alcance da chave pública
revoke execute on function public.absenteismo_confirmar(uuid) from public, anon;

notify pgrst, 'reload schema';
