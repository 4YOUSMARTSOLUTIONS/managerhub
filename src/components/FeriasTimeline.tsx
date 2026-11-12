"use client";

import type { CSSProperties } from "react";
import { shortName, formatDate } from "@/lib/format";
import { dataLocal, diasDoPeriodo } from "@/lib/ferias";

/**
 * O tipo de cada barra. "prevista" é a do painel (aprovada ou solicitada, sem
 * distinguir); a linha do tempo da equipe em Aprovações separa "aprovada" e
 * "solicitada" e destaca como "pendente" os pedidos que aguardam a decisão.
 */
export type TipoNaTimeline = "efetivada" | "prevista" | "aprovada" | "solicitada" | "pendente";

export type TimelineLinha = {
  userId: string;
  nome: string | null;
  itens: { inicio: string; fim: string; tipo: TipoNaTimeline | string }[];
  /** agrupamento opcional (o setor): um título a cada troca */
  grupo?: string;
};

const INFO_CHEIO = "color-mix(in srgb, var(--mh-info) 45%, transparent)";

/** visual e rótulo de cada tipo, na ordem em que entram na legenda */
const TIPOS: { tipo: TipoNaTimeline; rotulo: string; estilo: CSSProperties }[] = [
  { tipo: "pendente", rotulo: "aguardando sua aprovação", estilo: { background: "var(--mh-primary-500)", border: "1px solid var(--mh-primary-500)" } },
  { tipo: "efetivada", rotulo: "efetivada", estilo: { background: "var(--mh-success)", border: "1px solid transparent" } },
  { tipo: "aprovada", rotulo: "aprovada pelo gestor", estilo: { background: INFO_CHEIO, border: "1px solid var(--mh-info)" } },
  { tipo: "prevista", rotulo: "prevista", estilo: { background: INFO_CHEIO, border: "1px solid var(--mh-info)" } },
  { tipo: "solicitada", rotulo: "aguardando aprovação", estilo: { background: "color-mix(in srgb, var(--mh-info) 12%, transparent)", border: "1px dashed var(--mh-info)" } },
];
const PREVISTA = TIPOS.find((t) => t.tipo === "prevista")!;
const tipoDe = (tipo: string) => TIPOS.find((t) => t.tipo === tipo) ?? PREVISTA;

/** largura de cada mês na régua; a janela de um ano passa da tela e rola */
const LARGURA_MES = 110;
/** a coluna dos nomes, presa à esquerda */
const COLUNA_NOME = 140;
/** o fundo do cartão e do modal: o que fica preso precisa cobrir o que rola por baixo */
const FUNDO = "var(--surface)";

/**
 * A linha do tempo das férias: os próximos meses em colunas, uma linha por
 * colaborador, barras posicionadas por porcentagem. Efetivada sai cheia,
 * prevista sai clara: sobreposição de equipe se enxerga de relance, que é o
 * que um calendário mensal não mostra para períodos longos.
 *
 * CSS puro, sem lib: a conta é (dias desde o início da janela) / (dias da
 * janela), e só.
 *
 * Em Aprovações (LUIZ, 12/11/2026) a mesma régua mostra a equipe inteira num
 * modal (`semCartao`), agrupada por setor quando a linha traz `grupo`.
 *
 * Rolagem (LUIZ, 12/11/2026): cada mês tem largura fixa e a janela é de um
 * ano, então os meses seguintes aparecem rolando para o lado, com os nomes e a
 * régua presos. Abre no começo da janela (o mês atual). Com muita gente,
 * `alturaMax` limita a altura e rola na vertical também.
 */
export function FeriasTimeline({
  linhas, janelaInicio, janelaFim, hoje, semCartao = false, alturaMax, aviso,
}: {
  linhas: TimelineLinha[];
  janelaInicio: string;
  janelaFim: string;
  hoje: string;
  /** sem o cartão e sem o título (dentro de um modal) */
  semCartao?: boolean;
  /** altura máxima da área das linhas: passa disso, rola na vertical com a régua presa */
  alturaMax?: number | string;
  /** entre o título e as barras (o alerta de coincidência do painel) */
  aviso?: React.ReactNode;
}) {
  if (linhas.length === 0) return null;

  const totalDias = diasDoPeriodo(janelaInicio, janelaFim);
  // o trilho mede LARGURA_MES por mês; numa tela mais larga ele estica (flex)
  const trilho = Math.round((totalDias / 30.44) * LARGURA_MES);
  // começo do dia (para o início da barra) e fim do dia (para o término)
  const pct = (iso: string) =>
    Math.min(100, Math.max(0, ((diasDoPeriodo(janelaInicio, iso) - 1) / totalDias) * 100));
  const pctFim = (iso: string) =>
    Math.min(100, Math.max(0, (diasDoPeriodo(janelaInicio, iso) / totalDias) * 100));

  const meses: { label: string; leftPct: number }[] = [];
  const cursor = dataLocal(janelaInicio);
  cursor.setDate(1);
  const fim = dataLocal(janelaFim);
  while (cursor <= fim) {
    // o mês em que a janela começa entra encostado no 0% (o pct satura); em
    // janeiro o ano vai junto, para a régua de um ano não repetir nomes
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-01`;
    const mes = cursor.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
    meses.push({
      label: cursor.getMonth() === 0 ? `${mes} ${String(cursor.getFullYear()).slice(2)}` : mes,
      leftPct: pct(iso),
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const hojePct = hoje >= janelaInicio && hoje <= janelaFim ? pct(hoje) : null;
  const presentes = new Set(linhas.flatMap((l) => l.itens.map((i) => tipoDe(i.tipo).tipo)));
  const legenda = TIPOS.filter((t) => presentes.has(t.tipo));

  const conteudo = (
    <>
      <div style={{ display: "flex", justifyContent: semCartao ? "flex-end" : "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem" }}>
        {!semCartao && <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: 0 }}>Linha do tempo</h3>}
        <span className="soft" style={{ fontSize: "0.74rem", display: "flex", gap: "0.9rem", alignItems: "center", flexWrap: "wrap" }}>
          {legenda.map((t) => (
            <span key={t.tipo} style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
              <span style={{ width: 14, height: 8, borderRadius: 3, ...t.estilo }} /> {t.rotulo}
            </span>
          ))}
        </span>
      </div>

      {aviso && <div style={{ marginTop: "0.7rem" }}>{aviso}</div>}

      <div style={{ overflow: "auto", maxHeight: alturaMax, marginTop: "0.7rem" }}>
        <div style={{ minWidth: COLUNA_NOME + trilho, display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          {/* régua dos meses, presa no topo; o canto fica preso nos dois sentidos */}
          <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 2, background: FUNDO, height: 20 }}>
            <span aria-hidden style={{ width: COLUNA_NOME, flexShrink: 0, position: "sticky", left: 0, zIndex: 3, background: FUNDO }} />
            <div style={{ position: "relative", flex: 1, minWidth: trilho }}>
              {meses.map((m) => (
                <span
                  key={m.label + m.leftPct}
                  className="soft"
                  style={{
                    position: "absolute", left: `${m.leftPct}%`, top: 2, fontSize: "0.68rem", whiteSpace: "nowrap",
                    fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em",
                  }}
                >
                  {m.label}
                </span>
              ))}
            </div>
          </div>

          {linhas.map((l, idx) => (
            <div key={l.userId} style={{ display: "contents" }}>
              {l.grupo !== undefined && l.grupo !== linhas[idx - 1]?.grupo && (
                <span
                  className="soft"
                  style={{
                    position: "sticky", left: 0, alignSelf: "flex-start", fontSize: "0.7rem", fontWeight: 600,
                    textTransform: "uppercase", letterSpacing: "0.04em", marginTop: idx === 0 ? 0 : "0.45rem",
                  }}
                >
                  {l.grupo}
                </span>
              )}
              <div style={{ display: "flex", alignItems: "center" }}>
                {/* o nome fica preso à esquerda enquanto os meses rolam */}
                <span
                  title={l.nome ?? undefined}
                  style={{
                    width: COLUNA_NOME, flexShrink: 0, paddingRight: "0.5rem", boxSizing: "border-box",
                    position: "sticky", left: 0, zIndex: 1, background: FUNDO, alignSelf: "stretch",
                    display: "flex", alignItems: "center", fontSize: "0.8rem", fontWeight: 600,
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortName(l.nome)}</span>
                </span>
                <div style={{ position: "relative", flex: 1, minWidth: trilho, height: 20, background: "var(--surface-2)", borderRadius: 6 }}>
                  {meses.map((m) => (
                    <span
                      key={`g${m.leftPct}`}
                      aria-hidden
                      style={{ position: "absolute", left: `${m.leftPct}%`, top: 0, bottom: 0, borderLeft: "1px solid var(--border)" }}
                    />
                  ))}
                  {hojePct !== null && (
                    <span
                      aria-hidden
                      style={{ position: "absolute", left: `${hojePct}%`, top: 0, bottom: 0, borderLeft: "2px solid var(--mh-danger)", opacity: 0.55 }}
                    />
                  )}
                  {l.itens.map((it, i) => {
                    const left = pct(it.inicio);
                    const width = Math.max(pctFim(it.fim) - left, 0.3);
                    const t = tipoDe(it.tipo);
                    return (
                      <span
                        key={i}
                        title={`${formatDate(it.inicio)} a ${formatDate(it.fim)} (${t.rotulo})`}
                        style={{
                          position: "absolute", left: `${left}%`, width: `${width}%`,
                          top: 4, height: 12, borderRadius: 5, boxSizing: "border-box", ...t.estilo,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );

  return semCartao ? <div>{conteudo}</div> : <div className="card card-pad">{conteudo}</div>;
}
