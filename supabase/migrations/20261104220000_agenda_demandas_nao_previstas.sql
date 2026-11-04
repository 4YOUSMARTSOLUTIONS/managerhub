-- Demandas não previstas no diário de bordo.
--
-- O atalho do diário grava a demanda como tarefa de data única numa agenda
-- pessoal, uma por pessoa, criada no primeiro uso. Não vai para a agenda da
-- rotina: ela é do gestor, e o colaborador só escreve nela quando o gestor
-- libera (`can_responsible_edit`), o que hoje não acontece em nenhuma.
--
-- A marca fica na agenda, e não na tarefa, porque é ela que muda as regras:
-- as tarefas daqui contam na carga do dia mas ficam fora da aderência (quem
-- registra a própria demanda e marca como feita não pode subir o indicador da
-- rotina pactuada) e fora de Tempos e movimentos (carga PLANEJADA).

alter table public.agendas
  add column if not exists imprevistos boolean not null default false;

comment on column public.agendas.imprevistos is
  'Agenda pessoal de demandas não previstas (atalho do diário de bordo). Fora da aderência e da carga planejada.';

-- uma por pessoa e empresa: o atalho procura antes de criar, e o índice segura
-- dois cliques simultâneos
create unique index if not exists agendas_imprevistos_uma_por_pessoa
  on public.agendas (tenant_id, responsible_id)
  where imprevistos;

notify pgrst, 'reload schema';
