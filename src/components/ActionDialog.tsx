"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAction, updateAction } from "@/lib/actions/actions";
import { generateActionsAI } from "@/lib/actions/ai";
import { formatDate } from "@/lib/format";
import { PRIORITY } from "@/lib/constants";
import { PeoplePicker, type Person } from "./PeoplePicker";
import { SearchSelect } from "./SearchSelect";

export type Opt = { id: string; name: string; active?: boolean };
export type SecaoOpt = { id: string; name: string; active?: boolean };
export type BlocoOpt = { id: string; name: string; pilarId: string; secaoId: string; active?: boolean };
export type ItemOpt = { id: string; name: string; pilarId: string; secaoId: string; blocoId: string | null; active?: boolean };
export type SubOpt = { id: string; name: string; departmentId: string };
export type OccOpt = { id: string; seriesId: string; occurredOn: string };

type Demanda = { id?: string; description: string; assignees: string[]; files: File[] };

export type CollectedAction = {
  payload: {
    is_sdpo: boolean; pilar_id: string; secao_id: string; bloco_id: string; item_id: string;
    meeting_series_id: string; kpi_id: string; tool_id: string; unit_id?: string;
    department_id?: string; subdepartment_id?: string;
    requester_id: string; problem_statement: string; due_date: string; priority: string; cc: string[];
    /** `id` presente = demanda que JÁ existe (preserva histórico na edição) */
    demandas: { id?: string; description: string; assignees: string[] }[];
  };
  headerFiles: File[];
  demandaFiles: File[][];
  summary: string;
  /** origem: "ai" = sugerida pela IA (substituível ao regerar) · "manual" = criada/editada à mão */
  source?: "ai" | "manual";
};

export function ActionDialog({
  open, onClose, people, pilares, secoes, blocos, itens, kpis, tools, series, occurrences, units,
  departments = [], subdepartments = [],
  onCollect, lockedSeries, defaultRequesterId, defaultAssignees, defaultUnitId, editing, editingActionId, aiEnabled,
}: {
  open: boolean;
  onClose: () => void;
  people: Person[];
  pilares: Opt[];
  secoes: SecaoOpt[];
  blocos: BlocoOpt[];
  itens: ItemOpt[];
  kpis: Opt[];
  tools: Opt[];
  series: Opt[];
  occurrences: OccOpt[];
  units?: Opt[];
  /** setor e subsetor da AÇÃO (recorte para exportação e relatórios) */
  departments?: Opt[];
  subdepartments?: SubOpt[];
  onCollect?: (a: CollectedAction) => void;
  lockedSeries?: { id: string; name: string } | null;
  defaultRequesterId?: string;
  defaultAssignees?: string[];
  defaultUnitId?: string;
  editing?: CollectedAction | null;
  /** id da ação EXISTENTE sendo editada (muda o salvar de criar para atualizar) */
  editingActionId?: string | null;
  aiEnabled?: boolean;
}) {
  const [isSdpo, setIsSdpo] = useState(true);
  const [pilarId, setPilarId] = useState("");
  const [secaoId, setSecaoId] = useState("");
  const [blocoId, setBlocoId] = useState("");
  const [itemId, setItemId] = useState("");
  const [seriesId, setSeriesId] = useState("");
  const [occurrenceId, setOccurrenceId] = useState("");
  const [kpiId, setKpiId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [subdepartmentId, setSubdepartmentId] = useState("");
  const [toolId, setToolId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("medium");
  const [problema, setProblema] = useState("");
  const [requesterId, setRequesterId] = useState("");
  const [cc, setCc] = useState<string[]>([]);
  const [demandas, setDemandas] = useState<Demanda[]>([{ description: "", assignees: [], files: [] }]);
  const [files, setFiles] = useState<File[]>([]);
  const [keepOpen, setKeepOpen] = useState(false);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [aiOpen, setAiOpen] = useState(false);
  const [aiDraft, setAiDraft] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    setOccurrenceId(""); setError(""); setSaved(""); setKeepOpen(false);
    setAiOpen(false); setAiDraft(""); setAiBusy(false); setAiErr("");
    if (editing) {
      const p = editing.payload;
      setIsSdpo(p.is_sdpo); setPilarId(p.pilar_id); setSecaoId(p.secao_id); setBlocoId(p.bloco_id); setItemId(p.item_id);
      setSeriesId(lockedSeries?.id ?? p.meeting_series_id); setKpiId(p.kpi_id); setToolId(p.tool_id); setUnitId(p.unit_id || defaultUnitId || "all");
      setDepartmentId(p.department_id ?? ""); setSubdepartmentId(p.subdepartment_id ?? "");
      setDueDate(p.due_date); setPriority(p.priority); setRequesterId(p.requester_id); setCc(p.cc);
      setProblema(p.problem_statement ?? "");
      setDemandas(p.demandas.map((d, i) => ({ id: d.id, description: d.description, assignees: d.assignees, files: editing.demandaFiles[i] ?? [] })));
      setFiles(editing.headerFiles);
    } else {
      setIsSdpo(true); setPilarId(""); setSecaoId(""); setBlocoId(""); setItemId("");
      setSeriesId(lockedSeries?.id ?? ""); setKpiId(""); setToolId(""); setUnitId(defaultUnitId ?? "");
      setDepartmentId(""); setSubdepartmentId("");
      setDueDate(""); setPriority("medium"); setRequesterId(defaultRequesterId ?? ""); setCc([]);
      setProblema("");
      setDemandas([{ description: "", assignees: defaultAssignees ?? [], files: [] }]); setFiles([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // só mostra ativos, mas mantém o valor já selecionado (ao editar ação antiga)
  const isActive = (o: { active?: boolean; id: string }, selected: string) => o.active !== false || o.id === selected;
  const pilarOpts = useMemo(() => pilares.filter((p) => isActive(p, pilarId)), [pilares, pilarId]);
  const kpiOpts = useMemo(() => kpis.filter((k) => isActive(k, kpiId)), [kpis, kpiId]);
  const toolOpts = useMemo(() => tools.filter((t) => isActive(t, toolId)), [tools, toolId]);
  // cascata: Pilar → [Bloco] → Item. A Seção saiu da tela: ela é DERIVADA do
  // item (ou do bloco), que já a carregam, e continua indo para o banco.
  const blocoOpts = useMemo(
    () => blocos.filter((b) => !pilarId || b.pilarId === pilarId).filter((b) => isActive(b, blocoId)),
    [blocos, pilarId, blocoId],
  );
  /**
   * Nem todo pilar tem bloco. Onde não tem, o campo não aparece (escolher entre
   * nada é ruído); onde tem, ele é obrigatório, porque a hierarquia do pilar
   * passa por ele.
   */
  const pilarTemBloco = blocoOpts.length > 0;
  const subOpts = useMemo(
    () => subdepartments.filter((x) => !departmentId || x.departmentId === departmentId),
    [subdepartments, departmentId],
  );
  const itemOpts = useMemo(() => {
    const list = itens.filter((i) => (!pilarId || i.pilarId === pilarId) && (!blocoId || i.blocoId === blocoId));
    return list.filter((i) => isActive(i, itemId));
  }, [itens, pilarId, blocoId, itemId]);
  /** Seção do item escolhido (ou do bloco): o que vai para o banco. */
  const secaoDerivada = useMemo(() => {
    const it = itemId ? itens.find((x) => x.id === itemId) : null;
    if (it?.secaoId) return it.secaoId;
    const b = blocoId ? blocos.find((x) => x.id === blocoId) : null;
    return b?.secaoId ?? "";
  }, [itens, blocos, itemId, blocoId]);
  const secaoNome = useMemo(
    () => (secaoDerivada ? secoes.find((x) => x.id === secaoDerivada)?.name ?? "" : ""),
    [secoes, secaoDerivada],
  );
  const occOpts = useMemo(
    () => occurrences.filter((o) => !seriesId || o.seriesId === seriesId).map((o) => ({ id: o.id, name: formatDate(o.occurredOn) })),
    [occurrences, seriesId],
  );

  if (!open) return null;

  // Ao trocar o Pilar, limpa bloco/item que não pertencem a ele.
  const onPilar = (id: string) => {
    setPilarId(id);
    if (blocoId) { const b = blocos.find((x) => x.id === blocoId); if (!id || (b && b.pilarId !== id)) setBlocoId(""); }
    if (itemId) { const it = itens.find((x) => x.id === itemId); if (!id || (it && it.pilarId !== id)) setItemId(""); }
  };
  // ao escolher o bloco (opcional): preenche pilar e seção; limpa item se não pertencer
  const onBloco = (id: string) => {
    setBlocoId(id);
    if (id) {
      const b = blocos.find((x) => x.id === id);
      if (b) { setPilarId(b.pilarId); setSecaoId(b.secaoId); }
      if (itemId) { const it = itens.find((x) => x.id === itemId); if (!it || it.blocoId !== id) setItemId(""); }
    }
  };
  // ao escolher o item: preenche pilar, seção e bloco automaticamente
  const onItem = (id: string) => {
    setItemId(id);
    if (id) {
      const it = itens.find((x) => x.id === id);
      if (it) { setPilarId(it.pilarId); setSecaoId(it.secaoId); setBlocoId(it.blocoId ?? ""); }
    }
  };

  const setDemanda = (i: number, patch: Partial<Demanda>) => setDemandas((ds) => ds.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  const addDemandaFiles = (i: number, list: FileList) => setDemandas((ds) => ds.map((d, idx) => (idx === i ? { ...d, files: [...d.files, ...Array.from(list)] } : d)));
  const removeDemandaFile = (i: number, fi: number) => setDemandas((ds) => ds.map((d, idx) => (idx === i ? { ...d, files: d.files.filter((_, k) => k !== fi) } : d)));

  const runAiActions = async () => {
    setAiErr("");
    if (!aiDraft.trim()) { setAiErr("Descreva a ação e quem ficou responsável para a IA montar."); return; }
    setAiBusy(true);
    const candidates = people.map((p) => ({ id: p.id, name: p.name }));
    // catálogo SDPO numerado: só itens ATIVOS com seção/pilar (ativos) resolvidos; bloco é opcional
    const sdpoItens = itens
      .map((it) => {
        if (it.active === false) return null;
        const s = secoes.find((x) => x.id === it.secaoId);
        const p = pilares.find((x) => x.id === it.pilarId);
        if (!s || !p || s.active === false || p.active === false) return null;
        const b = it.blocoId ? blocos.find((x) => x.id === it.blocoId) : undefined;
        if (it.blocoId && (!b || b.active === false)) return null;
        const label = b ? `${p.name} > ${s.name} > ${b.name} > ${it.name}` : `${p.name} > ${s.name} > ${it.name}`;
        return { item_id: it.id, secao_id: s.id, bloco_id: b?.id ?? "", pilar_id: p.id, label };
      })
      .filter((x): x is { item_id: string; secao_id: string; bloco_id: string; pilar_id: string; label: string } => !!x);
    const today = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD no fuso local

    const res = await generateActionsAI({
      draft: aiDraft,
      candidates,
      sdpoItens,
      kpis,
      tools,
      series,
      occurrences,
      today,
      single: true,
    });
    setAiBusy(false);
    if (!res.ok) { setAiErr(res.error); return; }

    const first = res.actions[0];
    if (!first) { setAiErr("A IA não identificou ações claras no texto."); return; }
    const p = first.payload;
    setIsSdpo(p.is_sdpo);
    setPilarId(p.pilar_id); setSecaoId(p.secao_id); setBlocoId(p.bloco_id); setItemId(p.item_id);
    setSeriesId(lockedSeries?.id ?? p.meeting_series_id); setOccurrenceId(lockedSeries ? "" : p.occurrence_id);
    setKpiId(p.kpi_id); setToolId(p.tool_id); setUnitId(defaultUnitId ?? "");
    setRequesterId(p.requester_id); setCc(p.cc);
    setPriority(p.priority); setDueDate(p.due_date); setProblema(p.problem_statement);
    const allDemandas = res.actions.flatMap((a) => a.payload.demandas);
    setDemandas(
      allDemandas.length
        ? allDemandas.map((d) => ({ description: d.description, assignees: d.assignees, files: [] }))
        : [{ description: "", assignees: [], files: [] }],
    );
    setAiOpen(false);
  };

  const submit = () => {
    setError(""); setSaved("");
    const cleanDemandas = demandas.filter((d) => d.description.trim());
    if (cleanDemandas.length === 0) { setError("Informe ao menos uma demanda."); return; }
    // ação sem responsável nasce órfã: ninguém a vê na própria lista e ela
    // não cobra ninguém. O servidor recusa igual.
    const semResp = cleanDemandas.findIndex((d) => d.assignees.length === 0);
    if (semResp >= 0) {
      setError(`Informe ao menos um responsável na demanda ${semResp + 1}.`);
      return;
    }
    if (units && units.length > 0 && !unitId) { setError("Selecione a unidade (ou “Todas as unidades”)."); return; }
    if (!requesterId) { setError("Informe o solicitante."); return; }
    if (!dueDate) { setError("Informe o prazo da ação."); return; }
    if (isSdpo && (!pilarId || !itemId)) { setError("Para SDPO, informe o Pilar e o Item."); return; }
    // onde o pilar TEM bloco, ele faz parte da hierarquia e não é dispensável
    if (isSdpo && pilarTemBloco && !blocoId) { setError("Informe o Bloco."); return; }
    if (isSdpo && !seriesId) { setError("Para ações do Programa de Excelência, informe a Reunião."); return; }

    // modo coletar: devolve a ação ao pai (não salva agora)
    if (onCollect) {
      onCollect({
        payload: {
          is_sdpo: isSdpo,
          pilar_id: pilarId, secao_id: secaoDerivada, bloco_id: blocoId, item_id: itemId,
          meeting_series_id: seriesId,
          kpi_id: kpiId, tool_id: toolId, unit_id: unitId === "all" ? "" : unitId,
          department_id: departmentId, subdepartment_id: subdepartmentId,
          requester_id: requesterId, problem_statement: problema.trim(), due_date: dueDate, priority, cc,
          demandas: cleanDemandas.map((d) => ({ description: d.description, assignees: d.assignees })),
        },
        headerFiles: files,
        demandaFiles: cleanDemandas.map((d) => d.files),
        summary: cleanDemandas.map((d) => d.description).join("; "),
      });
      onClose();
      return;
    }

    const payload = {
      is_sdpo: isSdpo,
      pilar_id: pilarId, secao_id: secaoDerivada, bloco_id: blocoId, item_id: itemId,
      meeting_series_id: seriesId, occurrence_id: occurrenceId,
      kpi_id: kpiId, tool_id: toolId, unit_id: unitId === "all" ? "" : unitId,
      department_id: departmentId, subdepartment_id: subdepartmentId,
      requester_id: requesterId, problem_statement: problema.trim(), due_date: dueDate, priority, cc,
      // o id da demanda vai junto na EDIÇÃO: sem ele a RPC criaria outra e o
      // histórico de tratamento da original iria embora
      demandas: cleanDemandas.map((d) => ({ id: d.id, description: d.description, assignees: d.assignees })),
    };

    // editar ação existente: os anexos seguem sendo do cadastro, não do editar
    if (editingActionId) {
      start(async () => {
        const res = await updateAction(editingActionId, payload);
        if (res.error) { setError(res.error); return; }
        onClose();
        router.refresh();
      });
      return;
    }

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
        // o problema é conteúdo da ação, não parâmetro: limpa junto com a descrição,
        // senão a próxima ação nasce com o diagnóstico da anterior
        setProblema("");
        setSaved("Ação criada. Os parâmetros foram mantidos — adicione a próxima.");
      } else {
        onClose();
      }
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "3vh 1rem", zIndex: 80, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 720, boxShadow: "var(--mh-shadow-e3)", margin: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>{onCollect ? (editing ? "Editar ação da reunião" : "Ação da reunião") : editingActionId ? "Editar ação" : "Nova ação"}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>

        <div style={{ padding: "1rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.7rem" }}>
          {/* Unidade (obrigatório) — antes da IA, pois a IA não preenche a unidade */}
          {units && units.length > 0 && (
            <div>
              <label className="label">Unidade <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <select className="select" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                <option value="" disabled>Selecione…</option>
                <option value="all">Todas as unidades</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          )}

          {/* Sugerir com IA */}
          {aiEnabled && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 9, padding: "0.7rem 0.9rem", background: "var(--surface-2)" }}>
              {!aiOpen ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAiOpen(true)}>
                  ✨ Sugerir ação com IA
                </button>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <label className="label" style={{ margin: 0 }}>Descreva a ação</label>
                  <div style={{ border: "1px solid var(--border)", borderRadius: 9, background: "var(--surface)", padding: "0.7rem 0.85rem" }}>
                    <p className="soft" style={{ fontSize: "0.72rem", margin: 0 }}>
                      Para que a IA te auxilie a preencher os campos e elaborar uma ação mais completa, cite quando fizer sentido:
                    </p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "0.3rem 1.1rem", marginTop: "0.55rem", fontSize: "0.72rem" }}>
                      {[
                        <><strong>Prioridade</strong> <span className="soft">(baixa, média, alta, urgente)</span></>,
                        <><strong>Prazo</strong> <span className="soft">(ex.: “até sexta”, “30/09/2026”)</span></>,
                        <><strong>Pilar / Seção / Item</strong> <span className="soft">(SDPO)</span></>,
                        <><strong>KPI</strong> <span className="soft">relacionado</span></>,
                        <><strong>Ferramenta de gestão</strong> <span className="soft">(ex.: PDCA, 5W2H)</span></>,
                        <><strong>Solicitante</strong> <span className="soft">e quem fica</span> <strong>em cópia</strong></>,
                        <><strong>Ação</strong> <span className="soft">e</span> <strong>responsável(is)</strong></>,
                      ].map((item, i) => (
                        <span key={i} style={{ display: "flex", gap: "0.45rem", alignItems: "baseline" }}>
                          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--mh-primary-500)", flexShrink: 0, transform: "translateY(-1px)" }} />
                          <span>{item}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <textarea
                    className="textarea"
                    value={aiDraft}
                    onChange={(e) => setAiDraft(e.target.value)}
                    placeholder="Ex.: João precisa renegociar o contrato com o fornecedor X até o fim do mês; é urgente…"
                    style={{ minHeight: 90 }}
                    disabled={aiBusy}
                  />
                  {aiErr && <p style={{ color: "var(--mh-danger)", fontSize: "0.8rem", margin: 0 }}>{aiErr}</p>}
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button type="button" className="btn btn-primary btn-sm" onClick={runAiActions} disabled={aiBusy}>
                      {aiBusy ? "Gerando…" : "Gerar"}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAiOpen(false); setAiErr(""); }} disabled={aiBusy}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Prioridade + Prazo */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "0.8rem" }}>
            <div>
              <label className="label">Prioridade</label>
              <select className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
                {(Object.entries(PRIORITY) as [string, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Prazo <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          {/* SDPO */}
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.9rem", fontWeight: 600 }}>
            <input type="checkbox" checked={isSdpo} onChange={(e) => setIsSdpo(e.target.checked)} />
            Ação relacionada ao Programa de Excelência (SDPO)
          </label>

          {isSdpo && (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "0.8rem", background: "var(--surface-2)", padding: "0.85rem", borderRadius: 9 }}>
              <div>
                <label className="label">Pilar</label>
                <SearchSelect options={pilarOpts} value={pilarId} onChange={onPilar} placeholder="Buscar pilar…" />
              </div>
              {pilarTemBloco && (
                <div>
                  <label className="label">Bloco <span style={{ color: "var(--mh-danger)" }}>*</span></label>
                  <SearchSelect options={blocoOpts} value={blocoId} onChange={onBloco} placeholder="Buscar bloco…" />
                </div>
              )}
              <div>
                <label className="label">Item <span style={{ color: "var(--mh-danger)" }}>*</span></label>
                <SearchSelect options={itemOpts} value={itemId} onChange={onItem} placeholder="Buscar item…" />
              </div>
              {/* a Seção não é mais escolhida: vem do item/bloco e vai para o
                  banco do mesmo jeito. Fica visível para conferência. */}
              {secaoNome && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <span className="soft" style={{ fontSize: "0.78rem" }}>Seção: <strong>{secaoNome}</strong></span>
                </div>
              )}
            </div>
          )}

          {/* Reunião + referência */}
          {lockedSeries ? (
            <div style={{ background: "var(--surface-2)", borderRadius: 9, padding: "0.6rem 0.85rem", fontSize: "0.85rem" }} className="muted">
              Vinculada à reunião <strong>{lockedSeries.name}</strong> · esta reunião que está sendo registrada.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "0.8rem" }}>
              <div>
                <label className="label">Reunião {isSdpo && <span style={{ color: "var(--mh-danger)" }}>*</span>}</label>
                <SearchSelect options={series} value={seriesId} onChange={(id) => { setSeriesId(id); setOccurrenceId(""); }} placeholder="Buscar reunião…" />
              </div>
              <div>
                <label className="label">Referência da reunião</label>
                <SearchSelect options={occOpts} value={occurrenceId} onChange={setOccurrenceId} placeholder="Buscar data…" emptyHint="Sem registros" />
              </div>
            </div>
          )}

          {/* KPI + Ferramenta */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "0.8rem" }}>
            <div>
              <label className="label">KPI</label>
              <SearchSelect options={kpiOpts} value={kpiId} onChange={setKpiId} placeholder="Buscar KPI…" />
            </div>
            <div>
              <label className="label">Ferramenta de gestão</label>
              <SearchSelect options={toolOpts} value={toolId} onChange={setToolId} placeholder="Buscar ferramenta…" />
            </div>
          </div>

          {/* Solicitante + Em cópia */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
            <div>
              <label className="label">Solicitante <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <PeoplePicker people={people} selected={requesterId ? [requesterId] : []} onChange={(ids) => setRequesterId(ids[0] ?? "")} single placeholder="Buscar solicitante…" />
            </div>
            <div>
              <label className="label">Em cópia</label>
              <PeoplePicker people={people} selected={cc} onChange={setCc} placeholder="Adicionar em cópia…" />
            </div>
          </div>

          {/* Setor da AÇÃO (não o do responsável): é o recorte que a exportação
              e os relatórios usam, e fica gravado na ação, sem se mover quando
              a pessoa muda de área. */}
          {departments.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "0.8rem" }}>
            <div>
              <label className="label">Setor</label>
              <SearchSelect
                options={departments}
                value={departmentId}
                onChange={(id) => {
                  setDepartmentId(id);
                  // subsetor que não pertence ao setor novo não faz sentido
                  if (subdepartmentId) {
                    const sub = subdepartments.find((x) => x.id === subdepartmentId);
                    if (!id || (sub && sub.departmentId !== id)) setSubdepartmentId("");
                  }
                }}
                placeholder="Buscar setor…"
              />
            </div>
            <div>
              <label className="label">Subsetor</label>
              <SearchSelect
                options={subOpts}
                value={subdepartmentId}
                onChange={(id) => {
                  setSubdepartmentId(id);
                  // escolher o subsetor primeiro preenche o setor dele
                  if (id) {
                    const sub = subdepartments.find((x) => x.id === id);
                    if (sub) setDepartmentId(sub.departmentId);
                  }
                }}
                placeholder={departmentId ? "Buscar subsetor…" : "Escolha o setor primeiro…"}
                emptyHint="Sem subsetores neste setor"
              />
            </div>
          </div>
          )}

          {/* Problema/Diagnóstico: encostado nas Demandas de propósito, para quem
              preenche escrever o porquê logo antes de escrever o que fazer */}
          <div style={{ background: "var(--surface-2)", padding: "0.85rem", borderRadius: 9 }}>
            <label className="label">Problema / Diagnóstico</label>
            <textarea
              className="textarea"
              value={problema}
              onChange={(e) => setProblema(e.target.value)}
              placeholder="Ex.: o giro de vasilhame caiu 12% no trimestre e os relatórios chegam sem o corte por rota, o que impede identificar onde está a perda."
              style={{ minHeight: 76 }}
            />
            <div className="soft" style={{ fontSize: "0.76rem", marginTop: "0.35rem" }}>
              Qual problema esta ação resolve? É isto que o responsável vê ao abrir a demanda.
            </div>
          </div>

          {/* Ações (demandas) */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
              <label className="label" style={{ margin: 0 }}>Demandas <span className="soft">(cada uma com seu(s) responsável(is))</span></label>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDemandas((d) => [...d, { description: "", assignees: [], files: [] }])}>+ Demanda</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {demandas.map((d, i) => (
                <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 9, padding: "0.6rem 0.7rem" }}>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                    <span className="soft" style={{ fontSize: "0.8rem", paddingTop: "0.55rem" }}>{i + 1}.</span>
                    <div style={{ flex: 1 }}>
                      <input className="input" placeholder="Descrição da demanda" value={d.description} onChange={(e) => setDemanda(i, { description: e.target.value })} />
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

          {/* Manter dados para criar outra (só na criação direta) */}
          {!onCollect && (
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.88rem", borderTop: "1px solid var(--border)", paddingTop: "0.9rem" }}>
              <input type="checkbox" checked={keepOpen} onChange={(e) => setKeepOpen(e.target.checked)} />
              Criar e manter os parâmetros para abrir outra ação em seguida
            </label>
          )}

          {saved && <p style={{ color: "var(--mh-success)", fontSize: "0.85rem", margin: 0, background: "var(--mh-success-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>{saved}</p>}
          {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>{error}</p>}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>{keepOpen ? "Fechar" : "Cancelar"}</button>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>{onCollect ? (editing ? "Salvar ação" : "Adicionar ação") : pending ? "Salvando…" : editingActionId ? "Salvar alterações" : "Criar ação"}</button>
        </div>
      </div>
    </div>
  );
}
