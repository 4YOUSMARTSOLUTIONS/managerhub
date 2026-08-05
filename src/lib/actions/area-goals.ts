"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Database, Enums } from "@/types/database";

function isAdminRole(role: Enums<"member_role">) {
  return role === "owner" || role === "admin";
}

const normTxt = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

export type CreateAreaGoalInput = {
  department_id?: string | null;
  subdepartment_id?: string | null;
  unit_id?: string | null; // null = todas as unidades (Grupo)
  parent_id?: string | null; // IC pai (hierarquia)
  name: string;
  description?: string | null; // conceito (métrica)
  unit?: string;
  kind: Enums<"area_goal_kind">;
  direction: Enums<"goal_direction">;
  consolidation: Enums<"area_consolidation">;
  owner_id?: string | null;
};

export async function createAreaGoal(input: CreateAreaGoalInput): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId, role } = await actionContext();
    if (!isAdminRole(role)) return { error: "Apenas owner/admin podem cadastrar indicadores." };
    const name = (input.name ?? "").trim();
    if (!name) return { error: "Informe o nome do indicador." };

    const { error } = await supabase.from("area_goals").insert({
      tenant_id: tenantId,
      department_id: input.department_id || null,
      subdepartment_id: input.subdepartment_id || null,
      unit_id: input.unit_id || null,
      parent_id: input.parent_id || null,
      name,
      description: (input.description ?? "").trim() || null,
      unit: (input.unit ?? "").trim(),
      kind: input.kind,
      direction: input.direction,
      consolidation: input.consolidation,
      owner_id: input.owner_id || null,
      created_by: userId,
    });
    if (error) return { error: error.message };
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type UpdateAreaGoalInput = {
  id: string;
  department_id?: string | null;
  subdepartment_id?: string | null;
  unit_id?: string | null;
  parent_id?: string | null;
  name: string;
  description?: string | null;
  unit?: string;
  kind: Enums<"area_goal_kind">;
  direction: Enums<"goal_direction">;
  consolidation: Enums<"area_consolidation">;
  owner_id?: string | null;
};

export async function updateAreaGoal(input: UpdateAreaGoalInput): Promise<ActionState> {
  try {
    const { supabase, role } = await actionContext();
    if (!isAdminRole(role)) return { error: "Apenas owner/admin podem editar indicadores." };
    const name = (input.name ?? "").trim();
    if (!name) return { error: "Informe o nome do indicador." };
    const { error } = await supabase
      .from("area_goals")
      .update({
        department_id: input.department_id || null,
        subdepartment_id: input.subdepartment_id || null,
        unit_id: input.unit_id || null,
        parent_id: input.parent_id || null,
        name,
        description: (input.description ?? "").trim() || null,
        unit: (input.unit ?? "").trim(),
        kind: input.kind,
        direction: input.direction,
        consolidation: input.consolidation,
        owner_id: input.owner_id || null,
      })
      .eq("id", input.id);
    if (error) return { error: error.message };
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteAreaGoal(id: string): Promise<ActionState> {
  try {
    const { supabase, role } = await actionContext();
    if (!isAdminRole(role)) return { error: "Apenas owner/admin podem excluir indicadores." };
    const { error } = await supabase.from("area_goals").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type UpsertAreaEntryInput = {
  area_goal_id: string;
  unit_id: string | null; // null = Grupo (consolidação manual)
  period: string; // YYYY-MM-01
  target_value: number | null;
  actual_value: number | null;
  numerator_value?: number | null; // razão: nº (ex.: chamados no prazo)
  denominator_value?: number | null; // razão: total (ex.: total de chamados)
};

export async function upsertAreaEntry(input: UpsertAreaEntryInput): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await actionContext();
    if (!input.area_goal_id) return { error: "Indicador inválido." };
    if (!input.period) return { error: "Informe a competência." };
    const num = (v: number | null) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));

    // O LANÇAMENTO TEM DE SER DA UNIDADE DA META.
    //
    // Quem pode gravar já é decidido pela RLS (owner/admin ou o responsável da
    // meta). Só que ela não olha ONDE: nada no banco liga
    // `area_goal_entries.unit_id` a `area_goals.unit_id`, então um responsável
    // podia gravar o resultado da meta da Matriz carimbado como Filial, e o
    // número apareceria na unidade errada sem erro nenhum.
    //
    // A folga existia antes, mas era abafada pela tela, que só oferecia a
    // unidade em que a pessoa estava. Agora a tela entrega de propósito metas de
    // fora do escopo de unidade dela, então a conferência passa para cá.
    const { data: meta } = await supabase
      .from("area_goals")
      .select("unit_id")
      .eq("id", input.area_goal_id)
      .maybeSingle();
    if (!meta) return { error: "Indicador não encontrado." };
    // meta de Grupo (unit_id nulo) segue aceitando qualquer unidade ou o consolidado
    if (meta.unit_id !== null && input.unit_id !== meta.unit_id) {
      return { error: "Este indicador é de outra unidade. O resultado precisa ser lançado na unidade dele." };
    }

    // upsert manual por (area_goal_id, period, unit_id) — RLS garante permissão (owner/admin ou responsável)
    let sel = supabase
      .from("area_goal_entries")
      .select("id")
      .eq("area_goal_id", input.area_goal_id)
      .eq("period", input.period);
    sel = input.unit_id === null ? sel.is("unit_id", null) : sel.eq("unit_id", input.unit_id);
    const { data: existing } = await sel.maybeSingle();

    const payload = {
      tenant_id: tenantId,
      area_goal_id: input.area_goal_id,
      unit_id: input.unit_id,
      period: input.period,
      target_value: num(input.target_value),
      actual_value: num(input.actual_value),
      numerator_value: num(input.numerator_value ?? null),
      denominator_value: num(input.denominator_value ?? null),
    };

    let error;
    if (existing?.id) {
      ({ error } = await supabase.from("area_goal_entries").update(payload).eq("id", existing.id));
    } else {
      ({ error } = await supabase.from("area_goal_entries").insert(payload));
    }
    if (error) return { error: error.message };
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------- Importação em lote (planilha .xlsx) ----------
export type AreaGoalImportRow = {
  name: string;
  unit?: string; // unidade de medida (R$, %…)
  orgUnit?: string; // unidade organizacional (MATRIZ, FILIAL…); vazio = todas
  kind?: string;
  direction?: string;
  consolidation?: string;
  department?: string;
  subdepartment?: string;
  owner?: string;
  parent?: string; // nome do IC pai (na mesma unidade)
  description?: string; // conceito (métrica) — opcional
};

/** Parse do arquivo é feito no cliente; aqui resolvemos nomes→ids, normalizamos e inserimos.
 *  Pula indicadores que já existem (mesmo nome + mesmo setor). */
export async function importAreaGoals(
  rows: AreaGoalImportRow[],
): Promise<{ imported: number; invalid: number; duplicates: number; error?: string }> {
  try {
    const { supabase, tenantId, userId, role } = await actionContext();
    if (!isAdminRole(role)) return { imported: 0, invalid: 0, duplicates: 0, error: "Apenas owner/admin podem cadastrar indicadores." };

    const [{ data: deps }, { data: subs }, { data: mems }, { data: existing }, { data: unitsList }] = await Promise.all([
      supabase.from("departments").select("id, name").eq("tenant_id", tenantId),
      supabase.from("subdepartments").select("id, name, department_id").eq("tenant_id", tenantId),
      supabase.from("memberships").select("user_id, profiles!memberships_user_id_fkey(full_name)").eq("tenant_id", tenantId),
      supabase.from("area_goals").select("name, department_id, unit_id").eq("tenant_id", tenantId),
      supabase.from("units").select("id, name").eq("tenant_id", tenantId),
    ]);
    const depByName = new Map((deps ?? []).map((d) => [normTxt(d.name), d.id]));
    const unitByName = new Map((unitsList ?? []).map((u) => [normTxt(u.name), u.id]));
    const subByName = new Map((subs ?? []).map((s) => [normTxt(s.name), { id: s.id, dept: s.department_id }]));
    const ownerByName = new Map<string, string>();
    for (const m of mems ?? []) {
      const nm = (m.profiles as unknown as { full_name: string | null } | null)?.full_name;
      if (nm) ownerByName.set(normTxt(nm), m.user_id);
    }

    const parseKind = (v?: string): Enums<"area_goal_kind"> => {
      const n = normTxt(v ?? "");
      return n.includes("iv") || n.includes("verific") ? "iv" : "ic";
    };
    const parseDir = (v?: string): Enums<"goal_direction"> =>
      normTxt(v ?? "").includes("menor") ? "menor_melhor" : "maior_melhor";
    const parseCons = (v?: string): Enums<"area_consolidation"> => {
      const n = normTxt(v ?? "");
      if (n.includes("media")) return "media";
      if (n.includes("manual")) return "manual";
      if (n.includes("razao") || n.includes("ratio")) return "razao";
      return "soma";
    };

    // chave de duplicidade: nome (normalizado) + setor + unidade
    const dupKey = (name: string, dept: string | null, unit: string | null) => `${normTxt(name)}|${dept ?? ""}|${unit ?? ""}`;
    const seen = new Set((existing ?? []).map((g) => dupKey(g.name, g.department_id, g.unit_id)));

    const toInsert: Database["public"]["Tables"]["area_goals"]["Insert"][] = [];
    const parentNames: (string | null)[] = []; // IC pai por linha inserida (paralelo a toInsert)
    let invalid = 0;
    let duplicates = 0;
    for (const r of rows ?? []) {
      // TODOS os campos são obrigatórios (IC pai é opcional)
      const name = String(r?.name ?? "").trim();
      const unit_id = r?.orgUnit ? unitByName.get(normTxt(r.orgUnit)) ?? null : null;
      const department_id = r?.department ? depByName.get(normTxt(r.department)) ?? null : null;
      const sub = r?.subdepartment ? subByName.get(normTxt(r.subdepartment)) ?? null : null;
      const subdepartment_id = sub?.id ?? null;
      const medida = String(r?.unit ?? "").trim();
      const tipo = String(r?.kind ?? "").trim();
      const dir = String(r?.direction ?? "").trim();
      const calc = String(r?.consolidation ?? "").trim();
      const owner_id = r?.owner ? ownerByName.get(normTxt(r.owner)) ?? null : null;
      if (!name || !unit_id || !department_id || !subdepartment_id || !medida || !tipo || !dir || !calc || !owner_id) {
        invalid++;
        continue;
      }
      const key = dupKey(name, department_id, unit_id);
      if (seen.has(key)) { duplicates++; continue; } // já existe (ou repetido na planilha)
      seen.add(key);
      toInsert.push({
        tenant_id: tenantId,
        department_id,
        subdepartment_id,
        unit_id,
        name,
        description: String(r?.description ?? "").trim() || null,
        unit: medida,
        kind: parseKind(tipo),
        direction: parseDir(dir),
        consolidation: parseCons(calc),
        owner_id,
        created_by: userId,
      });
      parentNames.push(String(r?.parent ?? "").trim() || null);
    }
    if (toInsert.length === 0) {
      const err = invalid > 0
        ? "Nenhum indicador importado — todas as colunas são obrigatórias (Indicador, Unidade, Setor, Subsetor, Un. medida, Tipo, Direção, Cálculo e Responsável). Unidade/Setor/Subsetor/Responsável precisam existir com o nome exato."
        : duplicates > 0
          ? "Todos os indicadores já existem (nenhum novo)."
          : "Nenhuma linha válida.";
      return { imported: 0, invalid, duplicates, error: err };
    }

    const { error } = await supabase.from("area_goals").insert(toInsert);
    if (error) return { imported: 0, invalid, duplicates, error: error.message };

    // 2º passo: vincula cada filho ao IC pai (mesma unidade), casando pelo nome
    if (parentNames.some((p) => p)) {
      const { data: allGoals } = await supabase
        .from("area_goals")
        .select("id, name, unit_id")
        .eq("tenant_id", tenantId);
      const idByUnitName = new Map((allGoals ?? []).map((g) => [`${g.unit_id ?? ""}|${normTxt(g.name)}`, g.id]));
      for (let i = 0; i < toInsert.length; i++) {
        const pName = parentNames[i];
        if (!pName) continue;
        const ins = toInsert[i];
        const childId = idByUnitName.get(`${ins.unit_id ?? ""}|${normTxt(ins.name)}`);
        const parentId = idByUnitName.get(`${ins.unit_id ?? ""}|${normTxt(pName)}`);
        if (childId && parentId && childId !== parentId) {
          await supabase.from("area_goals").update({ parent_id: parentId }).eq("id", childId);
        }
      }
    }

    revalidatePath("/metas");
    return { imported: toInsert.length, invalid, duplicates };
  } catch (e) {
    return { imported: 0, invalid: 0, duplicates: 0, error: (e as Error).message };
  }
}

// ---------- Importação de RESULTADOS (lançamentos por competência) ----------
export type AreaEntryImportRow = {
  name: string;
  orgUnit?: string;
  department?: string;
  period?: string; // YYYY-MM
  meta?: string;
  realizado?: string;
  numerator?: string;
  denominator?: string;
};

const parseNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (s === "") return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); // pt-BR: 1.234,56 → 1234.56
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
};

/** Importa resultados (meta/realizado ou numerador/denominador) para indicadores existentes,
 *  casando por Indicador + Unidade (+ Setor se ambíguo) e por competência. */
export async function importAreaEntries(
  rows: AreaEntryImportRow[],
): Promise<{ imported: number; invalid: number; notFound: number; error?: string }> {
  try {
    const { supabase, tenantId, role } = await actionContext();
    if (!isAdminRole(role)) return { imported: 0, invalid: 0, notFound: 0, error: "Apenas owner/admin podem lançar resultados." };

    const [{ data: deps }, { data: unitsList }, { data: goals }] = await Promise.all([
      supabase.from("departments").select("id, name").eq("tenant_id", tenantId),
      supabase.from("units").select("id, name").eq("tenant_id", tenantId),
      supabase.from("area_goals").select("id, name, department_id, unit_id, consolidation, unit").eq("tenant_id", tenantId),
    ]);
    const depByName = new Map((deps ?? []).map((d) => [normTxt(d.name), d.id]));
    const unitByName = new Map((unitsList ?? []).map((u) => [normTxt(u.name), u.id]));
    const goalsArr = goals ?? [];

    // pré-carrega os lançamentos existentes p/ decidir insert vs update sem 1 query por linha
    const goalIds = goalsArr.map((g) => g.id);
    const { data: existingEntries } = goalIds.length
      ? await supabase.from("area_goal_entries").select("id, area_goal_id, period, unit_id").in("area_goal_id", goalIds)
      : { data: [] as { id: string; area_goal_id: string; period: string; unit_id: string | null }[] };
    const entryKey = (goalId: string, period: string, unitId: string | null) => `${goalId}|${period}|${unitId ?? ""}`;
    const existingMap = new Map((existingEntries ?? []).map((e) => [entryKey(e.area_goal_id, e.period, e.unit_id), e.id]));

    const inserts: Database["public"]["Tables"]["area_goal_entries"]["Insert"][] = [];
    const updates: { id: string; payload: Database["public"]["Tables"]["area_goal_entries"]["Update"] }[] = [];
    let invalid = 0;
    let notFound = 0;
    for (const r of rows ?? []) {
      const name = (r.name ?? "").trim();
      const unit_id = r.orgUnit ? unitByName.get(normTxt(r.orgUnit)) ?? null : null;
      const period = (r.period ?? "").trim();
      if (!name || !unit_id || !/^\d{4}-\d{2}$/.test(period)) { invalid++; continue; }

      let cands = goalsArr.filter((g) => normTxt(g.name) === normTxt(name) && g.unit_id === unit_id);
      if (cands.length > 1 && r.department) {
        const dept_id = depByName.get(normTxt(r.department));
        if (dept_id) cands = cands.filter((g) => g.department_id === dept_id);
      }
      if (cands.length !== 1) { notFound++; continue; }
      const g = cands[0];

      const target = parseNum(r.meta);
      let actual: number | null;
      let numV: number | null = null;
      let denV: number | null = null;
      if (g.consolidation === "razao") {
        numV = parseNum(r.numerator);
        denV = parseNum(r.denominator);
        const scale = (g.unit ?? "").trim() === "%" ? 100 : 1;
        actual = numV != null && denV != null && denV !== 0 ? (numV / denV) * scale : null;
      } else {
        actual = parseNum(r.realizado);
      }
      if (target == null && actual == null && numV == null && denV == null) { invalid++; continue; }

      const periodDate = `${period}-01`;
      const payload = { tenant_id: tenantId, area_goal_id: g.id, unit_id: g.unit_id, period: periodDate, target_value: target, actual_value: actual, numerator_value: numV, denominator_value: denV };
      const k = entryKey(g.id, periodDate, g.unit_id);
      const existingId = existingMap.get(k);
      if (existingId) updates.push({ id: existingId, payload });
      else { inserts.push(payload); existingMap.set(k, "pending"); } // evita duplicar a mesma linha no arquivo
    }

    let imported = 0;
    if (inserts.length) {
      const { error } = await supabase.from("area_goal_entries").insert(inserts);
      if (error) return { imported: 0, invalid, notFound, error: error.message };
      imported += inserts.length;
    }
    for (const u of updates) {
      const { error } = await supabase.from("area_goal_entries").update(u.payload).eq("id", u.id);
      if (error) return { imported, invalid, notFound, error: error.message };
      imported += 1;
    }

    if (imported === 0) {
      return {
        imported: 0, invalid, notFound,
        error: notFound > 0
          ? "Nenhum resultado lançado — indicador não encontrado. Confira Indicador + Unidade (+ Setor) exatamente como cadastrados."
          : "Nenhuma linha válida — confira Indicador, Unidade, Competência (MM/AAAA) e os valores.",
      };
    }
    revalidatePath("/metas");
    return { imported, invalid, notFound };
  } catch (e) {
    return { imported: 0, invalid: 0, notFound: 0, error: (e as Error).message };
  }
}

export async function deleteAreaEntry(input: { area_goal_id: string; unit_id: string | null; period: string }): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    let q = supabase.from("area_goal_entries").delete().eq("area_goal_id", input.area_goal_id).eq("period", input.period);
    q = input.unit_id === null ? q.is("unit_id", null) : q.eq("unit_id", input.unit_id);
    const { error } = await q;
    if (error) return { error: error.message };
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
