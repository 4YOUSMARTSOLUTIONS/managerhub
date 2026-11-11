"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { DetailModal } from "@/components/ui/DetailModal";
import { DetailSection, Field, FieldGrid } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { ExportButton } from "@/components/ui/ExportButton";
import { formatDate, formatDateTime, normalizar, shortName } from "@/lib/format";
import type { BlitzAlertaAnalise } from "@/lib/blitz-aderencia";
import { valorDoCampo } from "./BlitzAderencia";

export type SituacaoAlerta = "" | "aguardando" | "tratado";
type Situacao = SituacaoAlerta;

/** O gestor como o filtro único das Análises mostra (vazio vira "Sem gestor (sucessores)"). */
const gestorDe = (a: BlitzAlertaAnalise) => valorDoCampo(a, "gestor");

/** O que deu errado na blitz, numa linha. */
function ocorrencia(a: BlitzAlertaAnalise): string {
  if (!a.liberado) return `Bloqueado${a.motivo ? `: ${a.motivo}` : ""}`;
  const n = a.respostas_nao.length;
  return `Liberado com desvio${n ? ` (${n} ${n === 1 ? "item" : "itens"} "não")` : ""}`;
}

/**
 * Os alertas da blitz no período, um a um (LUIZ, 11/11/2026). Toda blitz
 * liberada com desvio ou bloqueada avisa o gestor do colaborador, e só ele
 * registra a tratativa. Aqui quem acompanha (owner, admin, Gerencial,
 * segurança; o Gestor, a cadeia dele) vê quem já tratou e quem está devendo,
 * com o resumo por gestor para cobrar. Só leitura. Chega já filtrada pelo
 * filtro único das Análises; o resumo por gestor liga o filtro de gestor.
 */
export function BlitzAlertasLista({ alertas, rotuloPeriodo, chaveArquivo, situacaoInicial = "", gestorAtivo, onGestor }: {
  alertas: BlitzAlertaAnalise[];
  rotuloPeriodo: string;
  chaveArquivo: string;
  /** quem usa remonta com `key` quando o quadro de pendências pede "aguardando" */
  situacaoInicial?: Situacao;
  /** o gestor do filtro único, e como trocá-lo ("" tira) */
  gestorAtivo?: string;
  onGestor?: (gestor: string) => void;
}) {
  const [situacao, setSituacao] = useState<Situacao>(situacaoInicial);
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);

  // quem está devendo, do que mais deve para o que menos deve
  const devendo = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of alertas) if (!a.registrada_em) m.set(gestorDe(a), (m.get(gestorDe(a)) ?? 0) + 1);
    return [...m.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], "pt-BR"));
  }, [alertas]);

  const termo = normalizar(busca.trim());
  const lista = alertas.filter((a) =>
    (!situacao || (situacao === "tratado") === !!a.registrada_em)
    && (!termo || normalizar([a.colaborador, a.gestor, a.setor].filter(Boolean).join(" ")).includes(termo)));
  const tratados = alertas.filter((a) => a.registrada_em).length;
  const algumFiltro = !!situacao || !!busca;
  const detalhe = alertas.find((a) => a.id === aberto) ?? null;

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <div>
          <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>Alertas de {rotuloPeriodo}</h3>
          <p className="soft" style={{ fontSize: "0.78rem", margin: "0.15rem 0 0", maxWidth: 720 }}>
            Toda blitz liberada com desvio ou bloqueada avisa o gestor do colaborador, que conversa com a pessoa e registra a
            tratativa. Só o gestor alertado registra. {tratados} de {alertas.length} com tratativa.
          </p>
        </div>
        <ExportButton
          filename={`blitz-alertas-${chaveArquivo}.xlsx`}
          sheetName="Alertas"
          headers={["Data da blitz", "Colaborador", "Setor", "Unidade", "Gestor", "Ocorrência", "Itens não", "Situação", "Data da conversa", "O que foi tratado", "O que ficou combinado"]}
          rows={lista.map((a) => [
            formatDate(a.occurred_on), a.colaborador ?? "", a.setor ?? "", a.unidade ?? "", a.gestor ?? "",
            ocorrencia(a), a.respostas_nao.join("; "),
            a.registrada_em ? "Tratado" : "Aguardando tratativa",
            a.tratativa_em ? formatDate(a.tratativa_em) : "", a.tratativa_resumo ?? "", a.tratativa_acordo ?? "",
          ])}
        />
      </div>

      {/* quem está devendo: clicar filtra a lista por aquele gestor */}
      {devendo.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.4rem" }}>
          <span className="soft" style={{ fontSize: "0.78rem" }}>Aguardando tratativa:</span>
          {devendo.map(([g, n]) => {
            const escolhido = gestorAtivo === g && situacao === "aguardando";
            return (
              <button key={g} type="button" aria-pressed={escolhido}
                className={`btn btn-xs ${escolhido ? "btn-primary" : "btn-ghost"}`}
                onClick={() => {
                  if (escolhido) { onGestor?.(""); setSituacao(""); return; }
                  onGestor?.(g); setSituacao("aguardando");
                }}>
                {shortName(g)} <strong>{n}</strong>
              </button>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <input className="input" placeholder="Buscar colaborador ou gestor…" value={busca}
          onChange={(e) => setBusca(e.target.value)} style={{ width: 220, maxWidth: "100%" }} />
        <select className="select" value={situacao} aria-label="Situação" style={{ width: "auto" }}
          onChange={(e) => setSituacao(e.target.value as Situacao)}>
          <option value="">Situação: todas</option>
          <option value="aguardando">Aguardando tratativa</option>
          <option value="tratado">Tratados</option>
        </select>
        {algumFiltro && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSituacao(""); setBusca(""); }}>
            Limpar filtros
          </button>
        )}
      </div>

      {alertas.length === 0 ? (
        <EmptyState title="Nenhum alerta no período" description="Nenhuma blitz saiu com desvio ou bloqueio nas datas escolhidas." />
      ) : lista.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Nenhum alerta com esses filtros.</p>
      ) : (
        <div style={{ overflowX: "auto", maxHeight: 560, overflowY: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 100 }}>Blitz</th>
                <th>Colaborador</th>
                <th className="so-desktop">Gestor</th>
                <th className="so-desktop">Ocorrência</th>
                <th style={{ width: 190 }}>Situação</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((a) => (
                <tr key={a.id} onClick={() => setAberto(a.id)} style={{ cursor: "pointer" }} title="Abrir o alerta">
                  <td className="muted" style={{ fontSize: "0.82rem" }}>{formatDate(a.occurred_on)}</td>
                  <td style={{ fontWeight: 600 }}>
                    {shortName(a.colaborador)}
                    {a.setor && <span className="soft" style={{ fontWeight: 400, fontSize: "0.76rem" }}> · {a.setor}</span>}
                  </td>
                  <td className="so-desktop muted" style={{ fontSize: "0.82rem" }}>{shortName(a.gestor)}</td>
                  <td className="so-desktop muted" style={{ fontSize: "0.82rem" }}>{ocorrencia(a)}</td>
                  <td>
                    {a.registrada_em
                      ? <Badge tone="green">Tratado em {formatDate(a.tratativa_em)}</Badge>
                      : <Badge tone="amber">Aguardando tratativa</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detalhe && (
        <DetailModal
          open onClose={() => setAberto(null)} width="md"
          title={`${shortName(detalhe.colaborador)} · ${formatDate(detalhe.occurred_on)}`}
          badges={detalhe.registrada_em
            ? <Badge tone="green">Tratado em {formatDate(detalhe.tratativa_em)}</Badge>
            : <Badge tone="amber">Aguardando tratativa</Badge>}
          footer={<><span /><button type="button" className="btn btn-ghost" onClick={() => setAberto(null)}>Fechar</button></>}
        >
          <DetailSection title="A blitz">
            <FieldGrid>
              <Field label="Ocorrência">{ocorrencia(detalhe)}</Field>
              <Field label="Meio">{detalhe.meio ?? "—"}</Field>
              <Field label="Setor">{detalhe.setor ?? "—"}</Field>
              <Field label="Unidade">{detalhe.unidade ?? "—"}</Field>
            </FieldGrid>
            {detalhe.respostas_nao.length > 0 && (
              <ul style={{ margin: "0.6rem 0 0", paddingLeft: "1.1rem", fontSize: "0.84rem" }}>
                {detalhe.respostas_nao.map((q) => <li key={q}>{q}</li>)}
              </ul>
            )}
            {detalhe.observacao && (
              <p className="soft" style={{ margin: "0.6rem 0 0", fontSize: "0.83rem", whiteSpace: "pre-wrap" }}>{detalhe.observacao}</p>
            )}
          </DetailSection>
          <DetailSection title="Tratativa">
            <FieldGrid>
              <Field label="Gestor alertado">{detalhe.gestor ?? "—"}</Field>
              <Field label="Alerta enviado">{formatDateTime(detalhe.enviado_em)}</Field>
              {detalhe.tratativa_em && <Field label="Data da conversa">{formatDate(detalhe.tratativa_em)}</Field>}
            </FieldGrid>
            {detalhe.registrada_em ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.6rem", fontSize: "0.85rem" }}>
                <div><span className="soft">O que foi tratado: </span><span style={{ whiteSpace: "pre-wrap" }}>{detalhe.tratativa_resumo}</span></div>
                {detalhe.tratativa_acordo && (
                  <div><span className="soft">O que ficou combinado: </span><span style={{ whiteSpace: "pre-wrap" }}>{detalhe.tratativa_acordo}</span></div>
                )}
              </div>
            ) : (
              <p className="soft" style={{ margin: "0.6rem 0 0", fontSize: "0.83rem" }}>
                O gestor ainda não registrou a conversa. O registro é feito por ele, na aba Análises da blitz.
              </p>
            )}
          </DetailSection>
        </DetailModal>
      )}
    </div>
  );
}

/** As duas cores do quadro: vermelho para bloqueio, amarelo para desvio, translúcidas, com a borda cheia. */
const COR_PENDENCIA = {
  bloqueio: { fundo: "color-mix(in srgb, var(--mh-danger) 55%, transparent)", borda: "var(--mh-danger)", rotulo: "Bloqueio" },
  desvio: { fundo: "color-mix(in srgb, var(--mh-warning) 55%, transparent)", borda: "var(--mh-warning)", rotulo: "Liberado com desvio" },
} as const;

/**
 * Tratativas pendentes por gestor (LUIZ, 11/11/2026), no painel das Análises:
 * quem está devendo conversa com a equipe, do que mais deve para o que menos
 * deve. A barra separa o que é bloqueio (vermelho) do que é liberado com
 * desvio (amarelo), translúcidos. Clicar num gestor abre os Alertas filtrados
 * nele. Some quando não há pendência.
 */
export function TratativasPendentesPorGestor({ alertas, rotuloPeriodo, onVer }: {
  alertas: BlitzAlertaAnalise[];
  rotuloPeriodo: string;
  onVer: (gestor: string) => void;
}) {
  const [sobre, setSobre] = useState<string | null>(null);
  const linhas = useMemo(() => {
    const m = new Map<string, { gestor: string; pendentes: number; bloqueio: number; desvio: number; total: number }>();
    for (const a of alertas) {
      const g = gestorDe(a);
      const l = m.get(g) ?? { gestor: g, pendentes: 0, bloqueio: 0, desvio: 0, total: 0 };
      l.total += 1;
      if (!a.registrada_em) {
        l.pendentes += 1;
        if (a.liberado) l.desvio += 1; else l.bloqueio += 1;
      }
      m.set(g, l);
    }
    return [...m.values()].filter((l) => l.pendentes > 0)
      .sort((x, y) => y.pendentes - x.pendentes || x.gestor.localeCompare(y.gestor, "pt-BR"));
  }, [alertas]);

  if (linhas.length === 0) return null;
  const maior = Math.max(...linhas.map((l) => l.pendentes));
  const totalPendente = linhas.reduce((n, l) => n + l.pendentes, 0);
  const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

  return (
    <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.6rem", flexWrap: "wrap" }}>
        <div>
          <h4 style={{ fontSize: "0.92rem", fontWeight: 700, margin: 0 }}>Tratativas pendentes por gestor</h4>
          <p className="soft" style={{ fontSize: "0.74rem", margin: "0.2rem 0 0" }}>
            {totalPendente} {totalPendente === 1 ? "alerta" : "alertas"} de {rotuloPeriodo} sem tratativa registrada. Clique num gestor para ver os alertas dele.
          </p>
        </div>
        {/* legenda: duas séries, então a cor nunca fica sozinha */}
        <div style={{ display: "flex", gap: "0.8rem", fontSize: "0.72rem" }} className="soft">
          {(["bloqueio", "desvio"] as const).map((k) => (
            <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", whiteSpace: "nowrap" }}>
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: COR_PENDENCIA[k].fundo, border: `1px solid ${COR_PENDENCIA[k].borda}` }} />
              {COR_PENDENCIA[k].rotulo}
            </span>
          ))}
        </div>
      </div>
      <div role="group" aria-label="Tratativas pendentes por gestor" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {linhas.map((l) => {
          const ativo = sobre === l.gestor;
          const ver = () => onVer(l.gestor);
          const detalhe = [l.bloqueio ? plural(l.bloqueio, "bloqueio", "bloqueios") : "", l.desvio ? plural(l.desvio, "com desvio", "com desvio") : ""]
            .filter(Boolean).join(" e ");
          return (
            <div key={l.gestor} role="button" tabIndex={0}
              aria-label={`${l.gestor}: ${l.pendentes} de ${l.total} alertas sem tratativa (${detalhe}). Ver os alertas`}
              title={`${l.gestor}: ${detalhe} sem tratativa`}
              onClick={ver} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ver(); } }}
              onMouseEnter={() => setSobre(l.gestor)} onMouseLeave={() => setSobre(null)}
              style={{ display: "grid", gridTemplateColumns: "minmax(120px, 30%) 1fr 92px", alignItems: "center", gap: "0.6rem", padding: "3px 0", cursor: "pointer" }}>
              <span className="soft" style={{ fontSize: "0.76rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.gestor}</span>
              <div style={{ height: 16, borderLeft: "1px solid var(--border)" }}>
                {/* bloqueio primeiro (o mais grave), depois desvio; 2px entre os pedaços */}
                <div style={{
                  display: "flex", gap: 2, width: `${(l.pendentes / maior) * 100}%`, minWidth: 6, height: "100%",
                  opacity: sobre && !ativo ? 0.5 : 1, transition: "opacity 120ms",
                }}>
                  {(["bloqueio", "desvio"] as const).filter((k) => l[k] > 0).map((k, i, lista) => (
                    <div key={k} style={{
                      flex: l[k], minWidth: 3, height: "100%", background: COR_PENDENCIA[k].fundo,
                      border: `1px solid ${COR_PENDENCIA[k].borda}`, borderLeft: i === 0 ? "none" : undefined,
                      borderRadius: i === lista.length - 1 ? "0 4px 4px 0" : 0,
                    }} />
                  ))}
                </div>
              </div>
              <span style={{ fontSize: "0.78rem", textAlign: "right", whiteSpace: "nowrap" }}>
                <strong>{l.pendentes}</strong> <span className="soft">de {l.total}</span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
