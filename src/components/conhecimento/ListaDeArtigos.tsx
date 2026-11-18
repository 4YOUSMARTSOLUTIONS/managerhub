"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/format";

export type CartaoDeArtigo = {
  id: string;
  slug: string;
  titulo: string;
  resumo: string | null;
  publicado: boolean;
  updatedAt: string;
  /** rótulo do módulo no menu; nulo = artigo geral */
  modulo: string | null;
  /** grupo do menu onde o módulo mora, ou "Geral" */
  secao: string;
  busca: string;
};

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function ListaDeArtigos({ artigos }: { artigos: CartaoDeArtigo[] }) {
  const [busca, setBusca] = useState("");

  const secoes = useMemo(() => {
    const termos = normalizar(busca.trim()).split(/\s+/).filter(Boolean);
    const filtrados = termos.length
      ? artigos.filter((a) => { const t = normalizar(a.busca); return termos.every((q) => t.includes(q)); })
      : artigos;
    const porSecao = new Map<string, CartaoDeArtigo[]>();
    for (const a of filtrados) porSecao.set(a.secao, [...(porSecao.get(a.secao) ?? []), a]);
    // "Geral" abre a lista; o resto em ordem alfabética, como o menu
    return [...porSecao.entries()].sort(([a], [b]) =>
      a === "Geral" ? -1 : b === "Geral" ? 1 : a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
  }, [artigos, busca]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <input
        className="input" placeholder="Buscar nos manuais: tela, assunto ou palavra…"
        value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 420 }}
      />
      {secoes.length === 0 && (
        <p className="soft" style={{ margin: 0, fontSize: "0.88rem" }}>Nenhum artigo fala de &quot;{busca}&quot;.</p>
      )}
      {secoes.map(([secao, lista]) => (
        <section key={secao} style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          <h2 style={{ fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--mh-text-3)", margin: 0 }}>
            {secao}
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0.75rem" }}>
            {lista.map((a) => (
              <Link key={a.id} href={`/conhecimento/${a.slug}`} className="card mh-artigo-cartao">
                <span style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" }}>
                  <strong style={{ fontSize: "0.98rem", color: "var(--mh-text-1)" }}>{a.titulo}</strong>
                  <ChevronRight size={16} aria-hidden style={{ color: "var(--mh-text-3)", flexShrink: 0, marginTop: 2 }} />
                </span>
                {a.resumo && <span className="soft" style={{ fontSize: "0.84rem", lineHeight: 1.45 }}>{a.resumo}</span>}
                <span style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginTop: "auto", paddingTop: "0.3rem" }}>
                  {!a.publicado && <Badge tone="amber">Rascunho</Badge>}
                  {a.modulo && <Badge variant="quiet" tone="blue">{a.modulo}</Badge>}
                  <span className="soft" style={{ fontSize: "0.76rem" }}>Atualizado em {formatDate(a.updatedAt)}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
