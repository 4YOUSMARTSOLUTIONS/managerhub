"use server";

import { revalidatePath } from "next/cache";
import { dpActionContext } from "./context";
import { wantsActive } from "@/lib/catalogGuard";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";
import {
  parseDataPlanilha, acharTipo, chaveDaPunicao,
  type SanctionImportRow, type SanctionImportResult,
} from "@/lib/sanctions-import";
import { indiceDeAlvos, resolverAlvo, type Origem } from "@/lib/import-pessoa";

/**
 * Redutores da remuneração variável: catálogo de punições, o registro da
 * punição e as regras/faixas de corte.
 *
 * Tudo aqui é `dpActionContext`, pelo mesmo motivo de `absences.ts` e de
 * `rv-config.ts`: mexer nisto é mexer no que a pessoa recebe, e é o núcleo da
 * alçada do RH. A RLS já recusa quem não pode, mas recusa em silêncio: um update
 * fora da policy afeta zero linha e volta sem erro.
 *
 * Os dois `revalidatePath` são obrigatórios em toda função: o cadastro vive em
 * Configurações e quem consome é a tela de Metas.
 */

const RP_CONFIG = "/configuracoes";
const RP_METAS = "/metas";
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function revalidar() {
  revalidatePath(RP_CONFIG);
  revalidatePath(RP_METAS);
}

/** Traduz o erro do banco em algo que a pessoa entenda na tela. */
function mensagem(e: { code?: string; message?: string }): string {
  const msg = e.message ?? "";
  if (msg.includes("rv_reducer_bands_sem_sobreposicao")) {
    return "Esta faixa se sobrepõe a outra já cadastrada neste motivo. Ajuste os limites.";
  }
  if (msg.includes("rv_reducer_rules_ausencia_uk") || msg.includes("rv_reducer_rules_punicao")) {
    return "Já existe um motivo para esta origem. Edite o que existe em vez de criar outro.";
  }
  if (msg.includes("sanction_types_nome_unico")) return "Já existe um tipo de punição com esse nome.";
  if (msg.includes("rv_reducer_bands_pct")) return "A redução precisa ficar entre 0% e 100%.";
  if (msg.includes("rv_reducer_bands_max")) return "O limite final não pode ser menor que o inicial.";
  if (msg.includes("employee_sanctions_sanction_type_id_fkey")) {
    return "Este tipo de punição está em uso e não pode ser excluído. Desative-o.";
  }
  return msg || "Não foi possível salvar.";
}

// ---------------------------------------------------- catálogo de punições
export async function createSanctionType(formData: FormData): Promise<void> {
  const { supabase, tenantId } = await dpActionContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await supabase.from("sanction_types").insert({ tenant_id: tenantId, name });
  revalidar();
}

export async function setSanctionTypeActive(formData: FormData): Promise<void> {
  const { supabase } = await dpActionContext();
  await supabase.from("sanction_types").update({ active: wantsActive(formData) }).eq("id", String(formData.get("id")));
  revalidar();
}

export async function deleteSanctionType(formData: FormData): Promise<void> {
  const { supabase } = await dpActionContext();
  const id = String(formData.get("id"));
  // Em uso vira desativação, como nos demais catálogos: apagar levaria junto o
  // histórico disciplinar, e a FK é `on delete restrict` justamente por isso.
  const { count } = await supabase
    .from("employee_sanctions").select("id", { count: "exact", head: true }).eq("sanction_type_id", id);
  if ((count ?? 0) > 0) { await setSanctionTypeActive(formData); return; }
  await supabase.from("sanction_types").delete().eq("id", id);
  revalidar();
}

// ------------------------------------------------------ punição aplicada
export type SanctionInput = {
  /** ausente = criar */
  id?: string;
  user_id: string;
  sanction_type_id: string;
  occurred_on: string;
  note?: string | null;
};

export async function upsertSanction(input: SanctionInput): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId } = await dpActionContext();
    const occurred_on = (input.occurred_on ?? "").trim();
    if (!input.user_id) return { error: "Escolha o colaborador." };
    if (!input.sanction_type_id) return { error: "Escolha o tipo de punição." };
    if (!DATA.test(occurred_on)) return { error: "Informe a data da punição." };

    // A RLS confere o tenant da LINHA, e o tenant vem do servidor. O que ela não
    // confere é se a PESSOA é desta empresa: sem isto daria para registrar uma
    // punição no id de alguém de outro tenant.
    const { data: vinc } = await supabase
      .from("memberships").select("id").eq("tenant_id", tenantId).eq("user_id", input.user_id).maybeSingle();
    if (!vinc) return { error: "Colaborador não pertence a esta empresa." };

    const linha = {
      tenant_id: tenantId,
      user_id: input.user_id,
      sanction_type_id: input.sanction_type_id,
      occurred_on,
      note: (input.note ?? "").trim() || null,
    };
    const { error } = input.id
      ? await supabase.from("employee_sanctions").update(linha).eq("id", input.id)
      : await supabase.from("employee_sanctions").insert({ ...linha, created_by: userId });
    if (error) return { error: mensagem(error) };
    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteSanction(id: string): Promise<ActionState> {
  try {
    const { supabase } = await dpActionContext();
    const { error } = await supabase.from("employee_sanctions").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Importa punições em lote, casando o nome com o cadastro e o tipo com o
 * catálogo da empresa.
 *
 * **Reimportar a mesma planilha não duplica.** Mesma pessoa, mesmo tipo e mesma
 * data é considerada a mesma punição, e a observação é reescrita no lugar. Isso
 * importa mais aqui do que nas férias: com uma faixa por quantidade, uma punição
 * contada duas vezes muda o valor pago.
 *
 * A trava é de aplicação, e não um índice único no banco, de propósito: o
 * formulário manual precisa continuar podendo registrar duas ocorrências do
 * mesmo tipo no mesmo dia, que é raro mas existe. Quem digita uma a uma está
 * afirmando que são duas; quem reimporta uma planilha não está.
 *
 * Tipo fora do catálogo é RECUSADO e contado à parte, nunca criado na hora.
 */
export async function importSanctions(rows: SanctionImportRow[]): Promise<SanctionImportResult> {
  const vazio: SanctionImportResult = { imported: 0, updated: 0, invalid: 0, notFound: 0, mismatch: 0, unknownType: 0 };
  try {
    const { supabase, tenantId, userId } = await dpActionContext();

    const [{ data: membros }, { data: tipos }, { data: existentes }, { data: unidades }, { data: vinculoUnidade }, { data: contratos }] = await Promise.all([
      supabase.from("memberships").select("id, user_id, is_active, employee_code").eq("tenant_id", tenantId),
      supabase.from("sanction_types").select("id, name, active").eq("tenant_id", tenantId),
      supabase.from("employee_sanctions").select("id, user_id, sanction_type_id, occurred_on").eq("tenant_id", tenantId),
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
    // Lançamento de histórico é caso legítimo: férias de quem já saiu, ou de um
    // contrato ANTERIOR da mesma pessoa (a matrícula muda na recontratação).
    // Por isso o índice cobre os três, e a origem só muda a preferência e o
    // aviso na tela. As unidades do contrato antigo são as do vínculo de hoje,
    // que é a única informação de unidade que existe: employee_contracts não
    // guarda unidade.
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
    const idx = indiceDeAlvos(refs, (unidades ?? []).map((u) => u.name));

    // o que já está no banco, mais o que esta planilha já aceitou: sem a segunda
    // parte, duas linhas iguais da MESMA planilha entrariam como duas punições
    const jaExiste = new Map<string, string>();
    for (const s of existentes ?? []) {
      jaExiste.set(chaveDaPunicao(s.user_id, s.sanction_type_id, s.occurred_on), s.id);
    }

    const inserts: Record<string, unknown>[] = [];
    const updates: { id: string; note: string | null }[] = [];
    const r: SanctionImportResult = { ...vazio };

    for (const linha of rows ?? []) {
      const data = parseDataPlanilha(linha.occurredOn ?? "");
      if (!data) { r.invalid += 1; continue; }

      const resolvido = resolverAlvo(linha.code ?? "", linha.unit ?? "", idx);
      if (resolvido.motivo === "sem_matricula") { r.invalid += 1; continue; }
      if (resolvido.motivo === "nao_encontrada") { r.notFound += 1; continue; }
      const alvo = resolvido.alvoId;
      if (!alvo) { r.mismatch += 1; continue; }

      const tipo = acharTipo(linha.type ?? "", tipos ?? []);
      if (!tipo) { r.unknownType += 1; continue; }

      const note = (linha.note ?? "").trim() || null;
      const chave = chaveDaPunicao(alvo, tipo.id, data);
      const id = jaExiste.get(chave);
      if (id) { updates.push({ id, note }); continue; }

      inserts.push({
        tenant_id: tenantId,
        user_id: alvo,
        sanction_type_id: tipo.id,
        occurred_on: data,
        note,
        created_by: userId,
      });
      // marca com id vazio: a próxima linha igual desta planilha cai no update,
      // que não acha id nenhum e não faz nada, em vez de inserir a segunda
      jaExiste.set(chave, "");
    }

    if (inserts.length) {
      const { error } = await supabase.from("employee_sanctions").insert(inserts as never);
      if (error) return { ...r, error: mensagem(error) };
      r.imported = inserts.length;
    }
    for (const u of updates) {
      if (!u.id) continue;
      const { error } = await supabase.from("employee_sanctions").update({ note: u.note }).eq("id", u.id);
      if (error) return { ...r, error: mensagem(error) };
      r.updated += 1;
    }

    if (r.imported === 0 && r.updated === 0) {
      return {
        ...r,
        error: r.mismatch > 0
          ? "Nenhuma punição importada: conflito de unidade e matrícula (confira a coluna Unidade)."
          : r.notFound > 0
            ? "Nenhuma punição importada, matrícula não encontrada no cadastro."
            : r.unknownType > 0
              ? "Nenhuma punição importada: o tipo escrito não existe no catálogo da empresa. Cadastre-o em Punições › Tipos de punição."
              : "Nenhuma linha válida, confira o colaborador e a data.",
      };
    }

    revalidar();
    return r;
  } catch (e) {
    return { ...vazio, error: (e as Error).message };
  }
}

// ------------------------------------------------------- motivos e faixas
export type RuleInput = {
  name: string;
  source: Enums<"rv_reducer_source">;
  absence_kind?: Enums<"absence_kind"> | null;
  /** null com source `sanction` = qualquer punição */
  sanction_type_id?: string | null;
};

export async function createReducerRule(input: RuleInput): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await dpActionContext();
    const name = (input.name ?? "").trim();
    if (!name) return { error: "Dê um nome ao motivo." };
    if (input.source === "absence" && !input.absence_kind) {
      return { error: "Escolha o tipo de ausência que este motivo observa." };
    }
    const { error } = await supabase.from("rv_reducer_rules").insert({
      tenant_id: tenantId,
      name,
      source: input.source,
      absence_kind: input.source === "absence" ? input.absence_kind ?? null : null,
      sanction_type_id: input.source === "sanction" ? input.sanction_type_id ?? null : null,
    });
    if (error) return { error: mensagem(error) };
    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function toggleReducerRule(formData: FormData): Promise<void> {
  const { supabase } = await dpActionContext();
  await supabase.from("rv_reducer_rules").update({ active: wantsActive(formData) }).eq("id", String(formData.get("id")));
  revalidar();
}

export async function deleteReducerRule(formData: FormData): Promise<void> {
  const { supabase } = await dpActionContext();
  // as faixas caem junto pela FK em cascata
  await supabase.from("rv_reducer_rules").delete().eq("id", String(formData.get("id")));
  revalidar();
}

export async function addReducerBand(input: {
  rule_id: string; min_qtd: number; max_qtd: number | null; reduction_pct: number;
}): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await dpActionContext();
    if (!Number.isFinite(input.min_qtd) || input.min_qtd < 1) return { error: "O limite inicial começa em 1." };
    if (input.max_qtd != null && input.max_qtd < input.min_qtd) {
      return { error: "O limite final não pode ser menor que o inicial." };
    }
    if (!Number.isFinite(input.reduction_pct) || input.reduction_pct < 0 || input.reduction_pct > 100) {
      return { error: "A redução precisa ficar entre 0% e 100%." };
    }
    // O `tenant_id` vem daqui e a FK composta com a regra recusa a combinação
    // errada, então não dá para pendurar uma faixa em regra de outra empresa.
    const { error } = await supabase.from("rv_reducer_bands").insert({
      rule_id: input.rule_id,
      tenant_id: tenantId,
      min_qtd: input.min_qtd,
      max_qtd: input.max_qtd,
      reduction_pct: input.reduction_pct,
    });
    if (error) return { error: mensagem(error) };
    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteReducerBand(id: string): Promise<ActionState> {
  try {
    const { supabase } = await dpActionContext();
    const { error } = await supabase.from("rv_reducer_bands").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
