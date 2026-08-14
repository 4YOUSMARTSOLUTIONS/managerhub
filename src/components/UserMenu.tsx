"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, LogOut, Moon, Sun, UserRound } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { useAvatars } from "@/components/AvatarProvider";
import { ProfileDialog } from "@/components/ProfileDialog";
import { STATUS_COR, STATUS_ROTULO, useChatStatus } from "@/components/chat/ChatPresenceProvider";
import { setTheme } from "@/lib/actions/theme";
import { signOut } from "@/lib/actions/auth";
import { ROLE } from "@/lib/constants";
import type { Enums } from "@/types/database";
import type { Theme } from "@/lib/theme";

/** Menu do usuário: nome/avatar como gatilho; dentro, troca de tema e sair. */
export function UserMenu({
  userName,
  role,
  theme,
  variant = "topbar",
}: {
  userName: string | null | undefined;
  role: Enums<"member_role">;
  theme: Theme;
  /** "sidebar" = gatilho largo no rodapé, menu abre para cima */
  variant?: "topbar" | "sidebar";
}) {
  const isSidebar = variant === "sidebar";
  const [open, setOpen] = useState(false);
  const [perfil, setPerfil] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const next: Theme = theme === "dark" ? "light" : "dark";
  const { currentUserId } = useAvatars();
  // presença do chat: a bolinha no avatar e a troca de status valem em
  // qualquer tela, não só dentro do /chat
  const { meuStatus, mudarStatus, ativo: chatAtivo } = useChatStatus();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const itemStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    width: "100%",
    padding: "0.55rem 0.75rem",
    background: "none",
    border: "none",
    borderRadius: "var(--mh-radius-sm)",
    fontSize: "0.86rem",
    color: "var(--mh-text-1)",
    cursor: "pointer",
    textAlign: "left",
  };

  return (
    <div ref={ref} style={{ position: "relative", width: isSidebar ? "100%" : undefined }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={isSidebar ? "user-menu-trigger" : undefined}
        style={isSidebar ? {
          display: "flex", alignItems: "center", gap: "0.6rem", width: "100%",
          background: "none", border: "none", cursor: "pointer",
          padding: "0.5rem 0.6rem", borderRadius: "var(--mh-radius-md)", color: "inherit",
        } : {
          display: "flex", alignItems: "center", gap: "0.55rem",
          background: "none", border: "none", cursor: "pointer",
          padding: "0.2rem 0.3rem", borderRadius: "var(--mh-radius-md)", color: "inherit",
        }}
      >
        <span style={{ position: "relative", display: "flex", flexShrink: 0 }}>
          <Avatar name={userName} userId={currentUserId} />
          {chatAtivo && (
            <span
              aria-hidden
              title={`Chat: ${STATUS_ROTULO[meuStatus]}`}
              style={{
                position: "absolute", right: -1, bottom: -1, width: 11, height: 11,
                borderRadius: "50%", border: "2px solid var(--mh-surface-1)",
                background: STATUS_COR[meuStatus],
              }}
            />
          )}
        </span>
        {isSidebar && (
          <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
            <span style={{ display: "block", fontSize: "0.83rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{userName ?? "Usuário"}</span>
            <span className="soft" style={{ display: "block", fontSize: "0.7rem" }}>{ROLE[role]}</span>
          </span>
        )}
        <ChevronDown size={15} style={{ color: "var(--mh-text-3)", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }} />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            zIndex: 60,
            minWidth: 210,
            ...(isSidebar
              ? { left: 0, right: 0, bottom: "calc(100% + 8px)" }
              : { right: 0, top: "calc(100% + 8px)" }),
            background: "var(--mh-surface-1)",
            border: "1px solid var(--mh-border)",
            boxShadow: "var(--mh-shadow-e2)",
            borderRadius: "var(--mh-radius-md)",
            padding: "0.35rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.1rem",
          }}
        >
          <div style={{ padding: "0.4rem 0.75rem 0.55rem", borderBottom: "1px solid var(--mh-border)", marginBottom: "0.2rem" }}>
            <div style={{ fontSize: "0.86rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {userName ?? "Usuário"}
            </div>
            <div className="soft" style={{ fontSize: "0.72rem" }}>{ROLE[role]}</div>
          </div>

          {chatAtivo && (
            <>
              <div className="soft" style={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.04em", padding: "0.25rem 0.75rem 0.15rem" }}>
                Status no chat
              </div>
              {(["disponivel", "ocupado", "ausente"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="menuitemradio"
                  aria-checked={meuStatus === s}
                  style={{ ...itemStyle, fontWeight: meuStatus === s ? 600 : 400 }}
                  onClick={() => { mudarStatus(s); setOpen(false); }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--mh-surface-2)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                >
                  <span aria-hidden style={{ width: 9, height: 9, borderRadius: "50%", background: STATUS_COR[s], flexShrink: 0, marginLeft: 3 }} />
                  {STATUS_ROTULO[s]}
                </button>
              ))}
              <div style={{ borderTop: "1px solid var(--mh-border)", margin: "0.2rem 0" }} />
            </>
          )}

          <button
            type="button"
            role="menuitem"
            style={itemStyle}
            onClick={() => { setPerfil(true); setOpen(false); }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--mh-surface-2)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
          >
            <UserRound size={16} />
            Meu perfil
          </button>

          <button
            type="button"
            role="menuitem"
            style={itemStyle}
            disabled={pending}
            onClick={() => start(async () => { await setTheme(next); router.refresh(); setOpen(false); })}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--mh-surface-2)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            {next === "dark" ? "Tema escuro" : "Tema claro"}
          </button>

          <form action={signOut}>
            <button
              type="submit"
              role="menuitem"
              style={{ ...itemStyle, color: "var(--mh-danger)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--mh-surface-2)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              <LogOut size={16} />
              Sair
            </button>
          </form>
        </div>
      )}

      {perfil && <ProfileDialog onClose={() => setPerfil(false)} />}
    </div>
  );
}
