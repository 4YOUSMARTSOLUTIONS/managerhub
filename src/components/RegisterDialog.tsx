"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { finishOccurrence, saveOccurrenceDraft, type OccurrenceDraft } from "@/lib/actions/meeting-records";
import { createAction } from "@/lib/actions/actions";
import { generateMeetingAI, generateActionsAI } from "@/lib/actions/ai";
import { PERIODICITY } from "@/lib/constants";
import { formatTime } from "@/lib/format";
import { Avatar } from "@/components/ui/Avatar";
import { PeoplePicker, type Person } from "./PeoplePicker";
import { TorView } from "./TorView";
import { ElapsedTimer } from "./ElapsedTimer";
import { ActionDialog, type Opt, type SecaoOpt, type BlocoOpt, type ItemOpt, type CollectedAction } from "./ActionDialog";
import { confirmDialog } from "@/components/ui/confirm";
import { InfoHint } from "@/components/ui/InfoHint";
import { MeetingRecordingPanel } from "./MeetingRecordingPanel";
import type { SeriesData } from "./SeriesDialog";

export function RegisterDialog({
  open,
  onClose,
  people,
  series,
  occurrenceId,
  startedAt,
  draft,
  onDraftChange,
  pilares,
  secoes,
  blocos,
  itens,
  kpis,
  tools,
  aiEnabled,
}: {
  open: boolean;
  onClose: () => void;
  people: Person[];
  series?: SeriesData;
  occurrenceId?: string;
  startedAt?: string | null;
  draft?: OccurrenceDraft | null;
  onDraftChange?: (draft: OccurrenceDraft) => void;
  pilares: Opt[];
  secoes: SecaoOpt[];
  blocos: BlocoOpt[];
  itens: ItemOpt[];
  kpis: Opt[];
  tools: Opt[];
  aiEnabled: boolean;
}) {
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  // unidades da reunião (para o formulário de ação): a ação herda/seleciona entre as unidades da série
  const seriesUnits = useMemo(
    () => (series ? series.unitIds.map((id, i) => ({ id, name: series.unitNames[i] ?? "—" })) : []),
    [series],
  );
  const [present, setPresent] = useState<Record<string, boolean>>({});
  const [attendees, setAttendees] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [decisions, setDecisions] = useState("");
  const [transcript, setTranscript] = useState("");
  const [collected, setCollected] = useState<CollectedAction[]>([]);
  const [actionOpen, setActionOpen] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [advance, setAdvance] = useState(true);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [aiDraft, setAiDraft] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiActionsDraft, setAiActionsDraft] = useState("");
  const [aiActionsLoading, setAiActionsLoading] = useState(false);
  const [aiActionsError, setAiActionsError] = useState("");
  const [draftSaved, setDraftSaved] = useState(false);
  const skipAutosave = useRef(true);
  const router = useRouter();

  useEffect(() => {
    if (open && series) {
      skipAutosave.current = true; // não regravar logo após hidratar
      setError(""); setActionOpen(false); setEditingIdx(null);
      setAiOpen(false); setAiLoading(false); setAiError(""); setDraftSaved(false);
      setAiActionsLoading(false); setAiActionsError("");
      if (draft) {
        // restaura o rascunho (anexos não são guardados)
        setAttendees(draft.attendees ?? []);
        setPresent(draft.present ?? {});
        setNotes(draft.notes ?? "");
        setDecisions(draft.decisions ?? "");
        setTranscript(draft.transcript ?? "");
        setAdvance(draft.advance ?? series.periodicity !== "sob_demanda");
        setAiDraft(draft.aiDraft ?? "");
        setAiActionsDraft(draft.aiActionsDraft ?? "");
        setCollected((draft.collected ?? []).map((c) => ({
          payload: c.payload,
          summary: c.summary,
          source: c.source,
          headerFiles: [],
          demandaFiles: c.payload.demandas.map(() => []),
        })));
      } else {
        const ids = series.participantIds;
        setAttendees(ids);
        setPresent(Object.fromEntries(ids.map((id) => [id, true])));
        setNotes(""); setDecisions(""); setTranscript(""); setCollected([]);
        setAiDraft(""); setAiActionsDraft(""); setAdvance(series.periodicity !== "sob_demanda");
      }
    }
  }, [open, series, draft]);

  // autosave do rascunho (debounce ~1s) enquanto o formulário está aberto
  useEffect(() => {
    if (!open || !occurrenceId) return;
    if (skipAutosave.current) { skipAutosave.current = false; return; }
    const t = setTimeout(async () => {
      const payload: OccurrenceDraft = {
        notes, decisions, transcript, attendees, present, advance, aiDraft, aiActionsDraft,
        collected: collected.map((c) => ({ payload: c.payload, summary: c.summary, source: c.source })),
      };
      const r = await saveOccurrenceDraft(occurrenceId, payload);
      if (r.ok) { setDraftSaved(true); setTimeout(() => setDraftSaved(false), 1500); }
    }, 1000);
    return () => clearTimeout(t);
  }, [open, occurrenceId, notes, decisions, transcript, attendees, present, advance, aiDraft, aiActionsDraft, collected]);

  if (!open || !series) return null;

  const onAttendeesChange = (ids: string[]) => {
    setAttendees(ids);
    setPresent((prev) => {
      const next: Record<string, boolean> = {};
      for (const id of ids) next[id] = prev[id] ?? true;
      return next;
    });
  };

  const presentCount = attendees.filter((id) => present[id]).length;

  const submit = () => {
    setError("");
    if (!occurrenceId) { setError("Reunião inválida."); return; }
    if (!notes.trim()) { setError("Preencha as anotações da reunião para finalizar."); return; }
    start(async () => {
      const res = await finishOccurrence({
        occurrence_id: occurrenceId,
        notes,
        decisions,
        transcript,
        advance_next: advance,
        attendance: attendees.map((id) => ({ user_id: id, present: !!present[id] })),
      });
      if (res.error) { setError(res.error); return; }
      const occId = res.occurrenceId;

      // cria cada ação completa, já vinculada a esta ocorrência (com anexos)
      for (const ca of collected) {
        const fd = new FormData();
        fd.append("payload", JSON.stringify({ ...ca.payload, occurrence_id: occId }));
        ca.headerFiles.forEach((f) => fd.append("files", f));
        ca.demandaFiles.forEach((files, i) => files.forEach((f) => fd.append(`files_${i}`, f)));
        const r2 = await createAction(fd);
        if (r2.error) { setError("Reunião finalizada, mas falhou ao criar uma ação: " + r2.error); router.refresh(); return; }
      }

      onClose();
      router.refresh();
    });
  };

  const runAI = async () => {
    setAiError("");
    if (!aiDraft.trim()) { setAiError("Escreva ou cole um rascunho/transcrição da reunião."); return; }
    setAiLoading(true);
    const presentes = attendees.filter((id) => present[id]).map((id) => byId.get(id)?.name ?? "—");
    const res = await generateMeetingAI({
      draft: aiDraft,
      objetivo: series.objetivo,
      pautaItens: series.content.map((c) => c.item).filter(Boolean),
      presentes,
    });
    setAiLoading(false);
    if (!res.ok) { setAiError(res.error); return; }
    setNotes(res.anotacoes);
    setDecisions(res.decisoes);
    setAiOpen(false);
  };

  const runActionsAI = async () => {
    setAiActionsError("");
    // fonte = anotações da reunião (evita redigitar); usa também as decisões como contexto
    const base = [notes.trim(), decisions.trim() ? `Decisões: ${decisions.trim()}` : ""].filter(Boolean).join("\n\n");
    if (!base) { setAiActionsError("Preencha as anotações da reunião primeiro, a IA sugere as ações a partir delas."); return; }
    // se já houver ações sugeridas antes pela IA, regerar SUBSTITUI esse lote (evita duplicar)
    const hadAi = collected.some((c) => c.source === "ai");
    if (hadAi) {
      const ok = await confirmDialog({
        title: "Regerar ações com IA",
        message: "As ações sugeridas pela IA anteriormente serão substituídas por esta nova sugestão a partir das anotações atuais. As ações adicionadas ou editadas por você à mão são mantidas.",
        confirmLabel: "Substituir e gerar",
      });
      if (!ok) return;
    }
    setAiActionsLoading(true);
    const presentIds = attendees.filter((id) => present[id]);
    const candidates = people.map((p) => ({ id: p.id, name: p.name }));
    // catálogo SDPO numerado: itens com seção/pilar resolvidos; bloco é opcional
    const sdpoItens = itens
      .map((it) => {
        const s = secoes.find((x) => x.id === it.secaoId);
        const p = pilares.find((x) => x.id === it.pilarId);
        if (!s || !p) return null;
        const b = it.blocoId ? blocos.find((x) => x.id === it.blocoId) : undefined;
        if (it.blocoId && !b) return null;
        const label = b ? `${p.name} > ${s.name} > ${b.name} > ${it.name}` : `${p.name} > ${s.name} > ${it.name}`;
        return { item_id: it.id, secao_id: s.id, bloco_id: b?.id ?? "", pilar_id: p.id, label };
      })
      .filter((x): x is { item_id: string; secao_id: string; bloco_id: string; pilar_id: string; label: string } => !!x);
    const today = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD no fuso local

    const res = await generateActionsAI({
      draft: base,
      objetivo: series.objetivo,
      pautaItens: series.content.map((c) => c.item).filter(Boolean),
      candidates,
      sdpoItens,
      kpis,
      tools,
      today,
    });
    setAiActionsLoading(false);
    if (!res.ok) { setAiActionsError(res.error); return; }

    const defaultRequester = series.ownerUserId ?? presentIds[0] ?? attendees[0] ?? "";
    const novos: CollectedAction[] = res.actions.map((s) => {
      const p = s.payload;
      return {
        // reunião travada nesta ocorrência; ocorrência é vinculada ao finalizar
        payload: {
          is_sdpo: p.is_sdpo, pilar_id: p.pilar_id, secao_id: p.secao_id, bloco_id: p.bloco_id, item_id: p.item_id,
          meeting_series_id: series.id, kpi_id: p.kpi_id, tool_id: p.tool_id,
          requester_id: p.requester_id || defaultRequester,
          due_date: p.due_date, priority: p.priority, cc: p.cc,
          demandas: p.demandas,
        },
        headerFiles: [],
        demandaFiles: p.demandas.map(() => []),
        summary: s.summary,
        source: "ai",
      };
    });
    // substitui o lote anterior da IA; mantém as manuais/editadas
    setCollected((cs) => [...cs.filter((c) => c.source !== "ai"), ...novos]);
  };

  // ao fechar, garante o salvamento do estado atual (cobre a janela do debounce)
  const handleClose = () => {
    const payload: OccurrenceDraft = {
      notes, decisions, attendees, present, advance, aiDraft, aiActionsDraft,
      collected: collected.map((c) => ({ payload: c.payload, summary: c.summary, source: c.source })),
    };
    onDraftChange?.(payload); // mantém em memória para reabrir na mesma sessão
    if (occurrenceId) void saveOccurrenceDraft(occurrenceId, payload);
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: actionOpen ? "transparent" : "rgba(3, 6, 14, 0.6)", backdropFilter: actionOpen ? "none" : "blur(4px)", WebkitBackdropFilter: actionOpen ? "none" : "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 60, overflowY: "auto" }}>
      {/* card da reunião: oculto (mas preservado) enquanto "Nova ação" está aberto */}
      <div className="card" style={{ width: "100%", maxWidth: 620, boxShadow: "var(--mh-shadow-e3)", display: actionOpen ? "none" : undefined }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <div>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>Finalizar reunião</h2>
            <p className="muted" style={{ margin: "0.15rem 0 0", fontSize: "0.85rem" }}>{series.name} · {PERIODICITY[series.periodicity as keyof typeof PERIODICITY]}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <span style={{ fontSize: "0.76rem", color: "var(--mh-success)", opacity: draftSaved ? 1 : 0, transition: "opacity 0.2s" }}>✓ Rascunho salvo</span>
            <button type="button" onClick={handleClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
          </div>
        </div>

        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1.1rem" }}>
          {startedAt && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.8rem", background: "var(--mh-info-soft)", border: "1px solid color-mix(in srgb, var(--mh-info) 32%, transparent)", borderRadius: 9, padding: "0.6rem 0.9rem" }}>
              <div className="soft" style={{ fontSize: "0.83rem", color: "var(--mh-info)" }}>
                Iniciada às {formatTime(startedAt)} · em andamento
              </div>
              <ElapsedTimer startedAt={startedAt} style={{ fontSize: "1.1rem", color: "var(--mh-info)" }} />
            </div>
          )}

          <details style={{ background: "var(--surface-2)", borderRadius: 9, padding: "0.6rem 0.9rem" }}>
            <summary style={{ cursor: "pointer", fontSize: "0.82rem", fontWeight: 600, color: "var(--text-muted)" }}>Ver TOR da reunião</summary>
            <div style={{ marginTop: "0.8rem" }}>
              <TorView series={series} participantNames={attendees.map((id) => byId.get(id)?.name ?? "—")} />
            </div>
          </details>

          <div>
            <label className="label">Presença · {presentCount}/{attendees.length} presentes</label>
            {attendees.length > 0 && (
              <div style={{ border: "1px solid var(--border)", borderRadius: 9, maxHeight: 220, overflowY: "auto", marginBottom: "0.5rem" }}>
                {attendees.map((id) => {
                  const p = byId.get(id);
                  return (
                    <label key={id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--border)", cursor: "pointer", fontSize: "0.85rem" }}>
                      <input type="checkbox" checked={!!present[id]} onChange={(e) => setPresent((prev) => ({ ...prev, [id]: e.target.checked }))} />
                      <Avatar name={p?.name ?? "?"} userId={id} />
                      <span style={{ flex: 1 }}>{p?.name ?? "—"}</span>
                      <span className="soft" style={{ fontSize: "0.75rem" }}>{present[id] ? "Presente" : "Ausente"}</span>
                    </label>
                  );
                })}
              </div>
            )}
            <PeoplePicker people={people} selected={attendees} onChange={onAttendeesChange} placeholder="Adicionar participante…" />
          </div>

          {occurrenceId && (
            <MeetingRecordingPanel
              occurrenceId={occurrenceId}
              onUseTranscript={aiEnabled ? (t) => { setAiDraft(t); setAiOpen(true); } : undefined}
              onSaveTranscript={(t) => setTranscript((prev) => (prev.trim() ? `${prev.trim()}\n\n${t}` : t))}
            />
          )}

          {aiEnabled && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 9, padding: "0.7rem 0.9rem", background: "var(--surface-2)" }}>
              {!aiOpen ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAiOpen(true)}>
                  ✨ Gerar anotações e decisões com IA
                </button>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <label className="label" style={{ margin: 0 }}>Rascunho / transcrição da reunião</label>
                  <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
                    Escreva pontos soltos ou cole a transcrição. A IA organiza em Anotações e Decisões, você pode editar depois.
                  </p>
                  <textarea
                    className="textarea"
                    value={aiDraft}
                    onChange={(e) => setAiDraft(e.target.value)}
                    placeholder="Ex.: falamos sobre o atraso da entrega X, João vai assumir Y, decidimos adiar Z para a próxima…"
                    style={{ minHeight: 100 }}
                    disabled={aiLoading}
                  />
                  {aiError && <p style={{ color: "var(--mh-danger)", fontSize: "0.8rem", margin: 0 }}>{aiError}</p>}
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button type="button" className="btn btn-primary btn-sm" onClick={runAI} disabled={aiLoading}>
                      {aiLoading ? "Gerando…" : "Gerar"}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAiOpen(false); setAiError(""); }} disabled={aiLoading}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="label" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
              Anotações <span style={{ color: "var(--mh-danger)" }}>*</span>
              <InfoHint label="O que descrever nas anotações para ajudar a IA">
                <span style={{ fontSize: "0.72rem" }}>
                  Ao descrever as anotações, cite quando fizer sentido:
                  <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem", display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                    <li><strong>Prioridade</strong> (baixa, média, alta, urgente)</li>
                    <li><strong>Prazo</strong> (ex.: “até sexta”, “em 15 dias”, “30/09/2026”)</li>
                    <li><strong>Pilar / Bloco / Item</strong> (SDPO)</li>
                    <li><strong>KPI</strong> relacionado</li>
                    <li><strong>Ferramenta de gestão</strong> (ex.: PDCA, 5W2H)</li>
                    <li><strong>Solicitante</strong> e quem fica <strong>em cópia</strong></li>
                    <li><strong>Ação</strong> e <strong>responsável(is)</strong></li>
                  </ul>
                </span>
              </InfoHint>
            </label>
            <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Resumo, discussões e pontos tratados… (obrigatório)" />
          </div>

          <div>
            <label className="label">Decisões</label>
            <textarea className="textarea" value={decisions} onChange={(e) => setDecisions(e.target.value)} placeholder="Deliberações tomadas na reunião…" style={{ minHeight: 60 }} />
          </div>

          <div>
            <label className="label">Transcrição</label>
            <textarea className="textarea" value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder="Transcrição da gravação (use “Salvar transcrição” na gravação, ou cole aqui)…" style={{ minHeight: 60 }} />
          </div>

          {/* Ações da reunião (formulário completo) */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
              <label className="label" style={{ margin: 0 }}>Ações da reunião</label>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditingIdx(null); setActionOpen(true); }}>+ Nova ação</button>
            </div>

            {aiEnabled && (
              <div style={{ border: "1px solid var(--border)", borderRadius: 9, padding: "0.7rem 0.9rem", background: "var(--surface-2)", marginBottom: "0.6rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={runActionsAI} disabled={aiActionsLoading || !notes.trim()}>
                  {aiActionsLoading ? "Gerando ações…" : "✨ Sugerir ações a partir das anotações"}
                </button>
                {!notes.trim() && (
                  <p style={{ color: "var(--mh-danger)", fontSize: "0.78rem", margin: 0 }}>
                    Preencha as anotações da reunião primeiro, a IA sugere as ações a partir delas.
                  </p>
                )}
                <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
                  A IA lê as anotações (e decisões) acima e monta as ações, com responsáveis, prazo e classificação SDPO quando der. Você revisa e edita cada uma antes de finalizar.
                </p>
                {aiActionsError && <p style={{ color: "var(--mh-danger)", fontSize: "0.8rem", margin: 0 }}>{aiActionsError}</p>}
              </div>
            )}

            {collected.length === 0 ? (
              <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Nenhuma ação. Use “+ Nova ação” para abrir o formulário completo, a reunião já vem preenchida.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {collected.map((ca, i) => {
                  const nFiles = ca.headerFiles.length + ca.demandaFiles.reduce((s, f) => s + f.length, 0);
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.6rem", background: "var(--surface-2)", borderRadius: 8, padding: "0.5rem 0.7rem" }}>
                      <button type="button" onClick={() => { setEditingIdx(i); setActionOpen(true); }} title="Editar ação" style={{ minWidth: 0, flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                        <div style={{ fontSize: "0.86rem", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ca.summary || "Ação"}</div>
                        <div className="soft" style={{ fontSize: "0.76rem" }}>
                          {ca.payload.demandas.length} demanda(s){ca.payload.is_sdpo ? " · SDPO" : ""}{nFiles > 0 ? ` · 📎${nFiles}` : ""}
                        </div>
                      </button>
                      <div style={{ display: "flex", gap: "0.3rem", flexShrink: 0 }}>
                        <button type="button" className="icon-btn" onClick={() => { setEditingIdx(i); setActionOpen(true); }} title="Editar ação" style={{ width: 30, height: 30 }}>
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /><path d="m15 5 4 4" /></svg>
                        </button>
                        <button type="button" className="icon-btn icon-btn-danger" onClick={() => setCollected((cs) => cs.filter((_, idx) => idx !== i))} title="Remover" style={{ width: 30, height: 30 }}>×</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {series.periodicity !== "sob_demanda" && (
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
              <input type="checkbox" checked={advance} onChange={(e) => setAdvance(e.target.checked)} />
              Avançar automaticamente a próxima reunião ({PERIODICITY[series.periodicity as keyof typeof PERIODICITY].toLowerCase()})
            </label>
          )}

          {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>{error}</p>}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <span className="soft" style={{ fontSize: "0.75rem" }}>O preenchimento fica salvo automaticamente até finalizar ou cancelar (anexos não ficam no rascunho).</span>
          <div style={{ display: "flex", gap: "0.6rem" }}>
            <button type="button" className="btn btn-ghost" onClick={handleClose}>Fechar</button>
            <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>
              {pending ? "Finalizando…" : "Finalizar reunião"}
            </button>
          </div>
        </div>
      </div>

      <ActionDialog
        open={actionOpen}
        onClose={() => { setActionOpen(false); setEditingIdx(null); }}
        people={people}
        pilares={pilares}
        secoes={secoes}
        blocos={blocos}
        itens={itens}
        kpis={kpis}
        tools={tools}
        series={[]}
        occurrences={[]}
        onCollect={(a) => {
          // criada ou editada à mão vira "manual" — assim não é substituída ao regerar por IA
          const m: CollectedAction = { ...a, source: "manual" };
          setCollected((cs) => (editingIdx !== null ? cs.map((c, idx) => (idx === editingIdx ? m : c)) : [...cs, m]));
          setEditingIdx(null);
        }}
        editing={editingIdx !== null ? collected[editingIdx] : null}
        lockedSeries={{ id: series.id, name: series.name }}
        units={seriesUnits}
        defaultUnitId={seriesUnits.length === 1 ? seriesUnits[0].id : undefined}
        aiEnabled={aiEnabled}
      />
    </div>
  );
}
