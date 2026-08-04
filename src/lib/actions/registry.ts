"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import { isValidCnpj, normalizeCnpj } from "@/lib/cnpj";
import { isCatalogInUse, wantsActive } from "@/lib/catalogGuard";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";

const RP = "/configuracoes";

// ---------- Unidades ----------
export async function createUnit(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await actionContext();
    const name = String(formData.get("name") ?? "").trim();
    const kind = (String(formData.get("kind") ?? "filial") as Enums<"unit_kind">);
    if (!name) return { error: "Informe o nome da unidade." };
    const cnpjRaw = String(formData.get("cnpj") ?? "").trim();
    const cnpj = cnpjRaw ? (isValidCnpj(normalizeCnpj(cnpjRaw)) ? normalizeCnpj(cnpjRaw) : null) : null;
    const { error } = await supabase.from("units").insert({ tenant_id: tenantId, name, kind, ...(cnpj ? { cnpj } : {}) });
    if (error) {
      if (error.code === "P0001") return { error: error.message };
      if (error.code === "23505") return { error: "Esse CNPJ já está cadastrado em outra unidade." };
      return { error: error.message };
    }
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
export async function updateUnit(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const id = String(formData.get("id"));
    const name = String(formData.get("name") ?? "").trim();
    const kind = String(formData.get("kind") ?? "") as Enums<"unit_kind">;
    if (!name) return { error: "Informe o nome da unidade." };
    const cnpjRaw = String(formData.get("cnpj") ?? "").trim();
    let cnpj: string | null = null;
    if (cnpjRaw) {
      const normalized = normalizeCnpj(cnpjRaw);
      if (!isValidCnpj(normalized)) return { error: "CNPJ inválido. Confira os dígitos." };
      cnpj = normalized;
    }
    const { error } = await supabase.from("units").update({ name, kind, cnpj }).eq("id", id);
    if (error) {
      if (error.code === "23505") return { error: "Esse CNPJ já está cadastrado em outra unidade." };
      return { error: error.message };
    }
    revalidatePath(RP);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
export async function deleteUnit(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  await supabase.from("units").delete().eq("id", String(formData.get("id")));
  revalidatePath(RP);
}

// ---------- Setores ----------
export async function createDepartment(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await actionContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await supabase.from("departments").insert({ tenant_id: tenantId, name });
  revalidatePath(RP);
}
export async function setDepartmentActive(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  await supabase.from("departments").update({ active: wantsActive(formData) }).eq("id", String(formData.get("id")));
  revalidatePath(RP);
}
export async function deleteDepartment(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  const id = String(formData.get("id"));
  const used = await isCatalogInUse(supabase, id, [
    { table: "memberships", col: "department_id" },
    { table: "subdepartments", col: "department_id" },
    { table: "area_goals", col: "department_id" },
    { table: "checklists", col: "department_id" },
  ]);
  if (used) { await setDepartmentActive(formData); return; }
  await supabase.from("departments").delete().eq("id", id);
  revalidatePath(RP);
}

// ---------- Subsetores ----------
export async function createSubdepartment(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await actionContext();
  const name = String(formData.get("name") ?? "").trim();
  const department_id = String(formData.get("department_id") ?? "");
  if (!name || !department_id) return;
  await supabase.from("subdepartments").insert({ tenant_id: tenantId, department_id, name });
  revalidatePath(RP);
}
export async function setSubdepartmentActive(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  await supabase.from("subdepartments").update({ active: wantsActive(formData) }).eq("id", String(formData.get("id")));
  revalidatePath(RP);
}
export async function deleteSubdepartment(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  const id = String(formData.get("id"));
  const used = await isCatalogInUse(supabase, id, [
    { table: "memberships", col: "subdepartment_id" },
    { table: "area_goals", col: "subdepartment_id" },
    { table: "checklists", col: "subdepartment_id" },
  ]);
  if (used) { await setSubdepartmentActive(formData); return; }
  await supabase.from("subdepartments").delete().eq("id", id);
  revalidatePath(RP);
}

// ---------- Funções ----------
export async function createPosition(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await actionContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await supabase.from("positions").insert({ tenant_id: tenantId, name });
  revalidatePath(RP);
}
export async function setPositionActive(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  await supabase.from("positions").update({ active: wantsActive(formData) }).eq("id", String(formData.get("id")));
  revalidatePath(RP);
}
export async function deletePosition(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  const id = String(formData.get("id"));
  const used = await isCatalogInUse(supabase, id, [
    { table: "memberships", col: "position_id" },
    { table: "individual_rv_config", col: "position_id" },
    { table: "feedback_cadence_rules", col: "position_id" },
  ]);
  if (used) { await setPositionActive(formData); return; }
  await supabase.from("positions").delete().eq("id", id);
  revalidatePath(RP);
}

// ---------- Perfis de função ----------
export async function createPositionLevel(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await actionContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await supabase.from("position_levels").insert({ tenant_id: tenantId, name });
  revalidatePath(RP);
}
export async function setPositionLevelActive(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  await supabase.from("position_levels").update({ active: wantsActive(formData) }).eq("id", String(formData.get("id")));
  revalidatePath(RP);
}
export async function deletePositionLevel(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  const id = String(formData.get("id"));
  const used = await isCatalogInUse(supabase, id, [{ table: "memberships", col: "position_level_id" }]);
  if (used) { await setPositionLevelActive(formData); return; }
  await supabase.from("position_levels").delete().eq("id", id);
  revalidatePath(RP);
}

// ---------- Hierarquia ----------
//
// Segue o mesmo molde dos demais catálogos, com um acréscimo: `rank`. Hierarquia
// tem ordem (Diretoria acima de Gerência), então a lista é ordenada por ele e não
// pelo nome. O passo de 10 deixa espaço para encaixar nível novo no meio sem
// renumerar a tabela toda.
const PASSO_HIERARQUIA = 10;

export async function createHierarchyLevel(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await actionContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  // nasce no fim da ordem; reordenar é uma ação à parte
  const { data: ultimo } = await supabase
    .from("hierarchy_levels").select("rank").eq("tenant_id", tenantId)
    .order("rank", { ascending: false }).limit(1).maybeSingle();
  await supabase.from("hierarchy_levels").insert({
    tenant_id: tenantId, name, rank: (ultimo?.rank ?? 0) + PASSO_HIERARQUIA,
  });
  revalidatePath(RP);
}

export async function setHierarchyLevelActive(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  await supabase.from("hierarchy_levels").update({ active: wantsActive(formData) }).eq("id", String(formData.get("id")));
  revalidatePath(RP);
}

export async function deleteHierarchyLevel(formData: FormData): Promise<void> {
  const { supabase } = await actionContext();
  const id = String(formData.get("id"));
  const used = await isCatalogInUse(supabase, id, [{ table: "memberships", col: "hierarchy_level_id" }]);
  if (used) { await setHierarchyLevelActive(formData); return; }
  await supabase.from("hierarchy_levels").delete().eq("id", id);
  revalidatePath(RP);
}

/**
 * Sobe ou desce um nível na ordem.
 *
 * Troca o `rank` com o vizinho em vez de recalcular a lista inteira: é uma
 * escrita em duas linhas, e nenhum outro nível se mexe. Se não houver vizinho na
 * direção pedida, o nível já está na ponta e nada acontece.
 */
export async function moveHierarchyLevel(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await actionContext();
  const id = String(formData.get("id"));
  const paraCima = String(formData.get("dir")) === "up";

  const { data: atual } = await supabase
    .from("hierarchy_levels").select("id, rank").eq("id", id).maybeSingle();
  if (!atual) return;

  const { data: vizinho } = await supabase
    .from("hierarchy_levels").select("id, rank")
    .eq("tenant_id", tenantId)
    [paraCima ? "lt" : "gt"]("rank", atual.rank)
    .order("rank", { ascending: !paraCima })
    .limit(1).maybeSingle();
  if (!vizinho) return;

  await supabase.from("hierarchy_levels").update({ rank: vizinho.rank }).eq("id", atual.id);
  await supabase.from("hierarchy_levels").update({ rank: atual.rank }).eq("id", vizinho.id);
  revalidatePath(RP);
}

// ---------- Importação em lote (Setor > Subsetor e Funções) ----------
const normName = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

export type StructureImportRow = { setor: string; subsetor: string; funcao: string };
export type StructureImportResult = {
  rows: number;
  setoresCreated: number;
  subsetoresCreated: number;
  funcoesCreated: number;
  skipped: number;
  error?: string;
};

/**
 * Importa a estrutura organizacional a partir de linhas Setor/Subsetor/Função.
 * - Setor + Subsetor formam uma hierarquia (o subsetor pertence ao setor da linha);
 *   o setor é criado se ainda não existir, para poder receber o subsetor.
 * - Função é uma lista plana e independente: cada valor distinto vira uma função,
 *   sem relação com o setor da linha.
 * Nomes já cadastrados são reaproveitados (sem duplicar).
 */
export async function importStructure(rows: StructureImportRow[]): Promise<StructureImportResult> {
  const base: StructureImportResult = { rows: rows.length, setoresCreated: 0, subsetoresCreated: 0, funcoesCreated: 0, skipped: 0 };
  try {
    const { supabase, tenantId, role } = await actionContext();
    if (role !== "owner" && role !== "admin") return { ...base, error: "Apenas proprietário e administrador podem importar a estrutura." };

    const [{ data: depts }, { data: subs }, { data: positions }] = await Promise.all([
      supabase.from("departments").select("id, name").eq("tenant_id", tenantId),
      supabase.from("subdepartments").select("id, name, department_id").eq("tenant_id", tenantId),
      supabase.from("positions").select("id, name").eq("tenant_id", tenantId),
    ]);

    const deptByName = new Map<string, string>();
    for (const d of depts ?? []) deptByName.set(normName(d.name), d.id);
    const subByKey = new Map<string, string>();
    for (const s of subs ?? []) subByKey.set(`${s.department_id}|${normName(s.name)}`, s.id);
    const posByName = new Map<string, string>();
    for (const p of positions ?? []) posByName.set(normName(p.name), p.id);

    for (const r of rows) {
      const setor = (r.setor ?? "").trim();
      const subsetor = (r.subsetor ?? "").trim();
      const funcao = (r.funcao ?? "").trim();
      if (!setor && !subsetor && !funcao) continue;

      let deptId: string | undefined;
      if (setor) {
        deptId = deptByName.get(normName(setor));
        if (!deptId) {
          const { data, error } = await supabase.from("departments").insert({ tenant_id: tenantId, name: setor }).select("id").single();
          if (error || !data) return { ...base, error: `Setor "${setor}": ${error?.message ?? "falha ao criar"}` };
          deptId = data.id;
          deptByName.set(normName(setor), deptId);
          base.setoresCreated += 1;
        }
      }

      if (subsetor) {
        if (!deptId) {
          base.skipped += 1; // subsetor sem setor na linha: não dá para posicionar
        } else {
          const key = `${deptId}|${normName(subsetor)}`;
          if (!subByKey.get(key)) {
            const { data, error } = await supabase.from("subdepartments").insert({ tenant_id: tenantId, department_id: deptId, name: subsetor }).select("id").single();
            if (error || !data) return { ...base, error: `Subsetor "${subsetor}": ${error?.message ?? "falha ao criar"}` };
            subByKey.set(key, data.id);
            base.subsetoresCreated += 1;
          }
        }
      }

      if (funcao && !posByName.get(normName(funcao))) {
        const { data, error } = await supabase.from("positions").insert({ tenant_id: tenantId, name: funcao }).select("id").single();
        if (error || !data) return { ...base, error: `Função "${funcao}": ${error?.message ?? "falha ao criar"}` };
        posByName.set(normName(funcao), data.id);
        base.funcoesCreated += 1;
      }
    }

    revalidatePath(RP);
    return base;
  } catch (e) {
    return { ...base, error: (e as Error).message };
  }
}
