/**
 * Formulários (LUIZ, 24/11/2026): o que é comum ao editor, à tela de resposta,
 * à tabela de respostas e ao servidor. Sem "use server" e sem JSX.
 *
 * Tipos de pergunta: o benchmark de Google Forms, Microsoft Forms, Typeform e
 * Jotform, somado ao que o sistema antigo tinha (texto curto, parágrafo,
 * múltipla escolha, número, caixas de seleção, lista suspensa, data, hora,
 * fotos, arquivos, NPS e seção). Ficou de fora o que não cabe num formulário
 * interno: pagamento, agendamento externo e campos de contato de cliente.
 */

export type TipoCampo =
  | "texto_curto" | "paragrafo"
  | "multipla_escolha" | "caixas_selecao" | "lista_suspensa" | "sim_nao"
  | "numero" | "data" | "hora"
  | "escala" | "avaliacao" | "nps"
  | "grade_multipla" | "grade_caixas" | "ranking"
  | "fotos" | "arquivos" | "assinatura"
  | "colaborador"
  | "secao" | "texto";

export type FormatoTexto = "livre" | "email" | "telefone" | "link";

export type Condicao = { campo: string; valores: string[] };

export type Campo = {
  id: string;
  tipo: TipoCampo;
  titulo: string;
  descricao?: string;
  obrigatorio?: boolean;
  /** tirada do formulário depois de ter resposta: some da tela, fica na planilha */
  removido?: boolean;
  /** só aparece quando a resposta de outra pergunta for uma destas */
  condicao?: Condicao | null;
  // escolhas
  opcoes?: string[];
  outro?: boolean;
  embaralhar?: boolean;
  minSel?: number | null;
  maxSel?: number | null;
  // texto
  formato?: FormatoTexto;
  maxCaracteres?: number | null;
  // número
  min?: number | null;
  max?: number | null;
  inteiro?: boolean;
  // escala
  escalaMin?: 0 | 1;
  escalaMax?: number;
  rotuloMin?: string;
  rotuloMax?: string;
  // avaliação
  estrelas?: number;
  // grades
  linhas?: string[];
  colunas?: string[];
  // fotos e arquivos
  maxArquivos?: number;
};

export type Arquivo = { path: string; nome: string; tipo?: string; tamanho?: number };

/** Valor de uma resposta, conforme o tipo da pergunta. */
export type Valor =
  | string
  | number
  | string[]
  | { op?: string; outro?: string }
  | { ops: string[]; outro?: string }
  | Record<string, string>
  | Record<string, string[]>
  | Arquivo[]
  | { id: string; nome: string };

export type Respostas = Record<string, Valor>;

export type FormularioStatus = "rascunho" | "publicado" | "encerrado";

export type Formulario = {
  id: string;
  tenantId: string;
  criadoPor: string | null;
  criadoPorNome: string;
  titulo: string;
  descricao: string | null;
  campos: Campo[];
  status: FormularioStatus;
  anonimo: boolean;
  /** "Histórico privado": só quem gere vê as respostas. Sem isso, o público vê o histórico */
  privado: boolean;
  variasRespostas: boolean;
  permiteEditar: boolean;
  prazo: string | null;
  mensagemFinal: string | null;
  publicoTodos: boolean;
  publicoNiveis: string[];
  publicoCargos: string[];
  publicoPessoas: string[];
  unidades: string[];
  publicadoEm: string | null;
  encerradoEm: string | null;
  createdAt: string;
  updatedAt: string;
};

export const COLUNAS_FORMULARIO =
  "id, tenant_id, criado_por, titulo, descricao, campos, status, anonimo, privado, varias_respostas, permite_editar, " +
  "prazo, mensagem_final, publico_todos, publico_niveis, publico_cargos, publico_pessoas, unidades, " +
  "publicado_em, encerrado_em, created_at, updated_at";

type LinhaFormulario = {
  id: string; tenant_id: string; criado_por: string | null; titulo: string; descricao: string | null;
  campos: unknown; status: string; anonimo: boolean; privado: boolean; varias_respostas: boolean; permite_editar: boolean;
  prazo: string | null; mensagem_final: string | null; publico_todos: boolean; publico_niveis: string[];
  publico_cargos: string[]; publico_pessoas: string[]; unidades: string[]; publicado_em: string | null;
  encerrado_em: string | null; created_at: string; updated_at: string;
};

export function formularioDaLinha(r: LinhaFormulario, criadoPorNome = "—"): Formulario {
  return {
    id: r.id, tenantId: r.tenant_id, criadoPor: r.criado_por, criadoPorNome,
    titulo: r.titulo, descricao: r.descricao,
    campos: Array.isArray(r.campos) ? (r.campos as Campo[]) : [],
    status: r.status as FormularioStatus,
    anonimo: r.anonimo, privado: r.privado, variasRespostas: r.varias_respostas, permiteEditar: r.permite_editar,
    prazo: r.prazo, mensagemFinal: r.mensagem_final,
    publicoTodos: r.publico_todos, publicoNiveis: r.publico_niveis ?? [], publicoCargos: r.publico_cargos ?? [],
    publicoPessoas: r.publico_pessoas ?? [], unidades: r.unidades ?? [],
    publicadoEm: r.publicado_em, encerradoEm: r.encerrado_em, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Catálogo de tipos
// ---------------------------------------------------------------------------

export type GrupoTipo = "texto" | "escolha" | "numero" | "avaliacao" | "anexo" | "outros" | "layout";

export const GRUPOS_TIPO: { id: GrupoTipo; label: string }[] = [
  { id: "texto", label: "Texto" },
  { id: "escolha", label: "Escolha" },
  { id: "numero", label: "Número, data e hora" },
  { id: "avaliacao", label: "Avaliação" },
  { id: "anexo", label: "Fotos, arquivos e assinatura" },
  { id: "outros", label: "Pessoas" },
  { id: "layout", label: "Organização" },
];

export const TIPOS: Record<TipoCampo, { label: string; grupo: GrupoTipo; dica: string }> = {
  texto_curto: { label: "Texto curto", grupo: "texto", dica: "Resposta em uma linha. Pode validar e-mail, telefone ou link." },
  paragrafo: { label: "Parágrafo", grupo: "texto", dica: "Resposta longa, em várias linhas." },
  multipla_escolha: { label: "Múltipla escolha", grupo: "escolha", dica: "Escolhe uma opção." },
  caixas_selecao: { label: "Caixas de seleção", grupo: "escolha", dica: "Marca uma ou mais opções." },
  lista_suspensa: { label: "Lista suspensa", grupo: "escolha", dica: "Escolhe uma opção numa lista fechada." },
  sim_nao: { label: "Sim ou não", grupo: "escolha", dica: "Duas opções: Sim e Não." },
  numero: { label: "Número", grupo: "numero", dica: "Valor numérico, com mínimo e máximo opcionais." },
  data: { label: "Data", grupo: "numero", dica: "Escolhe um dia no calendário." },
  hora: { label: "Hora", grupo: "numero", dica: "Escolhe um horário." },
  escala: { label: "Escala linear", grupo: "avaliacao", dica: "Nota numa escala (ex.: 1 a 5), com rótulo nas pontas." },
  avaliacao: { label: "Avaliação (estrelas)", grupo: "avaliacao", dica: "De 1 a N estrelas." },
  nps: { label: "Escala (NPS)", grupo: "avaliacao", dica: "De 0 a 10: o quanto recomendaria." },
  grade_multipla: { label: "Grade de múltipla escolha", grupo: "avaliacao", dica: "Uma escolha por linha (ex.: satisfação por item)." },
  grade_caixas: { label: "Grade de caixas de seleção", grupo: "avaliacao", dica: "Várias marcações por linha." },
  ranking: { label: "Classificação", grupo: "avaliacao", dica: "Põe as opções em ordem de preferência." },
  fotos: { label: "Fotos", grupo: "anexo", dica: "Tira foto na hora ou escolhe da galeria." },
  arquivos: { label: "Arquivos", grupo: "anexo", dica: "PDF, planilha, documento, imagem, áudio ou vídeo." },
  assinatura: { label: "Assinatura", grupo: "anexo", dica: "Assina com o dedo ou o mouse." },
  colaborador: { label: "Colaborador", grupo: "outros", dica: "Escolhe uma pessoa da empresa." },
  secao: { label: "Seção", grupo: "layout", dica: "Título que separa um bloco de perguntas." },
  texto: { label: "Texto informativo", grupo: "layout", dica: "Orientação para quem responde, sem resposta." },
};

export const ORDEM_TIPOS: TipoCampo[] = [
  "texto_curto", "paragrafo",
  "multipla_escolha", "caixas_selecao", "lista_suspensa", "sim_nao",
  "numero", "data", "hora",
  "escala", "avaliacao", "nps", "grade_multipla", "grade_caixas", "ranking",
  "fotos", "arquivos", "assinatura",
  "colaborador",
  "secao", "texto",
];

/** Blocos que não recebem resposta. */
export const ehLayout = (t: TipoCampo) => t === "secao" || t === "texto";
/** Perguntas que podem ser condição de outra (resposta é uma opção). */
export const ehEscolha = (t: TipoCampo) =>
  t === "multipla_escolha" || t === "caixas_selecao" || t === "lista_suspensa" || t === "sim_nao";
export const temOpcoes = (t: TipoCampo) =>
  t === "multipla_escolha" || t === "caixas_selecao" || t === "lista_suspensa" || t === "ranking";
export const ehGrade = (t: TipoCampo) => t === "grade_multipla" || t === "grade_caixas";
export const ehAnexo = (t: TipoCampo) => t === "fotos" || t === "arquivos" || t === "assinatura";

export const OPCOES_SIM_NAO = ["Sim", "Não"];

export const MAX_FOTOS = 10;
export const MAX_ARQUIVOS = 10;
/** igual ao limite do bucket `formularios` */
export const TAMANHO_ARQUIVO_FORMULARIO = 20 * 1024 * 1024;

export function novoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

/** Pergunta nova de um tipo, já com o que ela precisa para funcionar. */
export function campoNovo(tipo: TipoCampo): Campo {
  const base: Campo = { id: novoId(), tipo, titulo: "", obrigatorio: false };
  switch (tipo) {
    case "multipla_escolha":
    case "caixas_selecao":
    case "lista_suspensa":
      return { ...base, opcoes: ["Opção 1", "Opção 2"] };
    case "ranking":
      return { ...base, opcoes: ["Item 1", "Item 2", "Item 3"] };
    case "texto_curto":
      return { ...base, formato: "livre" };
    case "escala":
      return { ...base, escalaMin: 1, escalaMax: 5, rotuloMin: "", rotuloMax: "" };
    case "avaliacao":
      return { ...base, estrelas: 5 };
    case "nps":
      return { ...base, rotuloMin: "Nada provável", rotuloMax: "Muito provável" };
    case "grade_multipla":
    case "grade_caixas":
      return { ...base, linhas: ["Linha 1", "Linha 2"], colunas: ["Ruim", "Regular", "Bom", "Ótimo"] };
    case "fotos":
      return { ...base, maxArquivos: 5 };
    case "arquivos":
      return { ...base, maxArquivos: 3 };
    case "secao":
    case "texto":
      return { id: base.id, tipo, titulo: "" };
    default:
      return base;
  }
}

/** As opções de uma pergunta de escolha (o Sim/Não é fixo). */
export function opcoesDe(c: Campo): string[] {
  if (c.tipo === "sim_nao") return OPCOES_SIM_NAO;
  return (c.opcoes ?? []).filter((o) => o.trim() !== "");
}

// ---------------------------------------------------------------------------
// Condições e seções
// ---------------------------------------------------------------------------

/** O valor de uma pergunta de escolha, como lista de opções marcadas. */
export function escolhidas(c: Campo | undefined, v: Valor | undefined): string[] {
  if (!c || v === undefined || v === null) return [];
  if (c.tipo === "caixas_selecao") {
    const x = v as { ops?: string[] };
    return Array.isArray(x?.ops) ? x.ops : [];
  }
  if (c.tipo === "multipla_escolha") {
    if (typeof v === "string") return [v];
    const x = v as { op?: string; outro?: string };
    return x?.outro !== undefined ? ["__outro__"] : x?.op ? [x.op] : [];
  }
  return typeof v === "string" ? [v] : [];
}

/**
 * Quais perguntas aparecem, dadas as respostas até aqui.
 *
 * A condição de uma seção vale para tudo o que vem depois dela até a próxima
 * seção. Pergunta escondida não conta como obrigatória e a resposta dela não é
 * enviada (quem mudou de ideia não deixa resposta órfã para trás).
 */
export function visiveis(campos: Campo[], respostas: Respostas): Set<string> {
  const porId = new Map(campos.map((c) => [c.id, c]));
  const vis = new Set<string>();
  let secaoVisivel = true;
  for (const c of campos) {
    if (c.removido) continue;
    const ok = (cond: Condicao | null | undefined) => {
      if (!cond?.campo) return true;
      if (!vis.has(cond.campo)) return false;
      const marcadas = escolhidas(porId.get(cond.campo), respostas[cond.campo]);
      return marcadas.some((m) => cond.valores.includes(m));
    };
    if (c.tipo === "secao") {
      secaoVisivel = ok(c.condicao);
      if (secaoVisivel) vis.add(c.id);
      continue;
    }
    if (secaoVisivel && ok(c.condicao)) vis.add(c.id);
  }
  return vis;
}

// ---------------------------------------------------------------------------
// Validação (a mesma no navegador e no servidor)
// ---------------------------------------------------------------------------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LINK = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i;
const telefoneOk = (s: string) => {
  const d = s.replace(/\D/g, "");
  return d.length >= 10 && d.length <= 13;
};

export function vazio(v: Valor | undefined): boolean {
  if (v === undefined || v === null || v === "") return true;
  if (typeof v === "number") return Number.isNaN(v);
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("ops" in o) return !(o.ops as string[])?.length && !String(o.outro ?? "").trim();
    if ("op" in o || "outro" in o) return !o.op && !String(o.outro ?? "").trim();
    if ("id" in o && "nome" in o) return !o.id;
    return Object.keys(o).length === 0;
  }
  return false;
}

/** Mensagem do problema da resposta, ou null quando está boa. */
export function problemaDe(c: Campo, v: Valor | undefined): string | null {
  if (vazio(v)) return c.obrigatorio ? "Resposta obrigatória." : null;
  switch (c.tipo) {
    case "texto_curto": {
      const s = String(v).trim();
      if (c.maxCaracteres && s.length > c.maxCaracteres) return `Até ${c.maxCaracteres} caracteres.`;
      if (c.formato === "email" && !EMAIL.test(s)) return "Digite um e-mail válido.";
      if (c.formato === "telefone" && !telefoneOk(s)) return "Digite um telefone com DDD.";
      if (c.formato === "link" && !LINK.test(s)) return "Digite um link válido.";
      return null;
    }
    case "paragrafo": {
      const s = String(v);
      if (c.maxCaracteres && s.length > c.maxCaracteres) return `Até ${c.maxCaracteres} caracteres.`;
      return null;
    }
    case "numero": {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) return "Digite um número.";
      if (c.inteiro && !Number.isInteger(n)) return "Digite um número inteiro.";
      if (c.min != null && n < c.min) return `O mínimo é ${c.min}.`;
      if (c.max != null && n > c.max) return `O máximo é ${c.max}.`;
      return null;
    }
    case "caixas_selecao": {
      const x = v as { ops?: string[]; outro?: string };
      const n = (x.ops?.length ?? 0) + (String(x.outro ?? "").trim() ? 1 : 0);
      if (c.minSel && n < c.minSel) return `Marque pelo menos ${c.minSel}.`;
      if (c.maxSel && n > c.maxSel) return `Marque no máximo ${c.maxSel}.`;
      return null;
    }
    case "grade_multipla":
    case "grade_caixas": {
      if (!c.obrigatorio) return null;
      const x = v as Record<string, string | string[]>;
      const falta = (c.linhas ?? []).filter((l) => {
        const r = x[l];
        return r === undefined || (Array.isArray(r) ? r.length === 0 : r === "");
      });
      return falta.length ? "Responda todas as linhas." : null;
    }
    case "fotos":
    case "arquivos": {
      const lim = c.maxArquivos ?? (c.tipo === "fotos" ? MAX_FOTOS : MAX_ARQUIVOS);
      return (v as Arquivo[]).length > lim ? `Até ${lim} arquivos.` : null;
    }
    default:
      return null;
  }
}

/** Erros por pergunta visível. Vazio = pode enviar. */
export function validarRespostas(campos: Campo[], respostas: Respostas): Record<string, string> {
  const vis = visiveis(campos, respostas);
  const erros: Record<string, string> = {};
  for (const c of campos) {
    if (c.removido || ehLayout(c.tipo) || !vis.has(c.id)) continue;
    const p = problemaDe(c, respostas[c.id]);
    if (p) erros[c.id] = p;
  }
  return erros;
}

/** Só o que deve ser gravado: respostas preenchidas de perguntas visíveis. */
export function respostasParaEnviar(campos: Campo[], respostas: Respostas): Respostas {
  const vis = visiveis(campos, respostas);
  const saida: Respostas = {};
  for (const c of campos) {
    if (c.removido || ehLayout(c.tipo) || !vis.has(c.id)) continue;
    const v = respostas[c.id];
    if (!vazio(v)) saida[c.id] = v as Valor;
  }
  return saida;
}

/** Caminhos de arquivo citados nas respostas (fotos, anexos e assinaturas). */
export function arquivosDasRespostas(campos: Campo[], respostas: Respostas): string[] {
  const paths: string[] = [];
  for (const c of campos) {
    if (!ehAnexo(c.tipo)) continue;
    const v = respostas[c.id];
    if (Array.isArray(v)) for (const a of v as Arquivo[]) if (a?.path) paths.push(a.path);
  }
  return paths;
}

// ---------------------------------------------------------------------------
// Exibição e planilha
// ---------------------------------------------------------------------------

/** Resposta em texto corrido (tabela, ficha e planilha). */
export function textoDaResposta(c: Campo, v: Valor | undefined): string {
  if (vazio(v)) return "";
  switch (c.tipo) {
    case "multipla_escolha": {
      if (typeof v === "string") return v;
      const x = v as { op?: string; outro?: string };
      return x.outro !== undefined ? `Outro: ${x.outro}` : x.op ?? "";
    }
    case "caixas_selecao": {
      const x = v as { ops?: string[]; outro?: string };
      const todas = [...(x.ops ?? [])];
      if (String(x.outro ?? "").trim()) todas.push(`Outro: ${x.outro}`);
      return todas.join("; ");
    }
    case "data": {
      const s = String(v);
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s;
    }
    case "numero":
      return typeof v === "number" ? v.toLocaleString("pt-BR") : String(v);
    case "escala":
    case "nps":
      return String(v);
    case "avaliacao":
      return `${v} de ${c.estrelas ?? 5}`;
    case "grade_multipla":
    case "grade_caixas": {
      const x = v as Record<string, string | string[]>;
      return (c.linhas ?? [])
        .filter((l) => x[l] !== undefined && !(Array.isArray(x[l]) && (x[l] as string[]).length === 0))
        .map((l) => `${l}: ${Array.isArray(x[l]) ? (x[l] as string[]).join(", ") : x[l]}`)
        .join("; ");
    }
    case "ranking":
      return (v as string[]).map((o, i) => `${i + 1}. ${o}`).join("; ");
    case "fotos":
    case "arquivos":
      return (v as Arquivo[]).map((a) => a.nome).join("; ");
    case "assinatura":
      return (v as Arquivo[]).length ? "Assinado" : "";
    case "colaborador":
      return (v as { nome: string }).nome ?? "";
    default:
      return String(v);
  }
}

/** Situação que a pessoa vê: o prazo vencido encerra sem ninguém precisar encerrar. */
export function situacaoDe(f: { status: FormularioStatus; prazo: string | null }, agora = Date.now()):
  "rascunho" | "aberto" | "encerrado" {
  if (f.status === "rascunho") return "rascunho";
  if (f.status === "encerrado") return "encerrado";
  if (f.prazo && new Date(f.prazo).getTime() <= agora) return "encerrado";
  return "aberto";
}

export const BUCKET_FORMULARIOS = "formularios";

// ---------------------------------------------------------------------------
// Público
// ---------------------------------------------------------------------------

export type OpcoesPublico = {
  niveis: { id: string; nome: string }[];
  cargos: { id: string; nome: string }[];
  unidades: { id: string; nome: string }[];
  pessoas: { id: string; nome: string; nivel: string | null; cargo: string | null; unidades: string[] }[];
};

export type RegraPublico = Pick<Formulario, "publicoTodos" | "publicoNiveis" | "publicoCargos" | "publicoPessoas" | "unidades">;

/** Quem recebe, pela mesma regra de `formulario_publico_ids` no banco. */
export function publicoDe(r: RegraPublico, pessoas: OpcoesPublico["pessoas"]): OpcoesPublico["pessoas"] {
  const niveis = new Set(r.publicoNiveis);
  const cargos = new Set(r.publicoCargos);
  const nomeadas = new Set(r.publicoPessoas);
  const unidades = new Set(r.unidades);
  return pessoas.filter((p) => {
    if (nomeadas.has(p.id)) return true;
    const pelaRegra = r.publicoTodos || (!!p.nivel && niveis.has(p.nivel)) || (!!p.cargo && cargos.has(p.cargo));
    return pelaRegra && (unidades.size === 0 || p.unidades.some((u) => unidades.has(u)));
  });
}
