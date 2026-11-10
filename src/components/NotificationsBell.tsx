"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getNotifications, markNotificationsRead, type NotificationRow } from "@/lib/actions/notifications";
import { formatDateTime } from "@/lib/format";
import { destinoDaNotificacao } from "@/lib/notificacao-destino";
import { usePush } from "@/components/pwa/usePush";
import { useInstalacao } from "@/components/pwa/useInstalacao";
import { toast } from "sonner";

/** "Agora não" no convite do sino vale para este aparelho. */
const DISPENSA = "mh_push_convite_dispensado";

export function NotificationsBell() {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  // convite para ligar as notificações no celular: só no app instalado, que é
  // onde a pessoa espera recebê-las, e some com o "Agora não"
  const push = usePush();
  const { instalado } = useInstalacao();
  const [dispensado, setDispensado] = useState(() => {
    try { return typeof window !== "undefined" && localStorage.getItem(DISPENSA) === "1"; } catch { return false; }
  });
  const convidar = instalado && push.estado === "desligado" && !dispensado;
  const dispensar = () => {
    setDispensado(true);
    try { localStorage.setItem(DISPENSA, "1"); } catch { /* sem armazenamento: some só nesta visita */ }
  };
  const ativarPush = async () => {
    const r = await push.ativar();
    if (r.ok) toast.success("Notificações ligadas. Um aviso de teste chega em instantes.");
    else if (r.motivo === "bloqueado") { toast.info("As notificações não foram liberadas. Dá para ligar depois pelo menu do seu nome."); dispensar(); }
    else toast.error(r.motivo);
  };

  const load = () => getNotifications().then((r) => { setItems(r.items); setUnread(r.unread); });

  useEffect(() => { load(); }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) { load(); void push.preparar(); }
  };

  const markAll = async () => {
    await markNotificationsRead();
    setItems((xs) => xs.map((x) => ({ ...x, isRead: true })));
    setUnread(0);
  };

  const onItem = async (n: NotificationRow) => {
    if (!n.isRead) { await markNotificationsRead([n.id]); setUnread((u) => Math.max(0, u - 1)); setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, isRead: true } : x))); }
    setOpen(false);
    const destino = destinoDaNotificacao(n);
    if (destino) router.push(destino);
  };

  return (
    <div style={{ position: "relative" }} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <button type="button" onClick={toggle} className="icon-btn" title="Notificações" style={{ position: "relative" }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
        {unread > 0 && (
          <span style={{ position: "absolute", top: -4, right: -4, background: "var(--mh-danger)", color: "#fff", borderRadius: 999, fontSize: "0.62rem", fontWeight: 700, minWidth: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 340, maxHeight: 420, overflowY: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "var(--mh-shadow-e3)", zIndex: 50 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.7rem 0.9rem", borderBottom: "1px solid var(--border)" }}>
            <strong style={{ fontSize: "0.9rem" }}>Notificações</strong>
            {unread > 0 && <button type="button" className="btn btn-ghost btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={markAll}>Marcar todas como lidas</button>}
          </div>
          {convidar && (
            <div style={{ padding: "0.65rem 0.9rem", borderBottom: "1px solid var(--border)", background: "var(--mh-surface-2)", display: "flex", flexDirection: "column", gap: "0.45rem" }}>
              <span style={{ fontSize: "0.8rem", lineHeight: 1.45 }}>Receba estes avisos no celular, mesmo com o app fechado.</span>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                <button type="button" className="btn btn-primary btn-xs" onMouseDown={(e) => e.preventDefault()} onClick={ativarPush}>Ativar</button>
                <button type="button" className="btn btn-ghost btn-xs" onMouseDown={(e) => e.preventDefault()} onClick={dispensar}>Agora não</button>
              </div>
            </div>
          )}
          {items.length === 0 ? (
            <p className="soft" style={{ padding: "1rem 0.9rem", fontSize: "0.85rem", margin: 0 }}>Sem notificações.</p>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onItem(n)}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "0.6rem 0.9rem", background: n.isRead ? "none" : "var(--primary-soft)", border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer" }}
              >
                <div style={{ fontSize: "0.84rem", fontWeight: 600 }}>{n.title}</div>
                {n.body && <div className="muted" style={{ fontSize: "0.8rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.body}</div>}
                <div className="soft" style={{ fontSize: "0.72rem", marginTop: 2 }}>{formatDateTime(n.createdAt)}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
