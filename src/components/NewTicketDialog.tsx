"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTicket } from "@/lib/actions/tickets";
import { initialActionState } from "@/lib/actions/types";
import { PRIORITY, TICKET_SLA_UNIT, options } from "@/lib/constants";
import type { Enums } from "@/types/database";

export type Opt = { id: string; name: string };
export type CatOpt = { id: string; name: string; sectorId: string };
export type SlaOpt = { categoryId: string; priority: Enums<"priority_level">; value: number; unit: Enums<"ticket_sla_unit"> };

export function NewTicketDialog({
  open, onClose, sectors, categories, units, slas,
}: {
  open: boolean;
  onClose: () => void;
  sectors: Opt[];
  categories: CatOpt[];
  units: Opt[];
  slas: SlaOpt[];
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
  const router = useRouter();

  const cats = useMemo(() => categories.filter((c) => c.sectorId === sectorId), [categories, sectorId]);
  const sla = useMemo(
    () => slas.find((s) => s.categoryId === categoryId && s.priority === priority),
    [slas, categoryId, priority],
  );

  if (!open) return null;

  const reset = () => {
    setTitle(""); setDescription(""); setSectorId(""); setCategoryId(""); setUnitId("");
    setPriority("medium"); setFiles([]); setError("");
  };
  const close = () => { reset(); onClose(); };

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
      reset();
      onClose();
      router.refresh();
    });
  };

  return (
    <div onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 60, overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 560, boxShadow: "var(--shadow)" }}>
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
                {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
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

          <div style={{ maxWidth: 260 }}>
            <label className="label">Prioridade <span className="soft">(sua percepção)</span></label>
            <select className="select" value={priority} onChange={(e) => setPriority(e.target.value as Enums<"priority_level">)}>
              {options(PRIORITY).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
            {sla
              ? `Prazo previsto: ${sla.value} ${TICKET_SLA_UNIT[sla.unit]} (definido pelo SLA da categoria).`
              : "O prazo é definido automaticamente pelo SLA da categoria/prioridade configurado em Configurações."}
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
            <label className="label">Anexos <span className="soft">(imagens — evidências)</span></label>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) setFiles((prev) => [...prev, ...Array.from(e.target.files!).filter((f) => f.type.startsWith("image/"))]); e.target.value = ""; }} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>↑ Adicionar imagem</button>
            {files.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem" }}>
                {files.map((f, i) => (
                  <div key={i} style={{ position: "relative" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={URL.createObjectURL(f)} alt={f.name} style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)" }} />
                    <button type="button" onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))} aria-label="Remover" style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", border: "none", background: "#dc2626", color: "#fff", cursor: "pointer", fontSize: "0.8rem", lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <p style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0, background: "#fef2f2", padding: "0.5rem 0.7rem", borderRadius: 8 }}>{error}</p>}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" onClick={close}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>{pending ? "Abrindo…" : "Abrir chamado"}</button>
        </div>
      </div>
    </div>
  );
}
