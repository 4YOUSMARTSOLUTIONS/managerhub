-- O ciclo de vida de uma previsão de férias. Enum sozinho no arquivo (AGENTS.md):
-- um erro em tabela ou função no mesmo arquivo deixaria o tipo órfão no re-run.
--
--   solicitada  -> o colaborador pediu (ou o pedido voltou de reprovação)
--   aprovada    -> o gestor validou a previsão (lançamento do gestor JÁ NASCE aqui)
--   reprovada   -> devolvida com nota, pelo gestor ou pelo DP
--   efetivada   -> o DP confirmou: calculada na folha e gravada em employee_absences
--   reagendada  -> substituída por outra previsão (a linha filha aponta reagendada_de)
--   cancelada   -> desfeita com nota; o registro fica
create type public.ferias_status as enum
  ('solicitada', 'aprovada', 'reprovada', 'efetivada', 'reagendada', 'cancelada');
