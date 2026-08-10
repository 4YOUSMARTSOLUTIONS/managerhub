"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";
import { indiceDeAlvos, resolverAlvo } from "@/lib/import-pessoa";

/** Espelha o `dpActionContext`. Estas actions devolvem `ActionState`, então a
 *  recusa precisa virar mensagem na tela em vez de exceção. */
const PODE_DP = new Set<Enums<"member_role">>(["owner", "admin", "hr"]);
const SO_DP = "Apenas proprietário, administrador e RH configuram a remuneração variável.";

const parseNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (s === "") return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
};

export type RvConfigInput = {
  scope: "position" | "user";
  position_id?: string | null;
  user_id?: string | null;
  effective_from: string; // YYYY-MM (competência de início da vigência)
  value: number;
};

/** Cria/atualiza uma vigência de RV (por função ou por colaborador). Owner/admin. */
export async function upsertRvConfig(input: RvConfigInput): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId, role } = await actionContext();
    if (!PODE_DP.has(role)) return { error: SO_DP };

    const m = (input.effective_from ?? "").trim().match(/^(\d{4})-(\d{2})$/);
    if (!m) return { error: "Informe a competência de início da vigência (MM/AAAA)." };
    const effective_from = `${input.effective_from}-01`;
    const value = Math.max(0, Number(input.value) || 0);

    if (input.scope === "position" && !input.position_id) return { error: "Informe a função." };
    if (input.scope === "user" && !input.user_id) return { error: "Informe o colaborador." };

    // upsert manual (índices únicos são parciais; onConflict do PostgREST não os cobre)
    let sel = supabase
      .from("individual_rv_config")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("scope", input.scope)
      .eq("effective_from", effective_from);
    sel = input.scope === "position" ? sel.eq("position_id", input.position_id!) : sel.eq("user_id", input.user_id!);
    const { data: existing } = await sel.maybeSingle();

    const payload = {
      tenant_id: tenantId,
      scope: input.scope,
      position_id: input.scope === "position" ? input.position_id! : null,
      user_id: input.scope === "user" ? input.user_id! : null,
      effective_from,
      value,
      created_by: userId,
    };
    const { error } = existing?.id
      ? await supabase.from("individual_rv_config").update(payload).eq("id", existing.id)
      : await supabase.from("individual_rv_config").insert(payload);
    if (error) return { error: error.message };

    revalidatePath("/configuracoes");
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------- Importação em lote (.xlsx) ----------
export type RvConfigImportRow = {
  name: string;
  period: string;
  value: string;
  /** ID da função/colaborador (aba de apoio do modelo); quando presente, decide */
  id?: string;
};

/** Importa vigências de RV (por função ou por colaborador), casando o nome com o cadastro. */
export async function importRvConfig(
  scope: "position" | "user",
  rows: RvConfigImportRow[],
): Promise<{ imported: number; invalid: number; notFound: number; mismatch: number; error?: string }> {
  try {
    const { supabase, tenantId, userId, role } = await actionContext();
    if (!PODE_DP.has(role)) return { imported: 0, invalid: 0, notFound: 0, mismatch: 0, error: SO_DP };

    // catálogo de alvos (função ou colaborador ativo): o ID decide, o nome confere
    const refs: { id: string; name: string }[] = [];
    if (scope === "position") {
      const { data } = await supabase.from("positions").select("id, name").eq("tenant_id", tenantId);
      for (const p of data ?? []) refs.push({ id: p.id, name: p.name });
    } else {
      const { data } = await supabase.from("memberships").select("user_id, is_active, profiles!memberships_user_id_fkey(full_name)").eq("tenant_id", tenantId);
      for (const m of data ?? []) {
        if (!m.is_active) continue;
        const nm = (m.profiles as unknown as { full_name: string | null } | null)?.full_name;
        refs.push({ id: m.user_id, name: nm ?? "" });
      }
    }
    const idx = indiceDeAlvos(refs);

    const { data: existing } = await supabase
      .from("individual_rv_config")
      .select("id, position_id, user_id, effective_from")
      .eq("tenant_id", tenantId)
      .eq("scope", scope);
    const key = (targetId: string, ef: string) => `${targetId}|${ef}`;
    const existingMap = new Map((existing ?? []).map((e) => [key((scope === "position" ? e.position_id : e.user_id) ?? "", e.effective_from), e.id]));

    const inserts: Record<string, unknown>[] = [];
    const updates: { id: string; payload: Record<string, unknown> }[] = [];
    // chave → posição já enfileirada, para linha repetida sobrescrever em vez de duplicar
    const queuedInsert = new Map<string, number>();
    const queuedUpdate = new Map<string, number>();
    let invalid = 0;
    let notFound = 0;
    let mismatch = 0;
    for (const r of rows ?? []) {
      const name = (r.name ?? "").trim();
      const pm = (r.period ?? "").trim().match(/^(\d{4})-(\d{2})$/);
      const value = parseNum(r.value);
      if ((!name && !(r.id ?? "").trim()) || !pm || value == null) { invalid++; continue; }
      const alvo = resolverAlvo(r.id ?? "", name, idx);
      if (alvo.divergente) { mismatch++; continue; }
      const targetId = alvo.alvoId;
      if (!targetId) { notFound++; continue; }
      const ef = `${r.period}-01`;
      const payload = {
        tenant_id: tenantId, scope,
        position_id: scope === "position" ? targetId : null,
        user_id: scope === "user" ? targetId : null,
        effective_from: ef, value: Math.max(0, value), created_by: userId,
      };
      const k = key(targetId, ef);
      const id = existingMap.get(k);
      // Linha repetida na planilha (mesmo alvo, mesma competência): vale a
      // ÚLTIMA. Empilhar dois inserts da mesma chave faria o índice único
      // derrubar o lote inteiro com "duplicate key value".
      if (id && id !== "pending") {
        const j = queuedUpdate.get(k);
        if (j != null) updates[j].payload = payload;
        else { queuedUpdate.set(k, updates.length); updates.push({ id, payload }); }
      } else if (id === "pending") {
        inserts[queuedInsert.get(k)!] = payload;
      } else {
        queuedInsert.set(k, inserts.length);
        inserts.push(payload);
        existingMap.set(k, "pending");
      }
    }

    let imported = 0;
    if (inserts.length) {
      const { error } = await supabase.from("individual_rv_config").insert(inserts as never);
      if (error) return { imported: 0, invalid, notFound, mismatch, error: error.message };
      imported += inserts.length;
    }
    for (const u of updates) {
      const { error } = await supabase.from("individual_rv_config").update(u.payload as never).eq("id", u.id);
      if (error) return { imported, invalid, notFound, mismatch, error: error.message };
      imported += 1;
    }
    if (imported === 0) {
      return {
        imported: 0, invalid, notFound, mismatch,
        error: mismatch > 0
          ? "Nenhum item importado: há linhas em que o ID e o nome apontam para cadastros diferentes."
          : notFound > 0
            ? `Nenhum item importado, ${scope === "position" ? "função" : "colaborador"} não encontrado (confira o ID ou o nome exato).`
            : "Nenhuma linha válida, confira Competência (MM/AAAA) e Valor.",
      };
    }
    revalidatePath("/configuracoes");
    revalidatePath("/metas");
    return { imported, invalid, notFound, mismatch };
  } catch (e) {
    return { imported: 0, invalid: 0, notFound: 0, mismatch: 0, error: (e as Error).message };
  }
}

/** Exclui uma vigência de RV. Owner/admin. */
export async function deleteRvConfig(id: string): Promise<ActionState> {
  try {
    const { supabase, role } = await actionContext();
    if (!PODE_DP.has(role)) return { error: SO_DP };
    const { error } = await supabase.from("individual_rv_config").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/configuracoes");
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
