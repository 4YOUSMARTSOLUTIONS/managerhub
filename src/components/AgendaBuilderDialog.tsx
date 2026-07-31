"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { SearchSelect } from "./SearchSelect";
import { AGENDA_FREQUENCY_LABEL, WEEKDAYS_PT } from "@/lib/constants";
import { createAgenda, updateAgenda, type AgendaInput, type AgendaTaskInput } from "@/lib/actions/agenda";
import type { AgendaFull } from "@/lib/agenda-types";
import type { Enums } from "@/types/database";

type Opt = { id: string; name: string };
type TaskDraft = AgendaTaskInput & { key: string };

const FREQS: Enums<"agenda_frequency">[] = ["diaria", "semanal", "mensal", "unica"];
let seq = 0;
const newKey = () => `t${seq++}`;

function emptyTask(): TaskDraft {
  return { key: newKey(), title: "", description: "", scheduled_time: "", duration_minutes: 30, frequency: "diaria", weekdays: [], day_of_month: 1, fixed_date: "", active: true, flexible: false };
}

function toMin(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
}
function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1).getDay();
}
/** As duas tarefas podem cair no mesmo dia (para valer a checagem de horário)? */
function canShareDay(a: TaskDraft, b: TaskDraft): boolean {
  const fa = a.frequency, fb = b.frequency;
  if (fa === "diaria" || fb === "diaria") return true;
  if (fa === "semanal" && fb === "semanal") return (a.weekdays ?? []).some((w) => (b.weekdays ?? []).includes(w));
  if (fa === "mensal" && fb === "mensal") return (a.day_of_month ?? 1) === (b.day_of_month ?? 1);
  if (fa === "unica" && fb === "unica") return !!a.fixed_date && a.fixed_date === b.fixed_date;
  const mixed = (x: TaskDraft, y: TaskDraft): boolean | null => {
    if (x.frequency === "unica") {
      if (!x.fixed_date) return false;
      if (y.frequency === "semanal") return (y.weekdays ?? []).includes(weekdayOf(x.fixed_date));
      if (y.frequency === "mensal") return Number(x.fixed_date.split("-")[2]) === (y.day_of_month ?? 1);
    }
    return null;
  };
  const p1 = mixed(a, b); if (p1 !== null) return p1;
  const p2 = mixed(b, a); if (p2 !== null) return p2;
  // semanal x mensal podem coincidir em algum dia
  return true;
}
/** Pares de tarefas com horários sobrepostos no mesmo dia. */
function findOverlaps(tasks: TaskDraft[]): [string, string][] {
  const list = tasks.filter((t) => t.title.trim() && t.scheduled_time);
  const out: [string, string][] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (!canShareDay(a, b)) continue;
      const as = toMin(a.scheduled_time), bs = toMin(b.scheduled_time);
      if (as == null || bs == null) continue;
      const ae = as + (a.duration_minutes || 0), be = bs + (b.duration_minutes || 0);
      if (as < be && bs < ae) out.push([a.title.trim() || "Tarefa", b.title.trim() || "Tarefa"]);
    }
  }
  return out;
}

export function AgendaBuilderDialog({
  open, onClose, agenda, people, currentUserId,
}: {
  open: boolean;
  onClose: () => void;
  agenda: AgendaFull | null;
  people: Opt[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [responsibleId, setResponsibleId] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [tasks, setTasks] = useState<TaskDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (agenda) {
      setName(agenda.name);
      setDescription(agenda.description ?? "");
      setResponsibleId(agenda.responsibleId);
      setCanEdit(agenda.canResponsibleEdit);
      setTasks(agenda.tasks.map((t) => ({
        key: newKey(), id: t.id, title: t.title, description: t.description ?? "",
        scheduled_time: t.scheduledTime ?? "", duration_minutes: t.durationMinutes,
        frequency: t.frequency, weekdays: t.weekdays ?? [], day_of_month: t.dayOfMonth ?? 1,
        fixed_date: t.fixedDate ?? "", active: t.active, flexible: t.flexible,
      })));
    } else {
      setName(""); setDescription(""); setResponsibleId(currentUserId); setCanEdit(false);
      setTasks([emptyTask()]);
    }
  }, [open, agenda, currentUserId]);

  const overlaps = useMemo(() => findOverlaps(tasks), [tasks]);

  if (!open) return null;

  const patch = (key: string, p: Partial<TaskDraft>) => setTasks((ts) => ts.map((t) => t.key === key ? { ...t, ...p } : t));
  const toggleWeekday = (key: string, wd: number) => setTasks((ts) => ts.map((t) => {
    if (t.key !== key) return t;
    const set = new Set(t.weekdays ?? []);
    set.has(wd) ? set.delete(wd) : set.add(wd);
    return { ...t, weekdays: [...set].sort() };
  }));

  const submit = () => {
    setError(null);
    if (!name.trim()) { setError("Informe o nome da agenda."); return; }
    if (!responsibleId) { setError("Escolha o responsável."); return; }
    const cleanTasks = tasks.filter((t) => t.title.trim());
    if (cleanTasks.length === 0) { setError("Adicione ao menos uma tarefa."); return; }
    if (overlaps.length > 0) { setError("Há tarefas com horários sobrepostos. Ajuste os horários ou a duração antes de salvar."); return; }
    const input: AgendaInput = {
      id: agenda?.id,
      name, description, unit_id: null,
      responsible_id: responsibleId,
      can_responsible_edit: canEdit,
      tasks: cleanTasks.map((t) => ({
        id: t.id, title: t.title, description: t.description, scheduled_time: t.scheduled_time,
        duration_minutes: t.duration_minutes, frequency: t.frequency, weekdays: t.weekdays,
        day_of_month: t.day_of_month, fixed_date: t.fixed_date, active: t.active, flexible: t.flexible,
      })),
    };
    start(async () => {
      const r = agenda ? await updateAgenda(input) : await createAgenda(input);
      if (r.error) { setError(r.error); return; }
      toast.success(agenda ? "Agenda atualizada." : "Agenda criada.");
      onClose();
      router.refresh();
    });
  };

  const isSelf = responsibleId === currentUserId;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3,6,14,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 50, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 680, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--mh-border)" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>{agenda ? "Editar agenda" : "Nova agenda"}</h2>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="Fechar"><X size={16} /></button>
        </div>

        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.85rem" }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="label">Nome da agenda</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Rotina do supervisor de logística" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="label">Descrição <span className="soft">(opcional)</span></label>
              <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Objetivo da rotina" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="label">Responsável</label>
              <SearchSelect options={people} value={responsibleId} onChange={setResponsibleId} placeholder="Buscar pessoa…" />
            </div>
          </div>

          {!isSelf && (
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
              <input type="checkbox" checked={canEdit} onChange={(e) => setCanEdit(e.target.checked)} />
              Permitir que o responsável edite as tarefas desta agenda
            </label>
          )}

          {/* tarefas */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <label className="label" style={{ margin: 0 }}>Tarefas da rotina</label>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTasks((ts) => [emptyTask(), ...ts])}><Plus size={14} /> Tarefa</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {tasks.map((t) => (
                <div key={t.key} style={{ border: "1px solid var(--mh-border)", borderRadius: "var(--mh-radius-md)", padding: "0.5rem 0.6rem" }}>
                  <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
                    <input className="input" style={{ flex: "3 1 170px", minWidth: 150 }} value={t.title} onChange={(e) => patch(t.key, { title: e.target.value })} placeholder="Título da tarefa" />
                    {t.flexible ? (
                      <div title="Sem horário fixo" style={{ flex: "0 0 112px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.72rem", color: "var(--mh-text-3)", border: "1px dashed var(--mh-border)", borderRadius: "var(--mh-radius-sm)", height: 38 }}>sem horário</div>
                    ) : (
                      <input type="time" className="input" title="Horário" style={{ flex: "0 0 112px" }} value={t.scheduled_time ?? ""} onChange={(e) => patch(t.key, { scheduled_time: e.target.value })} />
                    )}
                    <input type="number" min={0} step={5} className="input" title={t.flexible ? "Duração média (min)" : "Duração (min)"} placeholder={t.flexible ? "média" : "min"} style={{ flex: "0 0 76px" }} value={t.duration_minutes ?? 0} onChange={(e) => patch(t.key, { duration_minutes: Number(e.target.value) })} />
                    <select className="select" title="Frequência" style={{ flex: "0 0 130px" }} value={t.frequency} onChange={(e) => patch(t.key, { frequency: e.target.value as Enums<"agenda_frequency"> })}>
                      {FREQS.map((f) => <option key={f} value={f}>{AGENDA_FREQUENCY_LABEL[f]}</option>)}
                    </select>
                    {t.frequency === "mensal" && (
                      <input type="number" min={1} max={31} className="input" title="Dia do mês" placeholder="dia" style={{ flex: "0 0 68px" }} value={t.day_of_month ?? 1} onChange={(e) => patch(t.key, { day_of_month: Number(e.target.value) })} />
                    )}
                    {t.frequency === "unica" && (
                      <input type="date" className="input" title="Data" style={{ flex: "0 0 148px" }} value={t.fixed_date ?? ""} onChange={(e) => patch(t.key, { fixed_date: e.target.value })} />
                    )}
                    <button type="button" className="icon-btn icon-btn-danger" title="Remover" style={{ marginLeft: "auto" }} onClick={() => setTasks((ts) => ts.filter((x) => x.key !== t.key))}><Trash2 size={14} /></button>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", marginTop: "0.45rem" }}>
                    <label className="soft" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.72rem" }} title="Tarefa rotineira sem horário definido; a duração é uma média diária e conta na carga do dia">
                      <input type="checkbox" checked={t.flexible ?? false} onChange={(e) => patch(t.key, { flexible: e.target.checked, ...(e.target.checked ? { scheduled_time: "" } : {}) })} />
                      Sem horário fixo (tempo médio)
                    </label>
                    {t.frequency === "semanal" && (
                      <>
                        <span className="soft" style={{ fontSize: "0.7rem", marginLeft: "0.4rem" }}>Dias:</span>
                        {WEEKDAYS_PT.map((w, i) => {
                          const on = (t.weekdays ?? []).includes(i);
                          return (
                            <button key={i} type="button" onClick={() => toggleWeekday(t.key, i)}
                              className={`btn btn-sm ${on ? "btn-primary" : "btn-ghost"}`} style={{ padding: "0.2rem 0.45rem", fontSize: "0.72rem" }}>
                              {w.slice(0, 3)}
                            </button>
                          );
                        })}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {overlaps.length > 0 && (
            <div style={{ color: "var(--mh-warning)", fontSize: "0.82rem", background: "color-mix(in srgb, var(--mh-warning) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--mh-warning) 32%, transparent)", padding: "0.6rem 0.75rem", borderRadius: 8 }}>
              <strong>Horários sobrepostos:</strong>
              <ul style={{ margin: "0.3rem 0 0", paddingLeft: "1.1rem" }}>
                {overlaps.map(([a, b], i) => <li key={i}>“{a}” e “{b}” se sobrepõem no mesmo dia.</li>)}
              </ul>
            </div>
          )}
          {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>{error}</p>}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--mh-border)" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={pending || overlaps.length > 0}>{agenda ? "Salvar" : "Criar agenda"}</button>
        </div>
      </div>
    </div>
  );
}
