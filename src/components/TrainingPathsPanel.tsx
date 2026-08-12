"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Route, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { confirmDialog } from "@/components/ui/confirm";
import { TrainingPathDialog } from "@/components/TrainingPathDialog";
import { deleteTrilha, getTrilhaForEdit, type TrilhaForEdit } from "@/lib/actions/training-paths";
import type { Opt, PersonOpt, SubOpt, TrainingRow } from "@/components/TrainingsManager";

export type TrilhaRow = {
  id: string;
  name: string;
  description: string | null;
  prazoDias: number | null;
  active: boolean;
  /** nomes dos passos, já na ordem */
  passoNames: string[];
  ruleCount: number;
  /** pessoas com matrícula viva vinda desta trilha */
  atribuidos: number;
};

export function TrainingPathsPanel({
  rows, trainings, people, departments, subdepartments, positions, units, podeCadastrar,
}: {
  rows: TrilhaRow[];
  trainings: TrainingRow[];
  people: PersonOpt[];
  departments: Opt[];
  subdepartments: SubOpt[];
  positions: Opt[];
  units: Opt[];
  podeCadastrar: boolean;
}) {
  const [editando, setEditando] = useState<TrilhaForEdit | null>(null);
  const [criando, setCriando] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  const excluir = (t: TrilhaRow) => {
    start(async () => {
      const ok = await confirmDialog({
        title: "Excluir trilha",
        message: `"${t.name}" deixa de existir e as matrículas ainda não iniciadas saem da cobrança. O que já foi concluído continua no histórico.`,
        confirmLabel: "Excluir",
        tone: "danger",
      });
      if (!ok) return;
      await deleteTrilha(t.id);
      router.refresh();
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {podeCadastrar && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-primary" onClick={() => setCriando(true)}>
            Nova trilha
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="Nenhuma trilha cadastrada"
          description="Trilha é um programa de formação: vários treinamentos numa ordem que importa, como a integração de um novo colaborador."
        />
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Trilha</th>
                <th>Passos</th>
                <th>Prazo</th>
                <th>Público</th>
                <th>Atribuídos</th>
                <th>Situação</th>
                {podeCadastrar && <th></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} style={{ opacity: t.active ? 1 : 0.6 }}>
                  <td>
                    <span style={{ fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                      <Route size={14} style={{ color: "var(--text-muted)" }} />
                      {t.name}
                    </span>
                    {t.description && (
                      <div className="soft" style={{ fontSize: "0.72rem" }}>{t.description}</div>
                    )}
                  </td>
                  <td className="muted">
                    {t.passoNames.length > 0
                      ? t.passoNames.map((n, i) => `${i + 1}. ${n}`).join("  ")
                      : "Sem passos"}
                  </td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>
                    {t.prazoDias ? `${t.prazoDias} dias` : "Do treinamento"}
                  </td>
                  <td className="muted">
                    {t.ruleCount > 0 ? `${t.ruleCount} regra${t.ruleCount > 1 ? "s" : ""}` : "Sem público"}
                  </td>
                  <td className="muted">{t.atribuidos}</td>
                  <td><Badge tone={t.active ? "green" : "gray"}>{t.active ? "Ativa" : "Inativa"}</Badge></td>
                  {podeCadastrar && (
                    <td>
                      <span style={{ display: "inline-flex", gap: "0.3rem" }}>
                        <button
                          type="button" className="icon-btn" title="Editar"
                          onClick={async () => {
                            const t2 = await getTrilhaForEdit(t.id);
                            if (t2) setEditando(t2);
                          }}
                        >
                          <Pencil size={15} />
                        </button>
                        <button type="button" className="icon-btn icon-btn-danger" title="Excluir" disabled={pending} onClick={() => excluir(t)}>
                          <Trash2 size={15} />
                        </button>
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(criando || editando) && (
        <TrainingPathDialog
          trilha={editando}
          trainings={trainings}
          people={people}
          departments={departments}
          subdepartments={subdepartments}
          positions={positions}
          units={units}
          onClose={() => { setCriando(false); setEditando(null); }}
        />
      )}
    </div>
  );
}
