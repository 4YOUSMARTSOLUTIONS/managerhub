"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, ChevronDown, LogOut, Moon, Sun, UserRound, Volume2, VolumeX } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { useAvatars } from "@/components/AvatarProvider";
import { ProfileDialog } from "@/components/ProfileDialog";
import { STATUS_COR, STATUS_ROTULO, useChatStatus } from "@/components/chat/ChatPresenceProvider";
import { useChatVivo } from "@/components/chat/ChatLiveProvider";
import { StatusDropdown } from "@/components/chat/StatusDropdown";
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
  // presença e alertas do chat: bolinha no avatar, troca de status e os
  // liga/desliga de som e prévia valem em qualquer tela, não só no /chat
  const { meuStatus, mudarStatus, ativo: chatAtivo } = useChatStatus();
  const { som, alternarSom, notificacoes, alternarNotificacoes } = useChatVivo();

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

  // compacto de propósito: no sidebar o menu abre para cima e não pode
  // engolir a navegação inteira
  const itemStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    width: "100%",
    padding: "0.35rem 0.6rem",
    background: "none",
    border: "none",
    borderRadius: "var(--mh-radius-sm)",
    fontSize: "0.78rem",
    color: "var(--mh-text-1)",
    cursor: "pointer",
    textAlign: "left",
    whiteSpace: "nowrap",
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
            padding: "0.3rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.05rem",
          }}
        >
          {/* no sidebar o gatilho logo abaixo já mostra nome e papel; repetir
              aqui só empurrava o menu para cima da navegação */}
          {!isSidebar && (
            <div style={{ padding: "0.3rem 0.6rem 0.45rem", borderBottom: "1px solid var(--mh-border)", marginBottom: "0.15rem" }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {userName ?? "Usuário"}
              </div>
              <div className="soft" style={{ fontSize: "0.68rem" }}>{ROLE[role]}</div>
            </div>
          )}

          {chatAtivo && (
            <>
              {/* o status num dropdown: rótulo à esquerda, pílula colorida à
                  direita, o mesmo controle da coluna do chat */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", padding: "0.2rem 0.6rem 0.3rem" }}>
                <span style={{ fontSize: "0.75rem", fontWeight: 600 }}>Status no chat</span>
                <StatusDropdown status={meuStatus} onMudar={mudarStatus} />
              </div>

              {/* som e prévia independentes: qualquer combinação, e com os
                  dois desligados fica só o contador do balão */}
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={som}
                style={itemStyle}
                onClick={alternarSom}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--mh-surface-2)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
              >
                {som ? <Volume2 size={14} /> : <VolumeX size={14} style={{ color: "var(--mh-text-3)" }} />}
                <span style={{ flex: 1 }}>Som de mensagem</span>
                <span className="soft" style={{ fontSize: "0.68rem" }}>{som ? "Ligado" : "Desligado"}</span>
              </button>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={notificacoes}
                style={itemStyle}
                onClick={alternarNotificacoes}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--mh-surface-2)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
              >
                {notificacoes ? <Bell size={14} /> : <BellOff size={14} style={{ color: "var(--mh-text-3)" }} />}
                <span style={{ flex: 1 }}>Prévia da mensagem</span>
                <span className="soft" style={{ fontSize: "0.68rem" }}>{notificacoes ? "Ligada" : "Desligada"}</span>
              </button>
              <div style={{ borderTop: "1px solid var(--mh-border)", margin: "0.15rem 0" }} />
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
            <UserRound size={14} />
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
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
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
              <LogOut size={14} />
              Sair
            </button>
          </form>
        </div>
      )}

      {perfil && <ProfileDialog onClose={() => setPerfil(false)} />}
    </div>
  );
}
