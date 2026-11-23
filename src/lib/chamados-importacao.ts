/**
 * Leitura da exportação de chamados do sistema anterior (LUIZ, 22/11/2026).
 *
 * O arquivo entra como sai de lá, sem montar planilha: 14 colunas, datas em texto
 * "dd/mm/aaaa hh:mm" e todas as mensagens numa célula só, cada uma com o cabeçalho
 * "[dd/mm/aaaa hh:mm] NOME: texto".
 *
 * Módulo sem "use server": roda no navegador, e a gravação fica na RPC
 * `chamados_importar`, que confere tudo de novo.
 */

export type MensagemChamado = { em: string; autor: string; texto: string };

export type LinhaChamado = {
  /** linha da planilha, para apontar o que foi recusado */
  linha: number;
  id: string;
  unidade: string;
  titulo: string;
  setor: string;
  categoria: string;
  criador: string;
  responsavel: string;
  copia: string;
  status: string;
  /** "AAAA-MM-DDTHH:MM", no horário de Brasília */
  criado_em: string;
  prazo: string;
  concluido_em: string;
  /** a primeira mensagem é o pedido de quem abriu */
  descricao: string;
  mensagens: MensagemChamado[];
};

export type RecusaChamado = { linha: number; motivo: string };

const chave = (s: unknown) =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

const COLUNAS = {
  id: "id",
  unidade: "unidade",
  titulo: "titulo",
  categoria: "categoria",
  setor: "setor",
  criador: "criado por",
  responsavel: "responsavel",
  copia: "em copia",
  status: "status",
  criacao: "data/hora de criacao",
  prazo: "prazo",
  conclusao: "data/hora de conclusao",
  mensagens: "mensagens",
} as const;

const STATUS: Record<string, string> = {
  novo: "open",
  // no sistema anterior "Aberto" é o chamado que já tem responsável
  aberto: "in_progress",
  "em atendimento": "in_progress",
  "em andamento": "in_progress",
  aguardando: "waiting",
  concluido: "resolved",
  resolvido: "resolved",
  fechado: "closed",
  cancelado: "cancelled",
};

const doisDigitos = (n: number) => String(n).padStart(2, "0");

/** "" = vazio; null = preenchido, mas ilegível */
export function dataDoChamado(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return "";
  let d: number, m: number, a: number, h: number, min: number;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    [d, m, a, h, min] = [v.getDate(), v.getMonth() + 1, v.getFullYear(), v.getHours(), v.getMinutes()];
  } else {
    const t = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?)?$/.exec(String(v).trim());
    if (!t) return null;
    [d, m, a, h, min] = [Number(t[1]), Number(t[2]), Number(t[3]), Number(t[4] ?? 0), Number(t[5] ?? 0)];
  }
  const u = new Date(Date.UTC(a, m - 1, d));
  if (u.getUTCMonth() !== m - 1 || u.getUTCDate() !== d || h > 23 || min > 59) return null;
  return `${a}-${doisDigitos(m)}-${doisDigitos(d)}T${doisDigitos(h)}:${doisDigitos(min)}`;
}

/**
 * Tira da categoria a sigla que só repete o setor: em TI, "TI - Acesso" vira
 * "Acesso"; em Serviços Gerais, "SG - Limpeza" vira "Limpeza". Sigla de outra área
 * fica ("BI - Criação de Dashboard" em Desenvolvimento), porque ali ela informa.
 */
export function categoriaSemSigla(setor: string, categoria: string): string {
  const t = /^([A-Za-zÀ-ÿ]{2,4})\s*-\s*(.+)$/.exec(categoria.trim());
  if (!t) return categoria.trim();
  const iniciais = chave(setor).split(" ").filter((p) => !["de", "da", "do", "e"].includes(p)).map((p) => p[0]).join("");
  const sigla = chave(t[1]);
  return sigla === chave(setor) || sigla === iniciais ? t[2].trim() : categoria.trim();
}

// o cabeçalho só vale no começo da linha: um texto citando outra mensagem não corta a conversa
const CABECALHO = /^\[(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2})(?::\d{2})?\]\s*([^:\n]+?):[ \t]*/gm;

export function separarMensagens(celula: unknown): MensagemChamado[] {
  const bruto = String(celula ?? "").replace(/\r\n/g, "\n").trim();
  if (!bruto) return [];
  const achados = [...bruto.matchAll(CABECALHO)];
  if (achados.length === 0) return [{ em: "", autor: "", texto: bruto }];
  return achados.map((h, i) => {
    const inicio = (h.index ?? 0) + h[0].length;
    const fim = i + 1 < achados.length ? (achados[i + 1].index ?? bruto.length) : bruto.length;
    return { em: dataDoChamado(`${h[1]} ${h[2]}`) ?? "", autor: h[3].trim(), texto: bruto.slice(inicio, fim).trim() };
  });
}

const MASCARA = "••••••";
// o que vem depois de "senha:" e não é a senha ("senha: redefinida com sucesso")
const NAO_E_SENHA = new Set([
  "a", "o", "e", "de", "do", "da", "no", "na", "com", "para", "por", "foi", "nao", "ok", "sim", "que", "sua", "seu",
  "atual", "nova", "novo", "antiga", "padrao", "provisoria", "temporaria", "inicial",
  "redefinida", "alterada", "resetada", "trocada", "atualizada", "enviada", "liberada", "desbloqueada",
  "invalida", "incorreta", "errada", "expirada", "bloqueada", "vencida",
]);
const SENHA_COM_SEPARADOR = /\b(senha|password|pwd)\b((?:\s+(?:atual|nova|provis[óo]ria|padr[ãa]o|tempor[áa]ria|inicial|de acesso))?(?:\s*[:=]\s*|\s*-\s*|\s+é\s+))(\S+)/gi;
const SENHA_SEM_SEPARADOR = /\b(senha|password|pwd)(\s+)(?=\S*\d)(\S{4,})/gi;
const SENHA_NA_FRASE = /(\b(?:senha|password|pwd)\b[^\n•]{0,30}?)(?<![\wÀ-ÿ])(?=[^\s]*[A-Za-zÀ-ÿ])(?=[^\s]*\d)[\wÀ-ÿ@#$%&*!.-]{4,}/gi;

/** Cobre a senha escrita na conversa. O resto da mensagem fica como estava. */
export function mascararSenhas(texto: string): { texto: string; cobertas: number } {
  let cobertas = 0;
  const cobre = (palavra: string, meio: string) => {
    cobertas += 1;
    return `${palavra}${meio}${MASCARA}`;
  };
  const passo1 = texto.replace(SENHA_COM_SEPARADOR, (tudo, palavra: string, meio: string, valor: string) => {
    if (valor.startsWith(MASCARA)) return tudo;
    const limpo = chave(valor).replace(/[.,;:!?)]+$/, "");
    if (NAO_E_SENHA.has(limpo)) return tudo;
    // com hífen ou "é" a frase pode seguir normal ("senha - favor resetar"):
    // só cobre o que não é uma palavra comum
    if (!/[:=]/.test(meio) && /^[a-z]+$/.test(limpo)) return tudo;
    return cobre(palavra, meio);
  });
  const passo2 = passo1.replace(SENHA_SEM_SEPARADOR, (tudo, palavra: string, meio: string, valor: string) =>
    valor.startsWith(MASCARA) ? tudo : cobre(palavra, meio));
  // "senha de acesso do sistema Abc123": letra misturada com número, na mesma frase
  const passo3 = passo2.replace(SENHA_NA_FRASE, (_tudo, antes: string) => {
    cobertas += 1;
    return `${antes}${MASCARA}`;
  });
  return { texto: passo3, cobertas };
}

/** Devolve as linhas com as senhas cobertas e quantos chamados tinham alguma. */
export function mascararLinhas(linhas: LinhaChamado[]): { linhas: LinhaChamado[]; chamados: number } {
  let chamados = 0;
  const saida = linhas.map((l) => {
    let n = 0;
    const cobre = (t: string) => {
      const r = mascararSenhas(t);
      n += r.cobertas;
      return r.texto;
    };
    const nova = {
      ...l,
      titulo: cobre(l.titulo),
      descricao: cobre(l.descricao),
      mensagens: l.mensagens.map((m) => ({ ...m, texto: cobre(m.texto) })),
    };
    if (n > 0) chamados += 1;
    return nova;
  });
  return { linhas: saida, chamados };
}

/** Lê a aba (matriz de células). `erro` = o arquivo não é a exportação de chamados. */
export function lerExportacao(matriz: unknown[][]): { linhas: LinhaChamado[]; recusas: RecusaChamado[]; erro?: string } {
  if (matriz.length < 2) return { linhas: [], recusas: [], erro: "A planilha está vazia." };
  const cabecalho = (matriz[0] ?? []).map(chave);
  const pos = Object.fromEntries(
    Object.entries(COLUNAS).map(([k, nome]) => [k, cabecalho.indexOf(nome)]),
  ) as Record<keyof typeof COLUNAS, number>;
  const faltando = (Object.keys(COLUNAS) as (keyof typeof COLUNAS)[]).filter((k) => pos[k] < 0).map((k) => COLUNAS[k]);
  if (faltando.length > 0) {
    return {
      linhas: [],
      recusas: [],
      erro: `Este arquivo não é a exportação de chamados. Colunas que faltam: ${faltando.join(", ")}.`,
    };
  }

  const linhas: LinhaChamado[] = [];
  const recusas: RecusaChamado[] = [];
  const vistos = new Set<string>();
  for (let i = 1; i < matriz.length; i++) {
    const r = matriz[i] ?? [];
    const linha = i + 1;
    const txt = (k: keyof typeof COLUNAS) => String(r[pos[k]] ?? "").trim();
    if (r.every((c) => c === null || c === undefined || c === "")) continue;

    const id = txt("id");
    const titulo = txt("titulo");
    if (!id) { recusas.push({ linha, motivo: "Sem ID." }); continue; }
    if (!titulo) { recusas.push({ linha, motivo: `Chamado ${id} sem título.` }); continue; }
    if (vistos.has(id)) { recusas.push({ linha, motivo: `ID ${id} repetido na planilha.` }); continue; }

    const status = STATUS[chave(txt("status"))];
    if (!status) { recusas.push({ linha, motivo: `Chamado ${id}: status "${txt("status")}" não reconhecido.` }); continue; }

    const criado = dataDoChamado(r[pos.criacao]);
    const prazo = dataDoChamado(r[pos.prazo]);
    const concluido = dataDoChamado(r[pos.conclusao]);
    if (!criado) { recusas.push({ linha, motivo: `Chamado ${id}: data de criação ilegível.` }); continue; }
    if (prazo === null || concluido === null) { recusas.push({ linha, motivo: `Chamado ${id}: prazo ou conclusão ilegível.` }); continue; }

    const mensagens = separarMensagens(r[pos.mensagens]);
    const [primeira, ...resto] = mensagens;
    const setor = txt("setor");
    vistos.add(id);
    linhas.push({
      linha,
      id,
      unidade: txt("unidade"),
      titulo,
      setor,
      categoria: categoriaSemSigla(setor, txt("categoria")),
      // sem "Criado Por", quem abriu é quem escreveu a primeira mensagem
      criador: txt("criador") || primeira?.autor || "",
      responsavel: txt("responsavel"),
      copia: txt("copia"),
      status,
      criado_em: criado,
      prazo,
      concluido_em: concluido,
      descricao: primeira?.texto ?? "",
      // mensagem só com anexo chega sem texto no arquivo, e o anexo não vem junto
      mensagens: resto.filter((m) => m.texto),
    });
  }
  return { linhas, recusas };
}
