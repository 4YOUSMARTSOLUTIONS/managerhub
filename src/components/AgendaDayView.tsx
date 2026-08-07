"use client";

import { ChevronLeft, ChevronRight, AlertTriangle, ExternalLink, MessageSquare, Check, Contrast, X } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { AGENDA_STATUS_LABEL, AGENDA_STATUS_TONE, AGENDA_WORKDAY_MINUTES, WEEKDAYS_PT } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { dateFromYMD, fmtMinutes, pct } from "@/lib/agenda-schedule";
import type { DayItem } from "@/lib/agenda-types";
import type { Enums } from "@/types/database";

const STATUSES = ["feito", "parcial", "nao_feito"] as const;
const STATUS_ICON: Record<(typeof STATUSES)[number], React.ReactNode> = {
  feito: <Check size={15} />,
  parcial: <Contrast size={14} />,
  nao_feito: <X size={15} />,
};

export function AgendaDayView({
  subjectName, dateStr, todayStr, items, nonWorking, reservedMin, canFill, dayAdherence,
  onChangeDate, onToday, onSetStatus, onOpenDetail,
}: {
  subjectName: string;
  dateStr: string;
  todayStr: string;
  items: DayItem[];
  nonWorking: string | null;
  reservedMin: number;
  canFill: boolean;
  dayAdherence: number | null;
  onChangeDate: (deltaDays: number) => void;
  onToday: () => void;
  onSetStatus: (item: DayItem, status: Enums<"agenda_log_status">) => void;
  onOpenDetail: (item: DayItem) => void;
}) {
  const d = dateFromYMD(dateStr);
  const weekday = WEEKDAYS_PT[d.getDay()];
  const budget = AGENDA_WORKDAY_MINUTES;
  const over = reservedMin > budget;
  const freeMin = budget - reservedMin;
  const barPct = Math.min(100, Math.round((reservedMin / budget) * 100));

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      {/* cabeçalho de navegação */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", padding: "0.85rem 1.1rem", borderBottom: "1px solid var(--mh-border)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <button type="button" className="icon-btn" onClick={() => onChangeDate(-1)} aria-label="Dia anterior"><ChevronLeft size={16} /></button>
          <div style={{ minWidth: 190, textAlign: "center" }}>
            <div style={{ fontWeight: 700 }}>{weekday}, {formatDate(dateStr)}</div>
            <div className="soft" style={{ fontSize: "0.74rem" }}>{subjectName}</div>
          </div>
          <button type="button" className="icon-btn" onClick={() => onChangeDate(1)} aria-label="Próximo dia"><ChevronRight size={16} /></button>
          {dateStr !== todayStr && <button type="button" className="btn btn-ghost btn-sm" onClick={onToday}>Hoje</button>}
        </div>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center", fontSize: "0.8rem" }}>
          <span className="soft">Aderência do dia: <strong style={{ color: "var(--mh-text-1)" }}>{pct(dayAdherence)}</strong></span>
        </div>
      </div>

      {/* barra de carga (8h) */}
      <div style={{ padding: "0.85rem 1.1rem", borderBottom: "1px solid var(--mh-border)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", marginBottom: "0.35rem" }}>
          <span className="soft">Carga reservada: <strong style={{ color: over ? "var(--mh-danger)" : "var(--mh-text-1)" }}>{fmtMinutes(reservedMin)}</strong> de {fmtMinutes(budget)}</span>
          <span className="soft">{over ? <span style={{ color: "var(--mh-danger)", fontWeight: 600 }}>Excede em {fmtMinutes(reservedMin - budget)}</span> : <>Livre: {fmtMinutes(Math.max(0, freeMin))}</>}</span>
        </div>
        <div style={{ height: 8, borderRadius: 999, background: "var(--mh-surface-3, var(--mh-surface-2))", overflow: "hidden" }}>
          <div style={{ width: `${barPct}%`, height: "100%", background: over ? "var(--mh-danger)" : "var(--mh-success)", transition: "width 0.2s" }} />
        </div>
        {over && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.5rem", color: "var(--mh-danger)", fontSize: "0.8rem", fontWeight: 600 }}>
            <AlertTriangle size={14} /> A carga do dia ultrapassa a jornada de 8 horas. Considere redistribuir tarefas.
          </div>
        )}
      </div>

      {/* banner dia não trabalhado */}
      {nonWorking && (
        <div style={{ padding: "0.7rem 1.1rem", background: "var(--mh-surface-2)", borderBottom: "1px solid var(--mh-border)", fontSize: "0.83rem", color: "var(--mh-text-2)" }}>
          Dia não trabalhado ({nonWorking}). As tarefas deste dia não são cobradas.
        </div>
      )}

      {/* itens do dia */}
      {items.length === 0 ? (
        <EmptyState title="Nenhuma tarefa para o dia" description="Nada agendado para esta data." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {items.map((it) => (
            <div key={it.key} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.7rem 1.1rem", borderBottom: "1px solid var(--mh-border)", opacity: it.chargeable ? 1 : 0.6 }}>
              <div style={{ width: 52, flexShrink: 0, fontVariantNumeric: "tabular-nums", fontWeight: 600, fontSize: "0.85rem" }}>
                {it.time ? it.time.slice(0, 5) : "—"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: "0.88rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {it.title}
                  {it.kind === "checklist" && <Badge tone="purple">Checklist</Badge>}
                  {it.flexible && <Badge tone="blue">Tempo médio</Badge>}
                </div>
                {/* o nome da agenda saiu: repetia em toda linha, e a tela toda
                    já é de um responsável só. Fica a duração, que muda por linha. */}
                {it.durationMin > 0 && (
                  <div className="soft" style={{ fontSize: "0.74rem" }}>
                    {fmtMinutes(it.durationMin)}{it.flexible ? " (média)" : ""}
                  </div>
                )}
              </div>

              {it.kind === "task" && it.flexible ? (
                <>
                  <Badge tone="green">Realizada</Badge>
                  <span className="soft" style={{ fontSize: "0.7rem" }}>automática</span>
                  <BotaoDetalhe item={it} onOpenDetail={onOpenDetail} />
                </>
              ) : it.kind === "task" ? (
                <>
                  <div className="status-seg">
                    {STATUSES.map((s) => {
                      const active = it.status === s;
                      const tone = AGENDA_STATUS_TONE[s];
                      const col = tone === "green" ? "var(--mh-success)" : tone === "amber" ? "var(--mh-warning)" : "var(--mh-danger)";
                      return (
                        <button
                          key={s}
                          type="button"
                          className="status-seg-btn status-seg-icon"
                          data-active={active}
                          data-tone={tone}
                          disabled={!canFill}
                          title={AGENDA_STATUS_LABEL[s]}
                          aria-label={AGENDA_STATUS_LABEL[s]}
                          onClick={() => onSetStatus(it, active ? "pendente" : s)}
                          style={active ? { background: col } : undefined}
                        >
                          {STATUS_ICON[s]}
                        </button>
                      );
                    })}
                  </div>
                  <BotaoDetalhe item={it} onOpenDetail={onOpenDetail} />
                </>
              ) : (
                <>
                  <Badge tone={it.status === "feito" ? "green" : it.overdue ? "red" : "amber"}>
                    {it.status === "feito" ? "Concluído" : it.overdue ? "Atrasado" : "Pendente"}
                  </Badge>
                  <Link href="/checklists" className="icon-btn" title="Abrir checklists"><ExternalLink size={15} /></Link>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Observação, comentários e anexos da tarefa.
 *
 *  Acende em azul quando já há conteúdo lá dentro: sem isso, saber se uma tarefa
 *  tem justificativa exigia abrir uma por uma. */
function BotaoDetalhe({ item, onOpenDetail }: { item: DayItem; onOpenDetail: (item: DayItem) => void }) {
  const cheio = !!item.hasDetail;
  return (
    <button
      type="button"
      className="icon-btn"
      title={cheio ? "Detalhes, observação e anexos (preenchido)" : "Detalhes, observação e anexos"}
      aria-label="Detalhes, observação e anexos"
      onClick={() => onOpenDetail(item)}
      style={cheio ? { background: "var(--mh-info-soft)", color: "var(--mh-info)", borderColor: "color-mix(in srgb, var(--mh-info) 34%, transparent)" } : undefined}
    >
      <MessageSquare size={15} />
    </button>
  );
}
