"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";

/**
 * Trilhas de aprendizagem: programas que encadeiam cursos do catálogo em ordem.
 *
 * A trilha não guarda conteúdo nenhum. Ela aponta para cursos que já existem,
 * define a ordem e diz para quem o programa vale. Quem materializa as
 * matrículas é o banco (`trilha_materialize`), no mesmo momento do salvamento,
 * para quem salvou ver o efeito.
 */

const PODE_CADASTRAR: Enums<"member_role">[] = ["owner", "admin", "hr"];

/** Mesmo shape de `RegraPublico` em trainings.ts: quem deve cumprir o programa. */
export type RegraTrilha = {
  kind: "user" | "position" | "department" | "subdepartment" | "unit";
  refId: string;
  mandatory: boolean;
};

export type PassoTrilha = { trainingId: string; required: boolean };

export type TrilhaInput = {
  id?: string;
  name: string;
  description?: string;
  /** prazo do PROGRAMA em dias; null = cada passo usa o prazo do próprio curso */
  prazoDias: number | null;
  active: boolean;
  /** a ordem do array É a ordem dos passos */
  passos: PassoTrilha[];
  regras: RegraTrilha[];
};

export type TrilhaForEdit = {
  id: string;
  name: string;
  description: string;
  prazoDias: number | null;
  active: boolean;
  passos: PassoTrilha[];
  regras: RegraTrilha[];
};

export async function saveTrilha(input: TrilhaInput): Promise<ActionState & { id?: string }> {
  try {
    const { supabase, tenantId, userId, role } = await actionContext();

    const name = (input.name ?? "").trim();
    if (!name) return { error: "Informe o nome da trilha." };
    if (input.passos.length < 2) {
      return { error: "Uma trilha precisa de pelo menos dois treinamentos. Com um só, use o treinamento avulso." };
    }
    // curso repetido não é ordem, é engano; o banco tem a constraint, a
    // mensagem aqui evita o erro cru
    const unicos = new Set(input.passos.map((p) => p.trainingId));
    if (unicos.size !== input.passos.length) {
      return { error: "O mesmo treinamento aparece duas vezes na trilha." };
    }

    const campos = {
      tenant_id: tenantId,
      name,
      description: (input.description ?? "").trim() || null,
      prazo_dias: input.prazoDias,
      active: input.active,
      updated_at: new Date().toISOString(),
    };

    let pathId = input.id;
    if (pathId) {
      const { error } = await supabase.from("training_paths").update(campos).eq("id", pathId);
      if (error) return { error: error.message };
    } else {
      if (!PODE_CADASTRAR.includes(role)) {
        return { error: "Apenas proprietário, administrador e RH cadastram trilhas." };
      }
      const { data, error } = await supabase
        .from("training_paths")
        .insert({ ...campos, created_by: userId })
        .select("id")
        .single();
      if (error) return { error: error.message };
      pathId = data.id;
    }
    if (!pathId) return { error: "Não foi possível salvar a trilha." };

    // passos e regras são substituídos por inteiro, molde de `saveTraining` e
    // `saveItemsAudiences`: o `sort` sai do índice do array, então a ordem da
    // tela é literalmente a ordem gravada
    await supabase.from("training_path_steps").delete().eq("path_id", pathId);
    const { error: ePassos } = await supabase.from("training_path_steps").insert(
      input.passos.map((p, i) => ({
        tenant_id: tenantId,
        path_id: pathId,
        training_id: p.trainingId,
        sort: i,
        required: p.required,
      })),
    );
    if (ePassos) return { error: ePassos.message };

    await supabase.from("training_path_rules").delete().eq("path_id", pathId);
    if (input.regras.length > 0) {
      const { error: eRegras } = await supabase.from("training_path_rules").insert(
        input.regras.map((r) => ({
          tenant_id: tenantId,
          path_id: pathId,
          kind: r.kind,
          ref_id: r.refId,
          mandatory: r.mandatory,
        })),
      );
      if (eRegras) return { error: eRegras.message };
    }

    const { error: eMat } = await supabase.rpc("trilha_materialize", { p_path: pathId });
    if (eMat) return { error: `Trilha salva, mas a atribuição falhou: ${eMat.message}` };

    revalidatePath("/treinamentos");
    return { ok: true, id: pathId };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Exclusão SOFT, e a materialização roda depois.
 *
 * Apagar a linha levaria junto o `path_id` das matrículas que já nasceram dela,
 * e com ele a resposta para "de onde veio esta cobrança". A materialização em
 * seguida é o que recolhe as matrículas ainda não iniciadas: sem ela, o
 * colaborador continuaria devendo os cursos de um programa que não existe mais.
 */
export async function deleteTrilha(id: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase
      .from("training_paths")
      .update({ deleted_at: new Date().toISOString(), active: false })
      .eq("id", id);
    if (error) return { error: error.message };

    await supabase.rpc("trilha_materialize", { p_path: id });

    revalidatePath("/treinamentos");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function getTrilhaForEdit(id: string): Promise<TrilhaForEdit | null> {
  try {
    const { supabase } = await actionContext();
    const [{ data: t }, { data: passos }, { data: regras }] = await Promise.all([
      supabase
        .from("training_paths")
        .select("id, name, description, prazo_dias, active")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("training_path_steps")
        .select("training_id, required, sort")
        .eq("path_id", id)
        .order("sort"),
      supabase
        .from("training_path_rules")
        .select("kind, ref_id, mandatory")
        .eq("path_id", id),
    ]);
    if (!t) return null;

    return {
      id: t.id,
      name: t.name,
      description: t.description ?? "",
      prazoDias: t.prazo_dias,
      active: t.active,
      passos: (passos ?? []).map((p) => ({ trainingId: p.training_id, required: p.required })),
      regras: (regras ?? []).map((r) => ({
        kind: r.kind as RegraTrilha["kind"],
        refId: r.ref_id,
        mandatory: r.mandatory,
      })),
    };
  } catch {
    return null;
  }
}
