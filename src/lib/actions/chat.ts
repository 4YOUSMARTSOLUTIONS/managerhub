"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";

/**
 * Chat interno: conversas 1 a 1, grupos e mensagens.
 *
 * Toda escrita passa por aqui (padrão da casa), mas a AUTORIZAÇÃO mora no
 * banco: o insert de mensagem é coberto por policy (autor membro, não banido,
 * canal aberto) e criação/gestão são RPCs SECURITY DEFINER com guarda no
 * corpo. A action valida cedo só para a recusa chegar em português.
 */

const RP_CHAT = "/chat";
const TAMANHO_MENSAGEM = 4000;

export type ConversaResumo = {
  channelId: string;
  kind: Enums<"chat_channel_kind">;
  name: string | null;
  closedAt: string | null;
  role: Enums<"chat_member_role">;
  muted: boolean;
  lastReadAt: string;
  unread: number;
  membros: { id: string; name: string }[];
  lastBody: string | null;
  lastAuthor: string | null;
  lastAt: string | null;
  lastDeleted: boolean;
};

export type MensagemChat = {
  id: string;
  channelId: string;
  authorId: string;
  body: string | null;
  anexoPath: string | null;
  anexoNome: string | null;
  anexoMime: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  deletedAdmin: boolean;
  createdAt: string;
};

function mapMensagem(r: {
  id: string; channel_id: string; author_id: string; body: string | null;
  anexo_path: string | null; anexo_nome: string | null; anexo_mime: string | null;
  edited_at: string | null; deleted_at: string | null; deleted_admin: boolean; created_at: string;
}): MensagemChat {
  return {
    id: r.id, channelId: r.channel_id, authorId: r.author_id, body: r.body,
    anexoPath: r.anexo_path, anexoNome: r.anexo_nome, anexoMime: r.anexo_mime,
    editedAt: r.edited_at, deletedAt: r.deleted_at, deletedAdmin: r.deleted_admin,
    createdAt: r.created_at,
  };
}

export async function getConversas(): Promise<ConversaResumo[]> {
  const { supabase } = await actionContext();
  const { data } = await supabase.rpc("chat_overview");
  return (data ?? []).map((r) => ({
    channelId: r.channel_id,
    kind: r.kind,
    name: r.name,
    closedAt: r.closed_at,
    role: r.role,
    muted: r.muted,
    lastReadAt: r.last_read_at,
    unread: Number(r.unread ?? 0),
    membros: ((r.membros ?? []) as unknown as { id: string; name: string | null }[])
      .map((m) => ({ id: m.id, name: m.name ?? "" })),
    lastBody: r.last_body,
    lastAuthor: r.last_author,
    lastAt: r.last_at,
    lastDeleted: r.last_deleted,
  }));
}

export async function criarDm(alvoId: string): Promise<ActionState & { channelId?: string }> {
  try {
    const { supabase, tenantId } = await actionContext();
    if (!alvoId) return { error: "Escolha a pessoa." };
    const { data, error } = await supabase.rpc("chat_criar_dm", {
      p_tenant: tenantId, p_alvo: alvoId,
    });
    if (error) return { error: error.message };
    revalidatePath(RP_CHAT);
    return { ok: true, channelId: data ?? undefined };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function criarGrupo(
  nome: string, membroIds: string[],
): Promise<ActionState & { channelId?: string }> {
  try {
    const { supabase, tenantId } = await actionContext();
    if (!nome.trim()) return { error: "Dê um nome ao grupo." };
    if (membroIds.length === 0) return { error: "Escolha ao menos uma pessoa." };
    const { data, error } = await supabase.rpc("chat_criar_grupo", {
      p_tenant: tenantId, p_nome: nome.trim(), p_membros: membroIds,
    });
    if (error) return { error: error.message };
    revalidatePath(RP_CHAT);
    return { ok: true, channelId: data ?? undefined };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function enviarMensagem(
  channelId: string, body: string,
): Promise<ActionState & { mensagem?: MensagemChat }> {
  try {
    const { supabase, tenantId, userId } = await actionContext();
    const texto = body.trim();
    if (!channelId) return { error: "Conversa inválida." };
    if (!texto) return { error: "Escreva a mensagem." };
    if (texto.length > TAMANHO_MENSAGEM) {
      return { error: `A mensagem passou de ${TAMANHO_MENSAGEM} caracteres.` };
    }

    const { data, error } = await supabase
      .from("chat_messages")
      .insert({ tenant_id: tenantId, channel_id: channelId, author_id: userId, body: texto })
      .select("id, channel_id, author_id, body, anexo_path, anexo_nome, anexo_mime, edited_at, deleted_at, deleted_admin, created_at")
      .single();
    if (error) return { error: mensagemDoChat(error) };

    // quem envia já leu tudo até aqui: o próprio envio não vira "não lida"
    await supabase
      .from("chat_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("channel_id", channelId)
      .eq("user_id", userId);

    return { ok: true, mensagem: mapMensagem(data) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function carregarMensagens(
  channelId: string, antesDe?: string,
): Promise<MensagemChat[]> {
  const { supabase } = await actionContext();
  let q = supabase
    .from("chat_messages")
    .select("id, channel_id, author_id, body, anexo_path, anexo_nome, anexo_mime, edited_at, deleted_at, deleted_admin, created_at")
    .eq("channel_id", channelId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (antesDe) q = q.lt("created_at", antesDe);
  const { data } = await q;
  // a consulta desce do mais novo (paginação); a tela lê do mais antigo
  return (data ?? []).map(mapMensagem).reverse();
}

export async function marcarLido(channelId: string): Promise<void> {
  const { supabase, userId } = await actionContext();
  await supabase
    .from("chat_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("channel_id", channelId)
    .eq("user_id", userId);
}

export type PreferenciasChat = {
  notificacoes: boolean;
  status: Enums<"chat_user_status">;
};

/** As preferências do próprio usuário; quem nunca mexeu leva o padrão. */
export async function getPreferencias(): Promise<PreferenciasChat> {
  const { supabase, userId } = await actionContext();
  const { data } = await supabase
    .from("chat_settings")
    .select("notificacoes, status")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    notificacoes: data?.notificacoes ?? true,
    status: data?.status ?? "disponivel",
  };
}

/**
 * O liga/desliga do toast e o status manual (disponível/ocupado/ausente).
 * Upsert na própria linha; a RLS de `chat_settings` só deixa mexer nela mesmo.
 */
export async function salvarPreferencias(p: Partial<PreferenciasChat>): Promise<void> {
  const { supabase, tenantId, userId } = await actionContext();
  await supabase.from("chat_settings").upsert({
    user_id: userId,
    tenant_id: tenantId,
    ...(p.notificacoes !== undefined ? { notificacoes: p.notificacoes } : {}),
    ...(p.status ? { status: p.status } : {}),
    updated_at: new Date().toISOString(),
  });
}

export async function alternarMute(channelId: string, muted: boolean): Promise<void> {
  const { supabase, userId } = await actionContext();
  await supabase
    .from("chat_members")
    .update({ muted })
    .eq("channel_id", channelId)
    .eq("user_id", userId);
}

/** Traduz o erro do banco em algo que a pessoa entenda na tela. */
function mensagemDoChat(e: { code?: string; message?: string }): string {
  const msg = e.message ?? "";
  if (msg.includes("row-level security")) {
    return "Você não pode escrever nesta conversa. Ela pode ter sido encerrada, ou seu acesso ao chat foi bloqueado.";
  }
  return msg || "Não foi possível enviar.";
}
