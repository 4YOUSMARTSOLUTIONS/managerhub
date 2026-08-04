"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { MonthInput } from "@/components/ui/MonthInput";
import { EmptyState } from "@/components/ui/EmptyState";
import { Tabs, type Tab } from "@/components/ui/Tabs";
import { SearchSelect } from "@/components/SearchSelect";
import { MessageSquarePlus, Paperclip, X, Eye, Pencil, CalendarClock, Power, Trash2 } from "lucide-react";
import {
  createChecklist, updateChecklist, deleteChecklist, toggleChecklistActive,
  saveSchedule, deleteSchedule, submitRun, saveDraftRun, deleteRun, getChecklistPhotoUrls,
  addChecklistTaskComment, updateChecklistTaskStatus,
  type ChecklistItemInput, type AudienceInput,
} from "@/lib/actions/checklists";
import {
  CHECKLIST_ITEM_TYPE_LABEL, CHECKLIST_FREQUENCY_LABEL, CHECKLIST_VISIBILITY_LABEL,
  CHECKLIST_CONFORMIDADE_TONE, CHECKLIST_SCORED_TYPES, checklistAnswerLabel, WEEKDAYS_PT,
  CHECKLIST_TASK_STATUS_LABEL, CHECKLIST_TASK_STATUS_TONE,
} from "@/lib/constants";
import { currentOccurrence, type Occurrence } from "@/lib/checklist-schedule";
import { formatDate, formatDateTime, formatDuration, shortName } from "@/lib/format";

/** duração em segundos entre início e conclusão (null se faltar dado) */
function runDurationSec(startedAt: string | null, completedAt: string | null): number | null {
  if (!startedAt || !completedAt) return null;
  const s = (new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000;
  return Number.isFinite(s) && s >= 0 ? s : null;
}
import type { Enums } from "@/types/database";
import { confirmDialog } from "@/components/ui/confirm";

export type Opt = { id: string; name: string };
export type SubOpt = { id: string; name: string; departmentId: string };
export type AudienceRef = { kind: "user" | "position" | "department"; refId: string };
export type ItemRow = { id: string; section: string | null; sort: number; label: string; help: string | null; type: Enums<"checklist_item_type">; required: boolean; allowPhoto: boolean; allowNa: boolean; requireNoteOnNc: boolean; requirePhotoOnNc: boolean; options: string[] | null };
export type ScheduleRow = { id: string; frequency: Enums<"checklist_frequency">; fixedDate: string | null; weekday: number | null; dayOfMonth: number | null; runTime: string | null; active: boolean; targets: AudienceRef[] };
export type ChecklistTemplate = {
  id: string; name: string; description: string | null; unitId: string | null; unitName: string | null;
  deptId: string | null; deptName: string | null; subId: string | null; subName: string | null;
  visibility: Enums<"checklist_visibility">;
  defaultAssigneeId: string | null; defaultAssigneeName: string | null; autoOpenTasks: boolean;
  createdBy: string; createdByName: string; active: boolean; items: ItemRow[]; audiences: AudienceRef[]; schedules: ScheduleRow[];
};
export type TaskComment = { id: string; authorId: string; authorName: string; body: string; createdAt: string };
export type TaskRow = {
  id: string; checklistId: string; checklistName: string; runId: string; itemId: string; unitId: string | null; unitName: string | null;
  title: string; description: string | null; assigneeId: string | null; assigneeName: string | null;
  status: Enums<"checklist_task_status">; resolution: string | null; createdBy: string; createdByName: string; createdAt: string; resolvedAt: string | null;
  comments: TaskComment[];
};
export type RunAnswer = { itemId: string; conformidade: string | null; bool: boolean | null; text: string | null; number: number | null; option: string | null; note: string | null };
export type RunPhoto = { id: string; itemId: string; path: string; filename: string };
export type RunRow = { id: string; checklistId: string; executorId: string; executorName: string; unitId: string | null; unitName: string | null; periodKey: string | null; score: number | null; conformCount: number; nonconformCount: number; naCount: number; startedAt: string | null; completedAt: string | null; answers: RunAnswer[]; photos: RunPhoto[] };

// só os tipos que pontuam: texto, número, seleção e nota voltam com o construtor de
// formulários. O enum do banco segue completo, então nada quebra se algum item antigo
// tiver um desses tipos.
const ITEM_TYPE_OPTS = CHECKLIST_SCORED_TYPES.map((t) => [t, CHECKLIST_ITEM_TYPE_LABEL[t]] as const);
const FREQ_OPTS = Object.entries(CHECKLIST_FREQUENCY_LABEL) as [Enums<"checklist_frequency">, string][];

export function ChecklistsManager(props: {
  checklists: ChecklistTemplate[]; runs: RunRow[]; tasks: TaskRow[]; members: Opt[]; departments: Opt[]; subdepartments: SubOpt[];
  positions: Opt[]; units: Opt[]; currentUserId: string; isAdmin: boolean; reportIds: string[];
  myOrg: { positionId: string | null; departmentId: string | null }; activeUnitId: string | null;
}) {
  const { checklists, runs, tasks, members, departments, subdepartments, positions, units, currentUserId, isAdmin, reportIds, myOrg, activeUnitId } = props;
  const reportSet = useMemo(() => new Set(reportIds), [reportIds]);
  const canEdit = (c: ChecklistTemplate) => isAdmin || c.createdBy === currentUserId || reportSet.has(c.createdBy);
  const clById = useMemo(() => new Map(checklists.map((c) => [c.id, c])), [checklists]);
  // pode tratar a tarefa (alinhado à RLS): responsável, gestor do responsável, dono do checklist ou admin
  const canTreat = (t: TaskRow) => isAdmin || t.assigneeId === currentUserId || (!!t.assigneeId && reportSet.has(t.assigneeId)) || clById.get(t.checklistId)?.createdBy === currentUserId;
  const openTasksCount = tasks.filter((t) => (t.status === "pendente" || t.status === "em_andamento")).length;

  const [builder, setBuilder] = useState<{ mode: "new" | "edit"; row?: ChecklistTemplate } | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const task = taskId ? tasks.find((t) => t.id === taskId) ?? null : null;
  const [detailId, setDetailId] = useState<string | null>(null);
  const [runTarget, setRunTarget] = useState<{ checklist: ChecklistTemplate; scheduleId: string | null; periodKey: string | null; unitId: string | null } | null>(null);
  const [scheduleFor, setScheduleFor] = useState<{ checklist: ChecklistTemplate; schedule: ScheduleRow | null } | null>(null);
  const [runView, setRunView] = useState<RunRow | null>(null);
  const detail = detailId ? clById.get(detailId) ?? null : null;

  // ----- pendências (calculadas no cliente) -----
  const [pending, setPending] = useState<{ checklist: ChecklistTemplate; schedule: ScheduleRow; occ: Occurrence }[]>([]);
  useEffect(() => {
    const now = new Date();
    const done = new Set(runs.filter((r) => r.completedAt && r.executorId === currentUserId && r.periodKey).map((r) => `${r.checklistId}|${r.periodKey}`));
    const out: { checklist: ChecklistTemplate; schedule: ScheduleRow; occ: Occurrence }[] = [];
    for (const c of checklists) {
      if (!c.active) continue;
      for (const s of c.schedules) {
        if (!s.active) continue;
        const mine = s.targets.some((t) => (t.kind === "user" && t.refId === currentUserId) || (t.kind === "position" && t.refId === myOrg.positionId) || (t.kind === "department" && t.refId === myOrg.departmentId));
        if (!mine) continue;
        const occ = currentOccurrence({ frequency: s.frequency, fixedDate: s.fixedDate, weekday: s.weekday, dayOfMonth: s.dayOfMonth, runTime: s.runTime }, now);
        if (!occ) continue;
        if (done.has(`${c.id}|${occ.periodKey}`)) continue;
        out.push({ checklist: c, schedule: s, occ });
      }
    }
    out.sort((a, b) => a.occ.dueAt.getTime() - b.occ.dueAt.getTime());
    setPending(out);
  }, [checklists, runs, currentUserId, myOrg]);

  const openRunForPending = (p: { checklist: ChecklistTemplate; schedule: ScheduleRow; occ: Occurrence }) =>
    setRunTarget({ checklist: p.checklist, scheduleId: p.schedule.id, periodKey: p.occ.periodKey, unitId: p.checklist.unitId ?? activeUnitId });

  // rascunho em andamento do usuário atual para (checklist, ocorrência)
  const findDraft = (checklistId: string, periodKey: string | null): RunRow | null =>
    runs.find((r) => !r.completedAt && r.executorId === currentUserId && r.checklistId === checklistId && (r.periodKey ?? "") === (periodKey ?? "")) ?? null;

  const tabs: Tab[] = [
    {
      // primeira aba, como em Chamados
      id: "dashboard", label: "Dashboard",
      content: <EmptyState title="Dashboard em construção" description="Aqui vão os indicadores dos checklists: execuções, conformidade e aderência aos agendamentos." />,
    },
    {
      id: "pendentes", label: `Pendentes${pending.length ? ` (${pending.length})` : ""}`,
      content: pending.length === 0 ? <EmptyState title="Nenhum checklist pendente" description="Quando houver checklists agendados para você, eles aparecem aqui." /> : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table"><thead><tr><th>Checklist</th><th>Frequência</th><th>Prazo</th><th>Status</th><th></th></tr></thead>
            <tbody>{pending.map((p, i) => {
              const hasDraft = !!findDraft(p.checklist.id, p.occ.periodKey);
              return (
              <tr key={i} style={{ cursor: "pointer" }} onClick={() => openRunForPending(p)}>
                <td style={{ fontWeight: 600 }}>{p.checklist.name}</td>
                <td className="muted">{CHECKLIST_FREQUENCY_LABEL[p.schedule.frequency]}</td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{formatDateTime(p.occ.dueAt.toISOString())}</td>
                <td style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}><Badge tone={p.occ.overdue ? "red" : "amber"}>{p.occ.overdue ? "Atrasado" : "Pendente"}</Badge>{hasDraft && <Badge tone="blue">Rascunho</Badge>}</td>
                <td style={{ textAlign: "right" }}><button type="button" className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); openRunForPending(p); }}>{hasDraft ? "Continuar" : "Executar"}</button></td>
              </tr>
              );
            })}</tbody>
          </table>
        </div>
      ),
    },
    {
      id: "modelos", label: "Checklists",
      content: <ModelsView checklists={checklists} runs={runs} departments={departments} subdepartments={subdepartments}
        canEdit={canEdit} onNew={() => setBuilder({ mode: "new" })} onOpen={(c) => setDetailId(c.id)}
        onRun={(c) => setRunTarget({ checklist: c, scheduleId: null, periodKey: null, unitId: c.unitId ?? activeUnitId })}
        onSchedule={(c) => setScheduleFor({ checklist: c, schedule: null })}
        onEdit={(c) => setBuilder({ mode: "edit", row: c })} />,
    },
    {
      id: "tarefas", label: `Tarefas${openTasksCount ? ` (${openTasksCount})` : ""}`,
      content: <TasksView tasks={tasks} currentUserId={currentUserId} onOpen={(t) => setTaskId(t.id)} />,
    },
    {
      id: "historico", label: "Histórico",
      content: <HistoryView runs={runs} clById={clById} departments={departments} onOpen={(r) => setRunView(r)} />,
    },
  ];

  return (
    <div>
      {/* o Dashboard é a primeira aba, mas está vazio: por ora a tela abre em
          Checklists para ninguém cair numa tela em branco. Remover quando ele
          tiver conteúdo. */}
      <Tabs tabs={tabs} initialId="modelos" />
      {builder && (
        <ChecklistBuilderDialog mode={builder.mode} row={builder.row}
          departments={departments} subdepartments={subdepartments} positions={positions} units={units} members={members}
          onClose={() => setBuilder(null)} />
      )}
      {detail && (
        <ChecklistDetailDialog c={detail} canEdit={canEdit(detail)}
          members={members} positions={positions} departments={departments}
          onClose={() => setDetailId(null)}
          onEditSchedule={(s) => { setDetailId(null); setScheduleFor({ checklist: detail, schedule: s }); }} />
      )}
      {task && <TaskDialog task={task} canTreat={canTreat(task)} onClose={() => setTaskId(null)} />}
      {runTarget && <ChecklistRunDialog {...runTarget} draft={findDraft(runTarget.checklist.id, runTarget.periodKey)} onClose={() => setRunTarget(null)} />}
      {scheduleFor && <ChecklistScheduleDialog checklist={scheduleFor.checklist} schedule={scheduleFor.schedule} members={members} positions={positions} departments={departments} onClose={() => setScheduleFor(null)} />}
      {runView && <RunViewDialog run={runView} checklist={clById.get(runView.checklistId) ?? null} canDelete={isAdmin || runView.executorId === currentUserId} onClose={() => setRunView(null)} />}
    </div>
  );
}

// ---------------- Checklists (modelos + indicadores) ----------------
function confColor(pct: number | null) {
  return pct == null ? "var(--text-muted)" : pct >= 90 ? "var(--mh-success)" : pct >= 70 ? "var(--mh-warning)" : "var(--mh-danger)";
}

function ModelsView({ checklists, runs, departments, subdepartments, canEdit, onNew, onOpen, onRun, onSchedule, onEdit }: {
  checklists: ChecklistTemplate[]; runs: RunRow[]; departments: Opt[]; subdepartments: SubOpt[];
  canEdit: (c: ChecklistTemplate) => boolean; onNew: () => void; onOpen: (c: ChecklistTemplate) => void; onRun: (c: ChecklistTemplate) => void; onSchedule: (c: ChecklistTemplate) => void; onEdit: (c: ChecklistTemplate) => void;
}) {
  const [dept, setDept] = useState(""); const [sub, setSub] = useState("");
  const subOpts = subdepartments.filter((s) => !dept || s.departmentId === dept);
  const [toggling, startToggle] = useTransition();
  const router = useRouter();
  // excluir só é oferecido enquanto o checklist nunca foi executado (depois disso, o certo é inativar)
  const executedIds = useMemo(() => new Set(runs.map((r) => r.checklistId)), [runs]);
  const canDelete = (c: ChecklistTemplate) => canEdit(c) && !executedIds.has(c.id);
  const del = async (c: ChecklistTemplate) => {
    const ok = await confirmDialog({
      tone: "danger",
      title: "Excluir checklist",
      message: <>Excluir <strong>{c.name}</strong> definitivamente? Esta ação não pode ser desfeita.</>,
      confirmLabel: "Excluir",
    });
    if (!ok) return;
    startToggle(async () => { await deleteChecklist(c.id); router.refresh(); });
  };

  // confirma FORA da transição: dentro dela o portal do confirmDialog não renderiza
  const toggleActive = async (c: ChecklistTemplate) => {
    const ok = await confirmDialog({
      title: c.active ? "Inativar checklist" : "Ativar checklist",
      message: c.active
        ? <>Inativar <strong>{c.name}</strong>? Ele deixa de ficar disponível para execução.</>
        : <>Ativar <strong>{c.name}</strong>? Ele volta a ficar disponível para execução.</>,
      confirmLabel: c.active ? "Inativar" : "Ativar",
      tone: c.active ? "danger" : "primary",
    });
    if (!ok) return;
    startToggle(async () => {
      await toggleChecklistActive({ id: c.id, active: !c.active });
      router.refresh();
    });
  };

  const statsById = useMemo(() => {
    const agg = new Map<string, { execs: number; conf: number; nconf: number }>();
    for (const r of runs) {
      if (!r.completedAt) continue;
      const a = agg.get(r.checklistId) ?? { execs: 0, conf: 0, nconf: 0 };
      a.execs += 1; a.conf += r.conformCount; a.nconf += r.nonconformCount;
      agg.set(r.checklistId, a);
    }
    return agg;
  }, [runs]);
  const stat = (id: string) => {
    const a = statsById.get(id) ?? { execs: 0, conf: 0, nconf: 0 };
    const denom = a.conf + a.nconf;
    return { execs: a.execs, pct: denom > 0 ? Math.round((a.conf / denom) * 100) : null };
  };

  const filtered = checklists.filter((c) =>
    (!dept || c.deptId === dept) && (!sub || c.subId === sub));

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.7rem", alignItems: "flex-end", marginBottom: "1.1rem" }}>
        <div><label className="label">Setor</label><select className="select" value={dept} onChange={(e) => { setDept(e.target.value); setSub(""); }}><option value="">Todos</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
        <div><label className="label">Subsetor</label><select className="select" value={sub} onChange={(e) => setSub(e.target.value)}><option value="">Todos</option>{subOpts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div style={{ marginLeft: "auto" }}><button type="button" className="btn btn-primary" onClick={onNew}>+ Novo checklist</button></div>
      </div>
      {filtered.length === 0 ? <EmptyState title="Nenhum checklist" description="Use “+ Novo checklist” para criar o primeiro modelo." /> : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table"><thead><tr><th>Nome</th><th>Setor / Subsetor</th><th>Unidade</th><th>Criador</th><th style={{ textAlign: "right" }}>Itens</th><th style={{ textAlign: "right" }}>Execuções</th><th style={{ minWidth: 150 }}>Conformidade</th><th>Ativo</th><th></th></tr></thead>
            <tbody>{filtered.map((c) => {
              const s = stat(c.id);
              return (
              <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => onOpen(c)}>
                <td style={{ fontWeight: 600 }}>{c.name}</td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{c.deptName ?? "—"}{c.subName ? ` · ${c.subName}` : ""}</td>
                <td className="muted">{c.unitName ?? <span className="soft">Todas</span>}</td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{shortName(c.createdByName)}</td>
                <td className="muted" style={{ textAlign: "right" }}>{c.items.length}</td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{s.execs}</td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <div style={{ flex: 1, height: 7, borderRadius: 999, background: "var(--border)", overflow: "hidden", minWidth: 50 }}>
                      <div style={{ height: "100%", width: `${s.pct ?? 0}%`, background: confColor(s.pct), borderRadius: 999 }} />
                    </div>
                    <span style={{ fontWeight: 700, color: confColor(s.pct), width: 42, textAlign: "right" }}>{s.pct == null ? "—" : `${s.pct}%`}</span>
                  </div>
                </td>
                <td><Badge tone={c.active ? "green" : "gray"}>{c.active ? "Ativo" : "Inativo"}</Badge></td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <div style={{ display: "inline-flex", gap: "0.3rem", alignItems: "center", justifyContent: "flex-end" }}>
                    <button type="button" className="btn btn-primary btn-sm" disabled={!c.active} onClick={(e) => { e.stopPropagation(); onRun(c); }}>Executar</button>
                    {/* agendar sai do meio dos ícones e fica ao lado de Executar: as duas
                        são as ações do dia a dia, o resto é manutenção do cadastro */}
                    {canEdit(c) && <button type="button" className="btn btn-warning btn-sm" title="Agendar checklist" onClick={(e) => { e.stopPropagation(); onSchedule(c); }}><CalendarClock size={14} /> Agendar</button>}
                    <button type="button" className="icon-btn" title="Ver checklist" aria-label="Ver checklist" onClick={(e) => { e.stopPropagation(); onOpen(c); }}><Eye size={15} /></button>
                    {canEdit(c) && <button type="button" className="icon-btn" title="Editar checklist" aria-label="Editar checklist" onClick={(e) => { e.stopPropagation(); onEdit(c); }}><Pencil size={15} /></button>}
                    {canEdit(c) && <button type="button" className="icon-btn" disabled={toggling} title={c.active ? "Inativar checklist" : "Ativar checklist"} aria-label={c.active ? "Inativar checklist" : "Ativar checklist"} onClick={(e) => { e.stopPropagation(); toggleActive(c); }}><Power size={15} /></button>}
                    {canDelete(c) && <button type="button" className="icon-btn icon-btn-danger" disabled={toggling} title="Excluir checklist (nunca executado)" aria-label="Excluir checklist" onClick={(e) => { e.stopPropagation(); del(c); }}><Trash2 size={15} /></button>}
                  </div>
                </td>
              </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------- Histórico ----------------
function HistoryView({ runs, clById, departments, onOpen }: {
  runs: RunRow[]; clById: Map<string, ChecklistTemplate>; departments: Opt[]; onOpen: (r: RunRow) => void;
}) {
  const [dept, setDept] = useState(""); const [month, setMonth] = useState("");
  const done = runs.filter((r) => r.completedAt);
  const filtered = done.filter((r) => {
    const c = clById.get(r.checklistId);
    return (!dept || c?.deptId === dept) && (!month || (r.completedAt ?? "").slice(0, 7) === month);
  });
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.7rem", alignItems: "flex-end", marginBottom: "1.1rem" }}>
        <div><label className="label">Setor</label><select className="select" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">Todos</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
        <div><label className="label">Mês</label><MonthInput value={month} onChange={setMonth} /></div>
      </div>
      {filtered.length === 0 ? <EmptyState title="Sem execuções" description="Checklists concluídos aparecem aqui." /> : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table"><thead><tr><th>Início</th><th>Conclusão</th><th>Duração</th><th>Checklist</th><th>Executor</th><th>Unidade</th><th>Setor</th><th style={{ textAlign: "right" }}>Conformidade</th><th></th></tr></thead>
            <tbody>{filtered.map((r) => {
              const c = clById.get(r.checklistId);
              const dur = runDurationSec(r.startedAt, r.completedAt);
              return (
                <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => onOpen(r)}>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{r.startedAt ? formatDateTime(r.startedAt) : "—"}</td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{r.completedAt ? formatDateTime(r.completedAt) : "—"}</td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{dur == null ? <span className="soft">—</span> : formatDuration(dur)}</td>
                  <td style={{ fontWeight: 600 }}>{c?.name ?? "—"}</td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{shortName(r.executorName)}</td>
                  <td className="muted">{r.unitName ?? <span className="soft">—</span>}</td>
                  <td className="muted">{c?.deptName ?? <span className="soft">—</span>}</td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: r.score == null ? "var(--text-muted)" : r.score >= 90 ? "var(--mh-success)" : r.score >= 70 ? "var(--mh-warning)" : "var(--mh-danger)" }}>{r.score == null ? "—" : `${r.score}%`}</td>
                  <td style={{ textAlign: "right" }}><button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); onOpen(r); }}>Ver</button></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------- Modal base ----------------
function Modal({ title, onClose, children, footer, wide, maxWidth }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode; wide?: boolean; maxWidth?: number }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 60, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: maxWidth ?? (wide ? 760 : 560), boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>
        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>{children}</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>{footer}</div>
      </div>
    </div>
  );
}

// ---------------- Multi-pick (chips) ----------------
function MultiPick({ options, values, onChange, placeholder }: { options: Opt[]; values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const byId = new Map(options.map((o) => [o.id, o.name]));
  const remaining = options.filter((o) => !values.includes(o.id));
  return (
    <div>
      {values.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "0.4rem" }}>
          {values.map((v) => (
            <span key={v} className="badge badge-blue" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>{byId.get(v) ?? "—"}
              <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: "0.9rem", lineHeight: 1 }}>×</button>
            </span>
          ))}
        </div>
      )}
      <SearchSelect options={remaining} value="" onChange={(id) => id && onChange([...values, id])} placeholder={placeholder ?? "Adicionar…"} emptyHint="Nada" />
    </div>
  );
}

// ---------------- Builder ----------------
type DraftItem = { key: string; section: string; label: string; help: string; type: Enums<"checklist_item_type">; required: boolean; allowPhoto: boolean; allowNa: boolean; requireNoteOnNc: boolean; requirePhotoOnNc: boolean; optionsText: string };
let _k = 0; const nk = () => `k${_k++}`;

function ChecklistBuilderDialog({ mode, row, departments, subdepartments, positions, units, members, onClose }: {
  mode: "new" | "edit"; row?: ChecklistTemplate; departments: Opt[]; subdepartments: SubOpt[]; positions: Opt[]; units: Opt[]; members: Opt[]; onClose: () => void;
}) {
  const [name, setName] = useState(row?.name ?? "");
  const [description, setDescription] = useState(row?.description ?? "");
  const [unitId, setUnitId] = useState(row?.unitId ?? "");
  const [deptId, setDeptId] = useState(row?.deptId ?? "");
  const [subId, setSubId] = useState(row?.subId ?? "");
  const [visibility, setVisibility] = useState<Enums<"checklist_visibility">>(row?.visibility ?? "todos");
  const [audUsers, setAudUsers] = useState<string[]>(row?.audiences.filter((a) => a.kind === "user").map((a) => a.refId) ?? []);
  const [audPos, setAudPos] = useState<string[]>(row?.audiences.filter((a) => a.kind === "position").map((a) => a.refId) ?? []);
  const [audDept, setAudDept] = useState<string[]>(row?.audiences.filter((a) => a.kind === "department").map((a) => a.refId) ?? []);
  const [assigneeId, setAssigneeId] = useState(row?.defaultAssigneeId ?? "");
  const [autoOpenTasks, setAutoOpenTasks] = useState(row?.autoOpenTasks ?? true);
  const [items, setItems] = useState<DraftItem[]>(
    row?.items.map((i) => ({ key: nk(), section: i.section ?? "", label: i.label, help: i.help ?? "", type: i.type, required: i.required, allowPhoto: i.allowPhoto, allowNa: i.allowNa, requireNoteOnNc: i.requireNoteOnNc, requirePhotoOnNc: i.requirePhotoOnNc, optionsText: (i.options ?? []).join(", ") }))
      ?? [{ key: nk(), section: "", label: "", help: "", type: "conformidade", required: true, allowPhoto: false, allowNa: true, requireNoteOnNc: false, requirePhotoOnNc: false, optionsText: "" }],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const subOpts = subdepartments.filter((s) => !deptId || s.departmentId === deptId);

  const addItem = () => setItems((s) => [...s, { key: nk(), section: "", label: "", help: "", type: "conformidade", required: true, allowPhoto: false, allowNa: true, requireNoteOnNc: false, requirePhotoOnNc: false, optionsText: "" }]);
  const upItem = (key: string, patch: Partial<DraftItem>) => setItems((s) => s.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  const rmItem = (key: string) => setItems((s) => s.filter((it) => it.key !== key));
  const move = (key: string, dir: -1 | 1) => setItems((s) => { const i = s.findIndex((x) => x.key === key); const j = i + dir; if (j < 0 || j >= s.length) return s; const n = [...s]; [n[i], n[j]] = [n[j], n[i]]; return n; });

  const submit = () => {
    if (!name.trim()) { setError("Informe o nome."); return; }
    const validItems = items.filter((i) => i.label.trim());
    if (validItems.length === 0) { setError("Adicione ao menos um item com rótulo."); return; }
    const itemsPayload: ChecklistItemInput[] = validItems.map((i) => ({
      section: i.section.trim() || null, label: i.label.trim(), help: i.help.trim() || null, type: i.type, required: i.required, allow_photo: i.allowPhoto, allow_na: i.allowNa,
      require_note_on_nc: i.requireNoteOnNc, require_photo_on_nc: i.requirePhotoOnNc,
      options: (i.type === "selecao" || i.type === "nota") ? i.optionsText.split(",").map((x) => x.trim()).filter(Boolean) : null,
    }));
    const audiences: AudienceInput[] = visibility === "usuarios" ? audUsers.map((id) => ({ kind: "user", ref_id: id }))
      : visibility === "cargos" ? audPos.map((id) => ({ kind: "position", ref_id: id }))
      : visibility === "areas" ? audDept.map((id) => ({ kind: "department", ref_id: id })) : [];
    if (visibility !== "todos" && audiences.length === 0) { setError("Selecione o público (usuários, cargos ou áreas)."); return; }
    const payload = { ...(mode === "edit" ? { id: row!.id } : {}), name: name.trim(), description, unit_id: unitId || null, department_id: deptId || null, subdepartment_id: subId || null, visibility, default_assignee_id: assigneeId || null, auto_open_tasks: autoOpenTasks, items: itemsPayload, audiences };
    start(async () => {
      const r = mode === "edit" ? await updateChecklist(payload) : await createChecklist(payload);
      if (r?.error) { setError(r.error); return; }
      onClose(); router.refresh();
    });
  };

  return (
    <Modal maxWidth={540} title={mode === "edit" ? "Editar checklist" : "Novo checklist"} onClose={onClose} footer={<>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>{mode === "edit" ? "Salvar" : "Criar checklist"}</button>
    </>}>
      <div><label className="label">Nome</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div><label className="label">Descrição / objetivo</label><textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
        <div><label className="label">Unidade</label><select className="select" value={unitId} onChange={(e) => setUnitId(e.target.value)}><option value="">Todas as unidades</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div><label className="label">Setor</label><select className="select" value={deptId} onChange={(e) => { setDeptId(e.target.value); setSubId(""); }}><option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
        <div><label className="label">Subsetor</label><select className="select" value={subId} onChange={(e) => setSubId(e.target.value)}><option value="">—</option>{subOpts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      </div>
      <div>
        <label className="label">Visibilidade</label>
        <select className="select" value={visibility} onChange={(e) => setVisibility(e.target.value as Enums<"checklist_visibility">)}>
          {(Object.entries(CHECKLIST_VISIBILITY_LABEL) as [Enums<"checklist_visibility">, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {visibility === "usuarios" && <div style={{ marginTop: "0.5rem" }}><MultiPick options={members} values={audUsers} onChange={setAudUsers} placeholder="Adicionar usuário…" /></div>}
        {visibility === "cargos" && <div style={{ marginTop: "0.5rem" }}><MultiPick options={positions} values={audPos} onChange={setAudPos} placeholder="Adicionar cargo…" /></div>}
        {visibility === "areas" && <div style={{ marginTop: "0.5rem" }}><MultiPick options={departments} values={audDept} onChange={setAudDept} placeholder="Adicionar setor…" /></div>}
      </div>
      <div>
        <label style={{ display: "flex", gap: "0.4rem", alignItems: "center", cursor: "pointer", fontSize: "0.88rem" }}>
          <input type="checkbox" checked={autoOpenTasks} onChange={(e) => setAutoOpenTasks(e.target.checked)} />
          Abrir tarefa automaticamente para itens “Não conforme”
        </label>
        <div className="soft" style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>
          {autoOpenTasks
            ? "Cada não conformidade vira uma tarefa para o responsável tratar."
            : "As não conformidades ficam só registradas na execução, sem gerar tarefa."}
        </div>
      </div>
      {autoOpenTasks && (
        <div>
          <label className="label">Responsável pelas não conformidades</label>
          <SearchSelect options={members} value={assigneeId} onChange={setAssigneeId} placeholder="Quem trata as tarefas geradas…" emptyHint="Nenhum usuário" />
          <div className="soft" style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>Cada item marcado “Não conforme” abre uma tarefa para esta pessoa. Se vazio, vai para o criador do checklist.</div>
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.8rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
          <strong style={{ fontSize: "0.9rem" }}>Itens do checklist</strong>
          <button type="button" className="btn btn-ghost btn-sm" onClick={addItem}>+ Adicionar item</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {items.map((it, idx) => (
            <div key={it.key} className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <span className="soft" style={{ fontSize: "0.75rem", width: 20 }}>{idx + 1}</span>
                <input className="input" placeholder="Rótulo do item / pergunta" value={it.label} onChange={(e) => upItem(it.key, { label: e.target.value })} style={{ flex: 1 }} />
                <button type="button" className="icon-btn" title="Subir" onClick={() => move(it.key, -1)}>↑</button>
                <button type="button" className="icon-btn" title="Descer" onClick={() => move(it.key, 1)}>↓</button>
                <button type="button" className="icon-btn icon-btn-danger" title="Remover" onClick={() => rmItem(it.key)}>×</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                <input className="input" placeholder="Seção (opcional)" value={it.section} onChange={(e) => upItem(it.key, { section: e.target.value })} />
                <select className="select" value={it.type} onChange={(e) => upItem(it.key, { type: e.target.value as Enums<"checklist_item_type"> })}>{ITEM_TYPE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </div>
              {(it.type === "selecao" || it.type === "nota") && (
                <input className="input" placeholder={it.type === "nota" ? "Escala separada por vírgula (ex.: 1, 2, 3, 4, 5)" : "Opções separadas por vírgula"} value={it.optionsText} onChange={(e) => upItem(it.key, { optionsText: e.target.value })} />
              )}
              <div style={{ display: "flex", gap: "1rem", fontSize: "0.82rem", flexWrap: "wrap" }}>
                <label style={{ display: "flex", gap: "0.3rem", alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={it.required} onChange={(e) => upItem(it.key, { required: e.target.checked })} /> Obrigatório</label>
                {/* desligar "permitir foto" também derruba a exigência de foto (não dá p/ exigir o que não é permitido) */}
                <label style={{ display: "flex", gap: "0.3rem", alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={it.allowPhoto} onChange={(e) => upItem(it.key, e.target.checked ? { allowPhoto: true } : { allowPhoto: false, requirePhotoOnNc: false })} /> Permitir foto</label>
                {(it.type === "conformidade" || it.type === "sim_nao") && (
                  <label style={{ display: "flex", gap: "0.3rem", alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={it.allowNa} onChange={(e) => upItem(it.key, { allowNa: e.target.checked })} /> Permitir {it.type === "conformidade" ? "N.A." : "N/A"}</label>
                )}
                {(it.type === "conformidade" || it.type === "sim_nao") && (
                  <label style={{ display: "flex", gap: "0.3rem", alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={it.requireNoteOnNc} onChange={(e) => upItem(it.key, { requireNoteOnNc: e.target.checked })} /> Exigir observação se {it.type === "conformidade" ? "não conforme" : "“Não”"}</label>
                )}
                {/* exigir foto liga "permitir foto" junto, então a opção fica sempre disponível */}
                {(it.type === "conformidade" || it.type === "sim_nao") && (
                  <label style={{ display: "flex", gap: "0.3rem", alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={it.requirePhotoOnNc} onChange={(e) => upItem(it.key, e.target.checked ? { requirePhotoOnNc: true, allowPhoto: true } : { requirePhotoOnNc: false })} /> Exigir foto se {it.type === "conformidade" ? "não conforme" : "“Não”"}</label>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}

/**
 * Agrupa os itens por seção mesmo que estejam intercalados no cadastro.
 * As seções saem na ordem em que aparecem pela primeira vez; itens sem seção
 * mantêm-se juntos no ponto em que o primeiro deles aparece. A numeração segue
 * a ordem exibida. A chave ignora caixa/espaços, e o rótulo mostrado é o primeiro visto.
 */
function groupBySection(items: ItemRow[]): { item: ItemRow; n: number; sectionHeader: string | null; first: boolean }[] {
  const groups = new Map<string, { label: string; items: ItemRow[] }>();
  for (const it of items) {
    const raw = (it.section ?? "").trim();
    const key = raw.toLowerCase();
    const g = groups.get(key) ?? { label: raw, items: [] };
    g.items.push(it);
    groups.set(key, g);
  }
  const out: { item: ItemRow; n: number; sectionHeader: string | null; first: boolean }[] = [];
  for (const g of groups.values()) {
    let headerShown = false;
    for (const it of g.items) {
      const showHeader = !headerShown && !!g.label;
      out.push({ item: it, n: out.length + 1, sectionHeader: showHeader ? g.label : null, first: showHeader && out.length === 0 });
      if (showHeader) headerShown = true;
    }
  }
  return out;
}

// separador visual de seção: aparece uma vez, antes do primeiro item de cada seção
function SectionSeparator({ label, first }: { label: string; first?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginTop: first ? 0 : "0.5rem", marginBottom: "0.1rem" }}>
      <span className="soft" style={{ fontSize: "0.85rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

// ---------------- Detalhe do modelo ----------------
function ChecklistDetailDialog({ c, canEdit, members, positions, departments, onClose, onEditSchedule }: {
  c: ChecklistTemplate; canEdit: boolean;
  members: Opt[]; positions: Opt[]; departments: Opt[];
  onClose: () => void; onEditSchedule: (s: ScheduleRow) => void;
}) {
  // nomes dos alvos do agendamento (usuário / cargo / setor)
  const nameOf = (t: AudienceRef) => {
    const list = t.kind === "user" ? members : t.kind === "position" ? positions : departments;
    return list.find((o) => o.id === t.refId)?.name ?? "—";
  };
  const KIND_LABEL: Record<AudienceRef["kind"], string> = { user: "Usuário", position: "Cargo", department: "Setor" };
  const [pending, start] = useTransition();
  const router = useRouter();
  const delSched = async (id: string) => {
    if (!(await confirmDialog({ tone: "danger", title: "Excluir agendamento", message: "Excluir este agendamento? O checklist deixa de ser cobrado nessa frequência.", confirmLabel: "Excluir" }))) return;
    start(async () => { await deleteSchedule(id); router.refresh(); });
  };

  const itensTab = (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
      {groupBySection(c.items).map(({ item: i, n, sectionHeader, first }) => {
        return (
          <Fragment key={i.id}>
            {sectionHeader && <SectionSeparator label={sectionHeader} first={first} />}
            <div style={{ display: "flex", gap: "0.45rem", alignItems: "baseline", fontSize: "0.88rem" }}>
              <span className="soft" style={{ fontSize: "0.78rem" }}>{n}.</span>
              <span style={{ fontWeight: 600 }}>{i.label}</span>
              <span className="soft" style={{ fontSize: "0.75rem" }}>
                · {CHECKLIST_ITEM_TYPE_LABEL[i.type]}{(i.type === "conformidade" || i.type === "sim_nao") && !i.allowNa ? (i.type === "conformidade" ? " · sem N.A." : " · sem N/A") : ""}{i.allowPhoto ? " · foto" : ""}{i.requireNoteOnNc ? " · obs. obrigatória na NC" : ""}{i.requirePhotoOnNc ? " · foto obrigatória na NC" : ""}{i.required ? "" : " · opcional"}
              </span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );

  const agendaTab = c.schedules.length === 0 ? (
    <div className="soft" style={{ fontSize: "0.85rem" }}>Sem agendamento. Use o ícone de calendário na lista para agendar.</div>
  ) : (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      {c.schedules.map((s) => (
        <div key={s.id} className="card" style={{ padding: "0.55rem 0.7rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
            <Badge tone="blue">{CHECKLIST_FREQUENCY_LABEL[s.frequency]}</Badge>
            <span className="soft">
              {s.frequency === "semanal" && s.weekday != null ? WEEKDAYS_PT[s.weekday] : ""}
              {s.frequency === "mensal" && s.dayOfMonth ? `dia ${s.dayOfMonth}` : ""}
              {s.fixedDate ? formatDate(s.fixedDate) : ""}
              {s.runTime ? `${s.frequency === "diaria" ? "" : " · "}${s.runTime.slice(0, 5)}` : ""}
            </span>
            {!s.active && <Badge tone="gray">Inativo</Badge>}
            {canEdit && (
              <div style={{ marginLeft: "auto", display: "inline-flex", gap: "0.3rem" }}>
                <button type="button" className="icon-btn" title="Editar agendamento" aria-label="Editar agendamento" onClick={() => onEditSchedule(s)}><Pencil size={14} /></button>
                <button type="button" className="icon-btn icon-btn-danger" title="Excluir agendamento" aria-label="Excluir agendamento" disabled={pending} onClick={() => delSched(s.id)}><Trash2 size={14} /></button>
              </div>
            )}
          </div>
          {s.targets.length === 0 ? (
            <span className="soft" style={{ fontSize: "0.78rem" }}>Sem responsáveis.</span>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
              {s.targets.map((t, i) => (
                <span key={i} className="badge badge-gray" style={{ fontSize: "0.72rem" }} title={KIND_LABEL[t.kind]}>{nameOf(t)}</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <Modal maxWidth={480} title={c.name} onClose={onClose} footer={<>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>
    </>}>
      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
        <Badge tone="gray">{CHECKLIST_VISIBILITY_LABEL[c.visibility]}</Badge>
        <Badge tone={c.active ? "green" : "gray"}>{c.active ? "Ativo" : "Inativo"}</Badge>
      </div>
      {c.description && <div style={{ whiteSpace: "pre-wrap" }}>{c.description}</div>}
      <div className="soft" style={{ fontSize: "0.82rem" }}>
        {c.autoOpenTasks
          ? <>Responsável por não conformidades: <strong>{c.defaultAssigneeName ?? shortName(c.createdByName)}</strong></>
          : <>Não conformidades <strong>não geram tarefa</strong> automaticamente.</>}
      </div>
      <Tabs
        tabs={[
          { id: "itens", label: `Itens (${c.items.length})`, content: itensTab },
          { id: "agendamentos", label: `Agendamentos (${c.schedules.length})`, content: agendaTab },
        ]}
      />
    </Modal>
  );
}

// ---------------- Agendar ----------------
function ChecklistScheduleDialog({ checklist, schedule, members, positions, departments, onClose }: {
  checklist: ChecklistTemplate; schedule?: ScheduleRow | null; members: Opt[]; positions: Opt[]; departments: Opt[]; onClose: () => void;
}) {
  const editing = !!schedule;
  const pick = (kind: AudienceRef["kind"]) => (schedule?.targets ?? []).filter((t) => t.kind === kind).map((t) => t.refId);
  const [frequency, setFrequency] = useState<Enums<"checklist_frequency">>(schedule?.frequency ?? "semanal");
  const [fixedDate, setFixedDate] = useState(schedule?.fixedDate ?? "");
  const [weekday, setWeekday] = useState(schedule?.weekday ?? 1);
  const [dayOfMonth, setDayOfMonth] = useState(schedule?.dayOfMonth ?? 1);
  const [runTime, setRunTime] = useState(schedule?.runTime?.slice(0, 5) ?? "08:00");
  const [tUsers, setTUsers] = useState<string[]>(pick("user"));
  const [tPos, setTPos] = useState<string[]>(pick("position"));
  const [tDept, setTDept] = useState<string[]>(pick("department"));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const submit = () => {
    const targets: AudienceInput[] = [
      ...tUsers.map((id) => ({ kind: "user" as const, ref_id: id })),
      ...tPos.map((id) => ({ kind: "position" as const, ref_id: id })),
      ...tDept.map((id) => ({ kind: "department" as const, ref_id: id })),
    ];
    if (targets.length === 0) { setError("Selecione ao menos um responsável."); return; }
    if (frequency === "unica" && !fixedDate) { setError("Informe a data."); return; }
    start(async () => {
      const r = await saveSchedule({ ...(schedule ? { id: schedule.id } : {}), checklist_id: checklist.id, frequency, fixed_date: (frequency === "unica" || frequency === "anual") ? fixedDate || null : null, weekday: frequency === "semanal" ? weekday : null, day_of_month: frequency === "mensal" ? dayOfMonth : null, run_time: runTime || null, targets });
      if (r?.error) { setError(r.error); return; }
      onClose(); router.refresh();
    });
  };

  return (
    <Modal maxWidth={480} title={`${editing ? "Editar agendamento" : "Agendar"} · ${checklist.name}`} onClose={onClose} footer={<>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>{editing ? "Salvar alterações" : "Salvar agendamento"}</button>
    </>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
        <div><label className="label">Frequência</label><select className="select" value={frequency} onChange={(e) => setFrequency(e.target.value as Enums<"checklist_frequency">)}>{FREQ_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div><label className="label">Horário</label><input type="time" className="input" value={runTime} onChange={(e) => setRunTime(e.target.value)} /></div>
        {(frequency === "unica" || frequency === "anual") && <div><label className="label">Data</label><input type="date" className="input" value={fixedDate} onChange={(e) => setFixedDate(e.target.value)} /></div>}
        {frequency === "semanal" && <div><label className="label">Dia da semana</label><select className="select" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>{WEEKDAYS_PT.map((w, i) => <option key={i} value={i}>{w}</option>)}</select></div>}
        {frequency === "mensal" && <div><label className="label">Dia do mês</label><input type="number" min={1} max={31} className="input" value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value) || 1)} /></div>}
      </div>
      <div><label className="label">Usuários</label><MultiPick options={members} values={tUsers} onChange={setTUsers} placeholder="Adicionar usuário…" /></div>
      <div><label className="label">Cargos</label><MultiPick options={positions} values={tPos} onChange={setTPos} placeholder="Adicionar cargo…" /></div>
      <div><label className="label">Áreas (setores)</label><MultiPick options={departments} values={tDept} onChange={setTDept} placeholder="Adicionar setor…" /></div>
      {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}

// ---------------- Executar ----------------
type RunAnswerState = { conformidade?: string; bool?: boolean; text?: string; number?: string; option?: string; note?: string; files: File[] };

function ChecklistRunDialog({ checklist, scheduleId, periodKey, unitId, draft, onClose }: {
  checklist: ChecklistTemplate; scheduleId: string | null; periodKey: string | null; unitId: string | null; draft: RunRow | null; onClose: () => void;
}) {
  const initial = useMemo(() => {
    const a: Record<string, RunAnswerState> = {}; const n: Record<string, boolean> = {};
    for (const d of draft?.answers ?? []) {
      a[d.itemId] = { files: [], conformidade: d.conformidade ?? undefined, bool: d.bool ?? undefined, text: d.text ?? undefined, number: d.number != null ? String(d.number) : undefined, option: d.option ?? undefined, note: d.note ?? undefined };
      if (d.note) n[d.itemId] = true;
    }
    return { a, n };
  }, [draft]);
  const [ans, setAns] = useState<Record<string, RunAnswerState>>(initial.a);
  const [noteOpen, setNoteOpen] = useState<Record<string, boolean>>(initial.n);
  const [runId, setRunId] = useState<string | null>(draft?.id ?? null);
  // início real: retomado do rascunho ou o instante em que o formulário abriu
  const [startedAt] = useState<string>(() => draft?.startedAt ?? new Date().toISOString());
  const [error, setError] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const skipAutosave = useRef(true); // não regravar logo após hidratar o rascunho
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (itemId: string, patch: Partial<RunAnswerState>) => setAns((s) => ({ ...s, [itemId]: { ...(s[itemId] ?? { files: [] as File[] }), ...patch } }));
  const toggleNote = (itemId: string) => setNoteOpen((s) => {
    const open = !s[itemId];
    if (!open) set(itemId, { note: "" }); // ao desmarcar, limpa a observação
    return { ...s, [itemId]: open };
  });

  const conformDone = checklist.items.filter((i) => i.type === "conformidade" || i.type === "sim_nao");
  const conf = conformDone.filter((i) => ans[i.id]?.conformidade === "conforme").length;
  const nconf = conformDone.filter((i) => ans[i.id]?.conformidade === "nao_conforme").length;
  const parcial = conf + nconf > 0 ? Math.round((conf / (conf + nconf)) * 100) : null;

  const buildAnswers = () => checklist.items.map((it) => {
    const a = ans[it.id] ?? { files: [] };
    return { item_id: it.id, type: it.type, conformidade: (a.conformidade as "conforme" | "nao_conforme" | "na" | undefined) ?? null, bool: a.bool ?? null, text: a.text ?? null, number: a.number ? Number(a.number.replace(",", ".")) : null, option: a.option ?? null, note: a.note ?? null };
  });

  const draftFd = () => {
    const fd = new FormData();
    fd.set("payload", JSON.stringify({ checklist_id: checklist.id, run_id: runId, schedule_id: scheduleId, unit_id: unitId, period_key: periodKey, started_at: startedAt, answers: buildAnswers() }));
    return fd;
  };

  // só grava rascunho quando há algo preenchido (ou quando o rascunho já existe)
  const hasContent = Object.values(ans).some((a) =>
    !!a.conformidade || a.bool != null || !!a.text?.trim() || !!a.number?.trim() || !!a.option || !!a.note?.trim());

  const persistDraft = async () => {
    const r = await saveDraftRun(draftFd());
    if (r?.runId) setRunId(r.runId);
    return r;
  };

  // autosave (debounce ~1s): evita perder o preenchimento ao sair sem salvar
  useEffect(() => {
    if (skipAutosave.current) { skipAutosave.current = false; return; }
    if (!hasContent && !runId) return;
    const t = setTimeout(async () => {
      const r = await persistDraft();
      if (!r?.error) { setDraftSaved(true); setTimeout(() => setDraftSaved(false), 1500); }
    }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ans, noteOpen]);

  // fecha garantindo a gravação do que ficou na janela do debounce
  const closeSavingDraft = () => {
    if (hasContent || runId) void persistDraft().then(() => router.refresh());
    onClose();
  };

  const discardDraft = async () => {
    const ok = await confirmDialog({
      tone: "danger", title: "Descartar preenchimento",
      message: "Descartar este preenchimento? O rascunho será apagado e não dá para desfazer.",
      confirmLabel: "Descartar",
    });
    if (!ok) return;
    start(async () => {
      if (runId) await deleteRun(runId);
      onClose(); router.refresh();
    });
  };

  const submit = () => {
    for (const it of checklist.items) {
      const a = ans[it.id];
      if (it.required) {
        const filled = (it.type === "conformidade" || it.type === "sim_nao") ? !!a?.conformidade
          : it.type === "texto" ? !!a?.text?.trim() : it.type === "numero" ? !!a?.number?.trim() : !!a?.option;
        if (!filled) { setError(`Responda o item obrigatório: “${it.label}”.`); return; }
      }
      // exigências da não conformidade (definidas no cadastro do item)
      const isNc = a?.conformidade === "nao_conforme";
      if (!isNc) continue;
      if (it.requireNoteOnNc && !(a?.note ?? "").trim()) { setError(`Informe a observação da não conformidade em: “${it.label}”.`); return; }
      if (it.requirePhotoOnNc && (a?.files?.length ?? 0) === 0) { setError(`Anexe uma foto da não conformidade em: “${it.label}”.`); return; }
    }
    const fd = new FormData();
    fd.set("payload", JSON.stringify({ checklist_id: checklist.id, run_id: runId, schedule_id: scheduleId, unit_id: unitId, period_key: periodKey, started_at: startedAt, answers: buildAnswers() }));
    for (const it of checklist.items) for (const f of (ans[it.id]?.files ?? [])) fd.append(`photo:${it.id}`, f);
    start(async () => {
      const r = await submitRun(fd);
      if (r?.error) { setError(r.error); return; }
      onClose(); router.refresh();
    });
  };

  return (
    <Modal maxWidth={480} title={`Executar · ${checklist.name}`} onClose={onClose} footer={<>
      <span style={{ marginRight: "auto", display: "inline-flex", alignItems: "center", gap: "0.75rem" }}>
        {parcial != null && <span className="soft" style={{ fontSize: "0.85rem" }}>Conformidade parcial: <strong>{parcial}%</strong></span>}
        <span style={{ fontSize: "0.76rem", color: "var(--mh-success)", opacity: draftSaved ? 1 : 0, transition: "opacity 0.2s" }}>✓ Rascunho salvo</span>
      </span>
      {(hasContent || runId) && <button type="button" className="btn btn-ghost" style={{ color: "var(--mh-danger)" }} disabled={pending} onClick={discardDraft}>Descartar</button>}
      <button type="button" className="btn btn-ghost" disabled={pending} onClick={closeSavingDraft}>Fechar</button>
      <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>Concluir</button>
    </>}>
      {checklist.description && <div className="soft" style={{ fontSize: "0.85rem" }}>{checklist.description}</div>}
      {checklist.autoOpenTasks && <div className="soft" style={{ fontSize: "0.78rem" }}>Itens marcados como “Não conforme” abrem automaticamente uma tarefa para o responsável tratar.</div>}
      <div className="soft" style={{ fontSize: "0.78rem" }}>
        {draft ? "Rascunho retomado. " : ""}O preenchimento é salvo sozinho enquanto você responde. As fotos não ficam no rascunho e ele expira em 1 hora.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      {groupBySection(checklist.items).map(({ item: it, n, sectionHeader, first }) => {
        const a = ans[it.id];
        const inline = it.type === "conformidade" || it.type === "sim_nao" || it.type === "selecao" || it.type === "nota";
        // marcado como "Não conforme" / "Não": chama atenção (pulso) p/ observação e foto
        const isNc = a?.conformidade === "nao_conforme";
        const noteVisible = !!noteOpen[it.id] || (isNc && it.requireNoteOnNc);
        const noteMissing = isNc && !(a?.note ?? "").trim();
        const photoMissing = isNc && (a?.files?.length ?? 0) === 0;
        const btnStyle = { cursor: "pointer", border: "none", padding: "0.2rem 0.55rem", fontSize: "0.78rem" } as const;
        const control = (
          <>
            {/* Sim/Não usa o mesmo controle de três estados da conformidade, só com outro
                rótulo: é o que faz "Não" contar como não conformidade */}
            {(it.type === "conformidade" || it.type === "sim_nao") && (it.allowNa ? (["conforme", "nao_conforme", "na"] as const) : (["conforme", "nao_conforme"] as const)).map((v) => (
              <button key={v} type="button" onClick={() => set(it.id, { conformidade: v })}
                className={a?.conformidade === v ? `badge badge-${CHECKLIST_CONFORMIDADE_TONE[v]}` : "badge badge-gray"} style={btnStyle}>
                {a?.conformidade === v ? "✓ " : ""}{checklistAnswerLabel(it.type)[v]}
              </button>
            ))}
            {(it.type === "selecao" || it.type === "nota") && (
              <select className="select" value={a?.option ?? ""} onChange={(e) => set(it.id, { option: e.target.value })} style={{ padding: "0.25rem 0.5rem", height: "auto", fontSize: "0.82rem" }}>
                <option value="">Selecione…</option>{(it.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
          </>
        );
        return (
          <Fragment key={it.id}>
          {sectionHeader && <SectionSeparator label={sectionHeader} first={first} />}
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.3rem", padding: "0.5rem 0.65rem" }}>
            {/* nowrap + quebra do texto: os controles ficam sempre à direita, mesmo com pergunta longa */}
            <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", justifyContent: "space-between", flexWrap: "nowrap" }}>
              <div style={{ fontWeight: 600, fontSize: "0.88rem", flex: "1 1 auto", minWidth: 0, overflowWrap: "anywhere" }}>
                <span className="soft" style={{ fontWeight: 400 }}>{n}.</span> {it.label}{it.required && <span style={{ color: "var(--mh-danger)" }}> *</span>}
                {it.help && <div className="soft" style={{ fontSize: "0.76rem", fontWeight: 400 }}>{it.help}</div>}
              </div>
              {inline && <div style={{ display: "flex", gap: "0.35rem", flexShrink: 0, alignItems: "center" }}>{control}</div>}
            </div>
            {it.type === "texto" && <textarea className="input" rows={2} value={a?.text ?? ""} onChange={(e) => set(it.id, { text: e.target.value })} />}
            {it.type === "numero" && <input className="input" inputMode="decimal" value={a?.number ?? ""} onChange={(e) => set(it.id, { number: e.target.value })} />}
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
              {!noteVisible && (
                <button type="button" onClick={() => toggleNote(it.id)} className={`mh-mini-action${noteMissing ? " mh-attn" : ""}`}>
                  <MessageSquarePlus size={12} /> Observação{isNc && it.requireNoteOnNc ? " *" : ""}
                </button>
              )}
              {it.allowPhoto && (
                <label className={`mh-mini-action${photoMissing ? " mh-attn" : ""}`} style={{ cursor: "pointer" }}>
                  <Paperclip size={12} /> Foto{isNc && it.requirePhotoOnNc ? " *" : ""}
                  <input type="file" accept="image/*" multiple hidden onChange={(e) => set(it.id, { files: Array.from(e.target.files ?? []) })} />
                </label>
              )}
              {(a?.files?.length ?? 0) > 0 && <span className="soft" style={{ fontSize: "0.72rem" }}>{a?.files.length} foto(s)</span>}
            </div>
            {noteVisible && (
              <div style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
                <input className="input" placeholder={isNc && it.requireNoteOnNc ? "Descreva a não conformidade (obrigatório)" : "Observação"} value={a?.note ?? ""} onChange={(e) => set(it.id, { note: e.target.value })} autoFocus style={{ flex: 1 }} />
                {!(isNc && it.requireNoteOnNc) && (
                  <button type="button" onClick={() => toggleNote(it.id)} title="Remover observação" className="mh-mini-action" style={{ flexShrink: 0 }}>
                    <X size={13} />
                  </button>
                )}
              </div>
            )}
          </div>
          </Fragment>
        );
      })}
      </div>
      {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}

// ---------------- Ver execução (histórico) ----------------
function RunViewDialog({ run, checklist, canDelete, onClose }: { run: RunRow; checklist: ChecklistTemplate | null; canDelete: boolean; onClose: () => void }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const ansByItem = new Map(run.answers.map((a) => [a.itemId, a]));
  const photosByItem = new Map<string, RunPhoto[]>();
  for (const p of run.photos) { const arr = photosByItem.get(p.itemId) ?? []; arr.push(p); photosByItem.set(p.itemId, arr); }

  // um pedido só para todas as fotos da execução: antes cada miniatura abria o
  // próprio caminho até o servidor, e uma execução com 20 fotos custava 20 idas
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let vivo = true;
    const caminhos = run.photos.map((p) => p.path);
    if (caminhos.length === 0) return;
    void getChecklistPhotoUrls(caminhos).then((m) => { if (vivo) setUrls(m); });
    return () => { vivo = false; };
  }, [run.photos]);
  const del = async () => { if (!(await confirmDialog({ tone: "danger", confirmLabel: "Excluir", message: "Excluir esta execução?" }))) return; start(async () => { await deleteRun(run.id); onClose(); router.refresh(); }); };

  return (
    <Modal wide title={`${checklist?.name ?? "Checklist"} · ${run.completedAt ? formatDateTime(run.completedAt) : ""}`} onClose={onClose} footer={<>
      {canDelete && <button type="button" className="btn btn-ghost" style={{ color: "var(--mh-danger)", marginRight: "auto" }} disabled={pending} onClick={del}>Excluir</button>}
      <button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>
    </>}>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <Badge tone={run.score == null ? "gray" : run.score >= 90 ? "green" : run.score >= 70 ? "amber" : "red"}>Conformidade {run.score == null ? "—" : `${run.score}%`}</Badge>
        <span className="soft" style={{ fontSize: "0.8rem" }}>{run.conformCount} conforme · {run.nonconformCount} não conforme · {run.naCount} N.A.</span>
        <span className="soft" style={{ fontSize: "0.8rem" }}>· por {shortName(run.executorName)}{run.unitName ? ` · ${run.unitName}` : ""}</span>
      </div>
      <div className="soft" style={{ fontSize: "0.8rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <span>Início: <strong>{run.startedAt ? formatDateTime(run.startedAt) : "—"}</strong></span>
        <span>Conclusão: <strong>{run.completedAt ? formatDateTime(run.completedAt) : "—"}</strong></span>
        <span>Duração: <strong>{formatDuration(runDurationSec(run.startedAt, run.completedAt))}</strong></span>
      </div>
      {(checklist?.items ?? []).map((it, idx) => {
        const a = ansByItem.get(it.id);
        const ph = photosByItem.get(it.id) ?? [];
        return (
          <div key={it.id} style={{ borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
            <div style={{ fontWeight: 600 }}>{idx + 1}. {it.label}</div>
            <div style={{ marginTop: 2 }}>
              {(it.type === "conformidade" || it.type === "sim_nao") && a?.conformidade
                ? (() => { const v = a.conformidade as "conforme" | "nao_conforme" | "na";
                    return <Badge tone={CHECKLIST_CONFORMIDADE_TONE[v]}>{checklistAnswerLabel(it.type)[v]}</Badge>; })()
                : it.type === "numero" ? <span>{a?.number ?? "—"}</span>
                : (it.type === "selecao" || it.type === "nota") ? <span>{a?.option ?? "—"}</span>
                : <span style={{ whiteSpace: "pre-wrap" }}>{a?.text ?? "—"}</span>}
            </div>
            {a?.note && <div className="soft" style={{ fontSize: "0.82rem", marginTop: 2 }}>Obs.: {a.note}</div>}
            {ph.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.4rem" }}>{ph.map((p) => <PhotoThumb key={p.id} photo={p} url={urls[p.path] ?? null} />)}</div>}
          </div>
        );
      })}
    </Modal>
  );
}

function PhotoThumb({ photo, url }: { photo: RunPhoto; url: string | null }) {
  if (!url) return <span className="badge badge-gray">📎 {photo.filename}</span>;
  return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={photo.filename} style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }} /></a>;
}

// ---------------- Tarefas (não conformidades) ----------------
function TasksView({ tasks, currentUserId, onOpen }: { tasks: TaskRow[]; currentUserId: string; onOpen: (t: TaskRow) => void }) {
  const [status, setStatus] = useState<"abertas" | "todas" | Enums<"checklist_task_status">>("abertas");
  const [mine, setMine] = useState(false);
  const filtered = tasks.filter((t) => {
    const st = status === "abertas" ? (t.status === "pendente" || t.status === "em_andamento") : status === "todas" ? true : t.status === status;
    return st && (!mine || t.assigneeId === currentUserId);
  });
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.7rem", alignItems: "flex-end", marginBottom: "1.1rem" }}>
        <div><label className="label">Status</label>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="abertas">Abertas (pendente + em tratamento)</option>
            <option value="todas">Todas</option>
            {(Object.entries(CHECKLIST_TASK_STATUS_LABEL) as [Enums<"checklist_task_status">, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem", cursor: "pointer" }}>
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Só as minhas
        </label>
      </div>
      {filtered.length === 0 ? <EmptyState title="Nenhuma tarefa" description="Não conformidades em checklists geram tarefas automaticamente aqui." /> : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table"><thead><tr><th>Aberta em</th><th>Checklist</th><th>Item (não conformidade)</th><th>Unidade</th><th>Responsável</th><th>Status</th><th></th></tr></thead>
            <tbody>{filtered.map((t) => (
              <tr key={t.id} style={{ cursor: "pointer" }} onClick={() => onOpen(t)}>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{formatDate(t.createdAt)}</td>
                <td className="muted">{t.checklistName}</td>
                <td style={{ fontWeight: 600 }}>{t.title}</td>
                <td className="muted">{t.unitName ?? <span className="soft">—</span>}</td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{t.assigneeName ? shortName(t.assigneeName) : <span className="soft">—</span>}</td>
                <td><Badge tone={CHECKLIST_TASK_STATUS_TONE[t.status]}>{CHECKLIST_TASK_STATUS_LABEL[t.status]}</Badge></td>
                <td style={{ textAlign: "right" }}><button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); onOpen(t); }}>Abrir</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TaskDialog({ task, canTreat, onClose }: { task: TaskRow; canTreat: boolean; onClose: () => void }) {
  const [comment, setComment] = useState("");
  const [resolution, setResolution] = useState(task.resolution ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  // se a tarefa está na lista do usuário, a RLS já permite comentar
  const canComment = true;

  const addComment = () => {
    if (!comment.trim()) return;
    start(async () => {
      const r = await addChecklistTaskComment({ task_id: task.id, body: comment.trim() });
      if (r?.error) { setError(r.error); return; }
      setComment(""); router.refresh();
    });
  };
  const setStatus = (status: Enums<"checklist_task_status">) => {
    start(async () => {
      const r = await updateChecklistTaskStatus({ task_id: task.id, status, resolution });
      if (r?.error) { setError(r.error); return; }
      router.refresh();
      if (status === "concluida" || status === "cancelada") onClose();
    });
  };

  return (
    <Modal wide title={task.title} onClose={onClose} footer={<>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>
    </>}>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <Badge tone={CHECKLIST_TASK_STATUS_TONE[task.status]}>{CHECKLIST_TASK_STATUS_LABEL[task.status]}</Badge>
        <span className="soft" style={{ fontSize: "0.8rem" }}>{task.checklistName}{task.unitName ? ` · ${task.unitName}` : ""} · aberta {formatDateTime(task.createdAt)}</span>
      </div>
      <div className="soft" style={{ fontSize: "0.85rem" }}>Responsável: <strong>{task.assigneeName ?? "—"}</strong>{task.resolvedAt ? ` · tratada em ${formatDateTime(task.resolvedAt)}` : ""}</div>
      {task.description && <div><div className="soft" style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase" }}>Observação da execução</div><div style={{ whiteSpace: "pre-wrap" }}>{task.description}</div></div>}

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.7rem" }}>
        <div className="soft" style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", marginBottom: "0.4rem" }}>Tratativa ({task.comments.length})</div>
        {task.comments.length === 0 && <div className="soft" style={{ fontSize: "0.82rem" }}>Sem comentários ainda.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {task.comments.map((c) => (
            <div key={c.id} className="card card-pad" style={{ padding: "0.5rem 0.65rem" }}>
              <div className="soft" style={{ fontSize: "0.74rem", marginBottom: 2 }}>{shortName(c.authorName)} · {formatDateTime(c.createdAt)}</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{c.body}</div>
            </div>
          ))}
        </div>
        {canComment && (
          <div style={{ marginTop: "0.6rem" }}>
            <textarea className="input" rows={2} placeholder="Escreva um comentário sobre a tratativa…" value={comment} onChange={(e) => setComment(e.target.value)} />
            <div style={{ marginTop: "0.4rem" }}><button type="button" className="btn btn-ghost btn-sm" disabled={pending || !comment.trim()} onClick={addComment}>Comentar</button></div>
          </div>
        )}
      </div>

      {canTreat && task.status !== "concluida" && task.status !== "cancelada" && (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.7rem" }}>
          <label className="label">Resolução (ao concluir)</label>
          <textarea className="input" rows={2} placeholder="O que foi feito para resolver a não conformidade…" value={resolution} onChange={(e) => setResolution(e.target.value)} />
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
            {task.status === "pendente" && <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => setStatus("em_andamento")}>Iniciar tratamento</button>}
            <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => setStatus("concluida")}>Concluir</button>
            <button type="button" className="btn btn-ghost btn-sm" style={{ color: "var(--mh-danger)" }} disabled={pending} onClick={() => setStatus("cancelada")}>Cancelar tarefa</button>
          </div>
        </div>
      )}
      {task.resolution && (task.status === "concluida" || task.status === "cancelada") && (
        <div className="soft" style={{ fontSize: "0.85rem" }}>Resolução: {task.resolution}</div>
      )}
      {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}
