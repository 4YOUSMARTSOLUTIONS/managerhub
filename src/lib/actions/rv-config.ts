"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";
import { indiceDeAlvos, resolverAlvo, type IndiceDeAlvos, type Origem } from "@/lib/import-pessoa";
import { normTexto } from "@/lib/absences-import";

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
  /** por função: nome da função (catálogo); por colaborador: coluna informativa */
  name: string;
  period: string;
  value: string;
  /** matrícula do colaborador (coluna ID; só no escopo por colaborador) */
  code?: string;
  /** unidade da linha; obrigatória em empresa com mais de uma unidade */
  unit?: string;
};

/** Importa vigências de RV (por função ou por colaborador), casando o nome com o cadastro. */
export async function importRvConfig(
  scope: "position" | "user",
  rows: RvConfigImportRow[],
): Promise<{ imported: number; invalid: number; notFound: number; mismatch: number; error?: string }> {
  try {
    const { supabase, tenantId, userId, role } = await actionContext();
    if (!PODE_DP.has(role)) return { imported: 0, invalid: 0, notFound: 0, mismatch: 0, error: SO_DP };

    // função continua casando por NOME (item de catálogo, sem matrícula nem
    // unidade); colaborador casa por unidade + matrícula
    let funcaoPorNome: Map<string, string> | null = null;
    let idx: IndiceDeAlvos | null = null;
    if (scope === "position") {
      const { data } = await supabase.from("positions").select("id, name").eq("tenant_id", tenantId);
      funcaoPorNome = new Map((data ?? []).map((p) => [normTexto(p.name), p.id]));
    } else {
      const [{ data: membros }, { data: unidades }, { data: vinculoUnidade }, { data: contratos }] = await Promise.all([
        supabase.from("memberships").select("id, user_id, is_active, employee_code").eq("tenant_id", tenantId),
        supabase.from("units").select("id, name").eq("tenant_id", tenantId),
        // RLS já limita ao tenant; .in() com centenas de ids estouraria a URL
        supabase.from("membership_units").select("membership_id, unit_id").limit(20000),
        supabase.from("employee_contracts").select("user_id, employee_code").eq("tenant_id", tenantId),
      ]);
      const nomeUnidade = new Map((unidades ?? []).map((u) => [u.id, u.name]));
      const unidadesDoVinculo = new Map<string, string[]>();
      for (const v of vinculoUnidade ?? []) {
        const nm = nomeUnidade.get(v.unit_id);
        if (!nm) continue;
        const arr = unidadesDoVinculo.get(v.membership_id) ?? [];
        arr.push(nm);
        unidadesDoVinculo.set(v.membership_id, arr);
      }
      // ativos, desligados e contratos anteriores: ver import-pessoa.ts
      const unidadesPorUser = new Map<string, string[]>();
      const refs: { id: string; code?: string | null; units?: string[]; origem?: Origem }[] = [];
      for (const m of membros ?? []) {
        const uns = unidadesDoVinculo.get(m.id) ?? [];
        unidadesPorUser.set(m.user_id, uns);
        refs.push({ id: m.user_id, code: m.employee_code, units: uns, origem: m.is_active ? "ativo" : "desligado" });
      }
      for (const c of contratos ?? []) {
        refs.push({ id: c.user_id, code: c.employee_code, units: unidadesPorUser.get(c.user_id) ?? [], origem: "contrato_anterior" });
      }
      idx = indiceDeAlvos(refs, (unidades ?? []).map((u) => u.name));
    }

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
      if (!pm || value == null) { invalid++; continue; }
      let targetId: string | null;
      if (scope === "position") {
        if (!name) { invalid++; continue; }
        targetId = funcaoPorNome!.get(normTexto(name)) ?? null;
        if (!targetId) { notFound++; continue; }
      } else {
        const alvo = resolverAlvo(r.code ?? "", r.unit ?? "", idx!);
        if (alvo.motivo === "sem_matricula") { invalid++; continue; }
        if (alvo.motivo === "nao_encontrada") { notFound++; continue; }
        if (!alvo.alvoId) { mismatch++; continue; }
        targetId = alvo.alvoId;
      }
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
          ? "Nenhum item importado: conflito de unidade e matrícula (confira a coluna Unidade)."
          : notFound > 0
            ? scope === "position"
              ? "Nenhum item importado, função não encontrada (confira o nome exato)."
              : "Nenhum item importado, matrícula não encontrada no cadastro."
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
