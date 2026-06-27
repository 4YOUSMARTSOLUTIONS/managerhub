"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAction } from "@/lib/actions/actions";
import { formatDate } from "@/lib/format";
import { PRIORITY } from "@/lib/constants";
import { PeoplePicker, type Person } from "./PeoplePicker";
import { SearchSelect } from "./SearchSelect";

export type Opt = { id: string; name: string };
export type BlocoOpt = { id: string; name: string; pilarId: string };
export type ItemOpt = { id: string; name: string; blocoId: string };
export type OccOpt = { id: string; seriesId: string; occurredOn: string };

type Demanda = { description: string; assignees: string[]; files: File[] };

export function ActionDialog({
  open, onClose, people, pilares, blocos, itens, kpis, tools, series, occurrences,
}: {
  open: boolean;
  onClose: () => void;
  people: Person[];
  pilares: Opt[];
  blocos: BlocoOpt[];
  itens: ItemOpt[];
  kpis: Opt[];
  tools: Opt[];
  series: Opt[];
  occurrences: OccOpt[];
}) {
  const [isSdpo, setIsSdpo] = useState(true);
  const [pilarId, setPilarId] = useState("");
  const [blocoId, setBlocoId] = useState("");
  const [itemId, setItemId] = useState("");
  const [seriesId, setSeriesId] = useState("");
  const [occurrenceId, setOccurrenceId] = useState("");
  const [kpiId, setKpiId] = useState("");
  const [toolId, setToolId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("medium");
  const [requesterId, setRequesterId] = useState("");
  const [cc, setCc] = useState<string[]>([]);
  const [demandas, setDemandas] = useState<Demanda[]>([{ description: "", assignees: [], files: [] }]);
  const [files, setFiles] = useState<File[]>([]);
  const [keepOpen, setKeepOpen] = useState(false);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (open) {
      setIsSdpo(true); setPilarId(""); setBlocoId(""); setItemId("");
      setSeriesId(""); setOccurrenceId(""); setKpiId(""); setToolId("");
      setDueDate(""); setPriority("medium"); setRequesterId(""); setCc([]);
      setDemandas([{ description: "", assignees: [], files: [] }]); setFiles([]); setError(""); setSaved(""); setKeepOpen(false);
    }
  }, [open]);

  // cascata bidirecional: filtra pelo pai se houver, senão mostra todos
  const blocoOpts = useMemo(() => (pilarId ? blocos.filter((b) => b.pilarId === pilarId) : blocos), [blocos, pilarId]);
  const itemOpts = useMemo(() => (blocoId ? itens.filter((i) => i.blocoId === blocoId) : itens), [itens, blocoId]);
  const occOpts = useMemo(
    () => occurrences.filter((o) => !seriesId || o.seriesId === seriesId).map((o) => ({ id: o.id, name: formatDate(o.occurredOn) })),
    [occurrences, seriesId],
  );

  if (!open) return null;

  // ao escolher o pilar: se o bloco atual não pertence a ele, limpa bloco+item
  const onPilar = (id: string) => {
    setPilarId(id);
    if (blocoId) {
      const b = blocos.find((x) => x.id === blocoId);
      if (!id || (b && b.pilarId !== id)) { setBlocoId(""); setItemId(""); }
    }
  };
  // ao escolher o bloco: preenche o pilar automaticamente; limpa item se não pertencer
  const onBloco = (id: string) => {
    setBlocoId(id);
    if (id) {
      const b = blocos.find((x) => x.id === id);
      if (b) setPilarId(b.pilarId);
      if (itemId) {
        const it = itens.find((x) => x.id === itemId);
        if (!it || it.blocoId !== id) setItemId("");
      }
    } else {
      setItemId("");
    }
  };
  // ao escolher o item: preenche bloco e pilar automaticamente
  const onItem = (id: string) => {
    setItemId(id);
    if (id) {
      const it = itens.find((x) => x.id === id);
      if (it) {
        setBlocoId(it.blocoId);
        const b = blocos.find((x) => x.id === it.blocoId);
        if (b) setPilarId(b.pilarId);
      }
    }
  };

  const setDemanda = (i: number, patch: Partial<Demanda>) => setDemandas((ds) => ds.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  const addDemandaFiles = (i: number, list: FileList) => setDemandas((ds) => ds.map((d, idx) => (idx === i ? { ...d, files: [...d.files, ...Array.from(list)] } : d)));
  const removeDemandaFile = (i: number, fi: number) => setDemandas((ds) => ds.map((d, idx) => (idx === i ? { ...d, files: d.files.filter((_, k) => k !== fi) } : d)));

  const submit = () => {
    setError(""); setSaved("");
    const cleanDemandas = demandas.filter((d) => d.description.trim());
    if (cleanDemandas.length === 0) { setError("Informe ao menos uma ação."); return; }
    if (!requesterId) { setError("Informe o solicitante."); return; }
    if (!dueDate) { setError("Informe o prazo da ação."); return; }
    if (isSdpo && (!pilarId || !blocoId || !itemId)) { setError("Para SDPO, informe Pilar, Bloco e Item."); return; }
    if (isSdpo && !seriesId) { setError("Para ações do Programa de Excelência, informe a Reunião."); return; }

    const payload = {
      is_sdpo: isSdpo,
      pilar_id: pilarId, bloco_id: blocoId, item_id: itemId,
      meeting_series_id: seriesId, occurrence_id: occurrenceId,
      kpi_id: kpiId, tool_id: toolId,
      requester_id: requesterId, due_date: dueDate, priority, cc,
      demandas: cleanDemandas.map((d) => ({ description: d.description, assignees: d.assignees })),
    };
    const fd = new FormData();
    fd.append("payload", JSON.stringify(payload));
    for (const f of files) fd.append("files", f);
    cleanDemandas.forEach((d, i) => d.files.forEach((f) => fd.append(`files_${i}`, f)));

    start(async () => {
      const res = await createAction(fd);
      if (res.error) { setError(res.error); return; }
      router.refresh();
      if (keepOpen) {
        setDemandas([{ description: "", assignees: [], files: [] }]);
        setFiles([]);
        setSaved("Ação criada. Os parâmetros foram mantidos — adicione a próxima.");
      } else {
        onClose();
      }
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "4vh 1rem", zIndex: 60, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 720, boxShadow: "var(--shadow)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>Nova ação</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>

        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1.1rem" }}>
          {/* SDPO */}
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.9rem", fontWeight: 600 }}>
            <input type="checkbox" checked={isSdpo} onChange={(e) => setIsSdpo(e.target.checked)} />
            Ação relacionada ao Programa de Excelência (SDPO)
          </label>

          {isSdpo && (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)", gap: "0.8rem", background: "var(--surface-2)", padding: "0.85rem", borderRadius: 9 }}>
              <div>
                <label className="label">Pilar</label>
                <SearchSelect options={pilares} value={pilarId} onChange={onPilar} placeholder="Buscar pilar…" />
              </div>
              <div>
                <label className="label">Bloco</label>
                <SearchSelect options={blocoOpts} value={blocoId} onChange={onBloco} placeholder="Buscar bloco…" />
              </div>
              <div>
                <label className="label">Item</label>
                <SearchSelect options={itemOpts} value={itemId} onChange={onItem} placeholder="Buscar item…" />
              </div>
            </div>
          )}

          {/* Reunião + referência */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "0.8rem" }}>
            <div>
              <label className="label">Reunião {isSdpo ? <span style={{ color: "#dc2626" }}>*</span> : <span className="soft">(opcional)</span>}</label>
              <SearchSelect options={series} value={seriesId} onChange={(id) => { setSeriesId(id); setOccurrenceId(""); }} placeholder="Buscar reunião…" />
            </div>
            <div>
              <label className="label">Referência da reunião <span className="soft">(opcional)</span></label>
              <SearchSelect options={occOpts} value={occurrenceId} onChange={setOccurrenceId} placeholder="Buscar data…" emptyHint={seriesId ? "Sem registros" : "Sem registros"} />
            </div>
          </div>

          {/* KPI + Ferramenta + Prazo */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)", gap: "0.8rem" }}>
            <div>
              <label className="label">KPI <span className="soft">(opcional)</span></label>
              <SearchSelect options={kpis} value={kpiId} onChange={setKpiId} placeholder="Buscar KPI…" />
            </div>
            <div>
              <label className="label">Ferramenta de gestão <span className="soft">(opcional)</span></label>
              <SearchSelect options={tools} value={toolId} onChange={setToolId} placeholder="Buscar ferramenta…" />
            </div>
            <div>
              <label className="label">Prazo <span style={{ color: "#dc2626" }}>*</span></label>
              <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          <div style={{ maxWidth: 220 }}>
            <label className="label">Prioridade</label>
            <select className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
              {(Object.entries(PRIORITY) as [string, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>

          {/* Solicitante + Em cópia */}
          <div>
            <label className="label">Solicitante</label>
            <PeoplePicker people={people} selected={requesterId ? [requesterId] : []} onChange={(ids) => setRequesterId(ids[0] ?? "")} single placeholder="Buscar solicitante…" />
          </div>
          <div>
            <label className="label">Em cópia <span className="soft">(usuários que devem ter conhecimento)</span></label>
            <PeoplePicker people={people} selected={cc} onChange={setCc} placeholder="Adicionar em cópia…" />
          </div>

          {/* Ações (demandas) */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
              <label className="label" style={{ margin: 0 }}>Ações <span className="soft">(cada uma com seu(s) responsável(is))</span></label>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDemandas((d) => [...d, { description: "", assignees: [], files: [] }])}>+ Ação</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
              {demandas.map((d, i) => (
                <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 9, padding: "0.8rem" }}>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                    <span className="soft" style={{ fontSize: "0.8rem", paddingTop: "0.55rem" }}>{i + 1}.</span>
                    <div style={{ flex: 1 }}>
                      <input className="input" placeholder="Descrição da ação" value={d.description} onChange={(e) => setDemanda(i, { description: e.target.value })} />
                      <div style={{ marginTop: "0.5rem" }}>
                        <span className="soft" style={{ fontSize: "0.78rem" }}>Responsável(is)</span>
                        <PeoplePicker people={people} selected={d.assignees} onChange={(ids) => setDemanda(i, { assignees: ids })} placeholder="Buscar responsável…" />
                      </div>
                      <div style={{ marginTop: "0.5rem" }}>
                        <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem", cursor: "pointer", color: "var(--text-muted)" }}>
                          <span className="btn btn-ghost btn-sm" style={{ pointerEvents: "none" }}>↑ Anexo desta ação</span>
                          <input type="file" multiple hidden onChange={(e) => { if (e.target.files) addDemandaFiles(i, e.target.files); e.target.value = ""; }} />
                        </label>
                        {(d.files ?? []).length > 0 && (
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", marginTop: "0.35rem" }}>
                            {(d.files ?? []).map((f, fi) => (
                              <div key={fi} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.8rem", background: "var(--surface-2)", borderRadius: 7, padding: "0.25rem 0.55rem" }}>
                                <span>{f.name} <span className="soft">({Math.round(f.size / 1024)} KB)</span></span>
                                <button type="button" onClick={() => removeDemandaFile(i, fi)} aria-label="Remover" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "1rem" }}>×</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {demandas.length > 1 && (
                      <button type="button" className="icon-btn icon-btn-danger" onClick={() => setDemandas((ds) => ds.filter((_, idx) => idx !== i))} title="Remover ação" style={{ width: 32, height: 32 }}>×</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Anexos gerais */}
          <div>
            <label className="label">Anexos gerais <span className="soft">(valem para todas as ações acima)</span></label>
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => { if (e.target.files) setFiles((prev) => [...prev, ...Array.from(e.target.files!)]); e.target.value = ""; }} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>↑ Adicionar arquivo</button>
            {files.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginTop: "0.5rem" }}>
                {files.map((f, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.82rem", background: "var(--surface-2)", borderRadius: 7, padding: "0.3rem 0.6rem" }}>
                    <span>{f.name} <span className="soft">({Math.round(f.size / 1024)} KB)</span></span>
                    <button type="button" onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))} aria-label="Remover" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "1rem" }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Manter dados para criar outra */}
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.88rem", borderTop: "1px solid var(--border)", paddingTop: "0.9rem" }}>
            <input type="checkbox" checked={keepOpen} onChange={(e) => setKeepOpen(e.target.checked)} />
            Criar e manter os parâmetros para abrir outra ação em seguida
          </label>

          {saved && <p style={{ color: "#047857", fontSize: "0.85rem", margin: 0, background: "#ecfdf5", padding: "0.5rem 0.7rem", borderRadius: 8 }}>{saved}</p>}
          {error && <p style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0, background: "#fef2f2", padding: "0.5rem 0.7rem", borderRadius: 8 }}>{error}</p>}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>{keepOpen ? "Fechar" : "Cancelar"}</button>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>{pending ? "Salvando…" : "Criar ação"}</button>
        </div>
      </div>
    </div>
  );
}
