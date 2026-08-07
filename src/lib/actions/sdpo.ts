"use server";

import { revalidatePath } from "next/cache";
import { adminActionContext } from "./context";

const RP = "/configuracoes";

type Db = Awaited<ReturnType<typeof adminActionContext>>["supabase"];

/** true se qualquer ação já referencia um dos ids de pilar/seção/bloco/item informados. */
async function isReferenced(
  supabase: Db,
  ids: { pilar?: string[]; secao?: string[]; bloco?: string[]; item?: string[] },
): Promise<boolean> {
  const one = async (col: "pilar_id" | "secao_id" | "bloco_id" | "item_id", vals: string[]) => {
    if (!vals.length) return false;
    const { count } = await supabase.from("actions").select("id", { count: "exact", head: true }).in(col, vals);
    return (count ?? 0) > 0;
  };
  const [p, s, b, i] = await Promise.all([
    one("pilar_id", ids.pilar ?? []),
    one("secao_id", ids.secao ?? []),
    one("bloco_id", ids.bloco ?? []),
    one("item_id", ids.item ?? []),
  ]);
  return p || s || b || i;
}

// helper: lê o flag "active" enviado pelo form ("1"/"true" = ativar)
const wantsActive = (fd: FormData) => {
  const v = String(fd.get("active") ?? "");
  return v === "1" || v === "true";
};

// ---------- Programas (ex.: SPO, DPO) ----------
export async function createProgram(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await adminActionContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await supabase.from("sdpo_programas").insert({ tenant_id: tenantId, name });
  revalidatePath(RP);
}
export async function setProgramActive(formData: FormData): Promise<void> {
  const { supabase } = await adminActionContext();
  await supabase.from("sdpo_programas").update({ active: wantsActive(formData) }).eq("id", String(formData.get("id")));
  revalidatePath(RP);
}
export async function deleteProgram(formData: FormData): Promise<void> {
  const { supabase } = await adminActionContext();
  const id = String(formData.get("id"));
  // programa referenciado por blocos ou itens não é excluído (FK restrict): apenas desativa
  const [{ count: cb }, { count: ci }] = await Promise.all([
    supabase.from("sdpo_blocos").select("id", { count: "exact", head: true }).eq("programa_id", id),
    supabase.from("sdpo_itens").select("id", { count: "exact", head: true }).eq("programa_id", id),
  ]);
  if ((cb ?? 0) + (ci ?? 0) > 0) { await setProgramActive(formData); return; }
  await supabase.from("sdpo_programas").delete().eq("id", id);
  revalidatePath(RP);
}

// ---------- Pilares (catálogo global, único por nome; compartilhado entre programas) ----------
const normPilar = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
export async function createPilar(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await adminActionContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  // pilar é global: se já existe um com o mesmo nome, não duplica
  const { data: existing } = await supabase.from("sdpo_pilares").select("id, name").eq("tenant_id", tenantId);
  if ((existing ?? []).some((p) => normPilar(p.name) === normPilar(name))) return;
  await supabase.from("sdpo_pilares").insert({ tenant_id: tenantId, name });
  revalidatePath(RP);
}
export async function setPilarActive(formData: FormData): Promise<void> {
  const { supabase } = await adminActionContext();
  await supabase.from("sdpo_pilares").update({ active: wantsActive(formData) }).eq("id", String(formData.get("id")));
  revalidatePath(RP);
}
export async function deletePilar(formData: FormData): Promise<void> {
  const { supabase } = await adminActionContext();
  const id = String(formData.get("id"));
  // guarda: só exclui se o pilar e sua subárvore (blocos/itens deste pilar) nunca foram usados
  const { data: blocos } = await supabase.from("sdpo_blocos").select("id").eq("pilar_id", id);
  const blocoIds = (blocos ?? []).map((b) => b.id);
  const { data: itens } = await supabase.from("sdpo_itens").select("id").eq("pilar_id", id);
  const itemIds = (itens ?? []).map((i) => i.id);
  const used = await isReferenced(supabase, { pilar: [id], bloco: blocoIds, item: itemIds });
  if (used) { await setPilarActive(formData); return; } // usado → apenas desativa
  await supabase.from("sdpo_pilares").delete().eq("id", id);
  revalidatePath(RP);
}

// ---------- Seções (catálogo global, reutilizado por qualquer pilar) ----------
export async function createSecao(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await adminActionContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await supabase.from("sdpo_secoes").insert({ tenant_id: tenantId, name });
  revalidatePath(RP);
}
export async function setSecaoActive(formData: FormData): Promise<void> {
  const { supabase } = await adminActionContext();
  await supabase.from("sdpo_secoes").update({ active: wantsActive(formData) }).eq("id", String(formData.get("id")));
  revalidatePath(RP);
}
export async function deleteSecao(formData: FormData): Promise<void> {
  const { supabase } = await adminActionContext();
  const id = String(formData.get("id"));
  const { data: blocos } = await supabase.from("sdpo_blocos").select("id").eq("secao_id", id);
  const blocoIds = (blocos ?? []).map((b) => b.id);
  const { data: itens } = await supabase.from("sdpo_itens").select("id").eq("secao_id", id);
  const itemIds = (itens ?? []).map((i) => i.id);
  const used = await isReferenced(supabase, { secao: [id], bloco: blocoIds, item: itemIds });
  if (used) { await setSecaoActive(formData); return; }
  await supabase.from("sdpo_secoes").delete().eq("id", id);
  revalidatePath(RP);
}

// ---------- Blocos (pertencem a um Pilar + Seção; opcional) ----------
export async function createBloco(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await adminActionContext();
  const name = String(formData.get("name") ?? "").trim();
  const programa_id = String(formData.get("programa_id") ?? "") || null;
  const pilar_id = String(formData.get("pilar_id") ?? "");
  const secao_id = String(formData.get("secao_id") ?? "");
  const code = String(formData.get("code") ?? "").trim() || null;
  if (!name || !programa_id || !pilar_id || !secao_id) return;
  await supabase.from("sdpo_blocos").insert({ tenant_id: tenantId, programa_id, pilar_id, secao_id, name, code });
  revalidatePath(RP);
}
export async function setBlocoActive(formData: FormData): Promise<void> {
  const { supabase } = await adminActionContext();
  await supabase.from("sdpo_blocos").update({ active: wantsActive(formData) }).eq("id", String(formData.get("id")));
  revalidatePath(RP);
}
export async function deleteBloco(formData: FormData): Promise<void> {
  const { supabase } = await adminActionContext();
  const id = String(formData.get("id"));
  const { data: itens } = await supabase.from("sdpo_itens").select("id").eq("bloco_id", id);
  const itemIds = (itens ?? []).map((i) => i.id);
  const used = await isReferenced(supabase, { bloco: [id], item: itemIds });
  if (used) { await setBlocoActive(formData); return; }
  await supabase.from("sdpo_blocos").delete().eq("id", id);
  revalidatePath(RP);
}

// ---------- Itens (pertencem a um Pilar + Seção; opcionalmente a um Bloco) ----------
export async function createItem(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await adminActionContext();
  const name = String(formData.get("name") ?? "").trim();
  let programa_id = String(formData.get("programa_id") ?? "") || null;
  let pilar_id = String(formData.get("pilar_id") ?? "");
  let secao_id = String(formData.get("secao_id") ?? "");
  const bloco_id = String(formData.get("bloco_id") ?? "") || null;
  const code = String(formData.get("code") ?? "").trim() || null;
  // se veio bloco, o programa/pilar/seção do item são os do bloco (consistência pai/filho)
  if (bloco_id) {
    const { data: bl } = await supabase.from("sdpo_blocos").select("programa_id, pilar_id, secao_id").eq("id", bloco_id).eq("tenant_id", tenantId).single();
    if (bl?.programa_id) programa_id = bl.programa_id;
    if (bl?.pilar_id) pilar_id = bl.pilar_id;
    if (bl?.secao_id) secao_id = bl.secao_id;
  }
  if (!name || !programa_id || !pilar_id || !secao_id) return;
  await supabase.from("sdpo_itens").insert({ tenant_id: tenantId, programa_id, pilar_id, secao_id, bloco_id, name, code });
  revalidatePath(RP);
}
export async function setItemActive(formData: FormData): Promise<void> {
  const { supabase } = await adminActionContext();
  await supabase.from("sdpo_itens").update({ active: wantsActive(formData) }).eq("id", String(formData.get("id")));
  revalidatePath(RP);
}
export async function deleteItem(formData: FormData): Promise<void> {
  const { supabase } = await adminActionContext();
  const id = String(formData.get("id"));
  const used = await isReferenced(supabase, { item: [id] });
  if (used) { await setItemActive(formData); return; }
  await supabase.from("sdpo_itens").delete().eq("id", id);
  revalidatePath(RP);
}

// ---------- KPIs ----------
export async function createKpi(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await adminActionContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await supabase.from("action_kpis").insert({ tenant_id: tenantId, name });
  revalidatePath(RP);
}
export async function setKpiActive(formData: FormData): Promise<void> {
  const { supabase } = await adminActionContext();
  await supabase.from("action_kpis").update({ active: wantsActive(formData) }).eq("id", String(formData.get("id")));
  revalidatePath(RP);
}
export async function deleteKpi(formData: FormData): Promise<void> {
  const { supabase } = await adminActionContext();
  const id = String(formData.get("id"));
  const { count } = await supabase.from("actions").select("id", { count: "exact", head: true }).eq("kpi_id", id);
  if ((count ?? 0) > 0) { await setKpiActive(formData); return; } // usado → apenas desativa
  await supabase.from("action_kpis").delete().eq("id", id);
  revalidatePath(RP);
}

// ---------- Ferramentas de gestão ----------
export async function createTool(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await adminActionContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await supabase.from("action_tools").insert({ tenant_id: tenantId, name });
  revalidatePath(RP);
}
export async function setToolActive(formData: FormData): Promise<void> {
  const { supabase } = await adminActionContext();
  await supabase.from("action_tools").update({ active: wantsActive(formData) }).eq("id", String(formData.get("id")));
  revalidatePath(RP);
}
export async function deleteTool(formData: FormData): Promise<void> {
  const { supabase } = await adminActionContext();
  const id = String(formData.get("id"));
  const { count } = await supabase.from("actions").select("id", { count: "exact", head: true }).eq("tool_id", id);
  if ((count ?? 0) > 0) { await setToolActive(formData); return; }
  await supabase.from("action_tools").delete().eq("id", id);
  revalidatePath(RP);
}

// ---------- Importação em lote (Programa > Pilar > Seção > [Bloco] > Item) ----------
const normName = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

// ---------- Importação em lote de catálogos simples (KPIs / Ferramentas) ----------
export type SimpleImportResult = { created: number; skipped: number; error?: string };

async function importSimpleCatalog(table: "action_kpis" | "action_tools", names: string[]): Promise<SimpleImportResult> {
  const base: SimpleImportResult = { created: 0, skipped: 0 };
  try {
    const { supabase, tenantId, role } = await adminActionContext();
    if (role !== "owner" && role !== "admin") return { ...base, error: "Apenas proprietário e administrador podem importar." };
    const { data: existing } = await supabase.from(table).select("name").eq("tenant_id", tenantId);
    const seen = new Set((existing ?? []).map((x) => normName(x.name)));
    for (const raw of names) {
      const name = (raw ?? "").trim();
      if (!name) continue;
      const key = normName(name);
      if (seen.has(key)) { base.skipped += 1; continue; } // já existe (ou repetido no arquivo)
      const { error } = await supabase.from(table).insert({ tenant_id: tenantId, name });
      if (error) return { ...base, error: `"${name}": ${error.message}` };
      seen.add(key);
      base.created += 1;
    }
    revalidatePath(RP);
    return base;
  } catch (e) {
    return { ...base, error: (e as Error).message };
  }
}
export async function importKpis(names: string[]): Promise<SimpleImportResult> {
  return importSimpleCatalog("action_kpis", names);
}
export async function importTools(names: string[]): Promise<SimpleImportResult> {
  return importSimpleCatalog("action_tools", names);
}

export type SdpoImportRow = { programa: string; pilar: string; secao: string; bloco: string; codeBloco: string; item: string; codeItem: string };
export type SdpoImportResult = {
  rows: number;
  programasCreated: number;
  pilaresCreated: number;
  secoesCreated: number;
  blocosCreated: number;
  itensCreated: number;
  skipped: number;
  error?: string;
};

/**
 * Importa a estrutura do SDPO a partir de linhas Programa/Pilar/Seção/Bloco/Item.
 * Faz upsert por nome (sem duplicar o que já existe), encadeando os níveis.
 * Bloco é opcional: se vazio, o item pendura direto na seção (padrão SPO).
 * Um pilar precisa de um programa; uma seção precisa de um pilar; um item precisa de uma seção.
 * Linha sem programa é ignorada.
 */
export async function importSdpo(rows: SdpoImportRow[]): Promise<SdpoImportResult> {
  const base: SdpoImportResult = { rows: rows.length, programasCreated: 0, pilaresCreated: 0, secoesCreated: 0, blocosCreated: 0, itensCreated: 0, skipped: 0 };
  try {
    const { supabase, tenantId, role } = await adminActionContext();
    if (role !== "owner" && role !== "admin") return { ...base, error: "Apenas proprietário e administrador podem importar a estrutura." };

    const [{ data: programas }, { data: pilares }, { data: secoes }, { data: blocos }, { data: itens }] = await Promise.all([
      supabase.from("sdpo_programas").select("id, name").eq("tenant_id", tenantId),
      supabase.from("sdpo_pilares").select("id, name").eq("tenant_id", tenantId),
      supabase.from("sdpo_secoes").select("id, name").eq("tenant_id", tenantId),
      supabase.from("sdpo_blocos").select("id, name, pilar_id, secao_id").eq("tenant_id", tenantId),
      supabase.from("sdpo_itens").select("id, name, pilar_id, secao_id, bloco_id").eq("tenant_id", tenantId),
    ]);

    const programaByName = new Map<string, string>();
    for (const p of programas ?? []) programaByName.set(normName(p.name), p.id);
    // pilar é global: chave só pelo nome
    const pilarByName = new Map<string, string>();
    for (const p of pilares ?? []) pilarByName.set(normName(p.name), p.id);
    // seção é global: chave só pelo nome
    const secaoByName = new Map<string, string>();
    for (const s of secoes ?? []) secaoByName.set(normName(s.name), s.id);
    const blocoByKey = new Map<string, string>();
    for (const b of blocos ?? []) blocoByKey.set(`${b.pilar_id}|${b.secao_id}|${normName(b.name)}`, b.id);
    const itemByKey = new Map<string, string>();
    for (const i of itens ?? []) itemByKey.set(`${i.pilar_id}|${i.secao_id}|${i.bloco_id ?? ""}|${normName(i.name)}`, i.id);

    for (const r of rows) {
      const programaName = (r.programa ?? "").trim();
      if (!programaName) { base.skipped += 1; continue; }

      let programaId = programaByName.get(normName(programaName));
      if (!programaId) {
        const { data, error } = await supabase.from("sdpo_programas").insert({ tenant_id: tenantId, name: programaName }).select("id").single();
        if (error || !data) return { ...base, error: `Programa "${programaName}": ${error?.message ?? "falha ao criar"}` };
        programaId = data.id;
        programaByName.set(normName(programaName), programaId);
        base.programasCreated += 1;
      }

      const pilarName = (r.pilar ?? "").trim();
      if (!pilarName) continue;
      let pilarId = pilarByName.get(normName(pilarName));
      if (!pilarId) {
        const { data, error } = await supabase.from("sdpo_pilares").insert({ tenant_id: tenantId, name: pilarName }).select("id").single();
        if (error || !data) return { ...base, error: `Pilar "${pilarName}": ${error?.message ?? "falha ao criar"}` };
        pilarId = data.id;
        pilarByName.set(normName(pilarName), pilarId);
        base.pilaresCreated += 1;
      }

      const secaoName = (r.secao ?? "").trim();
      if (!secaoName) continue;
      let secaoId = secaoByName.get(normName(secaoName));
      if (!secaoId) {
        const { data, error } = await supabase.from("sdpo_secoes").insert({ tenant_id: tenantId, name: secaoName }).select("id").single();
        if (error || !data) return { ...base, error: `Seção "${secaoName}": ${error?.message ?? "falha ao criar"}` };
        secaoId = data.id;
        secaoByName.set(normName(secaoName), secaoId);
        base.secoesCreated += 1;
      }

      // Bloco é opcional (dentro do pilar + seção)
      let blocoId: string | null = null;
      const blocoName = (r.bloco ?? "").trim();
      if (blocoName) {
        const blocoKey = `${pilarId}|${secaoId}|${normName(blocoName)}`;
        blocoId = blocoByKey.get(blocoKey) ?? null;
        if (!blocoId) {
          const { data, error } = await supabase.from("sdpo_blocos").insert({ tenant_id: tenantId, programa_id: programaId, pilar_id: pilarId, secao_id: secaoId, name: blocoName, code: (r.codeBloco ?? "").trim() || null }).select("id").single();
          if (error || !data) return { ...base, error: `Bloco "${blocoName}": ${error?.message ?? "falha ao criar"}` };
          blocoId = data.id;
          blocoByKey.set(blocoKey, blocoId);
          base.blocosCreated += 1;
        }
      }

      const itemName = (r.item ?? "").trim();
      if (!itemName) continue;
      const itemKey = `${pilarId}|${secaoId}|${blocoId ?? ""}|${normName(itemName)}`;
      if (!itemByKey.get(itemKey)) {
        const { data, error } = await supabase.from("sdpo_itens").insert({ tenant_id: tenantId, programa_id: programaId, pilar_id: pilarId, secao_id: secaoId, bloco_id: blocoId, name: itemName, code: (r.codeItem ?? "").trim() || null }).select("id").single();
        if (error || !data) return { ...base, error: `Item "${itemName}": ${error?.message ?? "falha ao criar"}` };
        itemByKey.set(itemKey, data.id);
        base.itensCreated += 1;
      }
    }

    revalidatePath(RP);
    return base;
  } catch (e) {
    return { ...base, error: (e as Error).message };
  }
}
