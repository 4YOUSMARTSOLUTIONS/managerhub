"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { createTicket } from "@/lib/actions/tickets";
import { initialActionState } from "@/lib/actions/types";
import { PRIORITY, TICKET_SLA_UNIT, options } from "@/lib/constants";
import { ACCEPT_CHAMADO, ehPdf, recusaDeAnexoDeChamado } from "@/lib/uploads";
import type { Enums } from "@/types/database";

export type Opt = { id: string; name: string; active?: boolean };
export type CatOpt = { id: string; name: string; sectorId: string; active?: boolean };
export type SlaOpt = { categoryId: string; priority: Enums<"priority_level"> | null; value: number; unit: Enums<"ticket_sla_unit"> };

export function NewTicketDialog({
  open, onClose, sectors, categories, units, slas, slaMode,
}: {
  open: boolean;
  onClose: () => void;
  sectors: Opt[];
  categories: CatOpt[];
  units: Opt[];
  slas: SlaOpt[];
  slaMode: "priority" | "category";
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sectorId, setSectorId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [priority, setPriority] = useState<Enums<"priority_level">>("medium");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  // novo chamado usa só setores/categorias ativos
  const activeSectors = useMemo(() => sectors.filter((s) => s.active !== false), [sectors]);
  const cats = useMemo(() => categories.filter((c) => c.sectorId === sectorId && c.active !== false), [categories, sectorId]);
  const sla = useMemo(
    () => slas.find((s) => s.categoryId === categoryId && (slaMode === "category" ? s.priority == null : s.priority === priority)),
    [slas, categoryId, priority, slaMode],
  );

  if (!open) return null;

  const reset = () => {
    setTitle(""); setDescription(""); setSectorId(""); setCategoryId(""); setUnitId("");
    setPriority("medium"); setFiles([]); setError("");
  };
  const close = () => { reset(); onClose(); };

  // o que não passa é avisado na hora, em vez de sumir ao abrir o chamado
  const adicionarArquivos = (lista: FileList | null) => {
    const escolhidos = Array.from(lista ?? []);
    setError(escolhidos.map(recusaDeAnexoDeChamado).filter(Boolean).join(" "));
    setFiles((prev) => [...prev, ...escolhidos.filter((f) => !recusaDeAnexoDeChamado(f))]);
  };

  const submit = () => {
    setError("");
    if (!title.trim()) { setError("Informe o título do chamado."); return; }
    start(async () => {
      const fd = new FormData();
      fd.append("title", title);
      fd.append("description", description);
      fd.append("sector_id", sectorId);
      fd.append("category_id", categoryId);
      fd.append("unit_id", unitId);
      fd.append("priority", priority);
      for (const f of files) fd.append("files", f);
      const res = await createTicket(initialActionState, fd);
      if (res.error) { setError(res.error); return; }
      // confirmação com o número e o título: sem isso o formulário só fechava
      toast.success(res.message ?? "Chamado criado.", { description: title.trim() });
      if (res.warning) toast.warning(res.warning);
      reset();
      onClose();
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 60, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 560, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>Abrir chamado</h2>
          <button type="button" onClick={close} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>

        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label className="label">Unidade <span className="soft">(opcional)</span></label>
            <select className="select" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              <option value="">—</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
            <div>
              <label className="label">Setor</label>
              <select className="select" value={sectorId} onChange={(e) => { setSectorId(e.target.value); setCategoryId(""); }}>
                <option value="">Selecione…</option>
                {activeSectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Categoria</label>
              <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!sectorId}>
                <option value="">{sectorId ? "Selecione…" : "Escolha o setor"}</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          {slaMode !== "category" && (
            <div style={{ maxWidth: 260 }}>
              <label className="label">Prioridade <span className="soft">(sua percepção)</span></label>
              <select className="select" value={priority} onChange={(e) => setPriority(e.target.value as Enums<"priority_level">)}>
                {options(PRIORITY).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}

          <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
            {sla
              ? `Prazo previsto: ${sla.value} ${TICKET_SLA_UNIT[sla.unit]} (definido pelo SLA da categoria).`
              : "O prazo é definido automaticamente pelo SLA da categoria."}
          </p>

          <div>
            <label className="label">Título</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Computador não liga" />
          </div>
          <div>
            <label className="label">Descrição</label>
            <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Detalhe o problema ou solicitação" />
          </div>

          <div>
            <label className="label">Anexos <span className="soft">(imagens ou PDF, até 10 MB)</span></label>
            <input ref={fileRef} type="file" accept={ACCEPT_CHAMADO} multiple hidden onChange={(e) => { adicionarArquivos(e.target.files); e.target.value = ""; }} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>↑ Adicionar arquivo</button>
            {files.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem" }}>
                {files.map((f, i) => (
                  <div key={i} style={{ position: "relative" }}>
                    {ehPdf(f.name, f.type) ? (
                      <div title={f.name} style={{ width: 72, height: 72, boxSizing: "border-box", padding: "0 5px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text-muted)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3 }}>
                        <FileText size={20} />
                        <span style={{ fontSize: "0.62rem", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                      </div>
                    ) : (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={URL.createObjectURL(f)} alt={f.name} style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)" }} />
                    )}
                    <button type="button" onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))} aria-label="Remover" style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", border: "none", background: "var(--mh-danger)", color: "#fff", cursor: "pointer", fontSize: "0.8rem", lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>{error}</p>}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" onClick={close}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>{pending ? "Abrindo…" : "Abrir chamado"}</button>
        </div>
      </div>
    </div>
  );
}
