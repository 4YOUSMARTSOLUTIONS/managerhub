"use client";

import { X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { AGENDA_FREQUENCY_LABEL, WEEKDAYS_PT } from "@/lib/constants";
import { formatDate, shortName } from "@/lib/format";
import type { AgendaFull, AgendaTaskFull } from "@/lib/agenda-types";

/**
 * Ficha da agenda, só para ler.
 *
 * A lista de Agendas mostrava a linha e, fora Editar/Inativar/Excluir, não tinha
 * como saber o que havia DENTRO da agenda. E aqueles três botões dependem de
 * `canEditAgenda`, então quem é apenas RESPONSÁVEL por uma agenda criada pelo
 * gestor via a linha sem nenhuma ação: sabia que a agenda existia e não sabia
 * quais tarefas ela cobrava dele.
 *
 * Por isso este painel não tem trava de papel: quem já enxerga a linha (a RLS
 * decidiu isso) pode abrir a ficha. Nada aqui grava.
 */

/** Quando a tarefa acontece, em uma frase. */
function quando(t: AgendaTaskFull): string {
  const base = AGENDA_FREQUENCY_LABEL[t.frequency];
  if (t.frequency === "semanal") {
    const dias = [...(t.weekdays ?? [])].sort((a, b) => a - b).map((w) => WEEKDAYS_PT[w]?.slice(0, 3)).filter(Boolean);
    return dias.length > 0 ? `${base} · ${dias.join(", ")}` : base;
  }
  if (t.frequency === "mensal") return `${base} · dia ${t.dayOfMonth ?? 1}`;
  if (t.frequency === "unica") return t.fixedDate ? `${base} · ${formatDate(t.fixedDate)}` : base;
  return base;
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="soft" style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>{rotulo}</div>
      <div style={{ fontSize: "0.86rem", marginTop: 2 }}>{children}</div>
    </div>
  );
}

export function AgendaViewDialog({ agenda, onClose }: { agenda: AgendaFull | null; onClose: () => void }) {
  if (!agenda) return null;

  const ativas = agenda.tasks.filter((t) => t.active).length;
  // carga só das diárias: é a única frequência que vale para TODO dia útil, e
  // somar semanal com mensal daria um número que não acontece em dia nenhum
  const cargaDiaria = agenda.tasks
    .filter((t) => t.active && t.frequency === "diaria")
    .reduce((s, t) => s + t.durationMinutes, 0);

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(3,6,14,0.6)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "5vh 1rem", zIndex: 55, overflowY: "auto",
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 720, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "1rem 1.25rem", borderBottom: "1px solid var(--mh-border)", gap: "0.75rem" }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>{agenda.name}</h2>
            <div className="soft" style={{ fontSize: "0.78rem", marginTop: 2 }}>
              {ativas} {ativas === 1 ? "tarefa ativa" : "tarefas ativas"}
              {agenda.tasks.length !== ativas && <> · {agenda.tasks.length - ativas} inativa(s)</>}
              {cargaDiaria > 0 && <> · {cargaDiaria} min por dia nas diárias</>}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <Badge tone={agenda.active ? "green" : "gray"}>{agenda.active ? "Ativa" : "Inativa"}</Badge>
            <button type="button" onClick={onClose} className="icon-btn" aria-label="Fechar"><X size={16} /></button>
          </div>
        </div>

        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1.1rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.9rem" }}>
            {/* Unidade fica de fora: `AgendaBuilderDialog` grava `unit_id: null`
                fixo, então o campo sairia "—" em toda agenda. Quando o construtor
                ganhar o seletor de unidade, `agenda-data` precisa resolver o nome
                (hoje também grava `unitName: null` fixo) e aí o campo entra aqui. */}
            <Campo rotulo="Responsável">{shortName(agenda.responsibleName)}</Campo>
            <Campo rotulo="Criada por">{shortName(agenda.ownerName)}</Campo>
            <Campo rotulo="Em vigor desde">{formatDate(agenda.createdDate)}</Campo>
            <Campo rotulo="Responsável edita">
              {agenda.canResponsibleEdit ? "Sim" : <span className="soft">Não</span>}
            </Campo>
          </div>

          {agenda.description && (
            <div>
              <div className="soft" style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>Descrição</div>
              <p style={{ margin: 0, fontSize: "0.86rem", whiteSpace: "pre-wrap" }}>{agenda.description}</p>
            </div>
          )}

          <div>
            <div className="soft" style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.4rem" }}>Tarefas</div>
            {agenda.tasks.length === 0 ? (
              <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Esta agenda ainda não tem tarefas.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Tarefa</th>
                      <th>Quando</th>
                      <th>Horário</th>
                      <th style={{ textAlign: "right" }}>Duração</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agenda.tasks.map((t) => (
                      <tr key={t.id} style={{ opacity: t.active ? 1 : 0.5 }}>
                        <td>
                          <span style={{ fontWeight: 600 }}>{t.title}</span>
                          {!t.active && <span className="soft" style={{ fontSize: "0.72rem" }}> · inativa</span>}
                          {t.description && <div className="soft" style={{ fontSize: "0.74rem", fontWeight: 400 }}>{t.description}</div>}
                        </td>
                        <td className="muted" style={{ whiteSpace: "nowrap" }}>{quando(t)}</td>
                        <td className="muted" style={{ whiteSpace: "nowrap" }}>
                          {t.flexible
                            ? <span className="soft">sem horário fixo</span>
                            : (t.scheduledTime ?? <span className="soft">—</span>)}
                        </td>
                        <td className="muted" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {t.durationMinutes} min
                          {t.flexible && <div className="soft" style={{ fontSize: "0.72rem" }}>média</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", padding: "0.9rem 1.25rem", borderTop: "1px solid var(--mh-border)" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
