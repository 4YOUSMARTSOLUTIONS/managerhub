/**
 * Banco de conhecimento (LUIZ, 18/11/2026): o manual de cada módulo.
 *
 * Os artigos são escritos em markdown, num subconjunto pequeno e conhecido:
 * títulos, parágrafos, listas, tabelas, avisos, imagens e separador. Este
 * arquivo transforma o texto em blocos; quem desenha é o `Markdown.tsx`. Nada
 * aqui vira HTML cru: tudo sai como texto do React, então um artigo não tem
 * como injetar script, e link só abre endereço http(s) ou caminho do portal.
 *
 * Sem "use server" e sem JSX: servidor e tela usam as mesmas peças.
 */

/** Imagem de artigo: `![legenda](img:<arquivo no bucket conhecimento>)`. */
export const PREFIXO_IMAGEM = "img:";
export const BUCKET_CONHECIMENTO = "conhecimento";
export const TAMANHO_IMAGEM_CONHECIMENTO = 5 * 1024 * 1024;
export const MIMES_IMAGEM_CONHECIMENTO = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export type ArtigoResumo = {
  id: string;
  slug: string;
  modulo: string | null;
  titulo: string;
  resumo: string | null;
  ordem: number;
  publicado: boolean;
  updated_at: string;
};

export type Artigo = ArtigoResumo & { conteudo: string };

/** Endereço do artigo a partir do título: "Absenteísmo: guia" → "absenteismo-guia". */
export function slugDe(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export const SLUG_VALIDO = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Os arquivos de imagem citados no texto, para assinar os links de uma vez. */
export function imagensDoConteudo(md: string): string[] {
  const achados = new Set<string>();
  const re = /!\[[^\]]*\]\(img:([^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) achados.add(m[1]);
  return [...achados];
}

// ---------------------------------------------------------------------------
// Trechos de linha: negrito, itálico, código e link
// ---------------------------------------------------------------------------

export type Trecho =
  | { t: "texto"; v: string }
  | { t: "negrito"; filhos: Trecho[] }
  | { t: "italico"; filhos: Trecho[] }
  | { t: "codigo"; v: string }
  | { t: "link"; href: string; filhos: Trecho[] };

/** Só http(s), caminho do portal ("/ferias") ou âncora ("#motivos"). */
export function linkSeguro(href: string): string | null {
  const h = href.trim();
  if (/^https?:\/\//i.test(h)) return h;
  if (/^\/(?!\/)/.test(h)) return h;
  if (/^#[\w-]+$/.test(h)) return h;
  return null;
}

export function trechos(texto: string): Trecho[] {
  const saida: Trecho[] = [];
  let buffer = "";
  const solta = () => { if (buffer) { saida.push({ t: "texto", v: buffer }); buffer = ""; } };
  let i = 0;
  while (i < texto.length) {
    const resto = texto.slice(i);
    // código: o conteúdo sai literal
    if (resto[0] === "`") {
      const fim = texto.indexOf("`", i + 1);
      if (fim > i + 1) {
        solta();
        saida.push({ t: "codigo", v: texto.slice(i + 1, fim) });
        i = fim + 1;
        continue;
      }
    }
    if (resto.startsWith("**")) {
      const fim = texto.indexOf("**", i + 2);
      if (fim > i + 2) {
        solta();
        saida.push({ t: "negrito", filhos: trechos(texto.slice(i + 2, fim)) });
        i = fim + 2;
        continue;
      }
    }
    // itálico com _ só fora de palavra (nome_de_arquivo não vira itálico)
    if ((resto[0] === "_" || resto[0] === "*") && !/\w/.test(texto[i - 1] ?? "")) {
      const marca = resto[0];
      const fim = texto.indexOf(marca, i + 1);
      if (fim > i + 1 && !/\s/.test(texto[i + 1]) && !/\w/.test(texto[fim + 1] ?? "")) {
        solta();
        saida.push({ t: "italico", filhos: trechos(texto.slice(i + 1, fim)) });
        i = fim + 1;
        continue;
      }
    }
    if (resto[0] === "[") {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(resto);
      const href = m ? linkSeguro(m[2]) : null;
      if (m && href) {
        solta();
        saida.push({ t: "link", href, filhos: trechos(m[1]) });
        i += m[0].length;
        continue;
      }
    }
    buffer += resto[0];
    i += 1;
  }
  solta();
  return saida;
}

/** O texto puro de uma linha (para âncoras e busca). */
export function textoPuro(texto: string): string {
  const junta = (ts: Trecho[]): string => ts.map((t) =>
    t.t === "texto" || t.t === "codigo" ? t.v : junta(t.filhos)).join("");
  return junta(trechos(texto));
}

// ---------------------------------------------------------------------------
// Blocos
// ---------------------------------------------------------------------------

export type ItemDeLista = { texto: string; marcado: boolean | null };

export type Bloco =
  | { t: "titulo"; nivel: 2 | 3 | 4; texto: string; id: string }
  | { t: "paragrafo"; texto: string }
  | { t: "lista"; ordenada: boolean; inicio: number; itens: ItemDeLista[] }
  | { t: "tabela"; cabecalho: string[]; linhas: string[][] }
  | { t: "imagem"; legenda: string; arquivo: string }
  | { t: "aviso"; tom: "dica" | "atencao"; linhas: string[] }
  | { t: "separador" };

const RE_TITULO = /^(#{1,4})\s+(.+?)\s*#*\s*$/;
const RE_ITEM = /^\s*[-*]\s+(?:\[( |x|X)\]\s+)?(.*)$/;
const RE_NUMERO = /^\s*(\d+)[.)]\s+(.*)$/;
const RE_IMAGEM = /^!\[([^\]]*)\]\(img:([^)\s]+)\)\s*$/;
const RE_SEPARADOR = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const ehLinhaDeTabela = (l: string) => /^\s*\|.*\|\s*$/.test(l);
function celulas(linha: string): string[] {
  const s = linha.trim().replace(/^\|/, "").replace(/\|$/, "");
  return s.split("|").map((c) => c.trim());
}

/** A linha "| --- | :---: |" que separa o cabeçalho do corpo. */
const ehSeparadorDeTabela = (l: string) =>
  l.includes("-") && /^\s*\|?[\s|:-]+\|?\s*$/.test(l) && celulas(l).every((c) => /^:?-{2,}:?$/.test(c));

/** Aviso amarelo quando começa por um alerta; o resto é dica. */
const ATENCAO = /^(\*\*)?(aten[çc][ãa]o|cuidado|importante|nunca|n[ãa]o)\b/i;

export function blocos(md: string): Bloco[] {
  const linhas = md.replace(/\r\n?/g, "\n").split("\n");
  const saida: Bloco[] = [];
  const ids = new Map<string, number>();
  const idDe = (texto: string) => {
    const base = slugDe(textoPuro(texto)) || "secao";
    const n = ids.get(base) ?? 0;
    ids.set(base, n + 1);
    return n ? `${base}-${n + 1}` : base;
  };

  let i = 0;
  while (i < linhas.length) {
    const linha = linhas[i];
    if (!linha.trim()) { i += 1; continue; }

    const titulo = RE_TITULO.exec(linha);
    if (titulo) {
      // o título do artigo já é o h1 da página: "#" no texto vira seção
      const nivel = Math.min(4, Math.max(2, titulo[1].length)) as 2 | 3 | 4;
      saida.push({ t: "titulo", nivel, texto: titulo[2], id: idDe(titulo[2]) });
      i += 1;
      continue;
    }

    if (RE_SEPARADOR.test(linha)) { saida.push({ t: "separador" }); i += 1; continue; }

    const imagem = RE_IMAGEM.exec(linha.trim());
    if (imagem) {
      saida.push({ t: "imagem", legenda: imagem[1], arquivo: imagem[2] });
      i += 1;
      continue;
    }

    if (ehLinhaDeTabela(linha) && i + 1 < linhas.length && ehSeparadorDeTabela(linhas[i + 1])) {
      const cabecalho = celulas(linha);
      const corpo: string[][] = [];
      i += 2;
      while (i < linhas.length && ehLinhaDeTabela(linhas[i])) {
        const c = celulas(linhas[i]);
        // linha curta completa com vazio; longa corta no cabeçalho
        corpo.push(cabecalho.map((_, k) => c[k] ?? ""));
        i += 1;
      }
      saida.push({ t: "tabela", cabecalho, linhas: corpo });
      continue;
    }

    if (/^\s*>/.test(linha)) {
      const conteudo: string[] = [];
      while (i < linhas.length && /^\s*>/.test(linhas[i])) {
        conteudo.push(linhas[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      // linhas seguidas viram um parágrafo; linha vazia separa
      const paragrafos = conteudo.join("\n").split(/\n\s*\n/).map((p) => p.split("\n").join(" ").trim()).filter(Boolean);
      saida.push({ t: "aviso", tom: ATENCAO.test(paragrafos[0] ?? "") ? "atencao" : "dica", linhas: paragrafos });
      continue;
    }

    if (RE_ITEM.test(linha) || RE_NUMERO.test(linha)) {
      const ordenada = !RE_ITEM.test(linha);
      const inicio = ordenada ? Number(RE_NUMERO.exec(linha)?.[1] ?? 1) : 1;
      const itens: ItemDeLista[] = [];
      while (i < linhas.length && linhas[i].trim()) {
        const l = linhas[i];
        const item = ordenada ? RE_NUMERO.exec(l) : RE_ITEM.exec(l);
        if (item) {
          if (ordenada) itens.push({ texto: item[2], marcado: null });
          else itens.push({ texto: item[2], marcado: item[1] === undefined ? null : item[1].toLowerCase() === "x" });
        } else if (/^\s{2,}\S/.test(l) && itens.length) {
          // continuação do item anterior (linha recuada)
          itens[itens.length - 1].texto += ` ${l.trim()}`;
        } else {
          break;
        }
        i += 1;
      }
      saida.push({ t: "lista", ordenada, inicio, itens });
      continue;
    }

    // parágrafo: junta as linhas até uma vazia ou o começo de outro bloco
    const partes: string[] = [];
    while (
      i < linhas.length && linhas[i].trim()
      && !RE_TITULO.test(linhas[i]) && !RE_IMAGEM.test(linhas[i].trim())
      && !/^\s*>/.test(linhas[i]) && !RE_SEPARADOR.test(linhas[i])
      && !(partes.length && (RE_ITEM.test(linhas[i]) || RE_NUMERO.test(linhas[i])))
      && !(ehLinhaDeTabela(linhas[i]) && ehSeparadorDeTabela(linhas[i + 1] ?? ""))
    ) {
      partes.push(linhas[i].trim());
      i += 1;
    }
    if (partes.length) saida.push({ t: "paragrafo", texto: partes.join(" ") });
    else i += 1;
  }
  return saida;
}

/** As seções do artigo, para o "Nesta página". */
export function sumario(md: string): { id: string; texto: string }[] {
  return blocos(md)
    .filter((b): b is Extract<Bloco, { t: "titulo" }> => b.t === "titulo" && b.nivel === 2)
    .map((b) => ({ id: b.id, texto: textoPuro(b.texto) }));
}

/** Texto corrido do artigo, sem marcação, para a busca da lista. */
export function textoParaBusca(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#*_`>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
