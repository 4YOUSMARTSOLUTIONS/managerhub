/**
 * Sessão encerrada por falta de uso (LUIZ, 10/11/2026): o mesmo celular passa
 * de um motorista para outro, e sessão esquecida aberta deixava férias e a
 * escolha do 13º na mão do próximo.
 *
 * A regra (minutos por nível, com padrão da empresa) mora no banco
 * (`minha_inatividade`). Quem conta o uso é o app (`SessaoInatividade`): toque,
 * rolagem e digitação gravam a hora num cookie, no relógio do SERVIDOR (celular
 * com hora errada não encerra nem estica a sessão). O proxy lê o mesmo cookie e
 * recusa a sessão vencida, o que pega quem reabre o app fechado depois do prazo.
 *
 * Sem "use client": o proxy (servidor) e o app usam as mesmas constantes.
 */

/** Hora do último uso, em segundos (relógio do servidor). */
export const COOKIE_USO = "mh_uso";
/** O tempo sem uso desta pessoa, em minutos. Sem cookie = sem limite. */
export const COOKIE_LIMITE = "mh_inat";

/**
 * O app sai no tempo certo; o servidor só age depois desta folga, para não
 * disputar com o app aberto e pegar só quem ficou com ele fechado.
 */
export const FOLGA_DO_SERVIDOR_S = 120;

/** Opções de tempo em Configurações (minutos). */
export const OPCOES_DE_TEMPO = [15, 30, 60, 120, 240, 480, 720, 1440];

export function rotuloDoTempo(min: number | null): string {
  if (min === null) return "Sem limite";
  if (min < 60) return `${min} minutos`;
  const h = min / 60;
  return Number.isInteger(h) ? `${h} hora${h > 1 ? "s" : ""}` : `${min} minutos`;
}

/** Hora do login (segundos) dentro das claims do token (`amr`). */
export function horaDoLogin(claims: Record<string, unknown> | null | undefined): number {
  const amr = (claims?.amr as { timestamp?: number }[] | undefined) ?? [];
  return amr.reduce((m, a) => Math.max(m, Number(a?.timestamp) || 0), 0);
}
