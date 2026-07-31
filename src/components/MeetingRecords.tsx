"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { Tabs } from "@/components/ui/Tabs";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PERIODICITY } from "@/lib/constants";
import { formatDate, formatTime, formatDateTime, formatDuration } from "@/lib/format";
import { toggleSeries, deleteSeries, deleteOccurrence, startOccurrence, anticipateOccurrence, cancelOccurrence, loadMoreOccurrences, type OccurrenceDraft } from "@/lib/actions/meeting-records";
import { OCC_PAGE_SIZE } from "@/lib/constants";
import { ConfirmActionButton } from "@/components/ui/ConfirmActionButton";
import { SeriesDialog, type SeriesData, type Room, type Unit } from "./SeriesDialog";
import { RegisterDialog } from "./RegisterDialog";
import { MeetingRecordingsViewer } from "./MeetingRecordingsViewer";
import { MeetingOccurrenceDetail } from "./MeetingOccurrenceDetail";
import { MeetingFollowDialog } from "./MeetingFollowDialog";
import { SeriesViewDialog } from "./SeriesViewDialog";
import { StartMeetingDialog } from "./StartMeetingDialog";
import { SearchSelect } from "./SearchSelect";
import { ElapsedTimer } from "./ElapsedTimer";
import type { Opt, SecaoOpt, BlocoOpt, ItemOpt } from "./ActionDialog";
import type { Person } from "./PeoplePicker";
import type { Enums } from "@/types/database";
import { Filter, Globe } from "lucide-react";
import { toast } from "sonner";

export type OccStatus = "in_progress" | "finished" | "cancelled";
export type SeriesRow = SeriesData & { isActive: boolean; lastHeldDate: string | null };
export type OccurrenceRow = {
  id: string;
  seriesId: string;
  seriesName: string;
  occurredOn: string;
  status: OccStatus;
  autoFinished: boolean;
  meetingLink: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  draft: OccurrenceDraft | null;
  presentCount: number;
  totalCount: number;
  actionsCount: number;
  recordingsCount: number;
  registeredById: string | null;
  registeredByName: string | null;
};

const OCC_STATUS: Record<OccStatus, { label: string; tone: "green" | "red" | "blue" }> = {
  in_progress: { label: "Em andamento", tone: "blue" },
  finished: { label: "Finalizada", tone: "green" },
  cancelled: { label: "Cancelada", tone: "red" },
};

const ICON = {
  edit: "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z|m15 5 4 4",
  power: "M12 2v10|M18.36 6.64a9 9 0 1 1-12.73 0",
  trash: "M3 6h18|M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6|M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2|M10 11v6|M14 11v6",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z|M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
};
function Ico({ d }: { d: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {d.split("|").map((p, i) => <path key={i} d={p.trim()} />)}
    </svg>
  );
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function MeetingRecords({
  series,
  occurrences,
  people,
  rooms,
  units,
  pilares,
  secoes,
  blocos,
  itens,
  kpis,
  tools,
  aiEnabled,
  currentUserId,
  role,
}: {
  series: SeriesRow[];
  occurrences: OccurrenceRow[];
  people: Person[];
  rooms: Room[];
  units: Unit[];
  pilares: Opt[];
  secoes: SecaoOpt[];
  blocos: BlocoOpt[];
  itens: ItemOpt[];
  kpis: Opt[];
  tools: Opt[];
  aiEnabled: boolean;
  currentUserId: string;
  role: Enums<"member_role">;
}) {
  // criação de reunião restrita a owner/admin/manager (member não cria)
  const canCreate = role === "owner" || role === "admin" || role === "manager";
  // dono, gerencial (manager) e owner sempre; pública → admin também; privada → participantes também. Criador não edita.
  const canEditSeries = (s: SeriesRow) =>
    role === "owner" || role === "manager"
    || s.ownerUserId === currentUserId
    || (s.isPrivate ? s.participantIds.includes(currentUserId) : role === "admin");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [seriesOpen, setSeriesOpen] = useState(false);
  const [editing, setEditing] = useState<SeriesData | undefined>(undefined);
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishOcc, setFinishOcc] = useState<OccurrenceRow | null>(null);
  const [viewerOcc, setViewerOcc] = useState<OccurrenceRow | null>(null);
  const [detailOcc, setDetailOcc] = useState<OccurrenceRow | null>(null);
  const [followOcc, setFollowOcc] = useState<OccurrenceRow | null>(null);
  const [viewSeries, setViewSeries] = useState<SeriesRow | null>(null);
  const [overtimeOcc, setOvertimeOcc] = useState<OccurrenceRow | null>(null);
  const [snoozes, setSnoozes] = useState<Record<string, number>>({});
  const [drafts, setDrafts] = useState<Record<string, OccurrenceDraft>>({});

  // filtros — reuniões cadastradas (padrão: só ativas)
  const [seriesFiltersOpen, setSeriesFiltersOpen] = useState(false);
  const [recFiltersOpen, setRecFiltersOpen] = useState(false);
  const [seriesQuery, setSeriesQuery] = useState("");
  const [seriesStatus, setSeriesStatus] = useState<"all" | "active" | "inactive">("active");
  const [seriesPeriod, setSeriesPeriod] = useState("all");
  // unidade: filtrada pelo seletor global do topo, não por esta tela
  const [seriesResp, setSeriesResp] = useState("all");
  const [seriesPart, setSeriesPart] = useState("all");
  // filtros — registros
  const [recQuery, setRecQuery] = useState("");
  const [recSeries, setRecSeries] = useState("all");
  const [recResp, setRecResp] = useState("all");
  const [recPeriod, setRecPeriod] = useState("all");
  const [recPart, setRecPart] = useState("all");
  const [recFrom, setRecFrom] = useState("");
  const [recTo, setRecTo] = useState("");

  const seriesById = useMemo(() => new Map(series.map((s) => [s.id, s])), [series]);
  const personName = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const respOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of series) if (s.ownerUserId) m.set(s.ownerUserId, s.ownerUserName ?? personName.get(s.ownerUserId) ?? "—");
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [series, personName]);
  const partOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of series) for (const id of s.participantIds ?? []) if (!m.has(id)) m.set(id, personName.get(id) ?? "—");
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [series, personName]);

  // "Carregar mais" preservando o estado da tela (abas/filtros/rascunhos)
  const [occ, setOcc] = useState(occurrences);
  const [noMore, setNoMore] = useState(occurrences.length < OCC_PAGE_SIZE);
  const [moreLoading, startMore] = useTransition();
  useEffect(() => { setOcc(occurrences); setNoMore(occurrences.length < OCC_PAGE_SIZE); }, [occurrences]);
  const loadMore = () => startMore(async () => {
    const next = await loadMoreOccurrences(occ.length);
    setOcc((cur) => [...cur, ...next]);
    if (next.length < OCC_PAGE_SIZE) setNoMore(true);
  });

  const inProgress = useMemo(() => occ.filter((o) => o.status === "in_progress"), [occ]);
  const inProgressBySeries = useMemo(() => new Map(inProgress.map((o) => [o.seriesId, o])), [inProgress]);
  const history = useMemo(() => occ.filter((o) => o.status !== "in_progress"), [occ]);

  // duração prevista (min) de uma reunião a partir da série
  const plannedMin = (s: SeriesRow | undefined) => (s ? (s.durationMin ?? 0) * (s.durationUnit === "h" ? 60 : 1) : 0);
  const plannedLabel = (s: SeriesRow | undefined) => (s && s.durationUnit === "h" ? `${s.durationMin}h` : `${plannedMin(s)} min`);

  // alerta de estouro de tempo: para quem iniciou a reunião ou é dono; reavisa a cada 15 min até finalizar
  useEffect(() => {
    if (inProgress.length === 0) return;
    const tick = () => {
      setOvertimeOcc((cur) => {
        if (cur) return cur; // já há um alerta aberto
        const now = Date.now();
        for (const o of inProgress) {
          const s = seriesById.get(o.seriesId);
          if (!s || !o.startedAt) continue;
          const mine = o.registeredById === currentUserId || s.ownerUserId === currentUserId;
          if (!mine) continue;
          const planned = plannedMin(s);
          if (planned <= 0) continue;
          const elapsedMin = (now - new Date(o.startedAt).getTime()) / 60000;
          if (elapsedMin >= planned && now >= (snoozes[o.id] ?? 0)) return o;
        }
        return null;
      });
    };
    tick();
    const t = setInterval(tick, 30000);
    return () => clearInterval(t);
  }, [inProgress, seriesById, currentUserId, snoozes]);

  const openCreate = () => { setEditing(undefined); setSeriesOpen(true); };
  const openEdit = (s: SeriesRow) => { setEditing(s); setSeriesOpen(true); };
  const openFinish = (o: OccurrenceRow) => { setFinishOcc(o); setFinishOpen(true); };
  const [confirmStart, setConfirmStart] = useState<SeriesRow | null>(null);
  // quando true, o início é antes da data agendada → fluxo de antecipação (pede a próxima reunião)
  const [anticipating, setAnticipating] = useState(false);
  const doStart = (s: SeriesRow) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const d = new Date();
    const todayStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    setAnticipating(!!(s.nextDate && s.nextDate > todayStr));
    setConfirmStart(s);
  };

  const runStart = (roomId: string, link: string, nextDate?: string, nextTime?: string) => {
    const s = confirmStart;
    if (!s) return;
    start(async () => {
      const r = anticipating && nextDate
        ? await anticipateOccurrence(s.id, { roomId: roomId || null, link, nextDate, nextTime })
        : await startOccurrence(s.id, { roomId: roomId || null, link });
      if (r.error) { toast.error(r.error); return; } // mantém o diálogo aberto p/ trocar a sala
      setConfirmStart(null);
      router.refresh();
    });
  };
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const doCancel = (id: string) => setConfirmCancel(id);
  const runCancel = () => {
    const id = confirmCancel;
    if (!id) return;
    start(async () => {
      const r = await cancelOccurrence(id);
      setConfirmCancel(null);
      if (r.error) { toast.error(r.error); return; }
      router.refresh();
    });
  };

  const filteredSeries = useMemo(() => {
    const q = norm(seriesQuery.trim());
    return series.filter((s) => {
      if (seriesStatus === "active" && !s.isActive) return false;
      if (seriesStatus === "inactive" && s.isActive) return false;
      if (seriesPeriod !== "all" && s.periodicity !== seriesPeriod) return false;
      if (seriesResp !== "all" && s.ownerUserId !== seriesResp) return false;
      if (seriesPart !== "all" && !(s.participantIds ?? []).includes(seriesPart)) return false;
      if (!q) return true;
      const hay = norm([s.name, s.owner ?? "", s.ownerUserName ?? "", ...(s.unitNames ?? []), PERIODICITY[s.periodicity as keyof typeof PERIODICITY]].join(" "));
      return hay.includes(q);
    });
  }, [series, seriesQuery, seriesStatus, seriesPeriod, seriesResp, seriesPart]);

  const filteredOcc = useMemo(() => {
    const q = norm(recQuery.trim());
    return history.filter((o) => {
      if (recSeries !== "all" && o.seriesId !== recSeries) return false;
      if (recFrom && o.occurredOn < recFrom) return false;
      if (recTo && o.occurredOn > recTo) return false;
      const s = seriesById.get(o.seriesId);
      if (recResp !== "all" && s?.ownerUserId !== recResp) return false;
      if (recPeriod !== "all" && s?.periodicity !== recPeriod) return false;
      if (recPart !== "all" && !(s?.participantIds ?? []).includes(recPart)) return false;
      if (!q) return true;
      return norm(`${o.seriesName} ${o.registeredByName ?? ""}`).includes(q);
    });
  }, [history, recQuery, recSeries, recFrom, recTo, recResp, recPeriod, recPart, seriesById]);

  const filterFieldStyle = { display: "flex", flexDirection: "column", gap: "0.3rem" } as const;
  const filterPanelStyle = { padding: "1rem 1.25rem", borderBottom: "1px solid var(--mh-border)", background: "var(--mh-surface-2)" } as const;
  const filterGridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0.85rem" } as const;

  const seriesActive = [seriesResp !== "all", seriesPeriod !== "all", seriesPart !== "all", seriesStatus !== "active"].filter(Boolean).length;
  const clearSeries = () => { setSeriesResp("all"); setSeriesPeriod("all"); setSeriesPart("all"); setSeriesStatus("active"); };
  const recActive = [recQuery.trim(), recSeries !== "all", recResp !== "all", recPeriod !== "all", recPart !== "all", recFrom, recTo].filter(Boolean).length;
  const clearRec = () => { setRecQuery(""); setRecSeries("all"); setRecResp("all"); setRecPeriod("all"); setRecPart("all"); setRecFrom(""); setRecTo(""); };

  const seriesTab = (
    <Section
      title={`Reuniões cadastradas · ${filteredSeries.length}${filteredSeries.length !== series.length ? ` de ${series.length}` : ""}`}
      padded={false}
      action={series.length > 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flex: 1, justifyContent: "flex-end", minWidth: 0 }}>
          <input className="input" placeholder="Buscar por nome, dono, unidade…" value={seriesQuery} onChange={(e) => setSeriesQuery(e.target.value)} style={{ flex: 1, maxWidth: 420, minWidth: 0 }} />
          {seriesActive > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearSeries}>Limpar filtros</button>
          )}
          <button
            type="button"
            className={`btn btn-sm ${seriesFiltersOpen || seriesActive > 0 ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setSeriesFiltersOpen((v) => !v)}
            style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}
          >
            <Filter size={15} />
            Filtros
            {seriesActive > 0 && <Badge tone="blue">{seriesActive}</Badge>}
          </button>
        </div>
      ) : undefined}
    >
      {series.length > 0 && seriesFiltersOpen && (
        <div style={filterPanelStyle}>
          <div style={filterGridStyle}>
            {respOptions.length > 0 && (
              <div style={filterFieldStyle}>
                <span className="label" style={{ margin: 0 }}>Responsável</span>
                <select className="select" value={seriesResp} onChange={(e) => setSeriesResp(e.target.value)}>
                  <option value="all">Todos</option>
                  {respOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            )}
            <div style={filterFieldStyle}>
              <span className="label" style={{ margin: 0 }}>Frequência</span>
              <select className="select" value={seriesPeriod} onChange={(e) => setSeriesPeriod(e.target.value)}>
                <option value="all">Todas</option>
                {(Object.entries(PERIODICITY) as [string, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            {partOptions.length > 0 && (
              <div style={filterFieldStyle}>
                <span className="label" style={{ margin: 0 }}>Participante</span>
                <SearchSelect options={partOptions} value={seriesPart === "all" ? "" : seriesPart} onChange={(id) => setSeriesPart(id || "all")} placeholder="Participante…" emptyHint="Nenhum participante" />
              </div>
            )}
            <div style={filterFieldStyle}>
              <span className="label" style={{ margin: 0 }}>Status</span>
              <select className="select" value={seriesStatus} onChange={(e) => setSeriesStatus(e.target.value as "all" | "active" | "inactive")}>
                <option value="active">Ativas</option>
                <option value="inactive">Inativas</option>
                <option value="all">Ativas e inativas</option>
              </select>
            </div>
          </div>
        </div>
      )}
      {series.length === 0 ? (
        <EmptyState title="Nenhuma reunião cadastrada" description="Cadastre as reuniões recorrentes da empresa para começar a registrar os acontecimentos." />
      ) : filteredSeries.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>Reunião</th>
              <th>Dono</th>
              <th>Periodicidade</th>
              <th>Unidades</th>
              <th>Última realizada</th>
              <th>Próxima</th>
              <th>Participantes</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filteredSeries.map((s) => (
              <tr key={s.id} style={{ opacity: s.isActive ? 1 : 0.55 }}>
                <td style={{ fontWeight: 600 }}>{s.name}{s.isPrivate && <Badge tone="purple">Privada</Badge>}</td>
                <td className="muted">{s.ownerUserName ?? s.owner ?? "—"}</td>
                <td className="muted">{PERIODICITY[s.periodicity as keyof typeof PERIODICITY]}</td>
                <td className="muted">
                  {(s.unitNames ?? []).length === 0
                    ? "—"
                    : units.length > 0 && s.unitNames.length === units.length
                      ? "Todas"
                      : s.unitNames.join(", ")}
                </td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{s.lastHeldDate ? formatDateTime(s.lastHeldDate) : "—"}</td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{s.nextDate ? `${formatDate(s.nextDate)}${s.startTime ? " " + s.startTime.slice(0, 5) : ""}` : "—"}</td>
                <td className="muted">{s.participantIds.length}</td>
                <td><Badge tone={s.isActive ? "green" : "gray"}>{s.isActive ? "Ativa" : "Inativa"}</Badge></td>
                <td style={{ textAlign: "right" }}>
                  <div style={{ display: "inline-flex", gap: "0.3rem", justifyContent: "flex-end", alignItems: "center" }}>
                    {s.isActive && (
                      inProgressBySeries.has(s.id) ? (
                        <button className="btn btn-sm" style={{ background: "var(--blue-50, var(--mh-info-soft))", color: "var(--mh-info)", border: "1px solid color-mix(in srgb, var(--mh-info) 32%, transparent)" }} onClick={() => openFinish(inProgressBySeries.get(s.id)!)}>● Em andamento</button>
                      ) : (
                        <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => doStart(s)}>Iniciar</button>
                      )
                    )}
                    <button className="icon-btn" title="Ver informações da reunião" onClick={() => setViewSeries(s)}><Ico d={ICON.eye} /></button>
                    {canEditSeries(s) && (
                      <>
                        <button className="icon-btn" title="Editar" onClick={() => openEdit(s)}><Ico d={ICON.edit} /></button>
                        <form action={toggleSeries} style={{ display: "inline-flex" }}>
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="is_active" value={String(s.isActive)} />
                          <button className="icon-btn" type="submit" title={s.isActive ? "Inativar" : "Ativar"}><Ico d={ICON.power} /></button>
                        </form>
                        <ConfirmActionButton
                          action={deleteSeries}
                          fields={{ id: s.id }}
                          className="icon-btn icon-btn-danger"
                          buttonTitle="Excluir"
                          title="Excluir reunião (TOR)"
                          message={<>Excluir <strong>{s.name}</strong>? Todo o histórico de registros dessa série será removido.</>}
                          confirmLabel="Excluir"
                        >
                          <Ico d={ICON.trash} />
                        </ConfirmActionButton>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState title="Nenhuma reunião encontrada" description="Tente outro termo de busca ou filtro." />
      )}
    </Section>
  );

  const recordsTab = (
    <Section
      title={`Registros · ${filteredOcc.length}${filteredOcc.length !== history.length ? ` de ${history.length}` : ""}`}
      padded={false}
      action={history.length > 0 ? (
        <div style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
          {recActive > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearRec}>Limpar filtros</button>
          )}
          <button
            type="button"
            className={`btn btn-sm ${recFiltersOpen || recActive > 0 ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setRecFiltersOpen((v) => !v)}
            style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
          >
            <Filter size={15} />
            Filtros
            {recActive > 0 && <Badge tone="blue">{recActive}</Badge>}
          </button>
        </div>
      ) : undefined}
    >
      {history.length > 0 && recFiltersOpen && (
        <div style={filterPanelStyle}>
          <div style={filterGridStyle}>
            <div style={filterFieldStyle}>
              <span className="label" style={{ margin: 0 }}>Buscar</span>
              <input className="input" placeholder="Reunião, registrado por…" value={recQuery} onChange={(e) => setRecQuery(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div style={filterFieldStyle}>
              <span className="label" style={{ margin: 0 }}>Reunião</span>
              <select className="select" value={recSeries} onChange={(e) => setRecSeries(e.target.value)}>
                <option value="all">Todas</option>
                {series.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            {respOptions.length > 0 && (
              <div style={filterFieldStyle}>
                <span className="label" style={{ margin: 0 }}>Responsável</span>
                <select className="select" value={recResp} onChange={(e) => setRecResp(e.target.value)}>
                  <option value="all">Todos</option>
                  {respOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            )}
            <div style={filterFieldStyle}>
              <span className="label" style={{ margin: 0 }}>Frequência</span>
              <select className="select" value={recPeriod} onChange={(e) => setRecPeriod(e.target.value)}>
                <option value="all">Todas</option>
                {(Object.entries(PERIODICITY) as [string, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            {partOptions.length > 0 && (
              <div style={filterFieldStyle}>
                <span className="label" style={{ margin: 0 }}>Participante</span>
                <SearchSelect options={partOptions} value={recPart === "all" ? "" : recPart} onChange={(id) => setRecPart(id || "all")} placeholder="Participante…" emptyHint="Nenhum participante" />
              </div>
            )}
            <div style={filterFieldStyle}>
              <span className="label" style={{ margin: 0 }}>Data de</span>
              <input type="date" className="input" value={recFrom} onChange={(e) => setRecFrom(e.target.value)} />
            </div>
            <div style={filterFieldStyle}>
              <span className="label" style={{ margin: 0 }}>Data até</span>
              <input type="date" className="input" value={recTo} onChange={(e) => setRecTo(e.target.value)} />
            </div>
          </div>
        </div>
      )}
      {history.length === 0 ? (
        <EmptyState title="Nenhum registro" description="Quando uma reunião acontecer, clique em “Iniciar” na aba de reuniões cadastradas e depois finalize-a." />
      ) : filteredOcc.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>Reunião</th>
              <th>Dono</th>
              <th>Data</th>
              <th>Duração</th>
              <th>Presença</th>
              <th>Ações</th>
              <th>Status</th>
              <th>Registrado por</th>
              <th style={{ textAlign: "right" }}></th>
            </tr>
          </thead>
          <tbody>
            {filteredOcc.map((o) => (
              <tr key={o.id} style={{ opacity: o.status === "cancelled" ? 0.6 : 1 }}>
                <td style={{ fontWeight: 600 }}>
                  <button type="button" onClick={() => setDetailOcc(o)} title="Ver detalhes da reunião" style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 600, color: "var(--mh-primary-600, var(--text))", cursor: "pointer", textAlign: "left" }}>
                    {o.seriesName}
                  </button>
                </td>
                <td className="muted">{seriesById.get(o.seriesId)?.ownerUserName ?? seriesById.get(o.seriesId)?.owner ?? "—"}</td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{o.startedAt ? formatDateTime(o.startedAt) : formatDate(o.occurredOn)}</td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{o.status === "cancelled" ? "—" : formatDuration(o.durationSeconds)}</td>
                <td className="muted">{o.presentCount}/{o.totalCount}</td>
                <td className="muted">{o.actionsCount > 0 ? <Badge tone="blue">{o.actionsCount}</Badge> : "—"}</td>
                <td>
                  <Badge tone={OCC_STATUS[o.status].tone}>{OCC_STATUS[o.status].label}</Badge>
                  {o.autoFinished && <Badge tone="amber">Automática</Badge>}
                </td>
                <td className="muted">{o.registeredByName ?? "—"}</td>
                <td style={{ textAlign: "right" }}>
                  <div style={{ display: "inline-flex", gap: "0.3rem", justifyContent: "flex-end", alignItems: "center" }}>
                    <button type="button" className="icon-btn" title="Ver detalhes" onClick={() => setDetailOcc(o)}><Ico d={ICON.eye} /></button>
                    {o.recordingsCount > 0 && (
                      <button type="button" className="icon-btn" title={`Gravações (${o.recordingsCount})`} onClick={() => setViewerOcc(o)}>🎙</button>
                    )}
                    <ConfirmActionButton
                      action={deleteOccurrence}
                      fields={{ id: o.id }}
                      className="icon-btn icon-btn-danger"
                      buttonTitle="Excluir registro"
                      title="Excluir registro"
                      message="Excluir este registro de reunião?"
                      confirmLabel="Excluir"
                    >
                      <Ico d={ICON.trash} />
                    </ConfirmActionButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState title="Nenhum registro encontrado" description="Tente outro termo de busca ou ajuste o período." />
      )}
      {!noMore && (
        <div style={{ textAlign: "center", marginTop: "1rem" }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={moreLoading} onClick={loadMore}>
            {moreLoading ? "Carregando…" : "Carregar mais registros"}
          </button>
        </div>
      )}
    </Section>
  );

  return (
    <div>
      <PageHeader
        title="Reuniões"
        subtitle="Cadastre as reuniões recorrentes, inicie e finalize cada acontecimento."
        action={canCreate ? <button className="btn btn-primary" onClick={openCreate}>+ Nova reunião</button> : undefined}
      />

      {inProgress.length > 0 && (
        <div style={{ marginBottom: "1.25rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {inProgress.map((o) => (
            <div key={o.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", border: "1px solid color-mix(in srgb, var(--mh-info) 32%, transparent)", background: "linear-gradient(0deg, var(--surface), var(--surface)), var(--mh-info-soft)", borderRadius: 12, padding: "0.9rem 1.1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.9rem", minWidth: 0 }}>
                <span className="live-dot" title="Reunião acontecendo agora" aria-label="Ao vivo" />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.seriesName}</div>
                  <div className="soft" style={{ fontSize: "0.8rem" }}>Em andamento{o.startedAt ? ` · iniciada às ${formatTime(o.startedAt)}` : ""}</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.9rem" }}>
                {o.startedAt && <ElapsedTimer startedAt={o.startedAt} style={{ fontSize: "1.15rem", color: "var(--mh-info)" }} />}
                {o.meetingLink && (
                  <a href={o.meetingLink} target="_blank" rel="noopener noreferrer" className="icon-btn" title="Acessar reunião online" style={{ color: "var(--mh-info)" }}>
                    <Globe size={17} />
                  </a>
                )}
                <button className="btn btn-primary btn-sm" onClick={() => openFinish(o)}>Registros da reunião</button>
                <button className="btn btn-warning btn-sm" onClick={() => setFollowOcc(o)}>Realizar follow</button>
                <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => doCancel(o.id)}>Cancelar</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Tabs
        tabs={[
          { id: "cadastradas", label: "Reuniões cadastradas", content: seriesTab },
          { id: "registros", label: "Registros", content: recordsTab },
        ]}
      />

      <SeriesDialog open={seriesOpen} onClose={() => setSeriesOpen(false)} people={people} rooms={rooms} units={units} series={editing} />
      <RegisterDialog
        open={finishOpen}
        onClose={() => setFinishOpen(false)}
        people={people}
        series={finishOcc ? seriesById.get(finishOcc.seriesId) : undefined}
        occurrenceId={finishOcc?.id}
        startedAt={finishOcc?.startedAt ?? null}
        draft={finishOcc ? (drafts[finishOcc.id] ?? finishOcc.draft) : null}
        onDraftChange={(d) => { if (finishOcc) setDrafts((p) => ({ ...p, [finishOcc.id]: d })); }}
        pilares={pilares}
        secoes={secoes}
        blocos={blocos}
        itens={itens}
        kpis={kpis}
        tools={tools}
        aiEnabled={aiEnabled}
      />
      {detailOcc && (
        <MeetingOccurrenceDetail occurrenceId={detailOcc.id} onClose={() => setDetailOcc(null)} />
      )}
      {viewSeries && (
        <SeriesViewDialog
          series={viewSeries}
          people={people}
          unitCount={units.length}
          durationLabel={plannedLabel(viewSeries)}
          onClose={() => setViewSeries(null)}
        />
      )}
      {followOcc && (
        <MeetingFollowDialog
          open
          onClose={() => setFollowOcc(null)}
          seriesId={followOcc.seriesId}
          seriesName={followOcc.seriesName}
          occurrenceId={followOcc.id}
          people={people}
          currentUserId={currentUserId}
          isAdmin={role === "owner" || role === "admin"}
        />
      )}
      {viewerOcc && (
        <MeetingRecordingsViewer
          occurrenceId={viewerOcc.id}
          title={`${viewerOcc.seriesName} · ${formatDate(viewerOcc.occurredOn)}`}
          onClose={() => setViewerOcc(null)}
        />
      )}
      <ConfirmDialog
        open={!!overtimeOcc}
        title="Tempo da reunião esgotado"
        message={overtimeOcc ? <>A reunião <strong>{overtimeOcc.seriesName}</strong> já passou do tempo previsto de <strong>{plannedLabel(seriesById.get(overtimeOcc.seriesId))}</strong>. Deseja finalizá-la agora?</> : ""}
        confirmLabel="Finalizar reunião"
        cancelLabel="Continuar reunião"
        tone="danger"
        onConfirm={() => { if (overtimeOcc) openFinish(overtimeOcc); setOvertimeOcc(null); }}
        onClose={() => { if (overtimeOcc) setSnoozes((p) => ({ ...p, [overtimeOcc.id]: Date.now() + 15 * 60 * 1000 })); setOvertimeOcc(null); }}
      />
      <StartMeetingDialog
        open={!!confirmStart}
        seriesName={confirmStart?.name ?? ""}
        defaultRoomId={confirmStart?.roomId ?? null}
        rooms={rooms}
        pending={pending}
        onConfirm={runStart}
        onClose={() => setConfirmStart(null)}
        anticipate={anticipating}
        scheduledLabel={confirmStart?.nextDate ? `${formatDate(confirmStart.nextDate)}${confirmStart.startTime ? " " + confirmStart.startTime.slice(0, 5) : ""}` : null}
        defaultNextDate={confirmStart?.nextDate ?? ""}
        defaultNextTime={confirmStart?.startTime ?? ""}
      />
      <ConfirmDialog
        open={!!confirmCancel}
        title="Cancelar reunião"
        message="Cancelar esta reunião em andamento? Ela ficará no histórico como cancelada."
        confirmLabel="Cancelar reunião"
        cancelLabel="Voltar"
        tone="danger"
        pending={pending}
        onConfirm={runCancel}
        onClose={() => setConfirmCancel(null)}
      />
    </div>
  );
}
