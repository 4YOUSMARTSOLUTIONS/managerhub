"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import { MIMES_ANEXO, TAMANHO_ANEXO, recusaDeUpload } from "@/lib/uploads";
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

const BUCKET_ANEXOS = "chat-anexos";

/**
 * Mensagem com arquivo (e legenda opcional). O upload sobe pela policy do
 * bucket (membro do canal, canal aberto) e o insert pela policy da tabela; se
 * o insert falhar depois do upload, o objeto fica órfão no bucket, sem
 * caminho apontando para ele (não há policy de delete de propósito).
 */
export async function enviarAnexo(formData: FormData): Promise<ActionState & { mensagem?: MensagemChat }> {
  try {
    const { supabase, tenantId, userId } = await actionContext();
    const channelId = String(formData.get("channelId") ?? "");
    const legenda = String(formData.get("body") ?? "").trim();
    const file = formData.get("file");
    if (!channelId) return { error: "Conversa inválida." };
    if (!(file instanceof File)) return { error: "Escolha o arquivo." };
    if (legenda.length > TAMANHO_MENSAGEM) {
      return { error: `A mensagem passou de ${TAMANHO_MENSAGEM} caracteres.` };
    }

    const recusa = recusaDeUpload(file, TAMANHO_ANEXO, MIMES_ANEXO);
    if (recusa) return { error: recusa };

    const safe = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${tenantId}/${channelId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;
    const up = await supabase.storage.from(BUCKET_ANEXOS).upload(path, file, {
      contentType: file.type || undefined, upsert: false,
    });
    if (up.error) {
      console.error("chat anexo: upload recusado:", up.error.message);
      return { error: "Não foi possível subir o arquivo. Verifique seu acesso à conversa." };
    }

    const { data, error } = await supabase
      .from("chat_messages")
      .insert({
        tenant_id: tenantId, channel_id: channelId, author_id: userId,
        body: legenda || null, anexo_path: path, anexo_nome: file.name, anexo_mime: file.type || null,
      })
      .select("id, channel_id, author_id, body, anexo_path, anexo_nome, anexo_mime, edited_at, deleted_at, deleted_admin, created_at")
      .single();
    if (error) return { error: mensagemDoChat(error) };

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

/** URL assinada de 10 minutos; a policy de select do bucket decide quem pode. */
export async function urlAnexoChat(path: string): Promise<ActionState & { url?: string }> {
  const { supabase } = await actionContext();
  const { data, error } = await supabase.storage.from(BUCKET_ANEXOS).createSignedUrl(path, 600);
  if (error || !data?.signedUrl) return { error: "Não foi possível abrir o anexo." };
  return { ok: true, url: data.signedUrl };
}

export async function editarMensagem(id: string, body: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const texto = body.trim();
    if (!texto) return { error: "Escreva a mensagem." };
    if (texto.length > TAMANHO_MENSAGEM) {
      return { error: `A mensagem passou de ${TAMANHO_MENSAGEM} caracteres.` };
    }
    const { error } = await supabase.rpc("chat_editar_mensagem", { p_id: id, p_body: texto });
    if (error) return { error: error.message };
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function apagarMensagem(id: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("chat_apagar_mensagem", { p_id: id });
    if (error) return { error: error.message };
    return { ok: true };
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
  /** a PRÉVIA: toast na tela e, com a aba oculta, aviso do navegador */
  notificacoes: boolean;
  /** o alerta sonoro, independente da prévia */
  som: boolean;
  status: Enums<"chat_user_status">;
};

/** As preferências do próprio usuário; quem nunca mexeu leva o padrão. */
export async function getPreferencias(): Promise<PreferenciasChat> {
  const { supabase, userId } = await actionContext();
  const { data } = await supabase
    .from("chat_settings")
    .select("notificacoes, som, status")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    notificacoes: data?.notificacoes ?? true,
    som: data?.som ?? true,
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
    ...(p.som !== undefined ? { som: p.som } : {}),
    ...(p.status ? { status: p.status } : {}),
    updated_at: new Date().toISOString(),
  });
}

// ============================================================================
// Administração (dono do grupo ou owner/admin/hr; as guardas moram nas RPCs)
// ============================================================================

async function rpcSimples(
  chamada: (supabase: Awaited<ReturnType<typeof actionContext>>["supabase"]) => PromiseLike<{ error: { message: string } | null }>,
): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await chamada(supabase);
    if (error) return { error: error.message };
    revalidatePath(RP_CHAT);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function renomearGrupo(channelId: string, nome: string): Promise<ActionState> {
  if (!nome.trim()) return { error: "Dê um nome ao grupo." };
  return rpcSimples((s) => s.rpc("chat_renomear_grupo", { p_id: channelId, p_nome: nome.trim() }));
}

export async function encerrarGrupo(channelId: string, encerrar: boolean): Promise<ActionState> {
  return rpcSimples((s) => s.rpc("chat_encerrar_grupo", { p_id: channelId, p_encerrar: encerrar }));
}

export async function transferirDono(channelId: string, novoDonoId: string): Promise<ActionState> {
  if (!novoDonoId) return { error: "Escolha a pessoa." };
  return rpcSimples((s) => s.rpc("chat_transferir_dono", { p_id: channelId, p_novo: novoDonoId }));
}

export async function gerirMembros(
  channelId: string, adicionar: string[], remover: string[],
): Promise<ActionState> {
  if (adicionar.length === 0 && remover.length === 0) return { ok: true };
  return rpcSimples((s) => s.rpc("chat_gerir_membros", { p_id: channelId, p_adicionar: adicionar, p_remover: remover }));
}

export async function apagarMensagemAdmin(id: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("chat_apagar_mensagem_admin", { p_id: id });
    if (error) return { error: error.message };
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function banirDoChat(userId: string, motivo?: string): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await actionContext();
    const { error } = await supabase.rpc("chat_banir", {
      p_tenant: tenantId, p_user: userId, p_motivo: motivo?.trim() || null,
    });
    if (error) return { error: error.message };
    revalidatePath(RP_CHAT);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function desbanirDoChat(userId: string): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await actionContext();
    const { error } = await supabase.rpc("chat_desbanir", { p_tenant: tenantId, p_user: userId });
    if (error) return { error: error.message };
    revalidatePath(RP_CHAT);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type BloqueadoChat = { userId: string; name: string; reason: string | null; createdAt: string };

export async function getBloqueados(): Promise<BloqueadoChat[]> {
  const { supabase, tenantId } = await actionContext();
  const { data } = await supabase
    .from("chat_bans")
    .select("user_id, reason, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  const bans = data ?? [];
  if (bans.length === 0) return [];
  const { data: nomes } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", bans.map((b) => b.user_id));
  const nomePorId = new Map((nomes ?? []).map((p) => [p.id, p.full_name ?? ""]));
  return bans.map((r) => ({
    userId: r.user_id,
    name: nomePorId.get(r.user_id) ?? "",
    reason: r.reason,
    createdAt: r.created_at,
  }));
}

/**
 * Todas as conversas da empresa (aba de administração). Mapeada para o mesmo
 * formato da lista comum, com os campos de membro neutros e a marca de
 * leitura pura: quem não participa não escreve, só lê.
 */
export async function getConversasAdmin(): Promise<ConversaResumo[]> {
  const { supabase, tenantId } = await actionContext();
  const { data } = await supabase.rpc("chat_overview_admin", { p_tenant: tenantId });
  return (data ?? []).map((r) => ({
    channelId: r.channel_id,
    kind: r.kind,
    name: r.name,
    closedAt: r.closed_at,
    role: "membro" as const,
    muted: false,
    lastReadAt: "",
    unread: 0,
    membros: ((r.membros ?? []) as unknown as { id: string; name: string | null }[])
      .map((m) => ({ id: m.id, name: m.name ?? "" })),
    lastBody: r.last_body,
    lastAuthor: r.last_author,
    lastAt: r.last_at,
    lastDeleted: r.last_deleted,
  }));
}

export type FiltrosBusca = {
  q: string;
  autorId?: string;
  channelId?: string;
  de?: string;   // yyyy-mm-dd
  ate?: string;  // yyyy-mm-dd
};

export type ResultadoBusca = {
  id: string;
  channelId: string;
  authorId: string;
  body: string | null;
  createdAt: string;
};

/**
 * Busca avançada no histórico. SECURITY INVOKER no banco: cada um só encontra
 * o que a RLS deixa ler (membro = seus canais; administração = tudo).
 */
export async function buscarChat(f: FiltrosBusca): Promise<ResultadoBusca[]> {
  const { supabase } = await actionContext();
  const { data } = await supabase.rpc("chat_buscar", {
    p_q: f.q,
    p_autor: f.autorId || null,
    p_canal: f.channelId || null,
    p_de: f.de || null,
    p_ate: f.ate || null,
    p_lim: 50,
  });
  return (data ?? []).map((r) => ({
    id: r.id, channelId: r.channel_id, authorId: r.author_id,
    body: r.body, createdAt: r.created_at,
  }));
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
