"use client";

import { Paperclip } from "lucide-react";
import { ehAnexo, ehLayout, textoDaResposta, vazio, type Arquivo, type Campo, type Respostas } from "@/lib/formularios";

/**
 * As respostas de uma pessoa, para ler: a ficha da tabela de respostas e o
 * "minha resposta" de quem respondeu. Pergunta sem resposta mostra "—";
 * pergunta removida do formulário só aparece se tiver resposta.
 */
export function RespostaFicha({ campos, respostas, urls }: {
  campos: Campo[];
  respostas: Respostas;
  urls: Record<string, string>;
}) {
  let numero = 0;
  const blocos: React.ReactNode[] = [];
  for (const c of campos) {
    if (c.tipo === "texto") continue;
    if (c.removido && vazio(respostas[c.id])) continue;
    if (c.tipo === "secao") {
      blocos.push(
        <h3 key={c.id} className="soft" style={{
          fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
          margin: "0.5rem 0 0", paddingTop: "0.7rem", borderTop: "1px solid var(--border)",
        }}>{c.titulo || "Seção"}</h3>,
      );
      continue;
    }
    if (!ehLayout(c.tipo) && !c.removido) numero++;
    const v = respostas[c.id];
    let valor: React.ReactNode;
    if (vazio(v)) valor = <span className="soft">—</span>;
    else if (ehAnexo(c.tipo)) {
      const lista = v as Arquivo[];
      valor = (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: 2 }}>
          {lista.map((a) => {
            const url = urls[a.path];
            const ehImagem = (a.tipo ?? "").startsWith("image/");
            if (ehImagem && url) {
              return (
                <a key={a.path} href={url} target="_blank" rel="noreferrer" title={a.nome}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={a.nome} style={{
                    width: c.tipo === "assinatura" ? 220 : 96, height: c.tipo === "assinatura" ? 80 : 96,
                    objectFit: c.tipo === "assinatura" ? "contain" : "cover", borderRadius: 8,
                    border: "1px solid var(--border)", background: "#fff", display: "block",
                  }} />
                </a>
              );
            }
            return url ? (
              <a key={a.path} href={url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm"><Paperclip size={13} /> {a.nome}</a>
            ) : (
              <span key={a.path} className="soft" style={{ fontSize: "0.82rem" }}><Paperclip size={13} /> {a.nome}</span>
            );
          })}
        </div>
      );
    } else valor = <span style={{ whiteSpace: "pre-wrap" }}>{textoDaResposta(c, v)}</span>;

    blocos.push(
      <div key={c.id} style={{ minWidth: 0 }}>
        <div className="soft" style={{ fontSize: "0.74rem", fontWeight: 600, marginBottom: "0.15rem" }}>
          {!c.removido && `${numero}. `}{c.titulo || "Pergunta"}{c.removido ? " (removida do formulário)" : ""}
        </div>
        <div style={{ fontSize: "0.9rem", color: "var(--mh-text-1)", overflowWrap: "anywhere" }}>{valor}</div>
      </div>,
    );
  }
  return <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>{blocos}</div>;
}
