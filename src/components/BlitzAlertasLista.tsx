"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { DetailModal } from "@/components/ui/DetailModal";
import { DetailSection, Field, FieldGrid } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { ExportButton } from "@/components/ui/ExportButton";
import { formatDate, formatDateTime, normalizar, shortName } from "@/lib/format";
import type { BlitzAlertaAnalise } from "@/lib/blitz-aderencia";

export type SituacaoAlerta = "" | "aguardando" | "tratado";
type Situacao = SituacaoAlerta;

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
 * Só leitura. Chega já filtrada pelo filtro único das Análises; o resumo de
 * quem está devendo fica no quadro de pendências da aba Análises.
 */
export function BlitzAlertasLista({ alertas, rotuloPeriodo, chaveArquivo, situacaoInicial = "", item = "", onItem }: {
  alertas: BlitzAlertaAnalise[];
  rotuloPeriodo: string;
  chaveArquivo: string;
  /** quem usa remonta com `key` quando o quadro de pendências pede "aguardando" */
  situacaoInicial?: Situacao;
  /** o item (pergunta) clicado em "Itens que mais falham": só os alertas com "não" nele */
  item?: string;
  onItem?: (pergunta: string) => void;
}) {
  const [situacao, setSituacao] = useState<Situacao>(situacaoInicial);
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);

  const termo = normalizar(busca.trim());
  const lista = alertas.filter((a) =>
    (!item || a.respostas_nao.includes(item))
    && (!situacao || (situacao === "tratado") === !!a.registrada_em)
    && (!termo || normalizar([a.colaborador, a.gestor, a.setor].filter(Boolean).join(" ")).includes(termo)));
  const tratados = alertas.filter((a) => a.registrada_em).length;
  const algumFiltro = !!situacao || !!busca || !!item;
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
          headers={["Data da blitz", "Matrícula", "Colaborador", "Setor", "Unidade", "Gestor", "Ocorrência", "Itens não conformes", "Situação", "Data da conversa", "O que foi tratado", "O que ficou combinado"]}
          rows={lista.map((a) => [
            formatDate(a.occurred_on), a.matricula ?? "", a.colaborador ?? "", a.setor ?? "", a.unidade ?? "", a.gestor ?? "",
            ocorrencia(a), a.respostas_nao.join("; "),
            a.registrada_em ? "Tratado" : "Aguardando tratativa",
            a.tratativa_em ? formatDate(a.tratativa_em) : "", a.tratativa_resumo ?? "", a.tratativa_acordo ?? "",
          ])}
        />
      </div>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <input className="input" placeholder="Buscar colaborador ou gestor…" value={busca}
          onChange={(e) => setBusca(e.target.value)} style={{ width: 220, maxWidth: "100%" }} />
        <select className="select" value={situacao} aria-label="Situação" style={{ width: "auto" }}
          onChange={(e) => setSituacao(e.target.value as Situacao)}>
          <option value="">Situação: todas</option>
          <option value="aguardando">Aguardando tratativa</option>
          <option value="tratado">Tratados</option>
        </select>
        {/* o item que veio do clique em "Itens que mais falham" (LUIZ, 11/11/2026) */}
        {item && (
          <button type="button" className="btn btn-ghost btn-sm" title={`Tirar o filtro: ${item}`} onClick={() => onItem?.("")}
            style={{ maxWidth: 420, display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Item: {item}</span>
            <X size={13} aria-hidden style={{ flexShrink: 0 }} />
          </button>
        )}
        {algumFiltro && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSituacao(""); setBusca(""); onItem?.(""); }}>
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
                <th style={{ width: 90 }}>Matrícula</th>
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
                  <td className="muted" style={{ fontSize: "0.82rem", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{a.matricula ?? "—"}</td>
                  <td style={{ fontWeight: 600 }}>
                    {shortName(a.colaborador)}
                    {a.setor && <span className="soft" style={{ fontWeight: 400, fontSize: "0.76rem" }}> · {a.setor}</span>}
                  </td>
                  <td className="so-desktop muted" style={{ fontSize: "0.82rem" }}>{shortName(a.gestor)}</td>
                  <td className="so-desktop muted" style={{ fontSize: "0.82rem" }}>{ocorrencia(a)}</td>
                  <td>
                    {a.registrada_em
                      ? <Badge tone="green">Tratado em {formatDate(a.tratativa_em)}</Badge>
                      : <Badge tone={a.liberado ? "amber" : "red"}>Aguardando tratativa</Badge>}
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
            : <Badge tone={detalhe.liberado ? "amber" : "red"}>Aguardando tratativa</Badge>}
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
