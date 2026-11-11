"use client";

import { useMemo, useState } from "react";
import { pct, type BlitzItem } from "@/lib/blitz-aderencia";

/** Translúcido com a borda cheia: o mesmo padrão do quadro de pendências. */
const COR = {
  falha: { fundo: "color-mix(in srgb, var(--mh-warning) 55%, transparent)", borda: "var(--mh-warning)" },
  bloqueio: { fundo: "color-mix(in srgb, var(--mh-danger) 55%, transparent)", borda: "var(--mh-danger)" },
} as const;

type Linha = { nome: string; n: number; detalhe: string; dica: string };

/**
 * Barras deitadas de uma série só, do maior para o menor: nome à esquerda (até
 * duas linhas), a barra e o número com o detalhe. Mostra as primeiras e abre o
 * resto num clique.
 */
function Barras({ linhas, cor, rotulo, larguraDoNome = "42%", primeiras = 8 }: {
  linhas: Linha[]; cor: { fundo: string; borda: string }; rotulo: string; larguraDoNome?: string; primeiras?: number;
}) {
  const [todas, setTodas] = useState(false);
  const max = Math.max(1, ...linhas.map((l) => l.n));
  const vistas = todas ? linhas : linhas.slice(0, primeiras);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
      <div role="list" aria-label={rotulo} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {vistas.map((l) => (
          <div key={l.nome} role="listitem" title={l.dica}
            style={{ display: "grid", gridTemplateColumns: `minmax(140px, ${larguraDoNome}) 1fr auto`, alignItems: "center", gap: "0.6rem", padding: "2px 0" }}>
            <span className="soft" style={{
              fontSize: "0.76rem", lineHeight: 1.25, overflow: "hidden",
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
            }}>{l.nome}</span>
            <div style={{ height: 16, borderLeft: "1px solid var(--border)" }}>
              <div style={{
                width: `${(l.n / max) * 100}%`, minWidth: 3, height: "100%", borderRadius: "0 4px 4px 0",
                background: cor.fundo, border: `1px solid ${cor.borda}`, borderLeft: "none",
              }} />
            </div>
            <span style={{ fontSize: "0.78rem", textAlign: "right", whiteSpace: "nowrap" }}>
              <strong>{l.n}</strong> <span className="soft">{l.detalhe}</span>
            </span>
          </div>
        ))}
      </div>
      {linhas.length > primeiras && (
        <button type="button" className="btn btn-ghost btn-xs" style={{ alignSelf: "flex-start" }} onClick={() => setTodas((v) => !v)}>
          {todas ? "Ver menos" : `Ver todos (${linhas.length})`}
        </button>
      )}
    </div>
  );
}

function Cartao({ titulo, subtitulo, children, inteiro }: { titulo: string; subtitulo: string; children: React.ReactNode; inteiro?: boolean }) {
  return (
    <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "0.8rem", ...(inteiro ? { gridColumn: "1 / -1" } : {}) }}>
      <div>
        <h4 style={{ fontSize: "0.92rem", fontWeight: 700, margin: 0 }}>{titulo}</h4>
        <p className="soft" style={{ fontSize: "0.74rem", margin: "0.2rem 0 0" }}>{subtitulo}</p>
      </div>
      {children}
    </section>
  );
}

const vazio = (texto: string) => <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>{texto}</p>;

/**
 * Principais falhas (LUIZ, 11/11/2026: "quais são as principais falhas,
 * verificando pelas perguntas"). Três visões, todas do recorte da tela
 * (período, unidade do topo e o filtro de setor, gestor e função):
 *   - itens que mais falham: quantas vezes cada pergunta teve "não" e em que
 *     parte das vezes em que foi perguntada (sem os "não se aplica");
 *   - motivos de bloqueio;
 *   - não conformidade por meio de transporte.
 */
export function BlitzFalhas({ blitz, rotuloPeriodo }: { blitz: BlitzItem[]; rotuloPeriodo: string }) {
  const perguntas = useMemo<Linha[]>(() => {
    const m = new Map<string, { nao: number; perguntada: number }>();
    const de = (p: string) => { const e = m.get(p) ?? { nao: 0, perguntada: 0 }; m.set(p, e); return e; };
    for (const b of blitz) {
      for (const p of b.perguntadas ?? []) de(p).perguntada += 1;
      for (const p of b.nao ?? []) de(p).nao += 1;
    }
    return [...m.entries()].filter(([, e]) => e.nao > 0)
      .map(([nome, e]) => {
        const p = pct(e.nao, e.perguntada) ?? 0;
        return { nome, n: e.nao, detalhe: `· ${p}% das vezes`, dica: `${nome}: "não" em ${e.nao} de ${e.perguntada} vezes em que foi perguntado (${p}%)`, p };
      })
      .sort((x, y) => y.n - x.n || y.p - x.p || x.nome.localeCompare(y.nome, "pt-BR"));
  }, [blitz]);

  const motivos = useMemo<Linha[]>(() => {
    const m = new Map<string, number>();
    const bloqueios = blitz.filter((b) => !b.liberado);
    for (const b of bloqueios) { const k = b.motivo ?? "Sem motivo registrado"; m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()]
      .map(([nome, n]) => ({ nome, n, detalhe: `· ${pct(n, bloqueios.length) ?? 0}%`, dica: `${nome}: ${n} de ${bloqueios.length} bloqueios` }))
      .sort((x, y) => y.n - x.n || x.nome.localeCompare(y.nome, "pt-BR"));
  }, [blitz]);

  const meios = useMemo<Linha[]>(() => {
    const m = new Map<string, { total: number; nc: number }>();
    for (const b of blitz) {
      const k = b.meio ?? "Sem meio";
      const e = m.get(k) ?? { total: 0, nc: 0 };
      e.total += 1;
      if (!b.conforme) e.nc += 1;
      m.set(k, e);
    }
    return [...m.entries()].filter(([, e]) => e.nc > 0)
      .map(([nome, e]) => {
        const p = pct(e.nc, e.total) ?? 0;
        return { nome, n: e.nc, detalhe: `de ${e.total} · ${p}%`, dica: `${nome}: ${e.nc} de ${e.total} blitz não conformes (${p}%)` };
      })
      .sort((x, y) => y.n - x.n || x.nome.localeCompare(y.nome, "pt-BR"));
  }, [blitz]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <h3 style={{ fontSize: "0.98rem", fontWeight: 700, margin: "0.4rem 0 0" }}>Principais falhas</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: "1rem", alignItems: "start" }}>
        <Cartao inteiro titulo="Itens que mais falham"
          subtitulo={`As perguntas da blitz com mais respostas "não" em ${rotuloPeriodo}, e em que parte das vezes em que foram feitas.`}>
          {perguntas.length === 0 ? vazio("Nenhum item com \"não\" no período.") : (
            <Barras linhas={perguntas} cor={COR.falha} rotulo="Itens que mais falham" larguraDoNome="46%" />
          )}
        </Cartao>
        <Cartao titulo="Motivos de bloqueio" subtitulo="Por que as pessoas foram bloqueadas, e quanto cada motivo pesa nos bloqueios.">
          {motivos.length === 0 ? vazio("Nenhum bloqueio no período.") : (
            <Barras linhas={motivos} cor={COR.bloqueio} rotulo="Motivos de bloqueio" />
          )}
        </Cartao>
        <Cartao titulo="Não conformidade por meio de transporte" subtitulo="Quantas blitz de cada meio saíram com desvio ou bloqueio.">
          {meios.length === 0 ? vazio("Nenhuma blitz não conforme no período.") : (
            <Barras linhas={meios} cor={COR.falha} rotulo="Não conformidade por meio de transporte" larguraDoNome="34%" />
          )}
        </Cartao>
      </div>
    </div>
  );
}
