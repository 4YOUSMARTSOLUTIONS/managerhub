"use client";

import Link from "next/link";
import { Check, Lock, PlayCircle, Route } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import {
  effComBloqueio, effTrainingStatus, TRAINING_STATUS_LABEL, TRAINING_STATUS_TONE,
  contaComoEmDia,
} from "@/lib/training-schedule";
import { formatDate } from "@/lib/format";
import type { MyEnrollmentRow } from "@/components/TrainingsManager";
import type { TrilhaRow } from "@/components/TrainingPathsPanel";

/**
 * Card do programa em "Meus treinamentos".
 *
 * O que ele responde, e a lista de linhas soltas não respondia: em que ponto do
 * programa a pessoa está. O progresso conta PASSOS OBRIGATÓRIOS cumpridos, e
 * usa a mesma régua da conformidade (`contaComoEmDia`), então um curso concluído
 * fora da trilha, antes dela existir, já aparece marcado.
 */
export function TrainingPathCards({
  paths, rows,
}: {
  paths: TrilhaRow[];
  rows: MyEnrollmentRow[];
}) {
  const minhas = rows.filter((r) => r.pathId);
  if (minhas.length === 0) return null;

  const trilhasComMatricula = paths.filter((p) => minhas.some((r) => r.pathId === p.id));
  if (trilhasComMatricula.length === 0) return null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "0.8rem" }}>
      {trilhasComMatricula.map((t) => {
        // a ordem dos passos vem do cadastro da trilha; casar por NOME é o que
        // o card tem em mãos, e é suficiente porque o mesmo curso não se repete
        // dentro de uma trilha (constraint no banco)
        const passos = t.passoNames.map((nome) => {
          const linha = minhas.find((r) => r.pathId === t.id && r.trainingName === nome);
          const s = linha ? effComBloqueio(
            effTrainingStatus({
              status: linha.status,
              dueAt: linha.dueAt,
              expiresAt: linha.expiresAt,
              antecipacaoDias: linha.antecipacaoDias,
            }),
            linha.bloqueada,
          ) : null;
          return { nome, linha, s };
        });

        const feitos = passos.filter((p) => p.s && contaComoEmDia(p.s)).length;
        const total = passos.length;
        const pct = total === 0 ? 0 : Math.round((feitos / total) * 100);
        const prazo = minhas.find((r) => r.pathId === t.id)?.dueAt ?? null;

        return (
          <div key={t.id} className="card" style={{ padding: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.7rem" }}>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <Route size={15} style={{ color: "var(--text-muted)" }} />
                  {t.name}
                </h3>
                {prazo && (
                  <p className="soft" style={{ fontSize: "0.74rem", margin: "0.2rem 0 0" }}>
                    Prazo do programa: {formatDate(prazo)}
                  </p>
                )}
              </div>
              <span style={{ fontSize: "0.82rem", fontWeight: 700, whiteSpace: "nowrap" }}>
                {feitos} de {total}
              </span>
            </div>

            <div style={{ height: 8, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden", margin: "0.7rem 0" }}>
              <div
                style={{
                  width: `${pct}%`, height: "100%", borderRadius: 999,
                  background: pct === 100 ? "var(--mh-success)" : "var(--mh-primary)",
                }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {passos.map((p, i) => {
                const feito = p.s && contaComoEmDia(p.s);
                return (
                  <div key={p.nome} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.83rem" }}>
                    <span className="soft" style={{ minWidth: 14, fontSize: "0.74rem" }}>{i + 1}</span>
                    {feito
                      ? <Check size={14} style={{ color: "var(--mh-success)", flexShrink: 0 }} />
                      : p.linha?.bloqueada
                        ? <Lock size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                        : <PlayCircle size={14} style={{ color: "var(--mh-primary)", flexShrink: 0 }} />}
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.nome}
                    </span>
                    {p.s && <Badge tone={TRAINING_STATUS_TONE[p.s]}>{TRAINING_STATUS_LABEL[p.s]}</Badge>}
                    {p.linha && !feito && !p.linha.bloqueada && (
                      <Link href={`/treinamentos/realizar/${p.linha.id}`} className="btn btn-primary btn-sm">
                        Fazer
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
