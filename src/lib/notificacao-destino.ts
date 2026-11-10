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
}): string | null {
  // a notificação sabe para onde aponta: quadro do Planner ou lista de Ações
  if (n.plannerBoardId) return `/planner?quadro=${n.plannerBoardId}`;
  if (n.demandaId) return "/acoes";
  // treinamento não tem destino próprio na tabela: o tipo já diz para onde ir,
  // e uma coluna a mais em `notifications` custaria uma migração por módulo
  if (n.type.startsWith("training_")) return "/treinamentos";
  if (n.type.startsWith("punicao_")) return "/punicoes";
  if (n.type.startsWith("absenteismo_")) return "/absenteismos";
  if (n.type.startsWith("ferias_")) return "/ferias";
  // quem não tem e-mail cadastrado é o RH que resolve, na ficha do colaborador
  if (n.type === "senha_sem_email") return "/configuracoes?tab=usuarios";
  if (n.type.startsWith("seg_relato_")) return "/seguranca/relatos";
  if (n.type.startsWith("seg_acidente_")) return "/seguranca/acidentes";
  if (n.type.startsWith("seg_blitz_")) return "/seguranca/blitz";
  return null;
}
