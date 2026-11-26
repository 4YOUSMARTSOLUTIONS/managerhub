-- Motivo de afastamento "Rescisão indireta" (LUIZ, 26/11/2026).
--
-- Quem pediu rescisão indireta na Justiça segue com o contrato ativo na folha,
-- mas não trabalha. Sem um motivo próprio, essas pessoas apareciam como
-- trabalhando normalmente: pesavam na remuneração variável e nas pendências de
-- férias. Como os demais afastamentos, o efeito vem do TIPO (afastamento), não
-- do motivo: situação do colaborador, filtro "Afastados", RV, férias e
-- treinamentos passam a tratá-lo como o afastamento pelo INSS, sem mudança em
-- nenhuma outra função.

alter table public.employee_absences drop constraint employee_absences_motivo;
alter table public.employee_absences add constraint employee_absences_motivo check (
  motivo is null
  or (kind = 'afastamento' and motivo in ('afastado_inss', 'acidente_trabalho', 'aposentadoria_invalidez', 'rescisao_indireta'))
  or (kind = 'licenca' and motivo = 'licenca_maternidade')
);

comment on column public.employee_absences.motivo is
  'Detalhe do afastamento ou da licença: afastado_inss, acidente_trabalho, aposentadoria_invalidez, rescisao_indireta (afastamento) ou licenca_maternidade (licença). É a situação do colaborador enquanto vigora.';

-- A importação do histórico do absenteísmo repete a regra da constraint para
-- recusar a linha com uma mensagem clara. Patch no lugar (e não o corpo
-- recopiado) para não desfazer a correção das horas que viram o dia (21/11).
do $$
declare
  v_def text := pg_get_functiondef('public.absenteismo_importar(uuid,jsonb,boolean)'::regprocedure);
  v_de  text := $q$v_detalhe in ('afastado_inss', 'acidente_trabalho', 'aposentadoria_invalidez')$q$;
  v_para text := $q$v_detalhe in ('afastado_inss', 'acidente_trabalho', 'aposentadoria_invalidez', 'rescisao_indireta')$q$;
begin
  if position(v_de in v_def) = 0 then
    raise exception 'absenteismo_importar mudou: âncora da lista de detalhes não encontrada';
  end if;
  execute replace(v_def, v_de, v_para);
end $$;

-- a função é SECURITY DEFINER: o create or replace mantém o ACL, mas a regra da
-- casa é fechar de novo a cada migração que a reescreve
revoke execute on function public.absenteismo_importar(uuid, jsonb, boolean) from public, anon;

notify pgrst, 'reload schema';
