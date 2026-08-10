"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Pencil, Power, Users } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { Tabs, type Tab } from "@/components/ui/Tabs";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { SearchSelect } from "./SearchSelect";
import { ConfirmActionButton } from "@/components/ui/ConfirmActionButton";
import { AgendaDayView } from "./AgendaDayView";
import { AgendaDayCalendar } from "./AgendaDayCalendar";
import { AgendaWeekView } from "./AgendaWeekView";
import { AgendaMonthView } from "./AgendaMonthView";
import { AgendaBuilderDialog } from "./AgendaBuilderDialog";
import { AgendaViewDialog } from "./AgendaViewDialog";
import { AgendaLogDetail, type LogDetailCtx } from "./AgendaLogDetail";
import { AGENDA_STATUS_LABEL, AGENDA_STATUS_TONE } from "@/lib/constants";
import { formatDate, shortName } from "@/lib/format";
import {
  taskOccursOn, checklistTargetsUser, checklistOccurrenceForDate, nonWorkingReason,
  adherenceFromStatuses, pct, dateFromYMD, ymd,
} from "@/lib/agenda-schedule";
import { setLogStatus, toggleAgendaActive, deleteAgenda } from "@/lib/actions/agenda";
import type { AgendaFull, LogRow, ChecklistSchedFull, ChecklistRunLite, DayItem, OrgInfo, PlannerTaskLite } from "@/lib/agenda-types";
import type { Enums } from "@/types/database";

type Opt = { id: string; name: string };

export type AgendaSection = "diario" | "agendas" | "equipe" | "historico";

export function AgendaManager(props: {
  section?: AgendaSection;
  currentUserId: string;
  isAdmin: boolean;
  today: string;
  people: Opt[];
  nameById: Record<string, string>;
  orgByUser: Record<string, OrgInfo>;
  reportIds: string[];
  agendas: AgendaFull[];
  logs: LogRow[];
  checklistScheds: ChecklistSchedFull[];
  plannerTasks: PlannerTaskLite[];
  checklistRuns: ChecklistRunLite[];
  holidays: { day: string; name: string }[];
  logsComAnexoOuComentario?: string[];
}) {
  const section: AgendaSection = props.section ?? "diario";
  const { currentUserId, isAdmin, people, nameById, orgByUser, reportIds, agendas, logs, checklistScheds, checklistRuns, plannerTasks, holidays } = props;
  const router = useRouter();
  const [, start] = useTransition();

  const [todayStr, setTodayStr] = useState(props.today);
  const [meDate, setMeDate] = useState(props.today);
  const [calView, setCalView] = useState<"dia" | "semana" | "mes">("dia");
  useEffect(() => {
    const c = new Date().toLocaleDateString("sv-SE");
    setTodayStr(c);
    setMeDate(c);
  }, []);

  // Diário de bordo de outra pessoa. Começa sempre no próprio usuário; a lista de
  // quem pode ser escolhido repete a regra que o banco já aplica em
  // agenda_can_view: owner/admin alcançam a empresa, gestor alcança a cadeia dele.
  const [subject, setSubject] = useState(currentUserId);

  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<AgendaFull | null>(null);
  const [viewing, setViewing] = useState<AgendaFull | null>(null);
  const [detail, setDetail] = useState<LogDetailCtx | null>(null);
  const [detailCanFill, setDetailCanFill] = useState(true);

  /**
   * Status clicado que ainda não voltou do servidor, por `taskId|data`.
   *
   * O clique custava a ida ao banco MAIS o `router.refresh()`, que rebusca a
   * página inteira; até isso terminar o botão não mudava de cor e a pessoa
   * clicava de novo. Aqui a cor entra na hora, a aderência do dia recalcula
   * junto (é conta local, em cima desta mesma tabela) e a gravação segue atrás.
   * Se o servidor recusar, a entrada é removida e a linha volta ao que era.
   */
  const [statusOtimista, setStatusOtimista] = useState<Record<string, Enums<"agenda_log_status">>>({});
  const chaveStatus = (taskId: string, dateStr: string) => `${taskId}|${dateStr}`;

  // índices
  const logByTaskDate = useMemo(() => {
    const m = new Map<string, LogRow>();
    for (const l of logs) m.set(`${l.taskId}|${l.logDate}`, l);
    return m;
  }, [logs]);

  const comDetalhe = useMemo(() => new Set(props.logsComAnexoOuComentario ?? []), [props.logsComAnexoOuComentario]);

  const doneChkByUser = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of checklistRuns) {
      if (!m.has(r.executorId)) m.set(r.executorId, new Set());
      m.get(r.executorId)!.add(`${r.checklistId}|${r.periodKey}`);
    }
    return m;
  }, [checklistRuns]);

  const taskInfo = useMemo(() => {
    const m = new Map<string, { title: string; agendaName: string; responsibleId: string }>();
    for (const a of agendas) for (const t of a.tasks) m.set(t.id, { title: t.title, agendaName: a.name, responsibleId: a.responsibleId });
    return m;
  }, [agendas]);

  // ----- construção dos itens de um dia para um responsável -----
  const buildDayItems = (subjectUserId: string, dateStr: string): { items: DayItem[]; nonWorking: string | null; reserved: number } => {
    const date = dateFromYMD(dateStr);
    const nonWorking = nonWorkingReason(date, holidays);
    const items: DayItem[] = [];
    let reserved = 0;
    for (const a of agendas) {
      if (!a.active || a.responsibleId !== subjectUserId) continue;
      if (dateStr < a.createdDate) continue; // agenda ainda não existia nessa data
      for (const t of a.tasks) {
        if (!t.active) continue;
        if (!taskOccursOn({ frequency: t.frequency, weekdays: t.weekdays, dayOfMonth: t.dayOfMonth, fixedDate: t.fixedDate }, date)) continue;
        const log = logByTaskDate.get(`${t.id}|${dateStr}`);
        const otimista = statusOtimista[chaveStatus(t.id, dateStr)];
        reserved += t.durationMinutes;
        items.push({
          kind: "task", key: `t-${t.id}`, date: dateStr, title: t.title, agendaName: a.name,
          time: t.flexible ? null : t.scheduledTime, durationMin: t.durationMinutes,
          status: t.flexible ? "feito" : (otimista ?? log?.status ?? "pendente"), note: log?.note ?? null,
          chargeable: !nonWorking, flexible: t.flexible, taskId: t.id, agendaId: a.id, logId: log?.id ?? null,
          hasDetail: !!(log?.note ?? "").trim() || (!!log && comDetalhe.has(log.id)),
        });
      }
    }
    const org = orgByUser[subjectUserId] ?? { positionId: null, departmentId: null };
    const done = doneChkByUser.get(subjectUserId) ?? new Set<string>();
    for (const cs of checklistScheds) {
      if (!checklistTargetsUser(cs.targets, { userId: subjectUserId, positionId: org.positionId, departmentId: org.departmentId })) continue;
      const occ = checklistOccurrenceForDate({ frequency: cs.frequency, fixedDate: cs.fixedDate, weekday: cs.weekday, dayOfMonth: cs.dayOfMonth, runTime: cs.runTime }, date);
      if (!occ) continue;
      const isDone = done.has(`${cs.checklistId}|${occ.periodKey}`);
      items.push({
        kind: "checklist", key: `c-${cs.scheduleId}-${occ.periodKey}`, date: dateStr, title: cs.checklistName, agendaName: "Checklist periódico",
        time: cs.runTime, durationMin: 0, status: isDone ? "feito" : "pendente", note: null,
        chargeable: !nonWorking, checklistId: cs.checklistId, overdue: !isDone && occ.overdue,
      });
    }
    // Tarefas do Planner: INFORMATIVAS. Entram no dia do prazo (e, se
    // vencidas e abertas, no dia de hoje, como cobrança viva), mas com
    // `chargeable: false`, então ficam FORA da aderência de propósito: a
    // aderência mede a rotina pactuada; o Planner é trabalho auto-organizado,
    // e misturar os dois faria o indicador oscilar por fora do pacto.
    for (const pt of plannerTasks) {
      if (!pt.assigneeIds.includes(subjectUserId)) continue;
      const noPrazo = pt.dueDate === dateStr;
      const vencidaHoje = !pt.done && pt.dueDate < dateStr && dateStr === todayStr;
      if (!noPrazo && !vencidaHoje) continue;
      items.push({
        kind: "planner", key: `p-${pt.id}`, date: dateStr, title: pt.title,
        agendaName: pt.boardName, time: null, durationMin: 0,
        status: pt.done ? "feito" : "pendente", note: null,
        chargeable: false, plannerBoardId: pt.boardId, overdue: vencidaHoje,
      });
    }
    items.sort((x, y) => (x.time ?? "99") < (y.time ?? "99") ? -1 : (x.time ?? "99") > (y.time ?? "99") ? 1 : 0);
    return { items, nonWorking, reserved };
  };

  const dayAdherence = (items: DayItem[], nonWorking: string | null): number | null => {
    if (nonWorking) return null;
    return adherenceFromStatuses(items.filter((i) => i.chargeable).map((i) => i.status));
  };

  // aderência de um responsável num intervalo [from, to] (fim limitado a hoje)
  const windowAdherence = (subjectUserId: string, from: Date, to: Date): { adh: number | null; feito: number; total: number } => {
    const statuses: Enums<"agenda_log_status">[] = [];
    let feito = 0;
    const todayDate = dateFromYMD(todayStr);
    const end = to > todayDate ? todayDate : to;
    const cur = new Date(from);
    while (cur <= end) {
      if (!nonWorkingReason(cur, holidays)) {
        const ds = ymd(cur);
        const isPast = ds < todayStr;
        for (const a of agendas) {
          if (!a.active || a.responsibleId !== subjectUserId) continue;
          if (ds < a.createdDate) continue; // não cobra dias anteriores à criação da agenda
          for (const t of a.tasks) {
            if (!t.active) continue;
            if (!taskOccursOn({ frequency: t.frequency, weekdays: t.weekdays, dayOfMonth: t.dayOfMonth, fixedDate: t.fixedDate }, cur)) continue;
            if (t.flexible) { feito++; statuses.push("feito"); continue; } // tempo médio: realizada automaticamente
            const log = logByTaskDate.get(`${t.id}|${ds}`);
            const otimista = statusOtimista[chaveStatus(t.id, ds)];
            let st: Enums<"agenda_log_status">;
            if (otimista && otimista !== "pendente") st = otimista;
            else if (otimista === "pendente") { if (isPast) st = "nao_feito"; else continue; }
            else if (log && log.status !== "pendente") st = log.status;
            else if (isPast) st = "nao_feito"; // dia passado sem marcação = não realizada
            else continue; // hoje ainda não marcado: não conta como falha
            if (st === "feito") feito++;
            statuses.push(st);
          }
        }
      }
      cur.setDate(cur.getDate() + 1);
    }
    return { adh: adherenceFromStatuses(statuses), feito, total: statuses.length };
  };

  // ----- handlers -----
  const onSetStatus = (item: DayItem, status: Enums<"agenda_log_status">, dateStr: string) => {
    if (!item.taskId || !item.agendaId) return;
    const chave = chaveStatus(item.taskId, dateStr);
    setStatusOtimista((m) => ({ ...m, [chave]: status })); // pinta antes de ir ao banco
    start(async () => {
      const r = await setLogStatus({ agenda_id: item.agendaId!, task_id: item.taskId!, log_date: dateStr, status });
      if (r.error) {
        toast.error(r.error);
        setStatusOtimista((m) => { const n = { ...m }; delete n[chave]; return n; });
        return;
      }
      router.refresh();
    });
  };

  const canFillFor = (subjectUserId: string) => isAdmin || subjectUserId === currentUserId || reportIds.includes(subjectUserId);

  const openDetail = (item: DayItem, dateStr: string, canFill: boolean) => {
    if (!item.taskId || !item.agendaId) return;
    setDetailCanFill(canFill);
    setDetail({
      agendaId: item.agendaId, taskId: item.taskId, logDate: dateStr, title: item.title,
      agendaName: item.agendaName, status: item.status, note: item.note, logId: item.logId ?? null,
    });
  };

  const canEditAgenda = (a: AgendaFull) => isAdmin || a.ownerId === currentUserId;

  // ----- de quem é o diário em tela -----
  // Só entram na lista pessoas que têm agenda (como dona ou como responsável):
  // sem agenda o dia vem vazio, e para o owner o seletor viraria o quadro de
  // pessoal inteiro. O próprio usuário aparece sempre, mesmo sem agenda.
  const comAgenda = useMemo(() => {
    const s = new Set<string>();
    for (const a of agendas) { s.add(a.ownerId); s.add(a.responsibleId); }
    return s;
  }, [agendas]);

  const subjectOptions = useMemo(() => {
    const permitidos = isAdmin ? people.map((p) => p.id) : [currentUserId, ...reportIds];
    const vistos = new Set<string>();
    const outros: Opt[] = [];
    for (const id of permitidos) {
      if (id === currentUserId || vistos.has(id) || !comAgenda.has(id)) continue;
      vistos.add(id);
      outros.push({ id, name: nameById[id] ?? "Usuário" });
    }
    outros.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return [{ id: currentUserId, name: "Minha agenda" }, ...outros];
  }, [isAdmin, people, currentUserId, reportIds, comAgenda, nameById]);

  // derivado em vez de efeito: se o escolhido sair da lista (troca de unidade no
  // seletor do topo, agenda inativada), volta sozinho para o próprio usuário
  const subjectId = subjectOptions.some((o) => o.id === subject) ? subject : currentUserId;
  const isMe = subjectId === currentUserId;
  const subjectName = isMe ? "Minha agenda" : (nameById[subjectId] ?? "Colaborador");
  const subjectCanFill = canFillFor(subjectId);

  // ----- aba: Meu dia -----
  const meDay = buildDayItems(subjectId, meDate);
  const meTab = (
    <AgendaDayView
      subjectName={subjectName}
      dateStr={meDate}
      todayStr={todayStr}
      items={meDay.items}
      nonWorking={meDay.nonWorking}
      reservedMin={meDay.reserved}
      canFill={subjectCanFill}
      dayAdherence={dayAdherence(meDay.items, meDay.nonWorking)}
      onChangeDate={(delta) => { const d = dateFromYMD(meDate); d.setDate(d.getDate() + delta); setMeDate(ymd(d)); }}
      onToday={() => setMeDate(todayStr)}
      onSetStatus={(item, status) => onSetStatus(item, status, meDate)}
      onOpenDetail={(item) => openDetail(item, meDate, subjectCanFill)}
    />
  );

  const openItem = (item: DayItem) => {
    if (item.kind === "planner") { router.push(item.plannerBoardId ? `/planner?quadro=${item.plannerBoardId}` : "/planner"); return; }
    if (item.kind === "checklist") { router.push("/checklists"); return; }
    openDetail(item, item.date, subjectCanFill);
  };
  const getDayItems = (ds: string) => { const r = buildDayItems(subjectId, ds); return { items: r.items, nonWorking: r.nonWorking }; };
  const VIEWS: [typeof calView, string][] = [["dia", "Dia"], ["semana", "Semana"], ["mes", "Mês"]];
  const calTab = (
    <div>
      <div style={{ display: "inline-flex", gap: "0.3rem", marginBottom: "0.75rem", border: "1px solid var(--mh-border)", borderRadius: "var(--mh-radius-md)", padding: "0.15rem" }}>
        {VIEWS.map(([v, label]) => (
          <button key={v} type="button" onClick={() => setCalView(v)}
            className={`btn btn-sm ${calView === v ? "btn-primary" : "btn-ghost"}`} style={{ padding: "0.3rem 0.8rem" }}>
            {label}
          </button>
        ))}
      </div>
      {calView === "dia" ? (
        <AgendaDayCalendar
          subjectName={subjectName}
          dateStr={meDate}
          todayStr={todayStr}
          items={meDay.items}
          nonWorking={meDay.nonWorking}
          onChangeDate={(delta) => { const dd = dateFromYMD(meDate); dd.setDate(dd.getDate() + delta); setMeDate(ymd(dd)); }}
          onToday={() => setMeDate(todayStr)}
          onOpenItem={openItem}
        />
      ) : calView === "semana" ? (
        <AgendaWeekView dateStr={meDate} todayStr={todayStr} getDayItems={getDayItems} onSetDate={setMeDate} onToday={() => setMeDate(todayStr)} onOpenItem={openItem} />
      ) : (
        <AgendaMonthView dateStr={meDate} todayStr={todayStr} getDayItems={getDayItems} onSetDate={setMeDate} onToday={() => setMeDate(todayStr)} onOpenItem={openItem} onPickDay={(ds) => { setMeDate(ds); setCalView("dia"); }} />
      )}
    </div>
  );

  // ----- aba: Minhas agendas -----
  const myAgendas = agendas.filter((a) => a.ownerId === currentUserId || a.responsibleId === currentUserId || isAdmin);
  const agendasTab = (
    <Section title={`${myAgendas.length} ${myAgendas.length === 1 ? "agenda" : "agendas"}`} padded={false}>
      {myAgendas.length === 0 ? (
        <EmptyState title="Nenhuma agenda" description="Crie uma agenda de rotina para você ou para um colaborador." />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>Agenda</th><th>Responsável</th><th>Tarefas</th><th>Status</th><th style={{ textAlign: "right" }}>Ações</th></tr></thead>
            <tbody>
              {myAgendas.map((a) => (
                <tr key={a.id} style={{ opacity: a.active ? 1 : 0.55 }}>
                  <td style={{ fontWeight: 600 }}>{a.name}</td>
                  <td className="muted">{shortName(a.responsibleName)}{a.responsibleId !== a.ownerId && <span className="soft"> · de {shortName(a.ownerName)}</span>}</td>
                  <td className="muted">{a.tasks.length}</td>
                  <td><Badge tone={a.active ? "green" : "gray"}>{a.active ? "Ativa" : "Inativa"}</Badge></td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <div style={{ display: "inline-flex", gap: "0.3rem", justifyContent: "flex-end" }}>
                      {/* sem trava de papel: quem enxerga a linha (a RLS decidiu)
                          pode ver o que a agenda cobra. É a única ação que sobra
                          para quem é apenas responsável, e não dono, da agenda. */}
                      <button className="icon-btn" title="Visualizar agenda" aria-label="Visualizar agenda" onClick={() => setViewing(a)}><Eye size={14} /></button>
                      {canEditAgenda(a) && <button className="icon-btn" title="Editar" onClick={() => { setEditing(a); setBuilderOpen(true); }}><Pencil size={14} /></button>}
                      {canEditAgenda(a) && (
                        <button className="icon-btn" title={a.active ? "Inativar" : "Reativar"} onClick={() => start(async () => { const r = await toggleAgendaActive({ id: a.id, active: !a.active }); if (r.error) toast.error(r.error); else router.refresh(); })}><Power size={14} /></button>
                      )}
                      {canEditAgenda(a) && (
                        <ConfirmActionButton action={deleteAgenda} fields={{ id: a.id }} className="icon-btn icon-btn-danger" buttonTitle="Excluir"
                          title="Excluir agenda" message={<>Excluir <strong>{a.name}</strong> e todo o histórico de execuções?</>} confirmLabel="Excluir">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                        </ConfirmActionButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );

  // ----- aba: Equipe -----
  const [showAllTeam, setShowAllTeam] = useState(false);
  const [teamPeriod, setTeamPeriod] = useState<"mes" | "semana" | "hoje" | "mes_passado" | "custom">("mes");
  const [teamFrom, setTeamFrom] = useState("");
  const [teamTo, setTeamTo] = useState("");
  const teamRange: [Date, Date] = (() => {
    const t = dateFromYMD(todayStr);
    switch (teamPeriod) {
      case "hoje": return [t, t];
      case "semana": { const s = new Date(t); s.setDate(t.getDate() - t.getDay()); return [s, t]; }
      case "mes_passado": return [new Date(t.getFullYear(), t.getMonth() - 1, 1, 12), new Date(t.getFullYear(), t.getMonth(), 0, 12)];
      case "custom": return [teamFrom ? dateFromYMD(teamFrom) : new Date(t.getFullYear(), t.getMonth(), 1, 12), teamTo ? dateFromYMD(teamTo) : t];
      default: return [new Date(t.getFullYear(), t.getMonth(), 1, 12), t]; // mês atual
    }
  })();
  const teamPeopleIds = isAdmin && showAllTeam
    ? people.map((p) => p.id).filter((id) => id !== currentUserId)
    : reportIds;
  const teamPeople = teamPeopleIds.map((id) => ({ id, name: nameById[id] ?? "Usuário" }));
  const [teamUser, setTeamUser] = useState<string>("");
  const [teamDate, setTeamDate] = useState(props.today);
  useEffect(() => { setTeamDate(todayStr); }, [todayStr]);
  useEffect(() => {
    if (teamPeople.length === 0) { if (teamUser) setTeamUser(""); return; }
    if (!teamUser || !teamPeopleIds.includes(teamUser)) setTeamUser(teamPeople[0].id);
  }, [teamPeople, teamPeopleIds, teamUser]);

  const teamDay = teamUser ? buildDayItems(teamUser, teamDate) : null;
  const teamTab = (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <Section
        title="Aderência da equipe"
        padded={false}
        action={
          <div style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <select className="select" value={teamPeriod} onChange={(e) => setTeamPeriod(e.target.value as typeof teamPeriod)} style={{ width: "auto" }} title="Período">
              <option value="mes">Mês atual</option>
              <option value="semana">Semana atual</option>
              <option value="hoje">Hoje</option>
              <option value="mes_passado">Mês passado</option>
              <option value="custom">Período personalizado</option>
            </select>
            {teamPeriod === "custom" && (
              <>
                <input type="date" className="input" value={teamFrom} onChange={(e) => setTeamFrom(e.target.value)} style={{ width: 148 }} title="De" />
                <input type="date" className="input" value={teamTo} onChange={(e) => setTeamTo(e.target.value)} style={{ width: 148 }} title="Até" />
              </>
            )}
            {isAdmin && (
              <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.82rem" }} className="soft">
                <input type="checkbox" checked={showAllTeam} onChange={(e) => setShowAllTeam(e.target.checked)} />
                Ver todos
              </label>
            )}
          </div>
        }
      >
        {teamPeople.length === 0 ? (
          <EmptyState title="Sem colaboradores" description={isAdmin ? "Você não gerencia colaboradores diretamente. Marque “Ver todos os colaboradores” para visualizar toda a empresa." : "Você ainda não gerencia colaboradores com agenda."} />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th>Colaborador</th><th>Aderência</th><th>Realizadas</th><th>Tarefas planejadas</th><th style={{ textAlign: "right" }}></th></tr></thead>
              <tbody>
                {teamPeople.map((p) => {
                  const w = windowAdherence(p.id, teamRange[0], teamRange[1]);
                  const tone = w.adh == null ? "gray" : w.adh >= 0.85 ? "green" : w.adh >= 0.6 ? "amber" : "red";
                  return (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{shortName(p.name)}</td>
                      <td><Badge tone={tone}>{pct(w.adh)}</Badge></td>
                      <td className="muted">{w.feito}</td>
                      <td className="muted">{w.total}</td>
                      <td style={{ textAlign: "right" }}><button className="btn btn-ghost btn-sm" onClick={() => setTeamUser(p.id)}>Ver dia</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      {teamUser && teamDay && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.6rem" }}>
            <span className="soft" style={{ fontSize: "0.82rem" }}>Colaborador:</span>
            <div style={{ minWidth: 220 }}><SearchSelect options={teamPeople} value={teamUser} onChange={setTeamUser} placeholder="Selecionar…" /></div>
          </div>
          <AgendaDayView
            subjectName={nameById[teamUser] ?? "Colaborador"}
            dateStr={teamDate}
            todayStr={todayStr}
            items={teamDay.items}
            nonWorking={teamDay.nonWorking}
            reservedMin={teamDay.reserved}
            canFill={canFillFor(teamUser)}
            dayAdherence={dayAdherence(teamDay.items, teamDay.nonWorking)}
            onChangeDate={(delta) => { const d = dateFromYMD(teamDate); d.setDate(d.getDate() + delta); setTeamDate(ymd(d)); }}
            onToday={() => setTeamDate(todayStr)}
            onSetStatus={(item, status) => onSetStatus(item, status, teamDate)}
            onOpenDetail={(item) => openDetail(item, teamDate, canFillFor(teamUser))}
          />
        </div>
      )}
    </div>
  );

  // ----- aba: Histórico -----
  const [hStatus, setHStatus] = useState("");
  const [hPerson, setHPerson] = useState("");
  const [hFrom, setHFrom] = useState("");
  const [hTo, setHTo] = useState("");
  const historyRows = useMemo(() => {
    return logs
      .filter((l) => l.status !== "pendente")
      .map((l) => ({ log: l, info: taskInfo.get(l.taskId) }))
      .filter((r) => !!r.info)
      .filter((r) => !hStatus || r.log.status === hStatus)
      .filter((r) => !hPerson || r.info!.responsibleId === hPerson)
      .filter((r) => !hFrom || r.log.logDate >= hFrom)
      .filter((r) => !hTo || r.log.logDate <= hTo)
      .sort((a, b) => (a.log.logDate < b.log.logDate ? 1 : -1));
  }, [logs, taskInfo, hStatus, hPerson, hFrom, hTo]);
  const historyTab = (
    <Section title={`${historyRows.length} ${historyRows.length === 1 ? "registro" : "registros"}`} padded={false}>
      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", padding: "0.85rem 1.1rem", borderBottom: "1px solid var(--mh-border)" }}>
        <select className="select" value={hStatus} onChange={(e) => setHStatus(e.target.value)} style={{ width: "auto" }}>
          <option value="">Todo status</option>
          {(["feito", "parcial", "nao_feito"] as Enums<"agenda_log_status">[]).map((s) => <option key={s} value={s}>{AGENDA_STATUS_LABEL[s]}</option>)}
        </select>
        <select className="select" value={hPerson} onChange={(e) => setHPerson(e.target.value)} style={{ width: "auto", maxWidth: 220 }}>
          <option value="">Todos os responsáveis</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input type="date" className="input" value={hFrom} onChange={(e) => setHFrom(e.target.value)} style={{ width: 160 }} />
        <input type="date" className="input" value={hTo} onChange={(e) => setHTo(e.target.value)} style={{ width: 160 }} />
      </div>
      {historyRows.length === 0 ? (
        <EmptyState title="Sem registros" description="As execuções marcadas aparecerão aqui." />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>Data</th><th>Responsável</th><th>Agenda</th><th>Tarefa</th><th>Status</th><th>Observação</th></tr></thead>
            <tbody>
              {historyRows.map(({ log, info }) => (
                <tr key={log.id}>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{formatDate(log.logDate)}</td>
                  <td className="muted">{shortName(nameById[info!.responsibleId] ?? "—")}</td>
                  <td className="muted">{info!.agendaName}</td>
                  <td>{info!.title}</td>
                  <td><Badge tone={AGENDA_STATUS_TONE[log.status]}>{AGENDA_STATUS_LABEL[log.status]}</Badge></td>
                  <td className="muted" style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={log.note ?? ""}>{log.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );

  const HEADERS: Record<AgendaSection, { title: string; subtitle: string }> = {
    diario: {
      title: "Diário de bordo",
      subtitle: isMe
        ? "Sua rotina do dia, com aderência e integração aos checklists."
        : `Rotina de ${subjectName}, com aderência e integração aos checklists.`,
    },
    agendas: { title: "Agendas", subtitle: "Crie e gerencie as agendas de rotina, suas e da sua equipe." },
    equipe: { title: "Equipe", subtitle: "Aderência e rotina dos colaboradores que você gerencia." },
    historico: { title: "Histórico", subtitle: "Execuções registradas das rotinas." },
  };
  const diarioTabs: Tab[] = [
    { id: "dia", label: "Hoje", content: meTab },
    { id: "calendario", label: "Calendário", content: calTab },
  ];

  // o seletor só aparece para quem alcança mais alguém; para o colaborador comum
  // a tela continua exatamente como era
  // select nativo, não SearchSelect: aquele só abre a lista quando está vazio, e
  // este filtro nunca fica vazio (sem escolha, volta para o próprio usuário)
  const seletorDeDiario = section === "diario" && subjectOptions.length > 1 && (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem" }}>
      <span className="soft" style={{ fontSize: "0.82rem", whiteSpace: "nowrap" }}>Diário de:</span>
      <select
        className="select"
        value={subjectId}
        onChange={(e) => setSubject(e.target.value)}
        style={{ width: "auto", maxWidth: 260 }}
        title="Escolha de quem é o diário de bordo em tela"
      >
        {subjectOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  );

  return (
    <div>
      <PageHeader
        title={HEADERS[section].title}
        subtitle={HEADERS[section].subtitle}
        action={section === "diario" || section === "agendas"
          ? (
            <div style={{ display: "inline-flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
              {seletorDeDiario}
              <button className="btn btn-primary" onClick={() => { setEditing(null); setBuilderOpen(true); }}><Users size={15} /> Nova agenda</button>
            </div>
          )
          : undefined}
      />
      {section === "diario" && <Tabs tabs={diarioTabs} />}
      {section === "agendas" && agendasTab}
      {section === "equipe" && teamTab}
      {section === "historico" && historyTab}

      <AgendaViewDialog agenda={viewing} onClose={() => setViewing(null)} />
      <AgendaBuilderDialog open={builderOpen} onClose={() => setBuilderOpen(false)} agenda={editing} people={people} currentUserId={currentUserId} />
      <AgendaLogDetail ctx={detail} onClose={() => setDetail(null)} canFill={detailCanFill} nameById={nameById} />
    </div>
  );
}
