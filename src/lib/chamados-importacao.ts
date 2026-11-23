/**
 * Leitura da planilha de importação de chamados (LUIZ, 22/11/2026).
 *
 * O formato oficial é o MODELO abaixo, porque cada revenda vem de um sistema
 * diferente. As colunas são achadas pelo nome e aceitam sinônimos, e é assim que a
 * exportação do SAVI entra sem ajuste: "Criado Por" vale como Solicitante, e
 * "Mensagens" traz a conversa numa célula só, com o pedido na primeira mensagem.
 *
 * Módulo sem "use server": roda no navegador, e a gravação fica na RPC
 * `chamados_importar`, que confere tudo de novo.
 */

export type MensagemChamado = { em: string; autor: string; texto: string };

export type LinhaChamado = {
  /** linha da planilha, para apontar o que foi recusado */
  linha: number;
  /** vazio = o sistema numera */
  id: string;
  unidade: string;
  titulo: string;
  setor: string;
  categoria: string;
  /** low, medium, high, urgent; vazio = não informada */
  prioridade: string;
  criador: string;
  responsavel: string;
  copia: string;
  status: string;
  /** "AAAA-MM-DDTHH:MM", no horário de Brasília */
  criado_em: string;
  prazo: string;
  concluido_em: string;
  descricao: string;
  mensagens: MensagemChamado[];
};

export type RecusaChamado = { linha: number; motivo: string };

export const MODELO_CABECALHO = [
  "ID", "Título", "Descrição", "Setor", "Categoria", "Prioridade", "Unidade", "Solicitante", "Responsável",
  "Em cópia", "Status", "Data de criação", "Prazo", "Data de conclusão", "Comentários",
];

export const MODELO_EXEMPLOS: string[][] = [
  [
    "1001", "Computador não liga", "O computador do financeiro não liga desde a manhã.", "TI", "Computador", "Alta",
    "MATRIZ", "Maria Souza", "João Silva", "Ana Lima; Pedro Santos", "Concluído", "10/08/2026 08:30", "12/08/2026 08:30",
    "11/08/2026 16:45", "10/08/2026 09:10 | João Silva | Vou verificar a fonte\n11/08/2026 16:40 | João Silva | Fonte trocada",
  ],
  [
    "", "Trocar lâmpada da recepção", "", "Serviços Gerais", "Manutenção Corretiva", "", "", "João Silva", "", "", "Aberto",
    "05/09/2026", "15/09/2026", "", "",
  ],
];

export const MODELO_INSTRUCOES: string[][] = [
  ["Coluna", "Como preencher"],
  ["ID", "Número do chamado no sistema de origem. Se preencher, o chamado mantém esse número. Vazio: o sistema numera."],
  ["Título", "Obrigatório. Resumo do chamado."],
  ["Descrição", "Detalhe do pedido. Opcional."],
  ["Setor", "Nome do setor. Se não existir, é criado inativo."],
  ["Categoria", "Nome da categoria dentro do setor. Se não existir, é criada inativa."],
  ["Prioridade", "Baixa, Média, Alta ou Urgente (padrão: Média)."],
  ["Unidade", "Nome da unidade cadastrada. Use \"Todas\" ou deixe vazio para valer para todas."],
  ["Solicitante", "Nome completo de quem abriu, como no cadastro. Sem cadastro, fica só o nome escrito."],
  ["Responsável", "Nome completo de quem atende, como no cadastro. Uma pessoa."],
  ["Em cópia", "Nomes de quem acompanhava. Fica como informação na ficha e não dá acesso ao chamado."],
  ["Status", "Aberto, Em atendimento, Aguardando, Concluído, Fechado ou Cancelado (padrão: Aberto; Concluído se houver data de conclusão)."],
  ["Data de criação", "DD/MM/AAAA, com ou sem hora (DD/MM/AAAA HH:MM). Vazio: usa a data de hoje."],
  ["Prazo", "DD/MM/AAAA, com ou sem hora. Sem hora, vale até o fim do dia."],
  ["Data de conclusão", "DD/MM/AAAA, com ou sem hora. Só para chamado encerrado."],
  ["Comentários", "Histórico da conversa. Um por linha na célula (Alt+Enter), no formato: data | autor | texto."],
  ["Como funciona", "Nada é gravado antes do resumo, ninguém recebe aviso, e importar o mesmo arquivo de novo não duplica."],
];

const chave = (s: unknown) =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** comparação exata: "Data de criação" não pode ser confundida com outra coluna por um trecho do nome */
const COLUNAS = {
  id: ["id", "codigo", "numero"],
  titulo: ["titulo", "assunto"],
  descricao: ["descricao"],
  setor: ["setor"],
  categoria: ["categoria"],
  prioridade: ["prioridade"],
  unidade: ["unidade"],
  solicitante: ["solicitante", "criado por", "aberto por"],
  responsavel: ["responsavel"],
  copia: ["em copia", "copia"],
  status: ["status", "situacao"],
  criacao: ["data de criacao", "data/hora de criacao", "criado em", "aberto em", "data de abertura"],
  prazo: ["prazo", "data limite"],
  conclusao: ["data de conclusao", "data/hora de conclusao", "concluido em"],
  comentarios: ["comentarios", "mensagens"],
} as const;

const STATUS: Record<string, string> = {
  novo: "open",
  nova: "open",
  pendente: "open",
  "em atendimento": "in_progress",
  "em andamento": "in_progress",
  aguardando: "waiting",
  concluido: "resolved",
  concluida: "resolved",
  resolvido: "resolved",
  resolvida: "resolved",
  finalizado: "resolved",
  finalizada: "resolved",
  fechado: "closed",
  fechada: "closed",
  cancelado: "cancelled",
  cancelada: "cancelled",
};

const PRIORIDADE: Record<string, string> = {
  baixa: "low", baixo: "low",
  media: "medium", medio: "medium", normal: "medium",
  alta: "high", alto: "high",
  urgente: "urgent",
};

/**
 * "Aberto" depende de ter dono: no SAVI é o chamado que alguém já pegou, e o
 * sistema chama isso de "Em atendimento". "Atrasado" não é status, sai do prazo.
 */
function statusDoChamado(bruto: string, responsavel: string, concluido: string): string | null {
  const k = chave(bruto);
  if (!k) return concluido ? "resolved" : "open";
  if (["aberto", "aberta", "atrasado", "atrasada"].includes(k)) return responsavel ? "in_progress" : "open";
  return STATUS[k] ?? null;
}

const doisDigitos = (n: number) => String(n).padStart(2, "0");

/**
 * Data da célula em "AAAA-MM-DDTHH:MM". "" = vazia; null = preenchida, mas ilegível.
 * `semHora` é o horário de quem só informou o dia: meio-dia nunca vira o dia, e o
 * prazo usa 23:59 para o chamado não nascer atrasado no próprio dia do vencimento.
 */
export function dataDoChamado(v: unknown, semHora = "12:00"): string | null {
  if (v === null || v === undefined || v === "") return "";
  let a: number, m: number, d: number;
  let hora: string | null = null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    [a, m, d] = [v.getFullYear(), v.getMonth() + 1, v.getDate()];
    if (v.getHours() !== 0 || v.getMinutes() !== 0) hora = `${doisDigitos(v.getHours())}:${doisDigitos(v.getMinutes())}`;
  } else {
    const s = String(v).trim();
    const br = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?:[ T]+(\d{1,2}):(\d{2})(?::\d{2})?)?$/.exec(s);
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/.exec(s);
    if (br) {
      [d, m, a] = [Number(br[1]), Number(br[2]), Number(br[3].length === 2 ? `20${br[3]}` : br[3])];
      if (br[4]) hora = `${doisDigitos(Number(br[4]))}:${br[5]}`;
    } else if (iso) {
      [a, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
      if (iso[4]) hora = `${doisDigitos(Number(iso[4]))}:${iso[5]}`;
    } else {
      return null;
    }
  }
  const u = new Date(Date.UTC(a, m - 1, d));
  if (u.getUTCMonth() !== m - 1 || u.getUTCDate() !== d) return null;
  if (hora && (Number(hora.slice(0, 2)) > 23 || Number(hora.slice(3)) > 59)) return null;
  return `${a}-${doisDigitos(m)}-${doisDigitos(d)}T${hora ?? semHora}`;
}

// o cabeçalho só vale no começo da linha: um texto citando outra mensagem não corta a conversa
const CABECALHO = /^\[(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2})(?::\d{2})?\]\s*([^:\n]+?):[ \t]*/gm;

/** Aceita "[data hora] NOME: texto" (SAVI) ou uma linha por comentário, "data | autor | texto" (modelo). */
export function separarMensagens(celula: unknown): MensagemChamado[] {
  const bruto = String(celula ?? "").replace(/\r\n/g, "\n").trim();
  if (!bruto) return [];
  const achados = [...bruto.matchAll(CABECALHO)];
  if (achados.length > 0) {
    return achados.map((h, i) => {
      const inicio = (h.index ?? 0) + h[0].length;
      const fim = i + 1 < achados.length ? (achados[i + 1].index ?? bruto.length) : bruto.length;
      return { em: dataDoChamado(`${h[1]} ${h[2]}`) ?? "", autor: h[3].trim(), texto: bruto.slice(inicio, fim).trim() };
    });
  }
  return bruto.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const p = l.split("|").map((x) => x.trim());
    if (p.length >= 3) return { em: dataDoChamado(p[0]) || "", autor: p[1], texto: p.slice(2).join(" | ") };
    if (p.length === 2) {
      const em = dataDoChamado(p[0]);
      return em ? { em, autor: "", texto: p[1] } : { em: "", autor: p[0], texto: p[1] };
    }
    return { em: "", autor: "", texto: p[0] };
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

/** Lê a aba (matriz de células). `erro` = a planilha não tem a coluna obrigatória. */
export function lerPlanilhaDeChamados(matriz: unknown[][]): { linhas: LinhaChamado[]; recusas: RecusaChamado[]; erro?: string } {
  if (matriz.length < 2) return { linhas: [], recusas: [], erro: "A planilha está vazia." };
  const cabecalho = (matriz[0] ?? []).map(chave);
  const pos = Object.fromEntries(
    Object.entries(COLUNAS).map(([k, nomes]) => [k, cabecalho.findIndex((h) => (nomes as readonly string[]).includes(h))]),
  ) as Record<keyof typeof COLUNAS, number>;
  if (pos.titulo < 0) return { linhas: [], recusas: [], erro: "Não encontrei a coluna \"Título\". Baixe o modelo." };

  const linhas: LinhaChamado[] = [];
  const recusas: RecusaChamado[] = [];
  const vistos = new Set<string>();
  for (let i = 1; i < matriz.length; i++) {
    const r = matriz[i] ?? [];
    const linha = i + 1;
    if (r.every((c) => c === null || c === undefined || c === "")) continue;
    const txt = (k: keyof typeof COLUNAS) => (pos[k] >= 0 ? String(r[pos[k]] ?? "").trim() : "");
    const cel = (k: keyof typeof COLUNAS) => (pos[k] >= 0 ? r[pos[k]] : "");

    const id = txt("id");
    const nome = id ? `Chamado ${id}` : "Chamado";
    const titulo = txt("titulo");
    if (!titulo) { recusas.push({ linha, motivo: `${nome} sem título.` }); continue; }
    if (id && vistos.has(id)) { recusas.push({ linha, motivo: `ID ${id} repetido na planilha.` }); continue; }

    const criado = dataDoChamado(cel("criacao"));
    const prazo = dataDoChamado(cel("prazo"), "23:59");
    const concluido = dataDoChamado(cel("conclusao"));
    if (criado === null) { recusas.push({ linha, motivo: `${nome}: data de criação ilegível.` }); continue; }
    if (prazo === null) { recusas.push({ linha, motivo: `${nome}: prazo ilegível.` }); continue; }
    if (concluido === null) { recusas.push({ linha, motivo: `${nome}: data de conclusão ilegível.` }); continue; }

    const responsavel = txt("responsavel");
    const status = statusDoChamado(txt("status"), responsavel, concluido);
    if (!status) { recusas.push({ linha, motivo: `${nome}: status "${txt("status")}" não reconhecido.` }); continue; }

    const prioridadeTxt = chave(txt("prioridade"));
    const prioridade = prioridadeTxt ? PRIORIDADE[prioridadeTxt] : "";
    if (prioridade === undefined) { recusas.push({ linha, motivo: `${nome}: prioridade "${txt("prioridade")}" não reconhecida.` }); continue; }

    // sem coluna de descrição (SAVI), o pedido é a primeira mensagem da conversa
    const conversa = separarMensagens(cel("comentarios"));
    const temDescricao = pos.descricao >= 0;
    const primeira = temDescricao ? undefined : conversa[0];
    const seguintes = temDescricao ? conversa : conversa.slice(1);

    if (id) vistos.add(id);
    linhas.push({
      linha,
      id,
      unidade: txt("unidade"),
      titulo,
      setor: txt("setor"),
      categoria: txt("categoria"),
      prioridade,
      criador: txt("solicitante") || primeira?.autor || "",
      responsavel,
      copia: txt("copia"),
      status,
      criado_em: criado,
      prazo,
      concluido_em: concluido,
      descricao: temDescricao ? txt("descricao") : (primeira?.texto ?? ""),
      // mensagem só com anexo chega sem texto no arquivo, e o anexo não vem junto
      mensagens: seguintes.filter((m) => m.texto),
    });
  }
  return { linhas, recusas };
}
