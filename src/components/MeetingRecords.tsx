"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { Tabs } from "@/components/ui/Tabs";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PERIODICITY } from "@/lib/constants";
import { formatDate, formatTime, formatDuration } from "@/lib/format";
import { toggleSeries, deleteSeries, deleteOccurrence, startOccurrence, cancelOccurrence, type OccurrenceDraft } from "@/lib/actions/meeting-records";
import { SeriesDialog, type SeriesData, type Room, type Unit } from "./SeriesDialog";
import { RegisterDialog } from "./RegisterDialog";
import { ElapsedTimer } from "./ElapsedTimer";
import type { Opt, BlocoOpt, ItemOpt } from "./ActionDialog";
import type { Person } from "./PeoplePicker";

export type OccStatus = "in_progress" | "finished" | "cancelled";
export type SeriesRow = SeriesData & { isActive: boolean };
export type OccurrenceRow = {
  id: string;
  seriesId: string;
  seriesName: string;
  occurredOn: string;
  status: OccStatus;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  draft: OccurrenceDraft | null;
  presentCount: number;
  totalCount: number;
  actionsCount: number;
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
  blocos,
  itens,
  kpis,
  tools,
  aiEnabled,
}: {
  series: SeriesRow[];
  occurrences: OccurrenceRow[];
  people: Person[];
  rooms: Room[];
  units: Unit[];
  pilares: Opt[];
  blocos: BlocoOpt[];
  itens: ItemOpt[];
  kpis: Opt[];
  tools: Opt[];
  aiEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [seriesOpen, setSeriesOpen] = useState(false);
  const [editing, setEditing] = useState<SeriesData | undefined>(undefined);
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishOcc, setFinishOcc] = useState<OccurrenceRow | null>(null);
  const [drafts, setDrafts] = useState<Record<string, OccurrenceDraft>>({});

  // filtros — reuniões cadastradas (padrão: só ativas)
  const [seriesQuery, setSeriesQuery] = useState("");
  const [seriesStatus, setSeriesStatus] = useState<"all" | "active" | "inactive">("active");
  const [seriesPeriod, setSeriesPeriod] = useState("all");
  const [seriesUnit, setSeriesUnit] = useState("all");
  const [seriesResp, setSeriesResp] = useState("all");
  const [seriesPart, setSeriesPart] = useState("all");
  // filtros — registros
  const [recQuery, setRecQuery] = useState("");
  const [recSeries, setRecSeries] = useState("all");
  const [recUnit, setRecUnit] = useState("all");
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

  const inProgress = useMemo(() => occurrences.filter((o) => o.status === "in_progress"), [occurrences]);
  const inProgressBySeries = useMemo(() => new Map(inProgress.map((o) => [o.seriesId, o])), [inProgress]);
  const history = useMemo(() => occurrences.filter((o) => o.status !== "in_progress"), [occurrences]);

  const openCreate = () => { setEditing(undefined); setSeriesOpen(true); };
  const openEdit = (s: SeriesRow) => { setEditing(s); setSeriesOpen(true); };
  const openFinish = (o: OccurrenceRow) => { setFinishOcc(o); setFinishOpen(true); };
  const doStart = (s: SeriesRow) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const d = new Date();
    const todayStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (s.nextDate && s.nextDate > todayStr) {
      alert(`A próxima reunião está agendada para ${formatDate(s.nextDate)}. Para iniciar antes, edite a data da próxima reunião.`);
      return;
    }
    start(async () => {
      const r = await startOccurrence(s.id);
      if (r.error) { alert(r.error); return; }
      router.refresh();
    });
  };
  const doCancel = (id: string) => {
    if (!confirm("Cancelar esta reunião em andamento? Ela ficará no histórico como cancelada.")) return;
    start(async () => {
      const r = await cancelOccurrence(id);
      if (r.error) { alert(r.error); return; }
      router.refresh();
    });
  };

  const filteredSeries = useMemo(() => {
    const q = norm(seriesQuery.trim());
    return series.filter((s) => {
      if (seriesStatus === "active" && !s.isActive) return false;
      if (seriesStatus === "inactive" && s.isActive) return false;
      if (seriesPeriod !== "all" && s.periodicity !== seriesPeriod) return false;
      if (seriesUnit !== "all" && !(s.unitIds ?? []).includes(seriesUnit)) return false;
      if (seriesResp !== "all" && s.ownerUserId !== seriesResp) return false;
      if (seriesPart !== "all" && !(s.participantIds ?? []).includes(seriesPart)) return false;
      if (!q) return true;
      const hay = norm([s.name, s.owner ?? "", s.ownerUserName ?? "", ...(s.unitNames ?? []), PERIODICITY[s.periodicity as keyof typeof PERIODICITY]].join(" "));
      return hay.includes(q);
    });
  }, [series, seriesQuery, seriesStatus, seriesPeriod, seriesUnit, seriesResp, seriesPart]);

  const filteredOcc = useMemo(() => {
    const q = norm(recQuery.trim());
    return history.filter((o) => {
      if (recSeries !== "all" && o.seriesId !== recSeries) return false;
      if (recFrom && o.occurredOn < recFrom) return false;
      if (recTo && o.occurredOn > recTo) return false;
      const s = seriesById.get(o.seriesId);
      if (recUnit !== "all" && !(s?.unitIds ?? []).includes(recUnit)) return false;
      if (recResp !== "all" && s?.ownerUserId !== recResp) return false;
      if (recPeriod !== "all" && s?.periodicity !== recPeriod) return false;
      if (recPart !== "all" && !(s?.participantIds ?? []).includes(recPart)) return false;
      if (!q) return true;
      return norm(`${o.seriesName} ${o.registeredByName ?? ""}`).includes(q);
    });
  }, [history, recQuery, recSeries, recFrom, recTo, recUnit, recResp, recPeriod, recPart, seriesById]);

  const seriesFilterStyle = { padding: "0.42rem 0.6rem", fontSize: "0.85rem" };
  const seriesTab = (
    <Section
      title={`Reuniões cadastradas · ${filteredSeries.length}${filteredSeries.length !== series.length ? ` de ${series.length}` : ""}`}
      padded={false}
    >
      {series.length > 0 && (
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", padding: "0.8rem 1.1rem", borderBottom: "1px solid var(--border)" }}>
          <input className="input" placeholder="Buscar por nome…" value={seriesQuery} onChange={(e) => setSeriesQuery(e.target.value)} style={{ flex: "1 1 200px", minWidth: 160, ...seriesFilterStyle }} />
          {units.length > 0 && (
            <select className="select" value={seriesUnit} onChange={(e) => setSeriesUnit(e.target.value)} style={{ width: "auto", ...seriesFilterStyle }} title="Unidade">
              <option value="all">Todas as unidades</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          {respOptions.length > 0 && (
            <select className="select" value={seriesResp} onChange={(e) => setSeriesResp(e.target.value)} style={{ width: "auto", maxWidth: 200, ...seriesFilterStyle }} title="Usuário responsável">
              <option value="all">Todos os responsáveis</option>
              {respOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          <select className="select" value={seriesPeriod} onChange={(e) => setSeriesPeriod(e.target.value)} style={{ width: "auto", ...seriesFilterStyle }} title="Frequência">
            <option value="all">Toda frequência</option>
            {(Object.entries(PERIODICITY) as [string, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {partOptions.length > 0 && (
            <select className="select" value={seriesPart} onChange={(e) => setSeriesPart(e.target.value)} style={{ width: "auto", maxWidth: 200, ...seriesFilterStyle }} title="Usuário participante">
              <option value="all">Todos os participantes</option>
              {partOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <select className="select" value={seriesStatus} onChange={(e) => setSeriesStatus(e.target.value as "all" | "active" | "inactive")} style={{ width: "auto", ...seriesFilterStyle }} title="Status">
            <option value="active">Ativas</option>
            <option value="inactive">Inativas</option>
            <option value="all">Ativas e inativas</option>
          </select>
        </div>
      )}
      {series.length === 0 ? (
        <EmptyState title="Nenhuma reunião cadastrada" description="Cadastre as reuniões recorrentes da empresa para começar a registrar os acontecimentos." />
      ) : filteredSeries.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>Reunião</th>
              <th>Periodicidade</th>
              <th>Unidades</th>
              <th>Próxima</th>
              <th>Participantes</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filteredSeries.map((s) => (
              <tr key={s.id} style={{ opacity: s.isActive ? 1 : 0.55 }}>
                <td style={{ fontWeight: 600 }}>{s.name}</td>
                <td className="muted">{PERIODICITY[s.periodicity as keyof typeof PERIODICITY]}</td>
                <td className="muted">
                  {(s.unitNames ?? []).length === 0
                    ? "—"
                    : units.length > 0 && s.unitNames.length === units.length
                      ? "Todas"
                      : s.unitNames.join(", ")}
                </td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{s.nextDate ? formatDate(s.nextDate) : "—"}</td>
                <td className="muted">{s.participantIds.length}</td>
                <td><Badge tone={s.isActive ? "green" : "gray"}>{s.isActive ? "Ativa" : "Inativa"}</Badge></td>
                <td style={{ textAlign: "right" }}>
                  <div style={{ display: "inline-flex", gap: "0.3rem", justifyContent: "flex-end", alignItems: "center" }}>
                    {s.isActive && (
                      inProgressBySeries.has(s.id) ? (
                        <button className="btn btn-sm" style={{ background: "var(--blue-50, #eff6ff)", color: "#1d4ed8", border: "1px solid #bfdbfe" }} onClick={() => openFinish(inProgressBySeries.get(s.id)!)}>● Em andamento</button>
                      ) : (
                        <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => doStart(s)}>Iniciar</button>
                      )
                    )}
                    <button className="icon-btn" title="Editar" onClick={() => openEdit(s)}><Ico d={ICON.edit} /></button>
                    <form action={toggleSeries} style={{ display: "inline-flex" }}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="is_active" value={String(s.isActive)} />
                      <button className="icon-btn" type="submit" title={s.isActive ? "Inativar" : "Ativar"}><Ico d={ICON.power} /></button>
                    </form>
                    <form action={deleteSeries} style={{ display: "inline-flex" }}>
                      <input type="hidden" name="id" value={s.id} />
                      <button className="icon-btn icon-btn-danger" type="submit" title="Excluir"><Ico d={ICON.trash} /></button>
                    </form>
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
    >
      {history.length > 0 && (
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", padding: "0.8rem 1.1rem", borderBottom: "1px solid var(--border)" }}>
          <input className="input" placeholder="Buscar por nome…" value={recQuery} onChange={(e) => setRecQuery(e.target.value)} style={{ flex: "1 1 180px", minWidth: 150, ...seriesFilterStyle }} />
          <select className="select" value={recSeries} onChange={(e) => setRecSeries(e.target.value)} style={{ width: "auto", maxWidth: 190, ...seriesFilterStyle }} title="Reunião">
            <option value="all">Todas as reuniões</option>
            {series.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {units.length > 0 && (
            <select className="select" value={recUnit} onChange={(e) => setRecUnit(e.target.value)} style={{ width: "auto", ...seriesFilterStyle }} title="Unidade">
              <option value="all">Todas as unidades</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          {respOptions.length > 0 && (
            <select className="select" value={recResp} onChange={(e) => setRecResp(e.target.value)} style={{ width: "auto", maxWidth: 190, ...seriesFilterStyle }} title="Usuário responsável">
              <option value="all">Todos os responsáveis</option>
              {respOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          <select className="select" value={recPeriod} onChange={(e) => setRecPeriod(e.target.value)} style={{ width: "auto", ...seriesFilterStyle }} title="Frequência">
            <option value="all">Toda frequência</option>
            {(Object.entries(PERIODICITY) as [string, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {partOptions.length > 0 && (
            <select className="select" value={recPart} onChange={(e) => setRecPart(e.target.value)} style={{ width: "auto", maxWidth: 190, ...seriesFilterStyle }} title="Usuário participante">
              <option value="all">Todos os participantes</option>
              {partOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.8rem" }} className="soft">
            De <input type="date" className="input" value={recFrom} onChange={(e) => setRecFrom(e.target.value)} style={{ width: "auto", padding: "0.35rem 0.5rem", fontSize: "0.82rem" }} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.8rem" }} className="soft">
            Até <input type="date" className="input" value={recTo} onChange={(e) => setRecTo(e.target.value)} style={{ width: "auto", padding: "0.35rem 0.5rem", fontSize: "0.82rem" }} />
          </label>
        </div>
      )}
      {history.length === 0 ? (
        <EmptyState title="Nenhum registro" description="Quando uma reunião acontecer, clique em “Iniciar” na aba de reuniões cadastradas e depois finalize-a." />
      ) : filteredOcc.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>Reunião</th>
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
                <td style={{ fontWeight: 600 }}>{o.seriesName}</td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{formatDate(o.occurredOn)}</td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{o.status === "cancelled" ? "—" : formatDuration(o.durationSeconds)}</td>
                <td className="muted">{o.presentCount}/{o.totalCount}</td>
                <td className="muted">{o.actionsCount > 0 ? <Badge tone="blue">{o.actionsCount}</Badge> : "—"}</td>
                <td><Badge tone={OCC_STATUS[o.status].tone}>{OCC_STATUS[o.status].label}</Badge></td>
                <td className="muted">{o.registeredByName ?? "—"}</td>
                <td style={{ textAlign: "right" }}>
                  <form action={deleteOccurrence} style={{ display: "inline-flex" }}>
                    <input type="hidden" name="id" value={o.id} />
                    <button className="icon-btn icon-btn-danger" type="submit" title="Excluir registro"><Ico d={ICON.trash} /></button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState title="Nenhum registro encontrado" description="Tente outro termo de busca ou ajuste o período." />
      )}
    </Section>
  );

  return (
    <div>
      <PageHeader
        title="Reuniões"
        subtitle="Cadastre as reuniões recorrentes, inicie e finalize cada acontecimento."
        action={<button className="btn btn-primary" onClick={openCreate}>+ Nova reunião</button>}
      />

      {inProgress.length > 0 && (
        <div style={{ marginBottom: "1.25rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {inProgress.map((o) => (
            <div key={o.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", border: "1px solid #bfdbfe", background: "linear-gradient(0deg, var(--surface), var(--surface)), #eff6ff", borderRadius: 12, padding: "0.9rem 1.1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.9rem", minWidth: 0 }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#2563eb", flexShrink: 0, boxShadow: "0 0 0 4px rgba(37,99,235,0.15)" }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.seriesName}</div>
                  <div className="soft" style={{ fontSize: "0.8rem" }}>Em andamento{o.startedAt ? ` · iniciada às ${formatTime(o.startedAt)}` : ""}</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.9rem" }}>
                {o.startedAt && <ElapsedTimer startedAt={o.startedAt} style={{ fontSize: "1.15rem", color: "#1d4ed8" }} />}
                <button className="btn btn-primary btn-sm" onClick={() => openFinish(o)}>Registros da reunião</button>
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
        blocos={blocos}
        itens={itens}
        kpis={kpis}
        tools={tools}
        aiEnabled={aiEnabled}
      />
    </div>
  );
}
