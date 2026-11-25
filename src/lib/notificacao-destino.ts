/**
 * Parâmetros que abrem o item na tela (LUIZ, 25/11/2026): o aviso leva àquele
 * chamado ou àquela ação, e não só à lista. A tela lê o parâmetro, abre o
 * painel e o tira da URL ao fechar.
 */
export const ABRIR_CHAMADO = "chamado";
export const ABRIR_DEMANDA = "demanda";

/**
 * Para onde uma notificação leva. O sino e o aviso no celular usam o mesmo
 * mapa: tocar no aviso do celular abre a mesma tela que clicar no sino.
 *
 * Sem destino (`null`), o sino só marca como lida e o celular abre o início.
 */
export function destinoDaNotificacao(n: {
  type: string;
  demandaId?: string | null;
  plannerBoardId?: string | null;
  ticketId?: string | null;
}): string | null {
  // a notificação sabe para onde aponta: quadro do Planner, chamado ou ação
  if (n.plannerBoardId) return `/planner?quadro=${n.plannerBoardId}`;
  if (n.ticketId) return `/chamados?${ABRIR_CHAMADO}=${n.ticketId}`;
  if (n.demandaId) return `/acoes?${ABRIR_DEMANDA}=${n.demandaId}`;
  // aviso de chamado sem o id (o chamado foi excluído): ao menos a lista
  if (n.type === "ticket") return "/chamados";
  // treinamento não tem destino próprio na tabela: o tipo já diz para onde ir,
  // e uma coluna a mais em `notifications` custaria uma migração por módulo
  if (n.type.startsWith("training_")) return "/treinamentos";
  if (n.type.startsWith("punicao_")) return "/punicoes";
  if (n.type.startsWith("absenteismo_")) return "/absenteismos";
  if (n.type.startsWith("ferias_")) return "/ferias";
  // quem não tem e-mail cadastrado é o RH que resolve, na ficha do colaborador
  if (n.type === "senha_sem_email") return "/configuracoes?aba=usuarios";
  if (n.type.startsWith("seg_relato_")) return "/seguranca/relatos";
  if (n.type.startsWith("seg_acidente_")) return "/seguranca/acidentes";
  if (n.type.startsWith("seg_blitz_")) return "/seguranca/blitz";
  if (n.type.startsWith("sugestao_")) return "/sugestoes";
  if (n.type.startsWith("formulario_")) return "/formularios";
  return null;
}
