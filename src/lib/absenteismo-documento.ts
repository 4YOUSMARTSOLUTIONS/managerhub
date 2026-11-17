/**
 * Nome do documento do absenteísmo ao baixar (LUIZ, 17/11/2026), para o RH
 * arquivar sem renomear um por um:
 *
 *   ATD_2026_11_16           atestado de dias (e afastamento com documento médico)
 *   ATH_2026_11_16           atestado de horas
 *   PERÍCIA_INSS_2026_11_16  afastamento com documento da perícia do INSS
 *
 * A data é o início do período do documento. A extensão segue o arquivo que
 * subiu. Os demais motivos (licenças, suspensão, falta) e o afastamento sem o
 * tipo do documento (o importado do histórico) mantêm o nome original.
 */
export function nomeParaBaixar(d: {
  kind: string | null;
  /** `certificate_kind`: medico | odontologico | pericia_inss */
  tipoDocumento: string | null;
  /** ausência de horas (partial_day), não o primeiro dia parcial */
  emHoras: boolean;
  /** AAAA-MM-DD */
  inicio: string | null;
  original: string | null;
  caminho: string;
}): string {
  // o caminho no armazenamento leva um prefixo de data na frente do nome
  const base = d.original || d.caminho.split("/").pop()?.replace(/^\d+-/, "") || "documento";
  const ponto = base.lastIndexOf(".");
  const ext = ponto > 0 ? base.slice(ponto).toLowerCase() : "";
  const data = d.inicio && /^\d{4}-\d{2}-\d{2}/.test(d.inicio) ? d.inicio.slice(0, 10).replaceAll("-", "_") : null;
  if (!data) return base;

  if (d.kind === "afastamento" && d.tipoDocumento === "pericia_inss") return `PERÍCIA_INSS_${data}${ext}`;
  if (d.kind === "atestado" || (d.kind === "afastamento" && d.tipoDocumento === "medico")) {
    return `${d.emHoras ? "ATH" : "ATD"}_${data}${ext}`;
  }
  return base;
}

/** Rótulo do tipo de documento, na ficha, no resumo e no e-mail. */
export function rotuloTipoDocumento(v: string | null | undefined): string | null {
  return v === "medico" ? "Médico"
    : v === "odontologico" ? "Odontológico"
    : v === "pericia_inss" ? "Perícia INSS"
    : null;
}
