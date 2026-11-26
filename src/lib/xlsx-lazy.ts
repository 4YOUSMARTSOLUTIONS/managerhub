/**
 * O `xlsx` sozinho pesa cerca de 880 KB e estava importado de forma estática em 14
 * módulos de cliente. Resultado: toda tela que tivesse um botão de exportar ou um
 * diálogo de importação carregava a biblioteca inteira no primeiro acesso, mesmo
 * para quem nunca clica em exportar.
 *
 * Aqui ele só é buscado quando alguém realmente vai ler ou gerar uma planilha, e
 * fica em cache no módulo: a segunda chamada não paga rede de novo.
 */
export type Xlsx = typeof import("xlsx");

let cache: Xlsx | null = null;

export async function loadXlsx(): Promise<Xlsx> {
  if (!cache) cache = await import("xlsx");
  return cache;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * A primeira aba como matriz (linha 1 = cabeçalho), com as células de data já
 * em AAAA-MM-DD, montadas do número de série do Excel SEM passar por `Date`.
 *
 * Ler com `cellDates: true` cria um `Date` à meia-noite LOCAL, e nos dias em
 * que começava o horário de verão (ex.: 02/11/1985, 20/10/1991, 15/10/2017)
 * essa meia-noite não existe no fuso de São Paulo: a data volta um dia. Em
 * 26/11/2026 isso tinha gravado 3 datas erradas pela importação de
 * colaboradores (2 nascimentos e 1 demissão). Linhas totalmente vazias saem,
 * como no `sheet_to_json(..., { blankrows: false })`.
 *
 * Use com o livro lido por `XLSX.read(buf, { type: "array", cellNF: true })`.
 */
export function matrizDaPlanilha(XLSX: Xlsx, wb: import("xlsx").WorkBook): unknown[][] {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const ref = ws?.["!ref"];
  if (!ws || !ref) return [];
  const area = XLSX.utils.decode_range(ref);
  const linhas: unknown[][] = [];
  for (let r = area.s.r; r <= area.e.r; r++) {
    const linha: unknown[] = [];
    let algum = false;
    for (let c = area.s.c; c <= area.e.c; c++) {
      const cel = ws[XLSX.utils.encode_cell({ r, c })];
      let v: unknown = cel?.v ?? null;
      if (cel && cel.t === "n" && typeof cel.z === "string" && XLSX.SSF.is_date(cel.z)) {
        const p = XLSX.SSF.parse_date_code(cel.v as number);
        if (p) v = `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
      } else if (v instanceof Date) {
        v = `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
      }
      if (v !== null && v !== "") algum = true;
      linha.push(v);
    }
    if (algum) linhas.push(linha);
  }
  return linhas;
}
