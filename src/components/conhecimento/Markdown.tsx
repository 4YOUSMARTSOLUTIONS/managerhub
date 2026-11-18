import { Fragment } from "react";
import Link from "next/link";
import { AlertTriangle, Lightbulb } from "lucide-react";
import { blocos, trechos, type Trecho } from "@/lib/conhecimento";
import { FiguraDoArtigo } from "@/components/conhecimento/FiguraDoArtigo";

/**
 * Desenha o artigo do Banco de conhecimento. Sem "use client": a página do
 * artigo desenha no servidor, e a prévia do editor reaproveita no navegador.
 *
 * Tudo vira texto do React (nada de HTML cru), e a imagem só aparece se o
 * arquivo tiver link assinado no mapa: o texto não aponta para fora.
 */
export function Markdown({ conteudo, imagens }: { conteudo: string; imagens: Record<string, string> }) {
  return (
    <div className="mh-artigo">
      {blocos(conteudo).map((b, k) => {
        switch (b.t) {
          case "titulo": {
            const Tag = (`h${b.nivel}`) as "h2" | "h3" | "h4";
            return <Tag key={k} id={b.id}><Linha texto={b.texto} /></Tag>;
          }
          case "paragrafo":
            return <p key={k}><Linha texto={b.texto} /></p>;
          case "separador":
            return <hr key={k} />;
          case "lista":
            if (b.ordenada) {
              return (
                <ol key={k} start={b.inicio}>
                  {b.itens.map((it, j) => <li key={j}><Linha texto={it.texto} /></li>)}
                </ol>
              );
            }
            return (
              <ul key={k} className={b.itens.some((it) => it.marcado !== null) ? "mh-artigo-tarefas" : undefined}>
                {b.itens.map((it, j) => (
                  <li key={j}>
                    {it.marcado !== null && (
                      <span aria-hidden className={`mh-artigo-caixa${it.marcado ? " marcada" : ""}`} />
                    )}
                    <Linha texto={it.texto} />
                  </li>
                ))}
              </ul>
            );
          case "tabela":
            return (
              <div key={k} className="mh-artigo-tabela">
                <table className="table">
                  <thead>
                    <tr>{b.cabecalho.map((c, j) => <th key={j}><Linha texto={c} /></th>)}</tr>
                  </thead>
                  <tbody>
                    {b.linhas.map((l, j) => (
                      <tr key={j}>{l.map((c, n) => <td key={n}><Linha texto={c} /></td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "aviso":
            return (
              <aside key={k} className={`mh-artigo-aviso ${b.tom}`}>
                {b.tom === "atencao"
                  ? <AlertTriangle size={17} aria-hidden />
                  : <Lightbulb size={17} aria-hidden />}
                <div>{b.linhas.map((l, j) => <p key={j}><Linha texto={l} /></p>)}</div>
              </aside>
            );
          case "imagem": {
            const url = imagens[b.arquivo];
            return (
              <figure key={k} className="mh-artigo-figura">
                {url ? (
                  // clique amplia no meio da tela, sem sair do artigo
                  <FiguraDoArtigo url={url} legenda={b.legenda} />
                ) : (
                  <div className="mh-artigo-sem-imagem">Imagem indisponível</div>
                )}
                {b.legenda && <figcaption>{b.legenda}</figcaption>}
              </figure>
            );
          }
        }
      })}
    </div>
  );
}

function Linha({ texto }: { texto: string }) {
  return <>{trechos(texto).map((t, k) => <Pedaco key={k} t={t} />)}</>;
}

function Pedaco({ t }: { t: Trecho }) {
  switch (t.t) {
    case "texto": return <>{t.v}</>;
    case "codigo": return <code>{t.v}</code>;
    case "negrito": return <strong>{t.filhos.map((f, k) => <Pedaco key={k} t={f} />)}</strong>;
    case "italico": return <em>{t.filhos.map((f, k) => <Pedaco key={k} t={f} />)}</em>;
    case "link": {
      const filhos = t.filhos.map((f, k) => <Fragment key={k}><Pedaco t={f} /></Fragment>);
      if (t.href.startsWith("/")) return <Link href={t.href}>{filhos}</Link>;
      if (t.href.startsWith("#")) return <a href={t.href}>{filhos}</a>;
      return <a href={t.href} target="_blank" rel="noopener noreferrer">{filhos}</a>;
    }
  }
}
