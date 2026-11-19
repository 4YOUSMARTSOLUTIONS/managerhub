-- Atestado: CRM (ou registro) e local de atendimento obrigatórios (LUIZ,
-- 18/11/2026). Todo atestado traz os dois: a norma do CFM manda o médico se
-- identificar com o número do conselho (o dentista, o CRO), e o local vem no
-- timbre ou no carimbo. Até aqui o envio ao RH exigia só o profissional e a
-- data de emissão.
--
-- A validação mora em absenteismo_confirmar, que absenteismo_confirmar_e_separar
-- também chama: um lugar só. Vale para o próximo envio; lançamento que já está
-- com o RH não é afetado.

do $$
declare
  v_def text := pg_get_functiondef('public.absenteismo_confirmar(uuid)'::regprocedure);
  v_de text := $q$       or coalesce(btrim(v_at.doctor_name), '') = ''
       or v_at.issued_on is null then
      raise exception 'Preencha o nome do profissional e a data de emissão do atestado.';$q$;
  v_para text := $q$       or coalesce(btrim(v_at.doctor_name), '') = ''
       or coalesce(btrim(v_at.doctor_crm), '') = ''
       or coalesce(btrim(v_at.facility), '') = ''
       or v_at.issued_on is null then
      raise exception 'Preencha o profissional, o CRM ou registro, o hospital, clínica ou local e a data de emissão do atestado.';$q$;
begin
  if (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 then
    raise exception 'trecho de absenteismo_confirmar não encontrado exatamente uma vez';
  end if;
  execute replace(v_def, v_de, v_para);
end $$;

-- exposta ao app (o envio ao RH): fica para authenticated, fora do alcance da chave pública
revoke execute on function public.absenteismo_confirmar(uuid) from public, anon;

notify pgrst, 'reload schema';
