"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums, Json } from "@/types/database";

/**
 * Prova do treinamento: construtor, aplicação e correção.
 *
 * A nota, a aprovação e o prazo são decididos no banco (`prova_*`). Aqui só
 * entra o que é de tela: montar o formulário, mandar a resposta e trazer de
 * volta o que pode ser mostrado. Nenhuma destas funções calcula nota, e é
 * assim de propósito: quem calcula não pode ser o mesmo lado que responde.
 */

export type OpcaoQuestao = { id: string; text: string };

export type QuestaoInput = {
  id?: string;
  examId: string;
  sort: number;
  kind: Enums<"training_question_kind">;
  statement: string;
  options: OpcaoQuestao[];
  /** ids das opções corretas; vazio na dissertativa */
  correct: string[];
  weight: number;
};

export type ExamInput = {
  id?: string;
  trainingId: string;
  title: string;
  instructions: string | null;
  passingScore: number;
  maxAttempts: number | null;
  timeLimitMinutes: number | null;
  minMinutes: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  showResultDetail: boolean;
  startsAfterContent: boolean;
  active: boolean;
};

export type QuestaoRow = QuestaoInput & { id: string };

export type ExamRow = {
  id: string;
  title: string;
  instructions: string | null;
  passingScore: number;
  maxAttempts: number | null;
  timeLimitMinutes: number | null;
  minMinutes: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  showResultDetail: boolean;
  startsAfterContent: boolean;
  active: boolean;
  questoes: QuestaoRow[];
};

export async function getExam(trainingId: string): Promise<ExamRow | null> {
  try {
    const { supabase } = await actionContext();
    const { data: e } = await supabase
      .from("training_exams")
      .select("id, title, instructions, passing_score, max_attempts, time_limit_minutes, min_minutes, shuffle_questions, shuffle_options, show_result_detail, starts_after_content, active")
      .eq("training_id", trainingId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!e) return null;

    // esta leitura só volta com linhas para quem gere o treinamento: a policy
    // de `training_exam_questions` guarda o gabarito vivo
    const { data: qs } = await supabase
      .from("training_exam_questions")
      .select("id, sort, kind, statement, options, correct, weight")
      .eq("exam_id", e.id)
      .is("deleted_at", null)
      .order("sort");

    return {
      id: e.id,
      title: e.title,
      instructions: e.instructions,
      passingScore: e.passing_score,
      maxAttempts: e.max_attempts,
      timeLimitMinutes: e.time_limit_minutes,
      minMinutes: e.min_minutes,
      shuffleQuestions: e.shuffle_questions,
      shuffleOptions: e.shuffle_options,
      showResultDetail: e.show_result_detail,
      startsAfterContent: e.starts_after_content,
      active: e.active,
      questoes: (qs ?? []).map((q) => ({
        id: q.id,
        examId: e.id,
        sort: q.sort,
        kind: q.kind,
        statement: q.statement,
        options: (q.options as unknown as OpcaoQuestao[]) ?? [],
        correct: (q.correct as unknown as string[]) ?? [],
        weight: Number(q.weight),
      })),
    };
  } catch {
    return null;
  }
}

export async function saveExam(input: ExamInput): Promise<ActionState & { id?: string }> {
  try {
    const { supabase, tenantId, userId } = await actionContext();
    const campos = {
      tenant_id: tenantId,
      training_id: input.trainingId,
      title: input.title.trim() || "Avaliação",
      instructions: input.instructions?.trim() || null,
      passing_score: input.passingScore,
      max_attempts: input.maxAttempts,
      time_limit_minutes: input.timeLimitMinutes,
      min_minutes: input.minMinutes,
      shuffle_questions: input.shuffleQuestions,
      shuffle_options: input.shuffleOptions,
      show_result_detail: input.showResultDetail,
      starts_after_content: input.startsAfterContent,
      active: input.active,
      updated_at: new Date().toISOString(),
    };

    if (input.id) {
      const { error } = await supabase.from("training_exams").update(campos).eq("id", input.id);
      if (error) return { error: error.message };
      revalidatePath("/treinamentos");
      return { ok: true, id: input.id };
    }

    const { data, error } = await supabase
      .from("training_exams")
      .insert({ ...campos, created_by: userId })
      .select("id")
      .single();
    if (error) return { error: error.message };

    revalidatePath("/treinamentos");
    return { ok: true, id: data.id };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function saveQuestao(input: QuestaoInput): Promise<ActionState & { id?: string }> {
  try {
    const { supabase, tenantId } = await actionContext();
    const statement = input.statement.trim();
    if (!statement) return { error: "Escreva o enunciado da questão." };

    const objetiva = input.kind !== "dissertativa";
    if (objetiva) {
      if (input.options.length < 2) return { error: "A questão precisa de pelo menos duas alternativas." };
      if (input.correct.length === 0) return { error: "Marque a resposta certa." };
      if (input.kind !== "multipla_selecao" && input.correct.length > 1) {
        return { error: "Esta questão aceita apenas uma resposta certa." };
      }
    }

    const campos = {
      tenant_id: tenantId,
      exam_id: input.examId,
      sort: input.sort,
      kind: input.kind,
      statement,
      options: (objetiva ? input.options : []) as unknown as Json,
      correct: (objetiva ? input.correct : null) as unknown as Json,
      weight: input.weight,
      updated_at: new Date().toISOString(),
    };

    if (input.id) {
      const { error } = await supabase.from("training_exam_questions").update(campos).eq("id", input.id);
      if (error) return { error: error.message };
      revalidatePath("/treinamentos");
      return { ok: true, id: input.id };
    }

    const { data, error } = await supabase
      .from("training_exam_questions")
      .insert(campos)
      .select("id")
      .single();
    if (error) return { error: error.message };

    revalidatePath("/treinamentos");
    return { ok: true, id: data.id };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Soft delete. A questão sai das provas NOVAS e continua inteira nas tentativas
 * já aplicadas, que guardam o próprio retrato.
 */
export async function deleteQuestao(id: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase
      .from("training_exam_questions")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/treinamentos");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteExam(id: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase
      .from("training_exams")
      .update({ deleted_at: new Date().toISOString(), active: false })
      .eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/treinamentos");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ------------------------------------------------------------------- aplicar

export type QuestaoDaProva = {
  id: string;
  kind: Enums<"training_question_kind">;
  statement: string;
  options: OpcaoQuestao[];
  weight: number;
  /** o que a pessoa já marcou nesta tentativa */
  resposta: string[] | null;
  respostaTexto: string | null;
};

export type TentativaEmCurso = {
  attemptId: string;
  status: Enums<"training_attempt_status">;
  deadlineAt: string | null;
  startsAt: string;
  minMinutes: number;
  questoes: QuestaoDaProva[];
};

export async function iniciarProva(enrollmentId: string): Promise<{ attemptId?: string; error?: string }> {
  try {
    const { supabase } = await actionContext();
    const { data, error } = await supabase.rpc("prova_iniciar", { p_enrollment: enrollmentId });
    if (error) return { error: error.message };
    return { attemptId: data as string };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function getTentativa(attemptId: string): Promise<TentativaEmCurso | null> {
  try {
    const { supabase } = await actionContext();
    // `answer_key` não entra nesta lista, e nem poderia: a coluna é revogada
    const { data: a } = await supabase
      .from("training_exam_attempts")
      .select("id, exam_id, status, deadline_at, started_at, questions_snapshot")
      .eq("id", attemptId)
      .maybeSingle();
    if (!a) return null;

    const [{ data: exam }, { data: respostas }] = await Promise.all([
      supabase.from("training_exams").select("min_minutes").eq("id", a.exam_id).maybeSingle(),
      supabase.from("training_exam_answers").select("question_id, answer").eq("attempt_id", attemptId),
    ]);

    const porQuestao = new Map((respostas ?? []).map((r) => [r.question_id, r.answer]));
    const snapshot = (a.questions_snapshot as unknown as Array<{
      id: string;
      kind: Enums<"training_question_kind">;
      statement: string;
      options: OpcaoQuestao[] | null;
      weight: number;
    }>) ?? [];

    return {
      attemptId: a.id,
      status: a.status,
      deadlineAt: a.deadline_at,
      startsAt: a.started_at,
      minMinutes: exam?.min_minutes ?? 0,
      questoes: snapshot.map((q) => {
        const bruta = porQuestao.get(q.id);
        const texto = bruta && !Array.isArray(bruta)
          ? ((bruta as unknown as { texto?: string }).texto ?? null)
          : null;
        return {
          id: q.id,
          kind: q.kind,
          statement: q.statement,
          options: q.options ?? [],
          weight: Number(q.weight),
          resposta: Array.isArray(bruta) ? (bruta as unknown as string[]) : null,
          respostaTexto: texto,
        };
      }),
    };
  } catch {
    return null;
  }
}

export async function responderQuestao(
  attemptId: string,
  questionId: string,
  resposta: string[] | string,
): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const payload = Array.isArray(resposta) ? resposta : { texto: resposta };
    const { error } = await supabase.rpc("prova_responder", {
      p_attempt: attemptId,
      p_question: questionId,
      p_answer: payload as unknown as Json,
    });
    if (error) return { error: error.message };
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type ResultadoDaProva = {
  status: Enums<"training_attempt_status">;
  score: number | null;
  passed: boolean | null;
};

export async function enviarProva(attemptId: string): Promise<ActionState & { resultado?: ResultadoDaProva }> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("prova_enviar", { p_attempt: attemptId });
    if (error) return { error: error.message };

    const { data } = await supabase
      .from("training_exam_attempts")
      .select("status, score, passed")
      .eq("id", attemptId)
      .maybeSingle();

    revalidatePath("/treinamentos");
    return {
      ok: true,
      resultado: data
        ? { status: data.status, score: data.score === null ? null : Number(data.score), passed: data.passed }
        : undefined,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type ResumoDaProva = {
  examId: string;
  title: string;
  instructions: string | null;
  passingScore: number;
  maxAttempts: number | null;
  extraAttempts: number;
  timeLimitMinutes: number | null;
  minMinutes: number;
  startsAfterContent: boolean;
  showResultDetail: boolean;
  questoesCount: number;
  tentativas: Array<{
    id: string;
    attemptNo: number;
    status: Enums<"training_attempt_status">;
    score: number | null;
    submittedAt: string | null;
  }>;
};

/** O que a tela de execução precisa saber sobre a prova antes de começar. */
export async function getResumoDaProva(
  trainingId: string,
  enrollmentId: string,
): Promise<ResumoDaProva | null> {
  try {
    const { supabase } = await actionContext();
    const { data: e } = await supabase
      .from("training_exams")
      .select("id, title, instructions, passing_score, max_attempts, time_limit_minutes, min_minutes, starts_after_content, show_result_detail")
      .eq("training_id", trainingId)
      .eq("active", true)
      .is("deleted_at", null)
      .maybeSingle();
    if (!e) return null;

    const [{ data: tentativas }, { count }, { data: matricula }] = await Promise.all([
      supabase
        .from("training_exam_attempts")
        .select("id, attempt_no, status, score, submitted_at")
        .eq("enrollment_id", enrollmentId)
        .order("attempt_no"),
      supabase
        .from("training_exam_questions")
        .select("id", { count: "exact", head: true })
        .eq("exam_id", e.id)
        .is("deleted_at", null),
      supabase
        .from("training_enrollments")
        .select("extra_attempts")
        .eq("id", enrollmentId)
        .maybeSingle(),
    ]);

    return {
      examId: e.id,
      title: e.title,
      instructions: e.instructions,
      passingScore: e.passing_score,
      maxAttempts: e.max_attempts,
      extraAttempts: matricula?.extra_attempts ?? 0,
      timeLimitMinutes: e.time_limit_minutes,
      minMinutes: e.min_minutes,
      startsAfterContent: e.starts_after_content,
      showResultDetail: e.show_result_detail,
      // a contagem vem vazia para quem não gere o curso (a policy esconde as
      // questões), e nesse caso o número simplesmente não é mostrado
      questoesCount: count ?? 0,
      tentativas: (tentativas ?? []).map((t) => ({
        id: t.id,
        attemptNo: t.attempt_no,
        status: t.status,
        score: t.score === null ? null : Number(t.score),
        submittedAt: t.submitted_at,
      })),
    };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ corrigir

export type ParaCorrigir = {
  answerId: string;
  attemptId: string;
  enrollmentId: string;
  trainingName: string;
  userName: string;
  statement: string;
  weight: number;
  resposta: string;
  submittedAt: string | null;
};

/**
 * Fila de correção: dissertativas enviadas e ainda sem nota.
 *
 * A RLS já limita ao que a pessoa pode ver, então esta consulta não precisa
 * filtrar por responsável: quem não gere nada recebe uma fila vazia.
 */
export async function getFilaDeCorrecao(): Promise<ParaCorrigir[]> {
  try {
    const { supabase } = await actionContext();
    const { data: pendentes } = await supabase
      .from("training_exam_answers")
      .select("id, attempt_id, question_id, answer")
      .is("score", null)
      .limit(200);
    if (!pendentes || pendentes.length === 0) return [];

    const attemptIds = [...new Set(pendentes.map((p) => p.attempt_id))];
    const { data: tentativas } = await supabase
      .from("training_exam_attempts")
      .select("id, enrollment_id, user_id, status, submitted_at, questions_snapshot")
      .in("id", attemptIds)
      .eq("status", "aguardando_correcao");
    if (!tentativas || tentativas.length === 0) return [];

    const porTentativa = new Map(tentativas.map((t) => [t.id, t]));
    const userIds = [...new Set(tentativas.map((t) => t.user_id))];
    const enrollmentIds = [...new Set(tentativas.map((t) => t.enrollment_id))];

    const [{ data: pessoas }, { data: matriculas }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email").in("id", userIds),
      supabase.from("training_enrollments").select("id, training_id").in("id", enrollmentIds),
    ]);

    const trainingIds = [...new Set((matriculas ?? []).map((m) => m.training_id))];
    const { data: cursos } = await supabase
      .from("trainings")
      .select("id, name")
      .in("id", trainingIds);

    const nomePessoa = new Map((pessoas ?? []).map((p) => [p.id, p.full_name ?? p.email ?? "Sem nome"]));
    const cursoDaMatricula = new Map((matriculas ?? []).map((m) => [m.id, m.training_id]));
    const nomeCurso = new Map((cursos ?? []).map((c) => [c.id, c.name]));

    const linhas: ParaCorrigir[] = [];
    for (const p of pendentes) {
      const t = porTentativa.get(p.attempt_id);
      if (!t) continue;
      const snapshot = (t.questions_snapshot as unknown as Array<{ id: string; statement: string; weight: number }>) ?? [];
      const q = snapshot.find((x) => x.id === p.question_id);
      const texto = (p.answer as unknown as { texto?: string } | null)?.texto ?? "";
      linhas.push({
        answerId: p.id,
        attemptId: p.attempt_id,
        enrollmentId: t.enrollment_id,
        trainingName: nomeCurso.get(cursoDaMatricula.get(t.enrollment_id) ?? "") ?? "Treinamento",
        userName: nomePessoa.get(t.user_id) ?? "Sem nome",
        statement: q?.statement ?? "Questão",
        weight: Number(q?.weight ?? 1),
        resposta: texto,
        submittedAt: t.submitted_at,
      });
    }
    return linhas;
  } catch {
    return [];
  }
}

export async function corrigirResposta(
  answerId: string,
  score: number,
  feedback: string,
): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("prova_corrigir", {
      p_answer: answerId,
      p_score: score,
      p_feedback: feedback.trim() || null,
    });
    if (error) return { error: error.message };
    revalidatePath("/treinamentos");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function reabrirProva(enrollmentId: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("prova_reabrir", { p_enrollment: enrollmentId });
    if (error) return { error: error.message };
    revalidatePath("/treinamentos");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
