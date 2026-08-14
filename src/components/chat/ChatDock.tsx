"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, BellOff, ChevronLeft, Maximize2, MessageCircle, Send, X } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { carregarMensagens, enviarMensagem, type ConversaResumo, type MensagemChat } from "@/lib/actions/chat";
import { useChatVivo } from "./ChatLiveProvider";
import { STATUS_COR, useChatStatus } from "./ChatPresenceProvider";
import { EmojiPicker } from "./EmojiPicker";

/**
 * O balão do chat no canto direito: a conversa vem até você, em vez de você ir
 * até a tela do chat.
 *
 * Fechado é só a bolinha com o contador de não lidas; aberto mostra a lista de
 * conversas e, dentro dela, a conversa com campo de resposta. É resposta
 * rápida de propósito: anexo, edição, busca e administração continuam na tela
 * cheia, a um clique daqui.
 *
 * Some no /chat (lá a tela inteira já é o chat) e quando o módulo está
 * desligado.
 */
export function ChatDock({ meuId }: { meuId: string }) {
  const pathname = usePathname();
  const {
    conversas, naoLidas, canalAberto, abrirCanal, balaoAberto, setBalaoAberto,
    notificacoes, alternarNotificacoes, ativo,
  } = useChatVivo();

  if (!ativo || pathname?.startsWith("/chat")) return null;

  const conversa = conversas.find((c) => c.channelId === canalAberto) ?? null;

  return (
    <div style={{ position: "fixed", right: "1.25rem", bottom: "1.25rem", zIndex: 40, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.6rem" }}>
      {balaoAberto && (
        <div
          className="card"
          style={{
            width: "min(340px, calc(100vw - 2.5rem))",
            height: "min(460px, calc(100vh - 8rem))",
            display: "flex", flexDirection: "column", overflow: "hidden",
            boxShadow: "var(--mh-shadow-e3)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--mh-border)" }}>
            {conversa ? (
              <button
                type="button" className="muted" aria-label="Voltar para as conversas"
                onClick={() => abrirCanal(null)}
                style={{ background: "none", border: "none", cursor: "pointer", display: "flex", padding: 2 }}
              >
                <ChevronLeft size={17} />
              </button>
            ) : (
              <MessageCircle size={16} style={{ color: "var(--mh-primary)" }} />
            )}
            <span style={{ flex: 1, minWidth: 0, fontSize: "0.86rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {conversa ? rotulo(conversa, meuId) : "Chat interno"}
            </span>
            <button
              type="button" className="muted"
              title={notificacoes ? "Desligar a prévia da mensagem" : "Ligar a prévia da mensagem"}
              onClick={alternarNotificacoes}
              style={{ background: "none", border: "none", cursor: "pointer", display: "flex", padding: 2 }}
            >
              {notificacoes ? <Bell size={15} /> : <BellOff size={15} />}
            </button>
            <Link
              href="/chat" className="muted" title="Abrir a tela do chat"
              onClick={() => setBalaoAberto(false)}
              style={{ display: "flex", padding: 2 }}
            >
              <Maximize2 size={15} />
            </Link>
            <button
              type="button" className="muted" aria-label="Fechar"
              onClick={() => setBalaoAberto(false)}
              style={{ background: "none", border: "none", cursor: "pointer", display: "flex", padding: 2 }}
            >
              <X size={16} />
            </button>
          </div>

          {conversa
            ? <MiniConversa conversa={conversa} meuId={meuId} />
            : <MiniLista conversas={conversas} meuId={meuId} onAbrir={abrirCanal} />}
        </div>
      )}

      <button
        type="button"
        onClick={() => setBalaoAberto(!balaoAberto)}
        title={balaoAberto ? "Fechar o chat" : "Abrir o chat"}
        aria-label={naoLidas > 0 ? `Chat interno, ${naoLidas} não lidas` : "Chat interno"}
        style={{
          position: "relative", width: 52, height: 52, borderRadius: "50%",
          border: "none", cursor: "pointer", alignSelf: "flex-end",
          background: "var(--mh-primary)", color: "#fff",
          boxShadow: "var(--mh-shadow-e3)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        {balaoAberto ? <X size={22} /> : <MessageCircle size={22} />}
        {!balaoAberto && naoLidas > 0 && (
          <span
            style={{
              position: "absolute", top: -2, right: -2, minWidth: 20, height: 20,
              padding: "0 5px", borderRadius: 10, background: "var(--mh-danger)",
              color: "#fff", fontSize: "0.68rem", fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
              border: "2px solid var(--mh-surface-0, var(--mh-surface-1))",
            }}
          >
            {naoLidas > 99 ? "99+" : naoLidas}
          </span>
        )}
      </button>
    </div>
  );
}

function rotulo(c: ConversaResumo, meuId: string): string {
  if (c.kind === "grupo") return c.name ?? "Grupo";
  return c.membros.find((m) => m.id !== meuId)?.name ?? "Conversa";
}

function MiniLista({
  conversas, meuId, onAbrir,
}: {
  conversas: ConversaResumo[];
  meuId: string;
  onAbrir: (id: string) => void;
}) {
  const { presencas } = useChatStatus();

  if (conversas.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
        <p className="soft" style={{ fontSize: "0.8rem", textAlign: "center", margin: 0 }}>
          Nenhuma conversa ainda. Comece uma pela tela do chat.
        </p>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      {conversas.map((c) => {
        const outro = c.kind === "dm" ? c.membros.find((m) => m.id !== meuId) : null;
        return (
          <button
            key={c.channelId}
            type="button"
            onClick={() => onAbrir(c.channelId)}
            style={{
              display: "flex", gap: "0.55rem", alignItems: "center", width: "100%",
              padding: "0.55rem 0.7rem", background: "none", border: "none",
              borderBottom: "1px solid var(--mh-border)", cursor: "pointer", textAlign: "left",
            }}
          >
            <span style={{ position: "relative", display: "flex", flexShrink: 0 }}>
              <Avatar name={outro?.name ?? c.name} userId={outro?.id} size={30} />
              {outro && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute", right: -1, bottom: -1, width: 10, height: 10,
                    borderRadius: "50%", border: "2px solid var(--mh-surface-1)",
                    background: STATUS_COR[presencas[outro.id] ?? "offline"],
                  }}
                />
              )}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: "0.82rem", fontWeight: c.unread > 0 ? 700 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {rotulo(c, meuId)}
              </span>
              <span className="soft" style={{ display: "block", fontSize: "0.73rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.lastDeleted ? "Mensagem apagada" : c.lastBody ?? (c.lastAt ? "Anexo" : "Sem mensagens")}
              </span>
            </span>
            {c.unread > 0 && (
              <span style={{
                minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9,
                background: "var(--mh-primary)", color: "#fff", fontSize: "0.66rem", fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                {c.unread > 99 ? "99+" : c.unread}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Conversa dentro do balão: histórico recente e resposta. */
function MiniConversa({ conversa, meuId }: { conversa: ConversaResumo; meuId: string }) {
  const { aoVivo } = useChatVivo();
  const [historico, setHistorico] = useState<MensagemChat[] | null>(null);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const fimRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let vivo = true;
    carregarMensagens(conversa.channelId).then((ms) => { if (vivo) setHistorico(ms); });
    return () => { vivo = false; };
  }, [conversa.channelId]);

  // histórico + tempo real fundidos durante o render, dedup por id
  const doCanal = aoVivo[conversa.channelId];
  const mensagens = useMemo(() => {
    if (historico === null) return null;
    const porId = new Map(historico.map((m) => [m.id, m] as const));
    for (const m of doCanal ?? []) porId.set(m.id, m);
    return [...porId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [historico, doCanal]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [mensagens?.length]);

  const enviar = () => {
    const corpo = texto.trim();
    if (!corpo || pendente) return;
    setErro("");
    setTexto("");
    iniciar(async () => {
      const r = await enviarMensagem(conversa.channelId, corpo);
      if (r.error || !r.mensagem) { setErro(r.error ?? "Não foi possível enviar."); setTexto(corpo); return; }
      const nova = r.mensagem;
      setHistorico((atual) => ((atual ?? []).some((m) => m.id === nova.id) ? atual : [...(atual ?? []), nova]));
    });
  };

  const inserirEmoji = (emoji: string) => {
    const campo = campoRef.current;
    const inicio = campo?.selectionStart ?? texto.length;
    const fim = campo?.selectionEnd ?? texto.length;
    setTexto(texto.slice(0, inicio) + emoji + texto.slice(fim));
    requestAnimationFrame(() => {
      campo?.focus();
      const pos = inicio + emoji.length;
      campo?.setSelectionRange(pos, pos);
    });
  };

  const encerrado = Boolean(conversa.closedAt);

  return (
    <>
      {/* minHeight: 0 é o que deixa o filho com overflow rolar dentro do flex */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0.7rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
        {mensagens === null && <p className="soft" style={{ fontSize: "0.78rem" }}>Carregando…</p>}
        {mensagens?.length === 0 && (
          <p className="soft" style={{ fontSize: "0.78rem" }}>Nenhuma mensagem ainda. Diga olá.</p>
        )}
        {mensagens?.map((m) => {
          const minha = m.authorId === meuId;
          const autor = conversa.kind === "grupo" && !minha
            ? conversa.membros.find((x) => x.id === m.authorId)?.name ?? "" : "";
          return (
            <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: minha ? "flex-end" : "flex-start" }}>
              {autor && <span className="soft" style={{ fontSize: "0.68rem", margin: "0.2rem 0 0.05rem" }}>{autor}</span>}
              <div
                style={{
                  maxWidth: "82%", padding: "0.4rem 0.6rem", borderRadius: 11, fontSize: "0.82rem",
                  whiteSpace: "pre-wrap", overflowWrap: "break-word",
                  background: minha ? "var(--mh-primary-soft)" : "var(--mh-surface-2)",
                  border: "1px solid var(--mh-border)",
                }}
              >
                {m.deletedAt
                  ? <span className="soft" style={{ fontStyle: "italic" }}>
                      {m.deletedAdmin ? "Mensagem removida pela administração" : "Mensagem apagada"}
                    </span>
                  : m.body ?? "Anexo"}
                {!m.deletedAt && m.anexoPath && !m.body && (
                  <span className="soft" style={{ fontSize: "0.7rem" }}> · veja na tela do chat</span>
                )}
              </div>
            </div>
          );
        })}
        <div ref={fimRef} />
      </div>

      {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.76rem", margin: "0 0.7rem 0.3rem" }}>{erro}</p>}

      <div style={{ padding: "0.55rem 0.6rem", borderTop: "1px solid var(--mh-border)", display: "flex", gap: "0.35rem", alignItems: "flex-end" }}>
        <EmojiPicker onEscolher={inserirEmoji} disabled={encerrado} />
        <textarea
          ref={campoRef}
          className="input"
          rows={1}
          value={texto}
          disabled={encerrado}
          placeholder={encerrado ? "Conversa encerrada." : "Responder…"}
          style={{ flex: 1, resize: "none", maxHeight: 90, fontSize: "0.83rem" }}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
        />
        <button
          type="button" className="btn btn-primary btn-sm"
          disabled={pendente || !texto.trim() || encerrado}
          onClick={enviar}
          title="Enviar (Enter)"
        >
          <Send size={14} />
        </button>
      </div>
    </>
  );
}
