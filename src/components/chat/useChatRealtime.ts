"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Enums } from "@/types/database";
import type { MensagemChat } from "@/lib/actions/chat";

/**
 * O lado do navegador do tempo real do chat. Primeiro uso de Supabase Realtime
 * no projeto.
 *
 * Os canais são PRIVADOS ({ config: { private: true } }): sem as policies de
 * `realtime.messages` da migração 20260818103000 o subscribe é recusado, e o
 * sintoma é o canal nunca chegar a SUBSCRIBED. Antes de assinar é obrigatório
 * `realtime.setAuth(token)`, e o token precisa ser renovado quando a sessão
 * gira, senão o canal cai em silêncio quando o JWT expira.
 */

type LinhaBroadcast = {
  id: string; channel_id: string; author_id: string; body: string | null;
  anexo_path: string | null; anexo_nome: string | null; anexo_mime: string | null;
  edited_at: string | null; deleted_at: string | null; deleted_admin: boolean;
  created_at: string;
};

function paraMensagem(r: LinhaBroadcast): MensagemChat {
  return {
    id: r.id, channelId: r.channel_id, authorId: r.author_id, body: r.body,
    anexoPath: r.anexo_path, anexoNome: r.anexo_nome, anexoMime: r.anexo_mime,
    editedAt: r.edited_at, deletedAt: r.deleted_at, deletedAdmin: r.deleted_admin,
    createdAt: r.created_at,
  };
}

/**
 * Assina o tópico do usuário (`chat:u:{meuId}`) e entrega cada INSERT/UPDATE
 * de mensagem dos canais em que ele está. Uma assinatura cobre a conversa
 * aberta, os badges e os toasts.
 */
export function useChatRealtime(
  /** null desliga a assinatura: sem empresa, ou chat não contratado */
  meuId: string | null,
  onMensagem: (m: MensagemChat, evento: "INSERT" | "UPDATE") => void,
) {
  // ref para o callback: o efeito assina UMA vez e o handler sempre enxerga o
  // estado mais novo, sem reassinar a cada render
  const aoReceber = useRef(onMensagem);
  useEffect(() => { aoReceber.current = onMensagem; }, [onMensagem]);

  useEffect(() => {
    if (!meuId) return;
    const supabase = createClient();
    let canal: RealtimeChannel | null = null;
    let ativo = true;
    let tentativa: ReturnType<typeof setTimeout> | null = null;

    /**
     * O canal PRECISA se reerguer sozinho. Token que venceu, rede que caiu ou
     * computador que dormiu derrubam o websocket em silêncio: a tela continua
     * aberta parecendo viva, mas surda, e nenhuma mensagem chega até um F5.
     * Por isso todo estado de queda agenda uma reassinatura, e voltar o foco
     * para a aba confere o canal na hora.
     */
    const reassinarDepois = () => {
      if (!ativo || tentativa) return;
      tentativa = setTimeout(() => { tentativa = null; void assinar(); }, 5000);
    };

    const assinar = async () => {
      if (!ativo) return;
      if (canal) { void supabase.removeChannel(canal); canal = null; }
      const { data: { session } } = await supabase.auth.getSession();
      if (!ativo) return;
      if (!session) { reassinarDepois(); return; }
      await supabase.realtime.setAuth(session.access_token);
      const este = supabase
        .channel(`chat:u:${meuId}`, { config: { private: true } })
        .on("broadcast", { event: "INSERT" }, (msg) => {
          const linha = (msg.payload as { record?: LinhaBroadcast }).record;
          if (linha) aoReceber.current(paraMensagem(linha), "INSERT");
        })
        .on("broadcast", { event: "UPDATE" }, (msg) => {
          const linha = (msg.payload as { record?: LinhaBroadcast }).record;
          if (linha) aoReceber.current(paraMensagem(linha), "UPDATE");
        });
      canal = este;
      este.subscribe((estado, err) => {
        // canal trocado por uma reassinatura: o CLOSED do velho não interessa
        if (canal !== este) return;
        // uma linha de vida no console: é o que permite diagnosticar "nada
        // chega" olhando a aba da pessoa, sem adivinhar
        if (estado === "SUBSCRIBED") console.info("chat: canal de mensagens conectado");
        if (estado === "CHANNEL_ERROR" || estado === "TIMED_OUT" || estado === "CLOSED") {
          console.error("chat realtime:", estado, err?.message);
          reassinarDepois();
        }
      });
    };
    void assinar();

    const { data: escuta } = supabase.auth.onAuthStateChange((_evento, session) => {
      if (session) void supabase.realtime.setAuth(session.access_token);
    });

    const aoVoltar = () => {
      if (document.visibilityState === "visible" && canal?.state !== "joined") void assinar();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("online", aoVoltar);

    return () => {
      ativo = false;
      if (tentativa) clearTimeout(tentativa);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("online", aoVoltar);
      escuta.subscription.unsubscribe();
      if (canal) void supabase.removeChannel(canal);
    };
  }, [meuId]);
}

export type StatusPresenca = Enums<"chat_user_status"> | "offline";

/**
 * Presença por empresa: quem está conectado ao chat agora, e com qual status
 * manual. Quem não aparece no canal está offline; quem aparece carrega o
 * status escolhido (disponível/ocupado/ausente) no payload do track().
 */
export function useChatPresence(
  /** null desliga o canal: super admin sem empresa, ou chat não contratado */
  tenantId: string | null,
  meuId: string | null,
  status: Enums<"chat_user_status">,
): Record<string, StatusPresenca> {
  const [presencas, setPresencas] = useState<Record<string, StatusPresenca>>({});

  useEffect(() => {
    if (!tenantId || !meuId) return;
    const supabase = createClient();
    let canal: RealtimeChannel | null = null;
    let ativo = true;
    let tentativa: ReturnType<typeof setTimeout> | null = null;

    // mesma resiliência do canal de mensagens: queda agenda reassinatura,
    // e voltar o foco para a aba confere o canal na hora
    const reassinarDepois = () => {
      if (!ativo || tentativa) return;
      tentativa = setTimeout(() => { tentativa = null; void assinar(); }, 5000);
    };

    const assinar = async () => {
      if (!ativo) return;
      if (canal) { void supabase.removeChannel(canal); canal = null; }
      const { data: { session } } = await supabase.auth.getSession();
      if (!ativo) return;
      if (!session) { reassinarDepois(); return; }
      await supabase.realtime.setAuth(session.access_token);
      const este = supabase.channel(`chat:presenca:${tenantId}`, {
        config: { private: true, presence: { key: meuId } },
      });
      canal = este;
      este
        .on("presence", { event: "sync" }, () => {
          if (canal !== este) return;
          const estado = este.presenceState<{ status?: StatusPresenca }>();
          const mapa: Record<string, StatusPresenca> = {};
          for (const [uid, metas] of Object.entries(estado)) {
            mapa[uid] = metas[0]?.status ?? "disponivel";
          }
          setPresencas(mapa);
        })
        .subscribe((estado, err) => {
          if (canal !== este) return;
          if (estado === "SUBSCRIBED") void este.track({ status });
          if (estado === "CHANNEL_ERROR" || estado === "TIMED_OUT" || estado === "CLOSED") {
            console.error("chat presenca:", estado, err?.message);
            // canal caído = foto velha: melhor todo mundo offline do que
            // alguém "online fantasma" congelado até a reassinatura
            setPresencas({});
            reassinarDepois();
          }
        });
    };
    void assinar();

    const aoVoltar = () => {
      if (document.visibilityState === "visible" && canal?.state !== "joined") void assinar();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("online", aoVoltar);

    // fechar a aba: untrack explícito acelera o "saiu" para os colegas (o
    // fechamento do websocket cobre quando este aviso não chega a sair)
    const aoFechar = () => { void canal?.untrack(); };
    window.addEventListener("pagehide", aoFechar);

    return () => {
      ativo = false;
      if (tentativa) clearTimeout(tentativa);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("online", aoVoltar);
      window.removeEventListener("pagehide", aoFechar);
      if (canal) void supabase.removeChannel(canal);
    };
    // status nas dependências de propósito: trocar de status reassina e
    // re-track, o que é raro e barato
  }, [tenantId, meuId, status]);

  return presencas;
}
