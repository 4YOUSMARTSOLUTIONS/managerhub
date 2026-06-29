"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateTicketTriage, getTicketAttachmentUrl, getTicketComments, addTicketComment, type TicketComment } from "@/lib/actions/tickets";
import { Avatar } from "@/components/ui/Avatar";
import { PRIORITY, TICKET_STATUS, options } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import type { Enums } from "@/types/database";
import type { TicketRow, Opt, CatOpt, Member } from "./TicketsManager";

export function TicketPanel({
  open, onClose, ticket, sectors, categories, members, canEdit, canComment,
}: {
  open: boolean;
  onClose: () => void;
  ticket: TicketRow | null;
  sectors: Opt[];
  categories: CatOpt[];
  members: Member[];
  canEdit: boolean;
  canComment: boolean;
}) {
  const [status, setStatus] = useState<Enums<"ticket_status">>("open");
  const [priority, setPriority] = useState<Enums<"priority_level">>("medium");
  const [sectorId, setSectorId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (open && ticket) {
      setStatus(ticket.status);
      setPriority(ticket.priority);
      setSectorId(ticket.sectorId ?? "");
      setCategoryId(ticket.categoryId ?? "");
      setAssigneeId(ticket.assigneeId ?? "");
      setError("");
      setUrls({});
      setComments([]);
      setCommentText("");
      // gera URLs assinadas das imagens
      (async () => {
        const entries = await Promise.all(
          ticket.attachments.map(async (a) => [a.id, (await getTicketAttachmentUrl(a.path)) ?? ""] as const),
        );
        setUrls(Object.fromEntries(entries.filter(([, u]) => u)));
      })();
      getTicketComments(ticket.id).then(setComments);
    }
  }, [open, ticket]);

  const cats = useMemo(() => categories.filter((c) => c.sectorId === sectorId), [categories, sectorId]);

  if (!open || !ticket) return null;

  const save = () => {
    setError("");
    start(async () => {
      const res = await updateTicketTriage({
        ticket_id: ticket.id,
        status,
        priority,
        sector_id: sectorId || null,
        category_id: categoryId || null,
        assignee_id: assigneeId || null,
      });
      if (res.error) { setError(res.error); return; }
      onClose();
      router.refresh();
    });
  };

  const sendComment = () => {
    const text = commentText.trim();
    if (!text || !ticket) return;
    setError("");
    start(async () => {
      const res = await addTicketComment(ticket.id, text);
      if (res.error) { setError(res.error); return; }
      setCommentText("");
      setComments(await getTicketComments(ticket.id));
      router.refresh();
    });
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 60, overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 560, boxShadow: "var(--shadow)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <div>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>{ticket.code ? `${ticket.code} · ` : ""}{ticket.title}</h2>
            <p className="muted" style={{ margin: "0.15rem 0 0", fontSize: "0.83rem" }}>
              Solicitante: {ticket.requesterName ?? "—"} · pediu prioridade <strong>{ticket.requestedPriority ? PRIORITY[ticket.requestedPriority] : "—"}</strong>
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>

        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          {ticket.description && (
            <div>
              <label className="label">Descrição</label>
              <p style={{ margin: 0, fontSize: "0.88rem", whiteSpace: "pre-wrap" }}>{ticket.description}</p>
            </div>
          )}

          {ticket.attachments.length > 0 && (
            <div>
              <label className="label">Evidências</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {ticket.attachments.map((a) => (
                  urls[a.id] ? (
                    <a key={a.id} href={urls[a.id]} target="_blank" rel="noreferrer" title={a.filename}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={urls[a.id]} alt={a.filename} style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)" }} />
                    </a>
                  ) : (
                    <div key={a.id} style={{ width: 80, height: 80, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)" }} />
                  )
                ))}
              </div>
            </div>
          )}

          {canEdit ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
                <div>
                  <label className="label">Status</label>
                  <select className="select" value={status} onChange={(e) => setStatus(e.target.value as Enums<"ticket_status">)}>
                    {options(TICKET_STATUS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Prioridade</label>
                  <select className="select" value={priority} onChange={(e) => setPriority(e.target.value as Enums<"priority_level">)}>
                    {options(PRIORITY).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
                <div>
                  <label className="label">Setor</label>
                  <select className="select" value={sectorId} onChange={(e) => { setSectorId(e.target.value); setCategoryId(""); }}>
                    <option value="">—</option>
                    {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Categoria</label>
                  <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!sectorId}>
                    <option value="">—</option>
                    {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Responsável</label>
                <select className="select" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                  <option value="">A definir</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
                Ao mudar a prioridade ou a categoria, o prazo é recalculado pelo SLA e o solicitante é notificado.
              </p>
              {error && <p style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
            </>
          ) : (
            <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>Somente o gestor de chamados (ou owner/admin) pode tratar este chamado.</p>
          )}

          {/* Comentários */}
          <div>
            <label className="label">Comentários</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", maxHeight: 240, overflowY: "auto" }}>
              {comments.length === 0 ? (
                <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Sem comentários.</p>
              ) : comments.map((c) => (
                <div key={c.id} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                  <Avatar name={c.authorName ?? "?"} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "0.83rem" }}>
                      <strong>{c.authorName ?? "—"}</strong>
                      <span className="soft" style={{ fontSize: "0.74rem" }}> · {formatDateTime(c.createdAt)}</span>
                    </div>
                    <div className="muted" style={{ fontSize: "0.83rem", marginTop: 2, whiteSpace: "pre-wrap" }}>{c.body}</div>
                  </div>
                </div>
              ))}
            </div>
            {canComment && (
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", marginTop: "0.6rem" }}>
                <textarea className="textarea" value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Escreva um comentário…" style={{ minHeight: 46 }} />
                <button type="button" className="btn btn-primary btn-sm" disabled={pending || !commentText.trim()} onClick={sendComment}>Enviar</button>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>{canEdit ? "Cancelar" : "Fechar"}</button>
          {canEdit && <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>{pending ? "Salvando…" : "Salvar"}</button>}
        </div>
      </div>
    </div>
  );
}
