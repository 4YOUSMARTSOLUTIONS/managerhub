"use server";


import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";

/**
 * Catálogo de treinamentos, matriz de atribuição e matrículas.
 *
 * A escrita passa toda por aqui e nunca pelo cliente direto: a materialização
 * da matriz (quem deve fazer o quê) roda no banco logo depois de salvar, e a
 * tela precisa disso acontecendo na mesma ação para o usuário ver o efeito.
 */

const PODE_CADASTRAR: Enums<"member_role">[] = ["owner", "admin", "hr"];

export type RegraPublico = {
  kind: "user" | "position" | "department" | "subdepartment" | "unit";
  refId: string;
  mandatory: boolean;
};

/** Onde o treinamento se aplica. Vazio num tipo = todos daquele tipo. */
export type EscopoTreinamento = {
  kind: "unit" | "department" | "subdepartment" | "pilar" | "bloco" | "item";
  refId: string;
};

/**
 * Responsável pelo treinamento.
 *
 * `unitId` nulo = responde por todas as unidades. Com unidade, responde só por
 * ela: um curso que roda em três filiais costuma ter um dono em cada uma.
 */
export type ResponsavelTreinamento = { userId: string; unitId: string | null };

export type TrainingInput = {
  id?: string;
  name: string;
  description?: string;
  code?: string;
  workload_minutes: number;
  delivery: Enums<"training_delivery">;
  validade_meses: number | null;
  antecipacao_dias: number;
  prazo_dias: number | null;
  escopos: EscopoTreinamento[];
  active: boolean;
  owners: ResponsavelTreinamento[];
  regras: RegraPublico[];
};

const limpo = (v: string | null | undefined) => (v ?? "").trim() || null;

export async function saveTraining(input: TrainingInput): Promise<ActionState & { id?: string }> {
  try {
    const { supabase, tenantId, userId, role } = await actionContext();

    const name = (input.name ?? "").trim();
    if (!name) return { error: "Informe o nome do treinamento." };
    if (!(input.workload_minutes > 0)) return { error: "Informe a carga horária." };
    if (input.owners.length === 0) return { error: "Informe ao menos um responsável pelo treinamento." };

    const campos = {
      tenant_id: tenantId,
      name,
      description: limpo(input.description),
      code: limpo(input.code),
      workload_minutes: Math.round(input.workload_minutes),
      delivery: input.delivery,
      validade_meses: input.validade_meses,
      antecipacao_dias: input.antecipacao_dias ?? 60,
      prazo_dias: input.prazo_dias,
      active: input.active,
    };

    let trainingId = input.id;
    if (trainingId) {
      const { error } = await supabase.from("trainings").update(campos).eq("id", trainingId);
      if (error) return { error: error.message };
    } else {
      // a policy de insert exige owner/admin/hr; a mensagem aqui evita o erro cru
      if (!PODE_CADASTRAR.includes(role)) {
        return { error: "Apenas proprietário, administrador e RH cadastram treinamentos." };
      }
      const { data, error } = await supabase
        .from("trainings")
        .insert({ ...campos, created_by: userId })
        .select("id")
        .single();
      if (error) return { error: error.message };
      trainingId = data.id;
    }
    if (!trainingId) return { error: "Não foi possível salvar o treinamento." };

    // escopos, responsáveis e regras são substituídos por inteiro: é mais
    // simples de acertar do que um diff, e a tabela é pequena por treinamento
    await supabase.from("training_scopes").delete().eq("training_id", trainingId);
    if (input.escopos.length > 0) {
      const { error: eEscopos } = await supabase.from("training_scopes").insert(
        input.escopos.map((e) => ({
          tenant_id: tenantId, training_id: trainingId, kind: e.kind, ref_id: e.refId,
        })),
      );
      if (eEscopos) return { error: eEscopos.message };
    }

    await supabase.from("training_owners").delete().eq("training_id", trainingId);
    const { error: eOwners } = await supabase.from("training_owners").insert(
      input.owners.map((o) => ({
        tenant_id: tenantId, training_id: trainingId, user_id: o.userId, unit_id: o.unitId,
      })),
    );
    if (eOwners) return { error: eOwners.message };

    await supabase.from("training_assignment_rules").delete().eq("training_id", trainingId);
    if (input.regras.length > 0) {
      const { error: eRegras } = await supabase.from("training_assignment_rules").insert(
        input.regras.map((r) => ({
          tenant_id: tenantId,
          training_id: trainingId,
          kind: r.kind,
          ref_id: r.refId,
          mandatory: r.mandatory,
        })),
      );
      if (eRegras) return { error: eRegras.message };
    }

    // a matriz vira matrícula na hora: quem salvou precisa ver o efeito
    const { error: eMat } = await supabase.rpc("training_materialize", { p_training: trainingId });
    if (eMat) return { error: `Treinamento salvo, mas a atribuição falhou: ${eMat.message}` };

    revalidatePath("/treinamentos");
    return { ok: true, id: trainingId };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Exclusão é sempre SOFT.
 *
 * A NR-1 manda guardar evidência de capacitação por 5 anos, e a matrícula
 * concluída aponta para o curso: apagar a linha levaria junto o que prova que
 * a pessoa foi treinada.
 */
export async function deleteTraining(id: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase
      .from("trainings")
      .update({ deleted_at: new Date().toISOString(), active: false })
      .eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/treinamentos");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Matrícula avulsa, fora da matriz.
 *
 * Serve para o caso que o usuário descreveu: colaboradores específicos, e não
 * um cargo ou setor inteiro. Entra como `origin = 'manual'`, então a rotina de
 * materialização não a remove quando a pessoa muda de cargo (ela não veio de
 * regra nenhuma).
 */
export async function enrollPeople(
  trainingId: string,
  userIds: string[],
  dueAt?: string | null,
): Promise<ActionState & { criadas?: number }> {
  try {
    const { supabase, tenantId } = await actionContext();
    if (userIds.length === 0) return { error: "Selecione ao menos um colaborador." };

    // quem já tem matrícula viva não recebe outra
    const { data: existentes } = await supabase
      .from("training_enrollments")
      .select("user_id")
      .eq("training_id", trainingId)
      .in("user_id", userIds)
      .not("status", "in", "(cancelado,nao_aplicavel)");
    const jaTem = new Set((existentes ?? []).map((e) => e.user_id));
    const novos = userIds.filter((u) => !jaTem.has(u));
    if (novos.length === 0) return { ok: true, criadas: 0 };

    // carimbo de época: o vínculo de agora, para o relatório do ciclo não ser
    // reescrito por uma transferência futura
    const { data: vinculos } = await supabase
      .from("memberships")
      .select("user_id, position_id, department_id, subdepartment_id")
      .eq("tenant_id", tenantId)
      .in("user_id", novos);
    const org = new Map((vinculos ?? []).map((m) => [m.user_id, m]));

    const { error } = await supabase.from("training_enrollments").insert(
      novos.map((uid) => ({
        tenant_id: tenantId,
        training_id: trainingId,
        user_id: uid,
        origin: "manual" as const,
        mandatory: true,
        due_at: dueAt || null,
        snap_position_id: org.get(uid)?.position_id ?? null,
        snap_department_id: org.get(uid)?.department_id ?? null,
        snap_subdepartment_id: org.get(uid)?.subdepartment_id ?? null,
      })),
    );
    if (error) return { error: error.message };

    revalidatePath("/treinamentos");
    return { ok: true, criadas: novos.length };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Tira a matrícula de circulação sem apagar o registro. */
export async function cancelEnrollment(enrollmentId: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase
      .from("training_enrollments")
      .update({ status: "cancelado", applicable: false, updated_at: new Date().toISOString() })
      .eq("id", enrollmentId);
    if (error) return { error: error.message };
    revalidatePath("/treinamentos");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Isenção: a pessoa não precisa fazer, e fica registrado por quê e até quando.
 *
 * Isenção sem motivo, sem autor e sem prazo é buraco de auditoria; por isso os
 * três campos são gravados juntos e o motivo é exigido.
 */
export async function exemptEnrollment(
  enrollmentId: string,
  reason: string,
  until: string | null,
): Promise<ActionState> {
  try {
    const { supabase, userId } = await actionContext();
    const motivo = (reason ?? "").trim();
    if (!motivo) return { error: "Informe o motivo da isenção." };
    const { error } = await supabase
      .from("training_enrollments")
      .update({
        status: "isento",
        exempted_by: userId,
        exempted_reason: motivo,
        exempted_until: until || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", enrollmentId);
    if (error) return { error: error.message };
    revalidatePath("/treinamentos");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type TrainingForEdit = TrainingInput & { id: string };

export async function getTrainingForEdit(id: string): Promise<TrainingForEdit | null> {
  try {
    const { supabase } = await actionContext();
    const [{ data: t }, { data: owners }, { data: regras }, { data: escopos }] = await Promise.all([
      supabase.from("trainings").select("*").eq("id", id).maybeSingle(),
      supabase.from("training_owners").select("user_id, unit_id").eq("training_id", id),
      supabase.from("training_assignment_rules").select("kind, ref_id, mandatory").eq("training_id", id),
      supabase.from("training_scopes").select("kind, ref_id").eq("training_id", id),
    ]);
    if (!t) return null;
    return {
      id: t.id,
      name: t.name,
      description: t.description ?? "",
      code: t.code ?? "",
      workload_minutes: t.workload_minutes,
      delivery: t.delivery,
      validade_meses: t.validade_meses,
      antecipacao_dias: t.antecipacao_dias,
      prazo_dias: t.prazo_dias,
      escopos: (escopos ?? []).map((e) => ({ kind: e.kind as EscopoTreinamento["kind"], refId: e.ref_id })),
      active: t.active,
      owners: (owners ?? []).map((o) => ({ userId: o.user_id, unitId: o.unit_id })),
      regras: (regras ?? []).map((r) => ({
        kind: r.kind as RegraPublico["kind"],
        refId: r.ref_id,
        mandatory: r.mandatory,
      })),
    };
  } catch {
    return null;
  }
}

/**
 * Histórico legado: registra treinamentos que a empresa já fez antes do sistema.
 *
 * Sem isto, o primeiro dia de uso mostra 100% de inadimplência e a empresa
 * convoca de novo gente que já está treinada, o que queima o módulo logo na
 * largada. A data informada é a data REAL da conclusão, e é dela que sai o
 * vencimento: um curso anual feito em março vence em março.
 *
 * Em lote por treinamento: turma antiga inteira de uma vez, que é como o
 * registro costuma existir no papel.
 */
export async function importarHistorico(input: {
  trainingId: string;
  userIds: string[];
  completedAt: string;
  score: number | null;
  instructor: string | null;
}): Promise<ActionState & { importados?: number }> {
  try {
    const { supabase } = await actionContext();
    if (input.userIds.length === 0) return { error: "Escolha ao menos um colaborador." };
    if (!input.completedAt) return { error: "Informe a data da conclusão." };

    let importados = 0;
    const falhas: string[] = [];
    for (const userId of input.userIds) {
      const { error } = await supabase.rpc("training_importar_historico", {
        p_training: input.trainingId,
        p_user: userId,
        p_completed: input.completedAt,
        p_score: input.score,
        p_instructor: input.instructor?.trim() || null,
      });
      if (error) falhas.push(error.message);
      else importados += 1;
    }

    revalidatePath("/treinamentos");
    if (importados === 0) return { error: falhas[0] ?? "Nada foi importado." };
    return {
      ok: true,
      importados,
      warning: falhas.length > 0 ? `${falhas.length} não importados: ${falhas[0]}` : undefined,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
