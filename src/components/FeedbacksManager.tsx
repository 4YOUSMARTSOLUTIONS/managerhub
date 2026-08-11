"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge";
import { MonthInput } from "@/components/ui/MonthInput";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Tabs, type Tab } from "@/components/ui/Tabs";
import { SearchSelect } from "@/components/SearchSelect";
import {
  createFeedback, updateFeedback, deleteFeedback, deleteFeedbackAttachment,
  acknowledgeFeedback, getFeedbackAttachmentUrl, setFeedbackApplied,
  createFeedbackSession, updateFeedbackSession, deleteFeedbackSession,
  setFeedbackSessionApplied, acknowledgeFeedbackSession, generateFeedbackSessionAI,
  generateFeedbackAI,
} from "@/lib/actions/feedbacks";
import {
  createPdiAction, updatePdiAction, deletePdiAction, setPdiStatus, addPdiComment, deletePdiComment,
} from "@/lib/actions/pdi";
import {
  FEEDBACK_TYPE_LABEL, FEEDBACK_TYPE_TONE, FEEDBACK_VISIBILITY_LABEL, FEEDBACK_CHANNEL_LABEL,
  PDI_STATUS_LABEL, PDI_STATUS_TONE,
} from "@/lib/constants";
import { shortName, formatDate, formatDateTime } from "@/lib/format";
import type { Enums } from "@/types/database";
import { confirmDialog } from "@/components/ui/confirm";

export type Opt = { id: string; name: string };
export type CompOpt = { id: string; name: string; active: boolean };
export type FeedbackAttachment = { id: string; path: string; filename: string; contentType: string | null };
export type FeedbackRow = {
  id: string; subjectId: string; subjectName: string; authorId: string; authorName: string;
  date: string; type: Enums<"feedback_type">; channel: Enums<"feedback_channel"> | null;
  title: string | null; situation: string | null; behavior: string | null; impact: string | null;
  nextSteps: string | null; notes: string | null; visibility: Enums<"feedback_visibility">;
  appliedAt: string | null; acknowledgedAt: string | null; competencyIds: string[]; attachments: FeedbackAttachment[];
};
export type SessionRow = {
  id: string; subjectId: string; subjectName: string; authorId: string; authorName: string;
  date: string; referenceMonth: string | null; title: string | null;
  highlights: string | null; development: string | null; actionPlan: string | null; overall: string | null;
  visibility: Enums<"feedback_visibility">; appliedAt: string | null; acknowledgedAt: string | null; itemFeedbackIds: string[];
};
export type PdiComment = { id: string; authorId: string; authorName: string; body: string; createdAt: string };
export type PdiActionRow = {
  id: string; subjectId: string; subjectName: string; authorId: string; authorName: string;
  sourceFeedbackId: string | null; title: string; description: string | null;
  status: Enums<"pdi_action_status">; dueDate: string | null; completedAt: string | null; comments: PdiComment[];
};
export type CadenceRule = { deptId: string; posId: string; days: number };
export type MemberOrg = Record<string, { deptId: string | null; posId: string | null }>;

const TYPE_OPTS = Object.entries(FEEDBACK_TYPE_LABEL) as [Enums<"feedback_type">, string][];
const CHANNEL_OPTS = Object.entries(FEEDBACK_CHANNEL_LABEL) as [Enums<"feedback_channel">, string][];
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function thisMonth() { return today().slice(0, 7); }
function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + (dateStr.length === 10 ? "T00:00:00" : ""));
  const ms = Date.now() - d.getTime();
  return Math.floor(ms / 86400000);
}

export function FeedbacksManager({ feedbacks, sessions, subjectOptions, allSubjects, competencies, currentUserId, isAdmin, canManage, aiEnabled, pdiActions, cadenceRules, memberOrg }: {
  feedbacks: FeedbackRow[];
  sessions: SessionRow[];
  subjectOptions: Opt[];
  allSubjects: Opt[];
  competencies: CompOpt[];
  currentUserId: string;
  isAdmin: boolean;
  canManage: boolean;
  aiEnabled: boolean;
  pdiActions: PdiActionRow[];
  cadenceRules: CadenceRule[];
  memberOrg: MemberOrg;
}) {
  const [fbDialog, setFbDialog] = useState<{ mode: "new" | "edit"; row?: FeedbackRow } | null>(null);
  const [sessDialog, setSessDialog] = useState<{ mode: "new" | "edit"; row?: SessionRow } | null>(null);
  const [pdiDialog, setPdiDialog] = useState<{ mode: "new" | "edit"; row?: PdiActionRow; presetSubjectId?: string; presetFeedbackId?: string } | null>(null);
  const [fbDetailId, setFbDetailId] = useState<string | null>(null);
  const [sessDetailId, setSessDetailId] = useState<string | null>(null);
  const [pdiDetailId, setPdiDetailId] = useState<string | null>(null);
  const [scopeAll, setScopeAll] = useState(false); // admin: ver toda a empresa
  const compName = useMemo(() => new Map(competencies.map((c) => [c.id, c.name])), [competencies]);

  // escopo: minha equipe (subordinados diretos) por padrão; admin pode expandir p/ toda a empresa
  const roster = useMemo(() => (isAdmin && scopeAll ? allSubjects : subjectOptions), [isAdmin, scopeAll, allSubjects, subjectOptions]);
  const rosterIds = useMemo(() => new Set(roster.map((r) => r.id)), [roster]);

  const receivedFb = useMemo(() => feedbacks.filter((f) => f.subjectId === currentUserId && f.visibility === "compartilhado" && f.appliedAt), [feedbacks, currentUserId]);
  const receivedSess = useMemo(() => sessions.filter((s) => s.subjectId === currentUserId && s.visibility === "compartilhado" && s.appliedAt), [sessions, currentUserId]);
  const teamFb = useMemo(() => feedbacks.filter((f) => rosterIds.has(f.subjectId)), [feedbacks, rosterIds]);
  const teamSess = useMemo(() => sessions.filter((s) => rosterIds.has(s.subjectId)), [sessions, rosterIds]);
  const fbDetail = fbDetailId ? feedbacks.find((f) => f.id === fbDetailId) ?? null : null;
  const sessDetail = sessDetailId ? sessions.find((s) => s.id === sessDetailId) ?? null : null;
  const pdiDetail = pdiDetailId ? pdiActions.find((a) => a.id === pdiDetailId) ?? null : null;

  const canEditFb = (f: FeedbackRow) => isAdmin || f.authorId === currentUserId;
  const canEditSess = (s: SessionRow) => isAdmin || s.authorId === currentUserId;
  const managesSubject = (subjectId: string) => isAdmin || rosterIds.has(subjectId);

  // PDI: ações da minha equipe (roster) + as minhas próprias
  const pdiVisible = useMemo(
    () => pdiActions.filter((a) => rosterIds.has(a.subjectId) || a.subjectId === currentUserId),
    [pdiActions, rosterIds, currentUserId],
  );

  const tabs: Tab[] = [];
  if (canManage) {
    tabs.push({
      id: "painel", label: "Painel",
      content: <FeedbackDashboard roster={roster} feedbacks={teamFb} sessions={teamSess} compName={compName} cadenceRules={cadenceRules} memberOrg={memberOrg} />,
    });
    tabs.push({
      id: "feedbacks", label: "Feedbacks",
      content: <TeamFeedbacks rows={teamFb} subjectOptions={roster}
        onNew={() => setFbDialog({ mode: "new" })} onOpen={(f) => setFbDetailId(f.id)} />,
    });
    tabs.push({
      id: "sessoes", label: "Sessões",
      content: <TeamSessions rows={teamSess} subjectOptions={roster}
        onNew={() => setSessDialog({ mode: "new" })} onOpen={(s) => setSessDetailId(s.id)} />,
    });
  }
  tabs.push({
    id: "pdi", label: "PDI",
    content: <PdiView actions={pdiVisible} canManage={canManage} onNew={() => setPdiDialog({ mode: "new" })} onOpen={(a) => setPdiDetailId(a.id)} />,
  });
  tabs.push({
    id: "recebidos", label: "Recebidos",
    content: <ReceivedView feedbacks={receivedFb} sessions={receivedSess} compName={compName} />,
  });

  return (
    <div>
      {isAdmin && canManage && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.6rem" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.82rem", cursor: "pointer" }}>
            <input type="checkbox" checked={scopeAll} onChange={(e) => setScopeAll(e.target.checked)} />
            Ver toda a empresa {scopeAll ? "" : `(mostrando a minha equipe · ${subjectOptions.length})`}
          </label>
        </div>
      )}
      {tabs.length > 1 ? <Tabs tabs={tabs} /> : tabs[0]?.content}
      {fbDialog && (
        <FeedbackDialog mode={fbDialog.mode} row={fbDialog.row} subjectOptions={roster}
          competencies={competencies.filter((c) => c.active || (fbDialog.row?.competencyIds ?? []).includes(c.id))}
          aiEnabled={aiEnabled} onClose={() => setFbDialog(null)} />
      )}
      {sessDialog && (
        <FeedbackSessionDialog mode={sessDialog.mode} row={sessDialog.row} subjectOptions={roster}
          allFeedbacks={feedbacks} aiEnabled={aiEnabled} onClose={() => setSessDialog(null)} />
      )}
      {pdiDialog && (
        <PdiActionDialog mode={pdiDialog.mode} row={pdiDialog.row} subjectOptions={roster}
          presetSubjectId={pdiDialog.presetSubjectId} presetFeedbackId={pdiDialog.presetFeedbackId}
          onClose={() => setPdiDialog(null)} />
      )}
      {fbDetail && (
        <Modal title="Detalhes do feedback" onClose={() => setFbDetailId(null)} footer={<button type="button" className="btn btn-ghost" onClick={() => setFbDetailId(null)}>Fechar</button>}>
          <FeedbackCard f={fbDetail} compName={compName} showSubject canEdit={canEditFb(fbDetail)}
            onEdit={() => { setFbDetailId(null); setFbDialog({ mode: "edit", row: fbDetail }); }}
            onCreatePdi={() => { setFbDetailId(null); setPdiDialog({ mode: "new", presetSubjectId: fbDetail.subjectId, presetFeedbackId: fbDetail.id }); }} />
        </Modal>
      )}
      {sessDetail && (
        <Modal title="Detalhes da sessão" onClose={() => setSessDetailId(null)} footer={<button type="button" className="btn btn-ghost" onClick={() => setSessDetailId(null)}>Fechar</button>}>
          <SessionCard s={sessDetail} feedbacks={feedbacks} showSubject canEdit={canEditSess(sessDetail)}
            onEdit={() => { setSessDetailId(null); setSessDialog({ mode: "edit", row: sessDetail }); }} />
        </Modal>
      )}
      {pdiDetail && (
        <Modal title="Ação do PDI" onClose={() => setPdiDetailId(null)} footer={<button type="button" className="btn btn-ghost" onClick={() => setPdiDetailId(null)}>Fechar</button>}>
          <PdiActionCard a={pdiDetail} currentUserId={currentUserId}
            canManageThis={managesSubject(pdiDetail.subjectId)} isSubject={pdiDetail.subjectId === currentUserId}
            sourceFeedback={pdiDetail.sourceFeedbackId ? feedbacks.find((f) => f.id === pdiDetail.sourceFeedbackId) ?? null : null}
            onEdit={() => { setPdiDetailId(null); setPdiDialog({ mode: "edit", row: pdiDetail }); }} />
        </Modal>
      )}
    </div>
  );
}

// ---------------- Painel ----------------
function FeedbackDashboard({ roster, feedbacks, sessions, compName, cadenceRules, memberOrg }: {
  roster: Opt[]; feedbacks: FeedbackRow[]; sessions: SessionRow[]; compName: Map<string, string>; cadenceRules: CadenceRule[]; memberOrg: MemberOrg;
}) {
  const ym = thisMonth();
  const year = ym.slice(0, 4);
  // só feedbacks APLICADOS contam como "dados" ao colaborador
  const applied = feedbacks.filter((f) => f.appliedAt);
  const fbMonth = applied.filter((f) => (f.appliedAt ?? "").slice(0, 7) === ym).length;
  const fbYear = applied.filter((f) => (f.appliedAt ?? "").slice(0, 4) === year).length;
  const sessMonth = sessions.filter((s) => !!s.appliedAt && (s.appliedAt ?? "").slice(0, 7) === ym).length;

  const lastBySubject = new Map<string, string>(); // último appliedAt (timestamp)
  for (const f of applied) { const cur = lastBySubject.get(f.subjectId); if (!cur || (f.appliedAt ?? "") > cur) lastBySubject.set(f.subjectId, f.appliedAt ?? ""); }
  const lastSessBySubject = new Map<string, string>();
  for (const s of sessions) { if (!s.appliedAt) continue; const cur = lastSessBySubject.get(s.subjectId); if (!cur || s.appliedAt > cur) lastSessBySubject.set(s.subjectId, s.appliedAt); }
  const countMonth = new Map<string, number>();
  const countYear = new Map<string, number>();
  for (const f of applied) {
    if ((f.appliedAt ?? "").slice(0, 7) === ym) countMonth.set(f.subjectId, (countMonth.get(f.subjectId) ?? 0) + 1);
    if ((f.appliedAt ?? "").slice(0, 4) === year) countYear.set(f.subjectId, (countYear.get(f.subjectId) ?? 0) + 1);
  }
  const semFeedbackMes = roster.filter((r) => !(countMonth.get(r.id) ?? 0)).length;

  // cadência por (setor, função)
  const cadenceMap = new Map(cadenceRules.map((r) => [`${r.deptId}|${r.posId}`, r.days]));
  const ruleFor = (uid: string): number | undefined => {
    const org = memberOrg[uid];
    if (!org?.deptId || !org?.posId) return undefined;
    return cadenceMap.get(`${org.deptId}|${org.posId}`);
  };

  const strong = new Map<string, number>(), develop = new Map<string, number>();
  for (const f of applied) {
    const bucket = f.type === "reconhecimento" ? strong : f.type === "construtivo" ? develop : null;
    if (!bucket) continue;
    for (const id of f.competencyIds) bucket.set(id, (bucket.get(id) ?? 0) + 1);
  }
  const rank = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, n]) => ({ name: compName.get(id) ?? "—", n }));

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "1rem", marginBottom: "1.2rem" }}>
        <StatCard label="Feedbacks no mês" value={String(fbMonth)} />
        <StatCard label="Feedbacks no ano" value={String(fbYear)} />
        <StatCard label="Sessões no mês" value={String(sessMonth)} />
        <StatCard label="Sem feedback no mês" value={String(semFeedbackMes)} tone={semFeedbackMes ? "amber" : "green"} sub={`de ${roster.length} colaborador(es)`} />
      </div>

      <div className="card" style={{ overflowX: "auto", marginBottom: "1.2rem" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Colaborador</th>
              <th style={{ textAlign: "right" }}>No mês</th>
              <th style={{ textAlign: "right" }}>No ano</th>
              <th>Último feedback</th>
              <th>Última sessão</th>
              <th>Cadência</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((r) => {
              const last = lastBySubject.get(r.id) ?? null;
              const d = daysSince(last);
              const rule = ruleFor(r.id);
              let cad: React.ReactNode;
              if (rule === undefined) cad = <span className="soft">—</span>;
              else if (rule === 0) cad = <Badge tone="gray">Sem feedback</Badge>;
              else { const atrasado = d == null || d > rule; cad = <Badge tone={atrasado ? "red" : "green"}>{atrasado ? "Atrasado" : "Em dia"}</Badge>; }
              return (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}><span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}><Avatar name={r.name} userId={r.id} /> {shortName(r.name)}</span></td>
                  <td style={{ textAlign: "right" }}>{countMonth.get(r.id) ?? 0}</td>
                  <td style={{ textAlign: "right" }}>{countYear.get(r.id) ?? 0}</td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{last ? `${formatDateTime(last)} · há ${d}d` : <span className="soft">nunca</span>}</td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{lastSessBySubject.get(r.id) ? formatDateTime(lastSessBySubject.get(r.id)!) : <span className="soft">—</span>}</td>
                  <td>{cad}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
        <CompetencyRank title="Pontos fortes do time" tone="green" rows={rank(strong)} empty="Sem reconhecimentos marcados." />
        <CompetencyRank title="A desenvolver no time" tone="amber" rows={rank(develop)} empty="Sem pontos de desenvolvimento marcados." />
      </div>
    </div>
  );
}

function CompetencyRank({ title, tone, rows, empty }: { title: string; tone: "green" | "amber"; rows: { name: string; n: number }[]; empty: string }) {
  return (
    <div className="card card-pad">
      <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>{title}</div>
      {rows.length === 0 ? <div className="soft" style={{ fontSize: "0.85rem" }}>{empty}</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {rows.map((r) => (
            <div key={r.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Badge tone={tone === "green" ? "green" : "amber"}>{r.name}</Badge>
              <span className="soft" style={{ fontSize: "0.8rem" }}>{r.n}×</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const TONE_FG: Record<string, string> = { green: "var(--mh-success)", amber: "var(--mh-warning)", red: "var(--mh-danger)", neutral: "var(--mh-text-1)" };
function StatCard({ label, value, tone = "neutral", sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "0.25rem", justifyContent: "center", minHeight: 100 }}>
      <div className="soft" style={{ fontSize: "0.69rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div className="tabular" style={{ fontSize: "2rem", fontWeight: 700, lineHeight: 1.05, letterSpacing: "-0.02em", color: TONE_FG[tone] ?? "var(--mh-text-1)" }}>{value}</div>
      {sub && <div className="soft" style={{ fontSize: "0.74rem" }}>{sub}</div>}
    </div>
  );
}

// ---------------- Feedbacks (equipe) — tabela compacta ----------------
function fbSummary(f: FeedbackRow) { return f.title || f.situation || f.behavior || f.impact || f.notes || "—"; }

function TeamFeedbacks({ rows, subjectOptions, onNew, onOpen }: {
  rows: FeedbackRow[]; subjectOptions: Opt[]; onNew: () => void; onOpen: (f: FeedbackRow) => void;
}) {
  const [subject, setSubject] = useState("");
  const [type, setType] = useState<"" | Enums<"feedback_type">>("");
  const filtered = rows.filter((f) => (!subject || f.subjectId === subject) && (!type || f.type === type));

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.8rem", alignItems: "flex-end", marginBottom: "1.1rem" }}>
        <div style={{ minWidth: 220 }}>
          <label className="label">Colaborador</label>
          <SearchSelect options={subjectOptions} value={subject} onChange={setSubject} placeholder="Todos" emptyHint="Nenhum colaborador" />
        </div>
        <div>
          <label className="label">Tipo</label>
          <select className="select" value={type} onChange={(e) => setType(e.target.value as "" | Enums<"feedback_type">)}>
            <option value="">Todos</option>
            {TYPE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <button type="button" className="btn btn-primary" onClick={onNew}>+ Novo feedback</button>
        </div>
      </div>
      {filtered.length === 0 ? (
        <EmptyState title="Nenhum feedback" description="Use “+ Novo feedback” para registrar o primeiro feedback dos seus colaboradores." />
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>Data</th><th>Colaborador</th><th>Tipo</th><th>Assunto</th><th>Visibilidade</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {filtered.map((f) => (
                <tr key={f.id} onClick={() => onOpen(f)} style={{ cursor: "pointer" }}>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{formatDate(f.date)}</td>
                  <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{shortName(f.subjectName)}</td>
                  <td><Badge tone={FEEDBACK_TYPE_TONE[f.type]}>{FEEDBACK_TYPE_LABEL[f.type]}</Badge></td>
                  <td className="muted" style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={fbSummary(f)}>{fbSummary(f)}</td>
                  <td><Badge tone={f.visibility === "compartilhado" ? "blue" : "gray"}>{FEEDBACK_VISIBILITY_LABEL[f.visibility]}</Badge></td>
                  <td><Badge tone={f.appliedAt ? "green" : "gray"}>{f.appliedAt ? "Aplicado" : "Registrado"}</Badge></td>
                  <td style={{ textAlign: "right" }}><button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); onOpen(f); }}>Ver</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------- Sessões (equipe) — tabela compacta ----------------
function TeamSessions({ rows, subjectOptions, onNew, onOpen }: {
  rows: SessionRow[]; subjectOptions: Opt[]; onNew: () => void; onOpen: (s: SessionRow) => void;
}) {
  const [subject, setSubject] = useState("");
  const filtered = rows.filter((s) => !subject || s.subjectId === subject);
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.8rem", alignItems: "flex-end", marginBottom: "1.1rem" }}>
        <div style={{ minWidth: 220 }}>
          <label className="label">Colaborador</label>
          <SearchSelect options={subjectOptions} value={subject} onChange={setSubject} placeholder="Todos" emptyHint="Nenhum colaborador" />
        </div>
        <div style={{ marginLeft: "auto" }}>
          <button type="button" className="btn btn-primary" onClick={onNew}>+ Nova sessão</button>
        </div>
      </div>
      {filtered.length === 0 ? (
        <EmptyState title="Nenhuma sessão" description="Use “+ Nova sessão” para registrar uma conversa periódica (1:1) — pode consolidar os feedbacks do período, inclusive com apoio da IA." />
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>Data</th><th>Colaborador</th><th>Título</th><th>Ref.</th><th>Visibilidade</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} onClick={() => onOpen(s)} style={{ cursor: "pointer" }}>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{formatDate(s.date)}</td>
                  <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{shortName(s.subjectName)}</td>
                  <td className="muted" style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.title ?? ""}>{s.title || <span className="soft">—</span>}</td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{s.referenceMonth ? s.referenceMonth.slice(0, 7) : "—"}</td>
                  <td><Badge tone={s.visibility === "compartilhado" ? "blue" : "gray"}>{FEEDBACK_VISIBILITY_LABEL[s.visibility]}</Badge></td>
                  <td><Badge tone={s.appliedAt ? "green" : "gray"}>{s.appliedAt ? "Aplicado" : "Registrado"}</Badge></td>
                  <td style={{ textAlign: "right" }}><button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); onOpen(s); }}>Ver</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------- Recebidos ----------------
function ReceivedView({ feedbacks, sessions, compName }: { feedbacks: FeedbackRow[]; sessions: SessionRow[]; compName: Map<string, string> }) {
  if (feedbacks.length === 0 && sessions.length === 0) {
    return <EmptyState title="Nenhum feedback recebido" description="Feedbacks e sessões compartilhados e aplicados com você aparecerão aqui." />;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
      {sessions.map((s) => <SessionCard key={s.id} s={s} feedbacks={[]} showAck />)}
      {feedbacks.map((f) => <FeedbackCard key={f.id} f={f} compName={compName} showAck />)}
    </div>
  );
}

// ---------------- Card pontual ----------------
function FeedbackCard({ f, compName, showSubject, canEdit, onEdit, showAck, onCreatePdi }: {
  f: FeedbackRow; compName: Map<string, string>; showSubject?: boolean; canEdit?: boolean; onEdit?: () => void; showAck?: boolean; onCreatePdi?: () => void;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const blocks: [string, string | null][] = [
    ["Situação", f.situation], ["Comportamento", f.behavior], ["Impacto", f.impact], ["Próximos passos", f.nextSteps], ["Observações", f.notes],
  ];
  const del = async () => { if (!(await confirmDialog({ tone: "danger", confirmLabel: "Excluir", message: "Excluir este feedback? Esta ação não pode ser desfeita." }))) return; start(async () => { await deleteFeedback(f.id); router.refresh(); }); };
  const ack = () => start(async () => { await acknowledgeFeedback({ feedback_id: f.id }); router.refresh(); });
  const toggleApplied = () => start(async () => { await setFeedbackApplied({ id: f.id, applied: !f.appliedAt }); router.refresh(); });

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "0.6rem", ...(f.appliedAt ? {} : { borderLeft: "3px solid var(--border)" }) }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <Badge tone={FEEDBACK_TYPE_TONE[f.type]}>{FEEDBACK_TYPE_LABEL[f.type]}</Badge>
        <Badge tone={f.visibility === "compartilhado" ? "blue" : "gray"}>{FEEDBACK_VISIBILITY_LABEL[f.visibility]}</Badge>
        <Badge tone={f.appliedAt ? "green" : "gray"}>{f.appliedAt ? "Aplicado" : "Registrado"}</Badge>
        {f.channel && <span className="soft" style={{ fontSize: "0.78rem" }}>{FEEDBACK_CHANNEL_LABEL[f.channel]}</span>}
        <span className="soft" style={{ fontSize: "0.78rem" }}>{formatDate(f.date)}</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {onCreatePdi && <button type="button" className="btn btn-ghost btn-sm" onClick={onCreatePdi} title="Abrir uma ação de desenvolvimento (PDI) a partir deste feedback">+ Ação PDI</button>}
          {canEdit && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={toggleApplied} title={f.appliedAt ? "Reverter para registrado" : "Confirmar que foi conversado com o colaborador"}>
              {f.appliedAt ? "Reverter" : "Marcar como aplicado"}
            </button>
          )}
          {canEdit && onEdit && (
            <button type="button" className="icon-btn" title="Editar" onClick={onEdit}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>
            </button>
          )}
          {canEdit && (
            <button type="button" className="icon-btn icon-btn-danger" title="Excluir" disabled={pending} onClick={del}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
            </button>
          )}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
        {showSubject && <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontWeight: 600 }}><Avatar name={f.subjectName} userId={f.subjectId} /> {f.subjectName}</span>}
        <span className="soft">{showSubject ? "· por " : "de "}{shortName(f.authorName)}</span>
      </div>
      {f.title && <div style={{ fontWeight: 700 }}>{f.title}</div>}
      {blocks.filter(([, v]) => (v ?? "").trim()).map(([label, v]) => (
        <div key={label}>
          <div className="soft" style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{v}</div>
        </div>
      ))}
      {f.competencyIds.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
          {f.competencyIds.map((id) => <Badge key={id} tone="purple">{compName.get(id) ?? "—"}</Badge>)}
        </div>
      )}
      {f.attachments.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>{f.attachments.map((a) => <AttachmentLink key={a.id} att={a} />)}</div>
      )}
      {showAck && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
          {f.acknowledgedAt ? <span className="soft" style={{ fontSize: "0.8rem" }}>✓ Ciência dada em {formatDateTime(f.acknowledgedAt)}</span>
            : <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={ack}>Dar ciência</button>}
        </div>
      )}
    </div>
  );
}

// ---------------- Card de sessão ----------------
function SessionCard({ s, feedbacks, showSubject, canEdit, onEdit, showAck }: {
  s: SessionRow; feedbacks: FeedbackRow[]; showSubject?: boolean; canEdit?: boolean; onEdit?: () => void; showAck?: boolean;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const items = feedbacks.filter((f) => s.itemFeedbackIds.includes(f.id));
  const blocks: [string, string | null][] = [
    ["Destaques", s.highlights], ["Pontos de desenvolvimento", s.development], ["Plano de ação", s.actionPlan], ["Avaliação geral", s.overall],
  ];
  const del = async () => { if (!(await confirmDialog({ tone: "danger", confirmLabel: "Excluir", message: "Excluir esta sessão?" }))) return; start(async () => { await deleteFeedbackSession(s.id); router.refresh(); }); };
  const ack = () => start(async () => { await acknowledgeFeedbackSession({ session_id: s.id }); router.refresh(); });
  const toggleApplied = () => start(async () => { await setFeedbackSessionApplied({ id: s.id, applied: !s.appliedAt }); router.refresh(); });

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "0.6rem", ...(s.appliedAt ? {} : { borderLeft: "3px solid var(--border)" }) }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <Badge tone="blue">Sessão 1:1</Badge>
        <Badge tone={s.visibility === "compartilhado" ? "blue" : "gray"}>{FEEDBACK_VISIBILITY_LABEL[s.visibility]}</Badge>
        <Badge tone={s.appliedAt ? "green" : "gray"}>{s.appliedAt ? "Aplicado" : "Registrado"}</Badge>
        <span className="soft" style={{ fontSize: "0.78rem" }}>{formatDate(s.date)}{s.referenceMonth ? ` · ref. ${s.referenceMonth.slice(0, 7)}` : ""}</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {canEdit && <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={toggleApplied}>{s.appliedAt ? "Reverter" : "Marcar como aplicado"}</button>}
          {canEdit && onEdit && (
            <button type="button" className="icon-btn" title="Editar" onClick={onEdit}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>
            </button>
          )}
          {canEdit && (
            <button type="button" className="icon-btn icon-btn-danger" title="Excluir" disabled={pending} onClick={del}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
            </button>
          )}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
        {showSubject && <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontWeight: 600 }}><Avatar name={s.subjectName} userId={s.subjectId} /> {s.subjectName}</span>}
        <span className="soft">{showSubject ? "· por " : "de "}{shortName(s.authorName)}</span>
      </div>
      {s.title && <div style={{ fontWeight: 700 }}>{s.title}</div>}
      {blocks.filter(([, v]) => (v ?? "").trim()).map(([label, v]) => (
        <div key={label}>
          <div className="soft" style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{v}</div>
        </div>
      ))}
      {items.length > 0 && (
        <div>
          <div className="soft" style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 4 }}>Feedbacks referenciados</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
            {items.map((f) => <Badge key={f.id} tone="gray">{formatDate(f.date)} · {f.title || FEEDBACK_TYPE_LABEL[f.type]}</Badge>)}
          </div>
        </div>
      )}
      {showAck && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
          {s.acknowledgedAt ? <span className="soft" style={{ fontSize: "0.8rem" }}>✓ Ciência dada em {formatDateTime(s.acknowledgedAt)}</span>
            : <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={ack}>Dar ciência</button>}
        </div>
      )}
    </div>
  );
}

// ---------------- PDI ----------------
function PdiView({ actions, canManage, onNew, onOpen }: {
  actions: PdiActionRow[]; canManage: boolean; onNew: () => void; onOpen: (a: PdiActionRow) => void;
}) {
  const [showDone, setShowDone] = useState(false);
  const visible = actions.filter((a) => showDone || (a.status !== "concluida" && a.status !== "cancelada"));

  return (
    <div>
      <div style={{ display: "flex", gap: "0.8rem", alignItems: "center", marginBottom: "1.1rem", flexWrap: "wrap" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", cursor: "pointer" }}>
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Mostrar concluídas/canceladas
        </label>
        {canManage && <div style={{ marginLeft: "auto" }}><button type="button" className="btn btn-primary" onClick={onNew}>+ Nova ação</button></div>}
      </div>
      {visible.length === 0 ? (
        <EmptyState title="Nenhuma ação no PDI" description={canManage ? "Crie ações de desenvolvimento pela aba Feedbacks (botão “+ Ação PDI” no feedback) ou aqui em “+ Nova ação”." : "As ações do seu Plano de Desenvolvimento Individual aparecerão aqui."} />
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>Colaborador</th><th>Ação</th><th>Status</th><th>Prazo</th><th style={{ textAlign: "right" }}>Coment.</th><th></th></tr></thead>
            <tbody>
              {visible.map((a) => (
                <tr key={a.id} onClick={() => onOpen(a)} style={{ cursor: "pointer" }}>
                  <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{shortName(a.subjectName)}</td>
                  <td className="muted" style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.title}>{a.title}</td>
                  <td><Badge tone={PDI_STATUS_TONE[a.status]}>{PDI_STATUS_LABEL[a.status]}</Badge></td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{a.dueDate ? formatDate(a.dueDate) : <span className="soft">—</span>}</td>
                  <td className="muted" style={{ textAlign: "right" }}>{a.comments.length || ""}</td>
                  <td style={{ textAlign: "right" }}><button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); onOpen(a); }}>Abrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PdiActionCard({ a, currentUserId, canManageThis, isSubject, sourceFeedback, onEdit }: {
  a: PdiActionRow; currentUserId: string; canManageThis: boolean; isSubject: boolean; sourceFeedback: FeedbackRow | null; onEdit: () => void;
}) {
  const [pending, start] = useTransition();
  const [comment, setComment] = useState("");
  const router = useRouter();
  const terminal = a.status === "concluida" || a.status === "cancelada";
  const set = (status: Enums<"pdi_action_status">) => start(async () => { await setPdiStatus({ id: a.id, status }); router.refresh(); });
  const del = async () => { if (!(await confirmDialog({ tone: "danger", confirmLabel: "Excluir", message: "Excluir esta ação do PDI?" }))) return; start(async () => { await deletePdiAction(a.id); router.refresh(); }); };
  const send = () => { if (!comment.trim()) return; start(async () => { const r = await addPdiComment({ action_id: a.id, body: comment.trim() }); if (!r?.error) { setComment(""); router.refresh(); } }); };
  const delComment = (id: string) => start(async () => { await deletePdiComment(id); router.refresh(); });

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <Badge tone={PDI_STATUS_TONE[a.status]}>{PDI_STATUS_LABEL[a.status]}</Badge>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontWeight: 600 }}><Avatar name={a.subjectName} userId={a.subjectId} /> {a.subjectName}</span>
        {a.dueDate && <span className="soft" style={{ fontSize: "0.78rem" }}>Prazo: {formatDate(a.dueDate)}</span>}
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
          {canManageThis && !terminal && (
            <button type="button" className="icon-btn" title="Editar" onClick={onEdit}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>
            </button>
          )}
          {canManageThis && (
            <button type="button" className="icon-btn icon-btn-danger" title="Excluir" disabled={pending} onClick={del}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
            </button>
          )}
        </div>
      </div>
      <div style={{ fontWeight: 700 }}>{a.title}</div>
      {a.description && <div style={{ whiteSpace: "pre-wrap" }}>{a.description}</div>}
      {sourceFeedback && <div className="soft" style={{ fontSize: "0.78rem" }}>Origem: feedback de {formatDate(sourceFeedback.date)}{sourceFeedback.title ? ` · ${sourceFeedback.title}` : ""}</div>}

      {/* controles de status */}
      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
        {!terminal && (canManageThis || isSubject) && a.status !== "em_andamento" && <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => set("em_andamento")}>Em andamento</button>}
        {!terminal && isSubject && !canManageThis && a.status !== "conclusao_solicitada" && <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => set("conclusao_solicitada")}>Solicitar conclusão</button>}
        {!terminal && canManageThis && <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => set("concluida")}>Concluir</button>}
        {!terminal && canManageThis && <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => set("cancelada")}>Cancelar</button>}
        {terminal && canManageThis && <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => set("em_andamento")}>Reabrir</button>}
        {a.completedAt && <span className="soft" style={{ fontSize: "0.78rem", alignSelf: "center" }}>Concluída em {formatDateTime(a.completedAt)}</span>}
      </div>

      {/* comentários */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {a.comments.map((c) => (
          <div key={c.id} style={{ fontSize: "0.85rem" }}>
            <span style={{ fontWeight: 600 }}>{shortName(c.authorName)}</span> <span className="soft" style={{ fontSize: "0.72rem" }}>{formatDateTime(c.createdAt)}</span>
            {c.authorId === currentUserId && <button type="button" onClick={() => delComment(c.id)} disabled={pending} aria-label="Remover" style={{ background: "none", border: "none", color: "var(--mh-danger)", cursor: "pointer", marginLeft: 6 }}>×</button>}
            <div style={{ whiteSpace: "pre-wrap" }}>{c.body}</div>
          </div>
        ))}
        <div style={{ display: "flex", gap: "0.4rem" }}>
          <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Escrever um comentário…" onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
          <button type="button" className="btn btn-ghost btn-sm" disabled={pending || !comment.trim()} onClick={send}>Comentar</button>
        </div>
      </div>
    </div>
  );
}

function PdiActionDialog({ mode, row, subjectOptions, presetSubjectId, presetFeedbackId, onClose }: {
  mode: "new" | "edit"; row?: PdiActionRow; subjectOptions: Opt[]; presetSubjectId?: string; presetFeedbackId?: string; onClose: () => void;
}) {
  const [subjectId, setSubjectId] = useState(row?.subjectId ?? presetSubjectId ?? "");
  const [title, setTitle] = useState(row?.title ?? "");
  const [description, setDescription] = useState(row?.description ?? "");
  const [dueDate, setDueDate] = useState(row?.dueDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const lockedSubject = mode === "edit" || !!presetSubjectId;
  const subjectName = subjectOptions.find((o) => o.id === subjectId)?.name ?? row?.subjectName ?? "";

  const submit = () => {
    if (!subjectId) { setError("Selecione o colaborador."); return; }
    if (!title.trim()) { setError("Informe o título da ação."); return; }
    start(async () => {
      const r = mode === "edit" && row
        ? await updatePdiAction({ id: row.id, title, description, due_date: dueDate || null })
        : await createPdiAction({ subject_user_id: subjectId, title, description, due_date: dueDate || null, source_feedback_id: presetFeedbackId || null });
      if (r?.error) { setError(r.error); return; }
      onClose(); router.refresh();
    });
  };

  return (
    <Modal title={mode === "edit" ? "Editar ação do PDI" : "Nova ação do PDI"} onClose={onClose} footer={<>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>{mode === "edit" ? "Salvar" : "Criar ação"}</button>
    </>}>
      <div>
        <label className="label">Colaborador</label>
        {lockedSubject ? <input className="input" value={subjectName} disabled /> : <SearchSelect options={subjectOptions} value={subjectId} onChange={setSubjectId} placeholder="Buscar colaborador…" emptyHint="Nenhum colaborador" />}
      </div>
      <div><label className="label">Título</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Desenvolver comunicação em reuniões" /></div>
      <div><label className="label">Descrição</label><textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <div><label className="label">Prazo (opcional)</label><input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
      {presetFeedbackId && mode === "new" && <div className="soft" style={{ fontSize: "0.78rem" }}>Esta ação ficará vinculada ao feedback de origem.</div>}
      {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}

/**
 * O endereço assinado só é pedido no clique.
 *
 * Antes cada anexo assinava sozinho ao aparecer na tela: uma lista com 50 feedbacks
 * de dois anexos abria 100 idas ao servidor só para montar links que quase ninguém
 * clica. E a assinatura vale 10 minutos, então nem dava para reaproveitar.
 */
function AttachmentLink({ att }: { att: FeedbackAttachment }) {
  const [abrindo, setAbrindo] = useState(false);
  async function abrir() {
    setAbrindo(true);
    try {
      const url = await getFeedbackAttachmentUrl(att.path);
      if (url) window.open(url, "_blank", "noopener");
      else toast.error("Não foi possível abrir o anexo.");
    } finally {
      setAbrindo(false);
    }
  }
  return (
    <button type="button" onClick={abrir} disabled={abrindo} className="badge badge-gray" style={{ border: "none", cursor: abrindo ? "default" : "pointer", font: "inherit" }} title={att.filename}>
      📎 {att.filename}
    </button>
  );
}

// ---------------- Dialog pontual ----------------
function FeedbackDialog({ mode, row, subjectOptions, competencies, aiEnabled, onClose }: {
  mode: "new" | "edit"; row?: FeedbackRow; subjectOptions: Opt[]; competencies: CompOpt[]; aiEnabled: boolean; onClose: () => void;
}) {
  const [subjectId, setSubjectId] = useState(row?.subjectId ?? "");
  const [date, setDate] = useState(row?.date ?? today());
  const [type, setType] = useState<Enums<"feedback_type">>(row?.type ?? "reconhecimento");
  const [channel, setChannel] = useState<"" | Enums<"feedback_channel">>(row?.channel ?? "");
  const [title, setTitle] = useState(row?.title ?? "");
  const [situation, setSituation] = useState(row?.situation ?? "");
  const [behavior, setBehavior] = useState(row?.behavior ?? "");
  const [impact, setImpact] = useState(row?.impact ?? "");
  const [nextSteps, setNextSteps] = useState(row?.nextSteps ?? "");
  const [notes, setNotes] = useState(row?.notes ?? "");
  const [visibility, setVisibility] = useState<Enums<"feedback_visibility">>(row?.visibility ?? "privado");
  const [compIds, setCompIds] = useState<string[]>(row?.competencyIds ?? []);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aiDraft, setAiDraft] = useState("");
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [aiPending, startAi] = useTransition();
  const router = useRouter();
  const toggleComp = (id: string) => setCompIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const runAi = () => {
    if (!aiDraft.trim()) { setError("Conte o que aconteceu para a IA distribuir nos campos."); return; }
    setError(null); setAiMsg(null);
    startAi(async () => {
      const r = await generateFeedbackAI({
        draft: aiDraft,
        type,
        subject_name: subjectOptions.find((o) => o.id === subjectId)?.name ?? row?.subjectName ?? null,
        atuais: { situation, behavior, impact, next_steps: nextSteps, notes },
      });
      if (!("ok" in r) || !r.ok) { setError(r.error); return; }
      // valor da IA quando veio; senão preserva o que o gestor já digitou
      if (r.situation) setSituation(r.situation);
      if (r.behavior) setBehavior(r.behavior);
      if (r.impact) setImpact(r.impact);
      if (r.next_steps) setNextSteps(r.next_steps);
      if (r.notes) setNotes(r.notes);
      setAiMsg("Campos preenchidos a partir do relato, revise e edite antes de registrar.");
    });
  };

  const submit = () => {
    if (mode === "new" && !subjectId) { setError("Selecione o colaborador."); return; }
    if (!date) { setError("Informe a data."); return; }
    if (![situation, behavior, impact, notes].some((x) => x.trim())) { setError("Preencha ao menos um campo (situação, comportamento, impacto ou observações)."); return; }
    const payload = { ...(mode === "edit" ? { id: row!.id } : {}), subject_user_id: subjectId, feedback_date: date, type, channel: channel || null, title, situation, behavior, impact, next_steps: nextSteps, notes, visibility, competency_ids: compIds };
    const fd = new FormData();
    fd.set("payload", JSON.stringify(payload));
    for (const f of files) fd.append("files", f);
    start(async () => {
      const r = mode === "edit" ? await updateFeedback(fd) : await createFeedback(fd);
      if (r?.error) { setError(r.error); return; }
      onClose(); router.refresh();
    });
  };

  return (
    <Modal title={mode === "edit" ? "Editar feedback" : "Novo feedback"} onClose={onClose} footer={<>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>{mode === "edit" ? "Salvar" : "Registrar"}</button>
    </>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
        <div>
          <label className="label">Colaborador</label>
          {mode === "edit" ? <input className="input" value={row?.subjectName ?? ""} disabled /> : <SearchSelect options={subjectOptions} value={subjectId} onChange={setSubjectId} placeholder="Buscar colaborador…" emptyHint="Nenhum colaborador" />}
        </div>
        <div><label className="label">Data</label><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
        <div>
          <label className="label">Tipo</label>
          <select className="select" value={type} onChange={(e) => setType(e.target.value as Enums<"feedback_type">)}>{TYPE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </div>
        <div>
          <label className="label">Canal</label>
          <select className="select" value={channel} onChange={(e) => setChannel(e.target.value as "" | Enums<"feedback_channel">)}><option value="">—</option>{CHANNEL_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </div>
      </div>
      <div><label className="label">Título (opcional)</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="soft" style={{ fontSize: "0.78rem", margin: "-0.2rem 0" }}>Modelo SBI: descreva a situação, o comportamento observado, o impacto e os próximos passos.</div>
      <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "0.5rem", background: "var(--bg-subtle, rgba(0,0,0,0.02))" }}>
        <textarea className="input" rows={3} placeholder="Conte com suas palavras o que aconteceu, a IA distribui nos campos abaixo…" value={aiDraft} onChange={(e) => setAiDraft(e.target.value)} />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!aiEnabled || aiPending || !aiDraft.trim()}
            title={aiEnabled ? "Preencher Situação, Comportamento, Impacto, Próximos passos e Observações a partir do relato" : "IA não configurada (peça ao proprietário do sistema)"}
            onClick={runAi}>
            {aiPending ? "Preenchendo…" : "✨ Preencher com IA"}
          </button>
        </div>
      </div>
      {aiMsg && <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>{aiMsg}</p>}
      <div><label className="label">Situação</label><textarea className="input" rows={2} value={situation} onChange={(e) => setSituation(e.target.value)} /></div>
      <div><label className="label">Comportamento</label><textarea className="input" rows={2} value={behavior} onChange={(e) => setBehavior(e.target.value)} /></div>
      <div><label className="label">Impacto</label><textarea className="input" rows={2} value={impact} onChange={(e) => setImpact(e.target.value)} /></div>
      <div><label className="label">Próximos passos</label><textarea className="input" rows={2} value={nextSteps} onChange={(e) => setNextSteps(e.target.value)} /></div>
      <div><label className="label">Observações</label><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      <div>
        <label className="label">Visibilidade</label>
        <div style={{ display: "flex", gap: "1rem" }}>
          <label style={{ display: "flex", gap: "0.35rem", alignItems: "center", cursor: "pointer" }}><input type="radio" name="vis" checked={visibility === "compartilhado"} onChange={() => setVisibility("compartilhado")} /> Compartilhado com o colaborador</label>
          <label style={{ display: "flex", gap: "0.35rem", alignItems: "center", cursor: "pointer" }}><input type="radio" name="vis" checked={visibility === "privado"} onChange={() => setVisibility("privado")} /> Nota privada</label>
        </div>
        <div className="soft" style={{ fontSize: "0.75rem", marginTop: 4 }}>O colaborador só verá após você marcar o feedback como “Aplicado”.</div>
      </div>
      {competencies.length > 0 && (
        <div>
          <label className="label">Competências</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
            {competencies.map((c) => (
              <button key={c.id} type="button" onClick={() => toggleComp(c.id)} className={compIds.includes(c.id) ? "badge badge-purple" : "badge badge-gray"} style={{ cursor: "pointer", border: "none" }}>{compIds.includes(c.id) ? "✓ " : ""}{c.name}</button>
            ))}
          </div>
        </div>
      )}
      {mode === "edit" && row && row.attachments.length > 0 && (
        <div>
          <label className="label">Anexos atuais</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>{row.attachments.map((a) => <ExistingAttachment key={a.id} att={a} onDeleted={() => router.refresh()} />)}</div>
        </div>
      )}
      <div><label className="label">{mode === "edit" ? "Adicionar anexos" : "Anexos"}</label><input type="file" multiple className="input" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} /></div>
      {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}

// ---------------- Dialog de sessão ----------------
function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const from = `${ym}-01`;
  const last = new Date(y, m, 0).getDate();
  return { from, to: `${ym}-${String(last).padStart(2, "0")}` };
}

function FeedbackSessionDialog({ mode, row, subjectOptions, allFeedbacks, aiEnabled, onClose }: {
  mode: "new" | "edit"; row?: SessionRow; subjectOptions: Opt[]; allFeedbacks: FeedbackRow[]; aiEnabled: boolean; onClose: () => void;
}) {
  const [subjectId, setSubjectId] = useState(row?.subjectId ?? "");
  const [date, setDate] = useState(row?.date ?? today());
  const [refMonth, setRefMonth] = useState(row?.referenceMonth ? row.referenceMonth.slice(0, 7) : thisMonth());
  const [title, setTitle] = useState(row?.title ?? "");
  const [highlights, setHighlights] = useState(row?.highlights ?? "");
  const [development, setDevelopment] = useState(row?.development ?? "");
  const [actionPlan, setActionPlan] = useState(row?.actionPlan ?? "");
  const [overall, setOverall] = useState(row?.overall ?? "");
  const [visibility, setVisibility] = useState<Enums<"feedback_visibility">>(row?.visibility ?? "privado");
  const [itemIds, setItemIds] = useState<string[]>(row?.itemFeedbackIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [aiPending, startAi] = useTransition();
  const router = useRouter();

  // feedbacks pontuais do colaborador no mês de referência (para referenciar / IA)
  const periodFeedbacks = useMemo(() => {
    if (!subjectId) return [];
    const { from, to } = monthRange(refMonth);
    return allFeedbacks.filter((f) => f.subjectId === subjectId && f.date >= from && f.date <= to);
  }, [allFeedbacks, subjectId, refMonth]);
  const toggleItem = (id: string) => setItemIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const runAi = () => {
    if (!subjectId) { setError("Selecione o colaborador antes de gerar o rascunho."); return; }
    setError(null); setAiMsg(null);
    const { from, to } = monthRange(refMonth);
    startAi(async () => {
      const r = await generateFeedbackSessionAI({ subject_user_id: subjectId, from, to });
      if (!("ok" in r) || !r.ok) { setError(r.error); return; }
      setHighlights(r.highlights); setDevelopment(r.development); setActionPlan(r.action_plan);
      setItemIds(periodFeedbacks.map((f) => f.id));
      setAiMsg("Rascunho gerado a partir dos feedbacks do período — revise e edite antes de salvar.");
    });
  };

  const submit = () => {
    if (mode === "new" && !subjectId) { setError("Selecione o colaborador."); return; }
    if (![highlights, development, actionPlan, overall].some((x) => x.trim())) { setError("Preencha ao menos um campo da sessão."); return; }
    const payload = { ...(mode === "edit" ? { id: row!.id } : {}), subject_user_id: subjectId, session_date: date, reference_month: `${refMonth}-01`, title, highlights, development, action_plan: actionPlan, overall, visibility, item_feedback_ids: itemIds };
    start(async () => {
      const r = mode === "edit" ? await updateFeedbackSession(payload) : await createFeedbackSession(payload);
      if (r?.error) { setError(r.error); return; }
      onClose(); router.refresh();
    });
  };

  return (
    <Modal title={mode === "edit" ? "Editar sessão" : "Nova sessão de feedback"} onClose={onClose} footer={<>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>{mode === "edit" ? "Salvar" : "Registrar sessão"}</button>
    </>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.8rem" }}>
        <div>
          <label className="label">Colaborador</label>
          {mode === "edit" ? <input className="input" value={row?.subjectName ?? ""} disabled /> : <SearchSelect options={subjectOptions} value={subjectId} onChange={setSubjectId} placeholder="Buscar…" emptyHint="Nenhum colaborador" />}
        </div>
        <div><label className="label">Data</label><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div><label className="label">Mês de referência</label><MonthInput value={refMonth} onChange={(v) => setRefMonth(v || thisMonth())} /></div>
      </div>

      <div className="card card-pad" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.6rem", background: "var(--bg-subtle, rgba(0,0,0,0.02))" }}>
        <span className="soft" style={{ fontSize: "0.82rem" }}>
          {subjectId ? `${periodFeedbacks.length} feedback(s) pontual(is) no período` : "Selecione o colaborador para consolidar os feedbacks do período"}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!aiEnabled || aiPending || !subjectId} title={aiEnabled ? "Gerar um rascunho com IA a partir dos feedbacks do período" : "IA não configurada (configure a chave OpenAI em Configurações)"} onClick={runAi}>
          {aiPending ? "Gerando…" : "✨ Gerar rascunho com IA"}
        </button>
      </div>
      {aiMsg && <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>{aiMsg}</p>}

      <div><label className="label">Título (opcional)</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Ex.: Feedback de ${refMonth}`} /></div>
      <div><label className="label">Destaques / pontos fortes</label><textarea className="input" rows={3} value={highlights} onChange={(e) => setHighlights(e.target.value)} /></div>
      <div><label className="label">Pontos de desenvolvimento</label><textarea className="input" rows={3} value={development} onChange={(e) => setDevelopment(e.target.value)} /></div>
      <div><label className="label">Plano de ação / combinados</label><textarea className="input" rows={3} value={actionPlan} onChange={(e) => setActionPlan(e.target.value)} /></div>
      <div><label className="label">Avaliação geral (opcional)</label><textarea className="input" rows={2} value={overall} onChange={(e) => setOverall(e.target.value)} /></div>

      {periodFeedbacks.length > 0 && (
        <div>
          <label className="label">Referenciar feedbacks do período</label>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", maxHeight: 160, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: "0.5rem" }}>
            {periodFeedbacks.map((f) => (
              <label key={f.id} style={{ display: "flex", gap: "0.5rem", alignItems: "center", cursor: "pointer", fontSize: "0.85rem" }}>
                <input type="checkbox" checked={itemIds.includes(f.id)} onChange={() => toggleItem(f.id)} />
                <span className="soft">{formatDate(f.date)}</span> · <Badge tone={FEEDBACK_TYPE_TONE[f.type]}>{FEEDBACK_TYPE_LABEL[f.type]}</Badge> {f.title || (f.situation ?? "").slice(0, 40)}
              </label>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="label">Visibilidade</label>
        <div style={{ display: "flex", gap: "1rem" }}>
          <label style={{ display: "flex", gap: "0.35rem", alignItems: "center", cursor: "pointer" }}><input type="radio" name="svis" checked={visibility === "compartilhado"} onChange={() => setVisibility("compartilhado")} /> Compartilhado</label>
          <label style={{ display: "flex", gap: "0.35rem", alignItems: "center", cursor: "pointer" }}><input type="radio" name="svis" checked={visibility === "privado"} onChange={() => setVisibility("privado")} /> Nota privada</label>
        </div>
        <div className="soft" style={{ fontSize: "0.75rem", marginTop: 4 }}>O colaborador só verá após você marcar a sessão como “Aplicada”.</div>
      </div>
      {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}

// ---------------- utils ----------------
function ExistingAttachment({ att, onDeleted }: { att: FeedbackAttachment; onDeleted: () => void }) {
  const [pending, start] = useTransition();
  const remove = async () => { if (!(await confirmDialog({ tone: "danger", confirmLabel: "Excluir", message: `Remover o anexo "${att.filename}"?` }))) return; start(async () => { await deleteFeedbackAttachment({ id: att.id, path: att.path }); onDeleted(); }); };
  return (
    <span className="badge badge-gray" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>📎 {att.filename}
      <button type="button" onClick={remove} disabled={pending} aria-label="Remover" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--mh-danger)", fontSize: "0.9rem", lineHeight: 1 }}>×</button>
    </span>
  );
}

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 60, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 640, boxShadow: "var(--mh-shadow-e3)" }}>
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
