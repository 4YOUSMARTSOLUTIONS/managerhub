"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";

function isAdminRole(role: Enums<"member_role">) {
  return role === "owner" || role === "admin";
}

const normTxt = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

const parseNum = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").trim();
  if (!s || s === "-" || !/^-?[\d.,]+$/.test(s)) return null;
  const norm = s.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(norm);
  return Number.isNaN(n) ? null : n;
};

export type SustKpiInput = {
  name: string;
  owner_id?: string | null;
  unit?: string;
  direction: Enums<"goal_direction">;
  consolidation: Enums<"area_consolidation">;
  target?: number | null;
  sort?: number;
};

export async function createSustKpi(input: SustKpiInput): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId, role } = await actionContext();
    if (!isAdminRole(role)) return { error: "Apenas owner/admin podem cadastrar KPIs." };
    const name = (input.name ?? "").trim();
    if (!name) return { error: "Informe o nome do KPI." };
    const { error } = await supabase.from("sustainability_kpis").insert({
      tenant_id: tenantId,
      name,
      owner_id: input.owner_id || null,
      unit: (input.unit ?? "").trim(),
      direction: input.direction,
      consolidation: input.consolidation,
      target: input.target ?? null,
      sort: input.sort ?? 0,
      created_by: userId,
    });
    if (error) return { error: error.message };
    revalidatePath("/sustentabilidade");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function updateSustKpi(input: SustKpiInput & { id: string }): Promise<ActionState> {
  try {
    const { supabase, role } = await actionContext();
    if (!isAdminRole(role)) return { error: "Apenas owner/admin podem editar KPIs." };
    const name = (input.name ?? "").trim();
    if (!name) return { error: "Informe o nome do KPI." };
    const { error } = await supabase.from("sustainability_kpis").update({
      name,
      owner_id: input.owner_id || null,
      unit: (input.unit ?? "").trim(),
      direction: input.direction,
      consolidation: input.consolidation,
      target: input.target ?? null,
    }).eq("id", input.id);
    if (error) return { error: error.message };
    revalidatePath("/sustentabilidade");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteSustKpi(id: string): Promise<ActionState> {
  try {
    const { supabase, role } = await actionContext();
    if (!isAdminRole(role)) return { error: "Apenas owner/admin podem excluir KPIs." };
    const { error } = await supabase.from("sustainability_kpis").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/sustentabilidade");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function upsertSustEntry(input: { kpi_id: string; period: string; actual_value: number | null; numerator_value?: number | null; denominator_value?: number | null }): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await actionContext();
    if (!input.kpi_id) return { error: "KPI inválido." };
    if (!input.period) return { error: "Informe a competência." };
    const num = (v: number | null | undefined) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));

    const { data: existing } = await supabase
      .from("sustainability_entries").select("id")
      .eq("kpi_id", input.kpi_id).eq("period", input.period).maybeSingle();

    const payload = {
      tenant_id: tenantId,
      kpi_id: input.kpi_id,
      period: input.period,
      actual_value: num(input.actual_value),
      numerator_value: num(input.numerator_value),
      denominator_value: num(input.denominator_value),
    };
    let error;
    if (existing?.id) ({ error } = await supabase.from("sustainability_entries").update(payload).eq("id", existing.id));
    else ({ error } = await supabase.from("sustainability_entries").insert(payload));
    if (error) return { error: error.message };
    revalidatePath("/sustentabilidade");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteSustEntry(input: { kpi_id: string; period: string }): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.from("sustainability_entries").delete().eq("kpi_id", input.kpi_id).eq("period", input.period);
    if (error) return { error: error.message };
    revalidatePath("/sustentabilidade");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------- importação da planilha ----------
export type SustImportRow = {
  ordem?: string | number;
  name: string;
  unit?: string;
  owner?: string;
  target?: string | number;
  direction?: string;
  consolidation?: string;
};

export type SustImportResult = { kpis: number; skipped: number; ownersNotFound: string[]; error?: string };

export async function importSust(rows: SustImportRow[]): Promise<SustImportResult> {
  const base: SustImportResult = { kpis: 0, skipped: 0, ownersNotFound: [] };
  try {
    const { supabase, tenantId, userId, role } = await actionContext();
    if (!isAdminRole(role)) return { ...base, error: "Apenas owner/admin podem importar." };

    const { data: mems } = await supabase.from("memberships").select("user_id, profiles(full_name)").eq("tenant_id", tenantId);
    const ownerByName = new Map<string, string>();
    for (const m of mems ?? []) {
      const nm = (m.profiles as unknown as { full_name: string | null } | null)?.full_name;
      if (nm) ownerByName.set(normTxt(nm), m.user_id as string);
    }
    const { data: exKpis } = await supabase.from("sustainability_kpis").select("name").eq("tenant_id", tenantId);
    const seen = new Set<string>((exKpis ?? []).map((k) => normTxt(k.name)));

    const dirOf = (s?: string) => (normTxt(String(s ?? "")).includes("menor") ? "menor_melhor" : "maior_melhor") as Enums<"goal_direction">;
    const consOf = (s?: string, unit?: string) => {
      const t = normTxt(String(s ?? ""));
      if (t.includes("razao") || t.includes("razão")) return "razao" as Enums<"area_consolidation">;
      if (t.includes("media") || t.includes("média")) return "media" as Enums<"area_consolidation">;
      if (t.includes("manual")) return "manual" as Enums<"area_consolidation">;
      if (t.includes("soma")) return "soma" as Enums<"area_consolidation">;
      return (String(unit ?? "").trim() === "%" ? "razao" : "soma") as Enums<"area_consolidation">;
    };

    const ownersNotFound = new Set<string>();
    let sort = 0;
    for (const r of rows) {
      const name = (r.name ?? "").trim();
      if (!name) continue;
      if (seen.has(normTxt(name))) { base.skipped += 1; continue; }
      sort += 1;
      let owner_id: string | null = null;
      const ownerName = (r.owner ?? "").trim();
      if (ownerName && ownerName !== "-") {
        owner_id = ownerByName.get(normTxt(ownerName)) ?? null;
        if (!owner_id) ownersNotFound.add(ownerName);
      }
      const unit = (r.unit ?? "").trim() === "-" ? "" : (r.unit ?? "").trim();
      let target = parseNum(r.target);
      // normaliza meta % em fração para escala percentual (0,1724 → 17,24)
      if (unit === "%" && target != null && target <= 1) target = target * 100;
      const { error } = await supabase.from("sustainability_kpis").insert({
        tenant_id: tenantId,
        sort,
        name,
        owner_id,
        unit,
        direction: dirOf(r.direction),
        consolidation: consOf(r.consolidation, unit),
        target,
        created_by: userId,
      });
      if (error) return { ...base, error: error.message };
      seen.add(normTxt(name));
      base.kpis += 1;
    }
    revalidatePath("/sustentabilidade");
    return { ...base, ownersNotFound: [...ownersNotFound] };
  } catch (e) {
    return { ...base, error: (e as Error).message };
  }
}
