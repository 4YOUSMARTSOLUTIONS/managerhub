"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";
import { normTexto, parseDataPlanilha, parseTipo, parseDesconta, periodosCruzam } from "@/lib/absences-import";

/**
 * Férias e afastamentos do colaborador.
 *
 * Só owner/admin, a mesma regra da vigência de remuneração variável: é aqui que
 * se decide quantos dias do mês entram na conta da RV, então mexer nisto é mexer
 * no que a pessoa recebe.
 *
 * Os dois `revalidatePath` são obrigatórios: o cadastro vive em Configurações,
 * mas quem consome é a tela de Metas.
 */

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const SO_ADMIN = "Apenas proprietário e administrador lançam férias e afastamentos.";

export type AbsenceInput = {
  /** ausente = criar */
  id?: string;
  user_id: string;
  kind: Enums<"absence_kind">;
  start_date: string;
  end_date: string;
  discounts_rv: boolean;
  note?: string | null;
};

/** Traduz o erro do banco em algo que a pessoa entenda na tela. */
function mensagem(e: { code?: string; message?: string }): string {
  const cod = e.code ?? "";
  const msg = e.message ?? "";
  if (cod === "23P01" || msg.includes("employee_absences_sem_sobreposicao")) {
    return "Já existe um período lançado para este colaborador que se sobrepõe a este.";
  }
  if (cod === "23514" || msg.includes("employee_absences_periodo")) {
    return "A data de fim não pode ser anterior à de início.";
  }
  return msg || "Não foi possível salvar.";
}

export async function upsertAbsence(input: AbsenceInput): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId, role } = await actionContext();
    if (role !== "owner" && role !== "admin") return { error: SO_ADMIN };

    const start_date = (input.start_date ?? "").trim();
    const end_date = (input.end_date ?? "").trim();
    if (!input.user_id) return { error: "Escolha o colaborador." };
    if (!DATA.test(start_date) || !DATA.test(end_date)) return { error: "Informe as datas de início e de fim." };
    if (end_date < start_date) return { error: "A data de fim não pode ser anterior à de início." };

    // A RLS confere o tenant da LINHA, e o tenant vem daqui, do servidor. O que
    // ela não confere é se a PESSOA é desta empresa: sem isto daria para gravar
    // uma ausência no id de alguém de outro tenant.
    const { data: vinculo } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", input.user_id)
      .maybeSingle();
    if (!vinculo) return { error: "Colaborador não encontrado nesta empresa." };

    const payload = {
      tenant_id: tenantId,
      user_id: input.user_id,
      kind: input.kind,
      start_date,
      end_date,
      discounts_rv: !!input.discounts_rv,
      note: (input.note ?? "").trim() || null,
      created_by: userId,
    };

    const { error } = input.id
      ? await supabase.from("employee_absences").update(payload).eq("id", input.id)
      : await supabase.from("employee_absences").insert(payload);
    if (error) return { error: mensagem(error) };

    revalidatePath("/configuracoes");
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------- Importação em lote (.xlsx) ----------

export type AbsenceImportRow = {
  name: string;
  kind: string;
  start: string;
  end: string;
  /** "sim" | "nao" | "" (vazio = padrão do tipo) */
  discounts: string;
  note: string;
};

export type AbsenceImportResult = {
  imported: number;
  updated: number;
  invalid: number;
  notFound: number;
  /** recusadas por cruzar com um período já lançado */
  overlapping: number;
  error?: string;
};

/**
 * Importa períodos casando o nome com o cadastro.
 *
 * Reimportar a mesma planilha NÃO duplica nem falha: período com as mesmas datas
 * para a mesma pessoa é atualizado no lugar. O que cruza com um período
 * DIFERENTE é recusado e contado à parte, em vez de derrubar a planilha inteira
 * na constraint do banco. A constraint continua lá como rede de segurança.
 */
export async function importAbsences(rows: AbsenceImportRow[]): Promise<AbsenceImportResult> {
  const vazio: AbsenceImportResult = { imported: 0, updated: 0, invalid: 0, notFound: 0, overlapping: 0 };
  try {
    const { supabase, tenantId, userId, role } = await actionContext();
    if (role !== "owner" && role !== "admin") return { ...vazio, error: SO_ADMIN };

    const { data: membros } = await supabase
      .from("memberships")
      .select("user_id, is_active, profiles!memberships_user_id_fkey(full_name)")
      .eq("tenant_id", tenantId);
    const idPorNome = new Map<string, string>();
    for (const m of membros ?? []) {
      if (!m.is_active) continue;
      const nm = (m.profiles as unknown as { full_name: string | null } | null)?.full_name;
      if (nm) idPorNome.set(normTexto(nm), m.user_id);
    }

    const { data: existentes } = await supabase
      .from("employee_absences")
      .select("id, user_id, start_date, end_date")
      .eq("tenant_id", tenantId);

    // o que já está no banco, mais o que esta planilha já aceitou: as duas coisas
    // precisam entrar na conta, senão duas linhas cruzadas da MESMA planilha
    // passariam aqui e só quebrariam no insert
    const porDono = new Map<string, { id?: string; inicio: string; fim: string }[]>();
    for (const e of existentes ?? []) {
      const arr = porDono.get(e.user_id) ?? [];
      arr.push({ id: e.id, inicio: e.start_date, fim: e.end_date });
      porDono.set(e.user_id, arr);
    }

    const inserts: Record<string, unknown>[] = [];
    const updates: { id: string; payload: Record<string, unknown> }[] = [];
    const r: AbsenceImportResult = { ...vazio };

    for (const linha of rows ?? []) {
      const nome = (linha.name ?? "").trim();
      const inicio = parseDataPlanilha(linha.start ?? "");
      const fim = parseDataPlanilha(linha.end ?? "");
      const kind = parseTipo(linha.kind ?? "");
      if (!nome || !inicio || !fim || fim < inicio || !kind) { r.invalid += 1; continue; }

      const userIdAlvo = idPorNome.get(normTexto(nome));
      if (!userIdAlvo) { r.notFound += 1; continue; }

      const payload = {
        tenant_id: tenantId,
        user_id: userIdAlvo,
        kind,
        start_date: inicio,
        end_date: fim,
        discounts_rv: parseDesconta(linha.discounts ?? "", kind),
        note: (linha.note ?? "").trim() || null,
        created_by: userId,
      };

      const doDono = porDono.get(userIdAlvo) ?? [];
      const igual = doDono.find((x) => x.inicio === inicio && x.fim === fim);
      if (igual?.id) { updates.push({ id: igual.id, payload }); continue; }
      if (doDono.some((x) => periodosCruzam(inicio, fim, x.inicio, x.fim))) { r.overlapping += 1; continue; }

      inserts.push(payload);
      doDono.push({ inicio, fim });
      porDono.set(userIdAlvo, doDono);
    }

    if (inserts.length) {
      const { error } = await supabase.from("employee_absences").insert(inserts as never);
      if (error) return { ...r, error: mensagem(error) };
      r.imported = inserts.length;
    }
    for (const u of updates) {
      const { error } = await supabase.from("employee_absences").update(u.payload as never).eq("id", u.id);
      if (error) return { ...r, error: mensagem(error) };
      r.updated += 1;
    }

    if (r.imported === 0 && r.updated === 0) {
      return {
        ...r,
        error: r.notFound > 0
          ? "Nenhum período importado, colaborador não encontrado (confira o nome exato do cadastro)."
          : r.overlapping > 0
            ? "Nenhum período importado: todos cruzam com períodos já lançados."
            : "Nenhuma linha válida, confira o colaborador e as datas de início e fim.",
      };
    }

    revalidatePath("/configuracoes");
    revalidatePath("/metas");
    return r;
  } catch (e) {
    return { ...vazio, error: (e as Error).message };
  }
}

export async function deleteAbsence(id: string): Promise<ActionState> {
  try {
    const { supabase, role } = await actionContext();
    if (role !== "owner" && role !== "admin") return { error: SO_ADMIN };
    const { error } = await supabase.from("employee_absences").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/configuracoes");
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
