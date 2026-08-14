"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  getConversas, marcarLido, salvarPreferencias,
  type ConversaResumo, type MensagemChat,
} from "@/lib/actions/chat";
import { useChatRealtime } from "./useChatRealtime";

/**
 * O "pop" de mensagem nova, gerado na hora pela Web Audio API: dois tons
 * curtos, sem arquivo de áudio para servir.
 *
 * UM AudioContext para a página inteira, reutilizado. Criar um por mensagem
 * era um vazamento: o que nasce antes do primeiro gesto do usuário fica
 * "suspended" para sempre, e depois de meia dúzia pendurados o navegador
 * recusa contextos novos, o som funciona algumas vezes e morre. Com um só,
 * cada toque tenta um resume() e segue.
 */
let audioCtx: AudioContext | null = null;

function tocarSomDeMensagem() {
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.setValueAtTime(740, t);
    osc.frequency.setValueAtTime(988, t + 0.11);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    osc.start(t);
    osc.stop(t + 0.35);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  } catch {
    // sem áudio disponível: a notificação visual basta
  }
}

/**
 * O tempo real do chat mora no SHELL, não na tela do chat.
 *
 * Antes a assinatura do websocket vivia dentro do ChatManager: quem estava em
 * qualquer outra tela não recebia aviso nenhum, e a mensagem só aparecia ao
 * voltar para o /chat. Aqui a assinatura é UMA para o app inteiro e alimenta
 * três coisas: o toast em qualquer tela, o contador do balão flutuante e a
 * própria tela cheia do chat (que consome este contexto em vez de assinar de
 * novo, senão cada mensagem chegaria duas vezes).
 *
 * O canal aberto também é compartilhado: abrir uma conversa no balão e depois
 * ir para a tela cheia continua na mesma conversa, e nenhuma das duas mostra
 * toast do que já está à vista.
 */
type ValorChatVivo = {
  conversas: ConversaResumo[];
  /** mensagens chegadas pelo websocket, por canal (a thread funde com o histórico) */
  aoVivo: Record<string, MensagemChat[]>;
  naoLidas: number;
  /** conversa aberta, seja no balão ou na tela cheia */
  canalAberto: string | null;
  abrirCanal: (id: string | null) => void;
  /** o balão flutuante está aberto */
  balaoAberto: boolean;
  setBalaoAberto: (v: boolean) => void;
  recarregar: () => void;
  notificacoes: boolean;
  alternarNotificacoes: () => void;
  /** false quando não há chat (sem empresa ou módulo desligado) */
  ativo: boolean;
};

const Ctx = createContext<ValorChatVivo>({
  conversas: [],
  aoVivo: {},
  naoLidas: 0,
  canalAberto: null,
  abrirCanal: () => {},
  balaoAberto: false,
  setBalaoAberto: () => {},
  recarregar: () => {},
  notificacoes: true,
  alternarNotificacoes: () => {},
  ativo: false,
});

export function useChatVivo() {
  return useContext(Ctx);
}

export function ChatLiveProvider({
  meuId,
  conversasIniciais,
  notificacoesIniciais,
  children,
}: {
  /** null desliga tudo: sem empresa, ou chat não contratado */
  meuId: string | null;
  conversasIniciais: ConversaResumo[];
  notificacoesIniciais: boolean;
  children: React.ReactNode;
}) {
  const [conversas, setConversas] = useState(conversasIniciais);
  const [aoVivo, setAoVivo] = useState<Record<string, MensagemChat[]>>({});
  const [canalAberto, setCanalAberto] = useState<string | null>(null);
  const [balaoAberto, setBalaoAberto] = useState(false);
  const [notificacoes, setNotificacoes] = useState(notificacoesIniciais);

  // refs para o handler do websocket enxergar o estado novo sem reassinar
  const abertoRef = useRef(canalAberto);
  useEffect(() => { abertoRef.current = canalAberto; }, [canalAberto]);
  const notifRef = useRef(notificacoes);
  useEffect(() => { notifRef.current = notificacoes; }, [notificacoes]);
  const conversasRef = useRef(conversas);
  useEffect(() => { conversasRef.current = conversas; }, [conversas]);

  const recarregar = useCallback(() => {
    if (!meuId) return;
    void getConversas().then(setConversas);
  }, [meuId]);

  const abrirCanal = useCallback((id: string | null) => {
    setCanalAberto(id);
    if (!id) return;
    setConversas((xs) => xs.map((c) => (c.channelId === id ? { ...c, unread: 0 } : c)));
    void marcarLido(id);
  }, []);

  const alternarNotificacoes = useCallback(() => {
    setNotificacoes((v) => {
      const novo = !v;
      void salvarPreferencias({ notificacoes: novo });
      // com a aba em segundo plano o toast não é visto; o aviso do navegador é
      // o que resolve, e a permissão só pode ser pedida a partir de um clique
      if (novo && typeof Notification !== "undefined" && Notification.permission === "default") {
        void Notification.requestPermission();
      }
      return novo;
    });
  }, []);

  const receber = useCallback((m: MensagemChat, evento: "INSERT" | "UPDATE") => {
    setAoVivo((atual) => {
      const doCanal = atual[m.channelId] ?? [];
      return { ...atual, [m.channelId]: [...doCanal.filter((x) => x.id !== m.id), m] };
    });

    // a prévia da lista acompanha qualquer mensagem nova, inclusive a minha
    if (evento === "INSERT") {
      setConversas((xs) => xs.map((c) => (c.channelId === m.channelId
        ? { ...c, lastBody: m.body, lastAuthor: m.authorId, lastAt: m.createdAt, lastDeleted: false }
        : c)));
    }
    if (evento !== "INSERT" || m.authorId === meuId) return;

    if (m.channelId === abertoRef.current) {
      void marcarLido(m.channelId); // já está à vista: confirma a leitura, sem avisar
      return;
    }

    setConversas((xs) => xs.map((c) => (c.channelId === m.channelId
      ? { ...c, unread: c.unread + 1 } : c)));

    const conversa = conversasRef.current.find((c) => c.channelId === m.channelId);
    // canal ainda desconhecido = conversa recém-criada por outra pessoa
    if (!conversa) recarregar();
    if (!notifRef.current || conversa?.muted) return;

    const quem = conversa?.kind === "grupo"
      ? conversa.name ?? "Grupo"
      : conversa?.membros.find((x) => x.id === m.authorId)?.name ?? "Nova mensagem";
    const texto = m.body ?? "Anexo";

    tocarSomDeMensagem();

    // aba em segundo plano: aviso do navegador, que aparece fora da janela
    if (typeof document !== "undefined" && document.hidden
      && typeof Notification !== "undefined" && Notification.permission === "granted") {
      const n = new Notification(quem, { body: texto, tag: m.channelId });
      n.onclick = () => {
        window.focus();
        setBalaoAberto(true);
        abrirCanal(m.channelId);
        n.close();
      };
      return;
    }

    toast(quem, {
      description: texto,
      action: {
        label: "Responder",
        onClick: () => { setBalaoAberto(true); abrirCanal(m.channelId); },
      },
    });
  }, [meuId, recarregar, abrirCanal]);

  useChatRealtime(meuId, receber);

  // rede de segurança: voltar o foco para a aba ressincroniza a lista com o
  // banco (não lidas e prévias), cobrindo qualquer buraco de websocket caído
  useEffect(() => {
    if (!meuId) return;
    const aoVoltar = () => {
      if (document.visibilityState === "visible") recarregar();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("online", aoVoltar);
    return () => {
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("online", aoVoltar);
    };
  }, [meuId, recarregar]);

  const naoLidas = conversas.reduce((n, c) => n + c.unread, 0);

  return (
    <Ctx.Provider
      value={{
        conversas, aoVivo, naoLidas, canalAberto, abrirCanal,
        balaoAberto, setBalaoAberto, recarregar,
        notificacoes, alternarNotificacoes, ativo: Boolean(meuId),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
