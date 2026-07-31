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

// ---------- Categorias (seções) ----------
export async function createPnrCategory(input: { name: string; max_points?: number | null; sort?: number }): Promise<ActionState> {
  try {
    const { supabase, tenantId, role } = await actionContext();
    if (!isAdminRole(role)) return { error: "Apenas owner/admin podem cadastrar seções." };
    const name = (input.name ?? "").trim();
    if (!name) return { error: "Informe o nome da seção." };
    const { error } = await supabase.from("pnr_categories").insert({
      tenant_id: tenantId,
      name,
      max_points: input.max_points ?? null,
      sort: input.sort ?? 0,
    });
    if (error) return { error: error.message };
    revalidatePath("/pnr");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function updatePnrCategory(input: { id: string; name: string; max_points?: number | null; sort?: number }): Promise<ActionState> {
  try {
    const { supabase, role } = await actionContext();
    if (!isAdminRole(role)) return { error: "Apenas owner/admin podem editar seções." };
    const name = (input.name ?? "").trim();
    if (!name) return { error: "Informe o nome da seção." };
    const { error } = await supabase.from("pnr_categories").update({ name, max_points: input.max_points ?? null, sort: input.sort ?? 0 }).eq("id", input.id);
    if (error) return { error: error.message };
    revalidatePath("/pnr");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deletePnrCategory(id: string): Promise<ActionState> {
  try {
    const { supabase, role } = await actionContext();
    if (!isAdminRole(role)) return { error: "Apenas owner/admin podem excluir seções." };
    const { error } = await supabase.from("pnr_categories").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/pnr");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------- KPIs ----------
export type PnrKpiInput = {
  category_id?: string | null;
  name: string;
  description?: string | null;
  owner_id?: string | null;
  unit?: string;
  direction: Enums<"goal_direction">;
  consolidation: Enums<"area_consolidation">;
  max_points: number;
  target?: number | null;
  partial_high?: number | null;
  partial_low?: number | null;
  points_high?: number | null;
  points_low?: number | null;
  sort?: number;
};

export async function createPnrKpi(input: PnrKpiInput): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId, role } = await actionContext();
    if (!isAdminRole(role)) return { error: "Apenas owner/admin podem cadastrar indicadores." };
    const name = (input.name ?? "").trim();
    if (!name) return { error: "Informe o nome do indicador." };
    const { error } = await supabase.from("pnr_kpis").insert({
      tenant_id: tenantId,
      category_id: input.category_id || null,
      name,
      description: (input.description ?? "").trim() || null,
      owner_id: input.owner_id || null,
      unit: (input.unit ?? "").trim(),
      direction: input.direction,
      consolidation: input.consolidation,
      max_points: Number(input.max_points) || 0,
      target: input.target ?? null,
      partial_high: input.partial_high ?? null,
      partial_low: input.partial_low ?? null,
      points_high: input.points_high ?? null,
      points_low: input.points_low ?? null,
      sort: input.sort ?? 0,
      created_by: userId,
    });
    if (error) return { error: error.message };
    revalidatePath("/pnr");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function updatePnrKpi(input: PnrKpiInput & { id: string }): Promise<ActionState> {
  try {
    const { supabase, role } = await actionContext();
    if (!isAdminRole(role)) return { error: "Apenas owner/admin podem editar indicadores." };
    const name = (input.name ?? "").trim();
    if (!name) return { error: "Informe o nome do indicador." };
    const { error } = await supabase.from("pnr_kpis").update({
      category_id: input.category_id || null,
      name,
      description: (input.description ?? "").trim() || null,
      owner_id: input.owner_id || null,
      unit: (input.unit ?? "").trim(),
      direction: input.direction,
      consolidation: input.consolidation,
      max_points: Number(input.max_points) || 0,
      target: input.target ?? null,
      partial_high: input.partial_high ?? null,
      partial_low: input.partial_low ?? null,
      points_high: input.points_high ?? null,
      points_low: input.points_low ?? null,
    }).eq("id", input.id);
    if (error) return { error: error.message };
    revalidatePath("/pnr");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deletePnrKpi(id: string): Promise<ActionState> {
  try {
    const { supabase, role } = await actionContext();
    if (!isAdminRole(role)) return { error: "Apenas owner/admin podem excluir indicadores." };
    const { error } = await supabase.from("pnr_kpis").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/pnr");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------- Apuração mensal ----------
export async function upsertPnrEntry(input: { kpi_id: string; period: string; actual_value: number | null; numerator_value?: number | null; denominator_value?: number | null }): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await actionContext();
    if (!input.kpi_id) return { error: "Indicador inválido." };
    if (!input.period) return { error: "Informe a competência." };
    const num = (v: number | null | undefined) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));

    // upsert manual por (kpi_id, period) — RLS garante permissão (owner/admin ou responsável)
    const { data: existing } = await supabase
      .from("pnr_entries")
      .select("id")
      .eq("kpi_id", input.kpi_id)
      .eq("period", input.period)
      .maybeSingle();

    const payload = {
      tenant_id: tenantId,
      kpi_id: input.kpi_id,
      period: input.period,
      actual_value: num(input.actual_value),
      numerator_value: num(input.numerator_value),
      denominator_value: num(input.denominator_value),
    };

    let error;
    if (existing?.id) {
      ({ error } = await supabase.from("pnr_entries").update(payload).eq("id", existing.id));
    } else {
      ({ error } = await supabase.from("pnr_entries").insert(payload));
    }
    if (error) return { error: error.message };
    revalidatePath("/pnr");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deletePnrEntry(input: { kpi_id: string; period: string }): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.from("pnr_entries").delete().eq("kpi_id", input.kpi_id).eq("period", input.period);
    if (error) return { error: error.message };
    revalidatePath("/pnr");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------- Importação da planilha do PNR ----------
export type PnrImportRow = {
  ordem?: string | number;
  name: string;
  description?: string;
  maxPoints?: string | number;
  owner?: string;
  unit?: string;
  target?: string | number;
  direction?: string;
  partialHigh?: string | number;
  partialLow?: string | number;
  pointsHigh?: string | number;
  pointsLow?: string | number;
};

export type PnrImportResult = {
  categories: number;
  kpis: number;
  skipped: number; // já existiam
  ownersNotFound: string[];
  error?: string;
};

export async function importPnr(rows: PnrImportRow[]): Promise<PnrImportResult> {
  const base: PnrImportResult = { categories: 0, kpis: 0, skipped: 0, ownersNotFound: [] };
  try {
    const { supabase, tenantId, userId, role } = await actionContext();
    if (!isAdminRole(role)) return { ...base, error: "Apenas owner/admin podem importar." };

    // donos: nome → profile id
    const { data: mems } = await supabase
      .from("memberships")
      .select("user_id, profiles(full_name)")
      .eq("tenant_id", tenantId);
    const ownerByName = new Map<string, string>();
    for (const m of mems ?? []) {
      const nm = (m.profiles as unknown as { full_name: string | null } | null)?.full_name;
      if (nm) ownerByName.set(normTxt(nm), m.user_id as string);
    }

    // categorias e KPIs existentes (dedup por nome)
    const [{ data: exCats }, { data: exKpis }] = await Promise.all([
      supabase.from("pnr_categories").select("id, name").eq("tenant_id", tenantId),
      supabase.from("pnr_kpis").select("name").eq("tenant_id", tenantId),
    ]);
    const catIdByName = new Map<string, string>();
    for (const c of exCats ?? []) catIdByName.set(normTxt(c.name), c.id);
    const kpiSeen = new Set<string>((exKpis ?? []).map((k) => normTxt(k.name)));

    const dirOf = (s?: string) => (normTxt(String(s ?? "")).includes("menor") ? "menor_melhor" : "maior_melhor") as Enums<"goal_direction">;
    const consOf = (unit?: string) => (String(unit ?? "").trim() === "%" ? "media" : "soma") as Enums<"area_consolidation">;

    const ownersNotFound = new Set<string>();
    let currentCategoryId: string | null = null;
    let catSort = 0;
    let kpiSort = 0;

    for (const r of rows) {
      const name = (r.name ?? "").trim();
      if (!name) continue;
      const ordem = String(r.ordem ?? "").trim();
      const isSection = ordem === "-" || ordem === "";

      if (isSection) {
        catSort += 1;
        const key = normTxt(name);
        let id = catIdByName.get(key) ?? null;
        if (!id) {
          const { data, error } = await supabase
            .from("pnr_categories")
            .insert({ tenant_id: tenantId, name, max_points: parseNum(r.maxPoints), sort: catSort })
            .select("id")
            .single();
          if (error) return { ...base, categories: base.categories, error: error.message };
          id = data.id;
          catIdByName.set(key, id);
          base.categories += 1;
        }
        currentCategoryId = id;
        continue;
      }

      // KPI
      if (kpiSeen.has(normTxt(name))) { base.skipped += 1; continue; }
      kpiSort += 1;
      let owner_id: string | null = null;
      const ownerName = (r.owner ?? "").trim();
      if (ownerName && ownerName !== "-") {
        owner_id = ownerByName.get(normTxt(ownerName)) ?? null;
        if (!owner_id) ownersNotFound.add(ownerName);
      }
      const { error } = await supabase.from("pnr_kpis").insert({
        tenant_id: tenantId,
        category_id: currentCategoryId,
        sort: kpiSort,
        name,
        description: (r.description ?? "").trim() || null,
        owner_id,
        unit: (r.unit ?? "").trim() === "-" ? "" : (r.unit ?? "").trim(),
        direction: dirOf(r.direction),
        consolidation: consOf(r.unit),
        max_points: parseNum(r.maxPoints) ?? 0,
        target: parseNum(r.target),
        partial_high: parseNum(r.partialHigh),
        partial_low: parseNum(r.partialLow),
        points_high: parseNum(r.pointsHigh),
        points_low: parseNum(r.pointsLow),
        created_by: userId,
      });
      if (error) return { ...base, error: error.message };
      kpiSeen.add(normTxt(name));
      base.kpis += 1;
    }

    revalidatePath("/pnr");
    return { ...base, ownersNotFound: [...ownersNotFound] };
  } catch (e) {
    return { ...base, error: (e as Error).message };
  }
}
