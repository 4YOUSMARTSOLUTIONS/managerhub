"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import { createServiceClient } from "@/lib/supabase/admin";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";

/**
 * Turmas de treinamento: programação, convocação, liberação e presença.
 *
 * A turma é a OFERTA do curso. Quem conduz é o instrutor, e é dele a decisão de
 * liberar o início: um treinamento presencial não pode ser "feito" pelo sistema
 * antes de acontecer na sala.
 */

export type SessionInput = {
  id?: string;
  trainingId: string;
  name?: string;
  startsAt: string;
  /** vazio = calculado pela carga horária do treinamento */
  endsAt?: string | null;
  mode: Enums<"training_session_mode">;
  /** presencial: sala do cadastro de salas */
  roomId?: string | null;
  /** online: link da chamada */
  meetingUrl?: string;
  /** fora do cadastro: visita técnica, auditório de terceiro */
  location?: string;
  instructorId?: string | null;
  unitId?: string | null;
  capacity?: number | null;
  notes?: string;
};

const limpo = (v: string | null | undefined) => (v ?? "").trim() || null;

export async function saveSession(input: SessionInput): Promise<ActionState & { id?: string }> {
  try {
    const { supabase, tenantId, userId } = await actionContext();
    if (!input.trainingId) return { error: "Treinamento inválido." };
    if (!input.startsAt) return { error: "Informe a data e a hora de início." };
    if (input.endsAt && input.endsAt < input.startsAt) {
      return { error: "O término não pode ser antes do início." };
    }

    if (input.mode === "online" && !limpo(input.meetingUrl)) {
      return { error: "Turma online precisa do link da chamada." };
    }

    /**
     * Término: a carga horária do curso já diz quanto dura.
     *
     * Quando o formulário não manda o fim, ele é calculado aqui a partir da
     * carga. O cálculo mora TAMBÉM no servidor, e não só na tela, porque a
     * duração é informação do curso: qualquer caminho que crie turma deve
     * chegar no mesmo horário de término.
     */
    let fim = input.endsAt ? new Date(input.endsAt).toISOString() : null;
    if (!fim) {
      const { data: curso } = await supabase
        .from("trainings")
        .select("workload_minutes")
        .eq("id", input.trainingId)
        .maybeSingle();
      const carga = curso?.workload_minutes ?? 0;
      if (carga > 0) {
        fim = new Date(new Date(input.startsAt).getTime() + carga * 60_000).toISOString();
      }
    }

    const campos = {
      tenant_id: tenantId,
      training_id: input.trainingId,
      name: limpo(input.name),
      starts_at: new Date(input.startsAt).toISOString(),
      ends_at: fim,
      mode: input.mode,
      // sala e link são excludentes: guardar os dois deixaria a tela sem saber
      // qual mostrar quando alguém trocasse a modalidade
      room_id: input.mode === "presencial" ? (input.roomId || null) : null,
      meeting_url: input.mode === "online" ? limpo(input.meetingUrl) : null,
      location: limpo(input.location),
      instructor_id: input.instructorId || null,
      unit_id: input.unitId || null,
      capacity: input.capacity && input.capacity > 0 ? input.capacity : null,
      notes: limpo(input.notes),
      updated_at: new Date().toISOString(),
    };

    if (input.id) {
      const { error } = await supabase.from("training_sessions").update(campos).eq("id", input.id);
      if (error) return { error: error.message };
      revalidatePath("/treinamentos");
      return { ok: true, id: input.id };
    }

    const { data, error } = await supabase
      .from("training_sessions")
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

/**
 * Convoca gente para a turma.
 *
 * Convocar é vincular a matrícula à turma, e não criar matrícula nova: quem já
 * devia o treinamento continua com o mesmo ciclo, prazo e carimbo de época.
 * Quem ainda não tinha matrícula ganha uma, com origem `turma`.
 */
export async function convocar(
  sessionId: string,
  userIds: string[],
): Promise<ActionState & { convocados?: number }> {
  try {
    const { supabase, tenantId, userId } = await actionContext();
    if (userIds.length === 0) return { error: "Selecione ao menos um colaborador." };

    const { data: sessao } = await supabase
      .from("training_sessions")
      .select("id, training_id, capacity, starts_at, trainings(name)")
      .eq("id", sessionId)
      .maybeSingle();
    if (!sessao) return { error: "Turma não encontrada." };

    // vagas: conta quem já está na turma antes de aceitar mais gente
    if (sessao.capacity) {
      const { count } = await supabase
        .from("training_enrollments")
        .select("id", { count: "exact", head: true })
        .eq("session_id", sessionId);
      const jaConvocados = count ?? 0;
      if (jaConvocados + userIds.length > sessao.capacity) {
        return {
          error: `A turma tem ${sessao.capacity} vagas e ${jaConvocados} já convocados. Reduza a seleção ou aumente as vagas.`,
        };
      }
    }

    // matrículas vivas que já existem para este curso
    const { data: existentes } = await supabase
      .from("training_enrollments")
      .select("id, user_id")
      .eq("training_id", sessao.training_id)
      .in("user_id", userIds)
      .not("status", "in", "(cancelado,nao_aplicavel)");

    const porUsuario = new Map((existentes ?? []).map((e) => [e.user_id, e.id]));

    // quem já tem matrícula: só aponta para a turma
    const paraVincular = (existentes ?? []).map((e) => e.id);
    if (paraVincular.length > 0) {
      const { error } = await supabase
        .from("training_enrollments")
        .update({ session_id: sessionId, updated_at: new Date().toISOString() })
        .in("id", paraVincular);
      if (error) return { error: error.message };
    }

    // quem não tinha: matrícula nova já apontando para a turma, com o carimbo
    const novos = userIds.filter((u) => !porUsuario.has(u));
    if (novos.length > 0) {
      const { data: vinculos } = await supabase
        .from("memberships")
        .select("user_id, position_id, department_id, subdepartment_id")
        .eq("tenant_id", tenantId)
        .in("user_id", novos);
      const org = new Map((vinculos ?? []).map((m) => [m.user_id, m]));

      const { error } = await supabase.from("training_enrollments").insert(
        novos.map((uid) => ({
          tenant_id: tenantId,
          training_id: sessao.training_id,
          user_id: uid,
          session_id: sessionId,
          origin: "turma" as const,
          mandatory: true,
          snap_position_id: org.get(uid)?.position_id ?? null,
          snap_department_id: org.get(uid)?.department_id ?? null,
          snap_subdepartment_id: org.get(uid)?.subdepartment_id ?? null,
        })),
      );
      if (error) return { error: error.message };
    }

    // aviso no sino, best-effort: convocação que não notifica ninguém ainda é
    // convocação, e não pode derrubar o salvamento
    const alvo = userIds.filter((id) => id !== userId);
    if (alvo.length > 0) {
      const nomeCurso = (sessao.trainings as unknown as { name: string } | null)?.name ?? "Treinamento";
      const quando = new Date(sessao.starts_at).toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
      });
      const { error } = await supabase.rpc("notify_users", {
        p_tenant: tenantId,
        p_users: alvo,
        p_type: "training_session",
        p_title: "Você foi convocado para um treinamento",
        p_body: `${nomeCurso} em ${quando}`,
        p_demanda: null,
      });
      if (error) console.error("convocacao treinamento:", error.message);
    }

    revalidatePath("/treinamentos");
    return { ok: true, convocados: userIds.length };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function desconvocar(enrollmentId: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    // a matrícula continua existindo: sai da turma, não do treinamento
    const { error } = await supabase
      .from("training_enrollments")
      .update({ session_id: null, updated_at: new Date().toISOString() })
      .eq("id", enrollmentId);
    if (error) return { error: error.message };
    revalidatePath("/treinamentos");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Libera o início da turma.
 *
 * É a trava que o usuário pediu: treinamento conduzido por instrutor não pode
 * ser iniciado pelo colaborador antes de o instrutor abrir. Enquanto
 * `released_at` for nulo, a tela do participante mostra "aguardando liberação".
 */
export async function liberarTurma(sessionId: string, liberar: boolean): Promise<ActionState> {
  try {
    const { supabase, userId } = await actionContext();
    const { error } = await supabase
      .from("training_sessions")
      .update({
        released_at: liberar ? new Date().toISOString() : null,
        released_by: liberar ? userId : null,
        status: liberar ? "liberada" : "planejada",
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
    if (error) return { error: error.message };
    revalidatePath("/treinamentos");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function cancelarTurma(sessionId: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase
      .from("training_sessions")
      .update({ status: "cancelada", updated_at: new Date().toISOString() })
      .eq("id", sessionId);
    if (error) return { error: error.message };
    // as matrículas voltam a ficar soltas: o treinamento continua devido, só
    // esta oferta não vai acontecer
    await supabase
      .from("training_enrollments")
      .update({ session_id: null })
      .eq("session_id", sessionId);
    revalidatePath("/treinamentos");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type PresencaLinha = {
  enrollmentId: string;
  userId: string;
  userName: string;
  status: Enums<"training_attendance_status"> | null;
  /** true quando havia férias ou afastamento cobrindo a data da turma */
  afastado: boolean;
  motivoAfastamento: string | null;
};

/**
 * Monta a lista de presença da turma.
 *
 * Quem estava de férias ou afastado na data já vem marcado como justificado:
 * cobrar presença de quem não podia estar lá vira falta indevida no relatório,
 * e o dado para evitar isso já existe no sistema.
 *
 * A leitura de ausências usa o service client, como a tela de metas faz: a RLS
 * de `employee_absences` é do departamento pessoal, mas o instrutor precisa
 * saber que a pessoa estava fora sem ganhar acesso ao histórico dela.
 */
export async function getListaDePresenca(sessionId: string): Promise<PresencaLinha[]> {
  try {
    const { supabase, tenantId } = await actionContext();

    const { data: sessao } = await supabase
      .from("training_sessions")
      .select("starts_at, ends_at")
      .eq("id", sessionId)
      .maybeSingle();
    if (!sessao) return [];

    const [{ data: matriculas }, { data: presencas }] = await Promise.all([
      supabase
        .from("training_enrollments")
        .select("id, user_id")
        .eq("session_id", sessionId),
      supabase
        .from("training_session_attendance")
        .select("enrollment_id, status")
        .eq("session_id", sessionId),
    ]);
    if (!matriculas || matriculas.length === 0) return [];

    const userIds = matriculas.map((m) => m.user_id);
    const { data: perfis } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", userIds);
    const nome = new Map((perfis ?? []).map((p) => [p.id, p.full_name ?? p.email ?? "—"]));

    // datas como texto, sem passar por fuso (mesmo critério de rv-proporcional)
    const diaInicio = new Date(sessao.starts_at).toISOString().slice(0, 10);
    const diaFim = sessao.ends_at ? new Date(sessao.ends_at).toISOString().slice(0, 10) : diaInicio;

    const admin = createServiceClient();
    const { data: ausencias } = await admin
      .from("employee_absences")
      .select("user_id, kind, start_date, end_date")
      .eq("tenant_id", tenantId)
      .in("user_id", userIds)
      .lte("start_date", diaFim)
      .gte("end_date", diaInicio);

    const afastamentoDe = new Map<string, string>();
    for (const a of ausencias ?? []) afastamentoDe.set(a.user_id, a.kind);

    const lancado = new Map((presencas ?? []).map((p) => [p.enrollment_id, p.status]));

    return matriculas
      .map((m) => ({
        enrollmentId: m.id,
        userId: m.user_id,
        userName: nome.get(m.user_id) ?? "—",
        status: lancado.get(m.id) ?? null,
        afastado: afastamentoDe.has(m.user_id),
        motivoAfastamento: afastamentoDe.get(m.user_id) ?? null,
      }))
      .sort((a, b) => a.userName.localeCompare(b.userName, "pt-BR"));
  } catch {
    return [];
  }
}

/**
 * Grava a presença e fecha a turma.
 *
 * O que a presença decide na matrícula:
 *   presente     conclui o treinamento (e agenda a próxima reciclagem)
 *   ausente      `no_show`: continua devendo, e a falta fica registrada
 *   justificado  volta a `nao_iniciado`, sem falta: a pessoa não podia estar lá
 *
 * A validade do próximo ciclo tem data-base FIXA quando já havia vencimento
 * anterior: antecipar a reciclagem não encurta o prazo seguinte.
 */
export async function lancarPresenca(
  sessionId: string,
  linhas: { enrollmentId: string; status: Enums<"training_attendance_status"> }[],
  fecharTurma: boolean,
): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId } = await actionContext();
    if (linhas.length === 0) return { error: "Nada para lançar." };

    const { data: sessao } = await supabase
      .from("training_sessions")
      .select("id, training_id, starts_at, trainings(validade_meses, workload_minutes)")
      .eq("id", sessionId)
      .maybeSingle();
    if (!sessao) return { error: "Turma não encontrada." };

    const curso = sessao.trainings as unknown as { validade_meses: number | null } | null;
    const validadeMeses = curso?.validade_meses ?? null;

    // presença é substituída por inteiro: a lista é a foto do que aconteceu
    await supabase.from("training_session_attendance").delete().eq("session_id", sessionId);
    const { error: ePresenca } = await supabase.from("training_session_attendance").insert(
      linhas.map((l) => ({
        tenant_id: tenantId,
        session_id: sessionId,
        enrollment_id: l.enrollmentId,
        status: l.status,
        checked_by: userId,
      })),
    );
    if (ePresenca) return { error: ePresenca.message };

    // a conclusão usa a data da TURMA, não a de hoje: lançar a presença uma
    // semana depois não pode mudar quando o treinamento aconteceu
    const feitoEm = new Date(sessao.starts_at);
    const feitoYmd = feitoEm.toISOString().slice(0, 10);

    const presentes = linhas.filter((l) => l.status === "presente").map((l) => l.enrollmentId);
    const ausentes = linhas.filter((l) => l.status === "ausente").map((l) => l.enrollmentId);
    const justificados = linhas.filter((l) => l.status === "justificado").map((l) => l.enrollmentId);

    if (presentes.length > 0) {
      // vencimento anterior de cada matrícula, para a data-base ficar fixa
      const { data: atuais } = await supabase
        .from("training_enrollments")
        .select("id, expires_at")
        .in("id", presentes);

      for (const e of atuais ?? []) {
        const base = validadeMeses && e.expires_at && e.expires_at >= feitoYmd ? e.expires_at : feitoYmd;
        let expira: string | null = null;
        if (validadeMeses && validadeMeses > 0) {
          const [a, m, d] = base.split("-").map(Number);
          const alvo = new Date(Date.UTC(a, m - 1 + validadeMeses, 1));
          const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
          alvo.setUTCDate(Math.min(d, ultimoDia));
          expira = alvo.toISOString().slice(0, 10);
        }
        const { error } = await supabase
          .from("training_enrollments")
          .update({
            status: "concluido",
            completed_at: feitoEm.toISOString(),
            expires_at: expira,
            updated_at: new Date().toISOString(),
          })
          .eq("id", e.id);
        if (error) return { error: error.message };
      }
    }

    if (ausentes.length > 0) {
      const { error } = await supabase
        .from("training_enrollments")
        .update({ status: "no_show", updated_at: new Date().toISOString() })
        .in("id", ausentes);
      if (error) return { error: error.message };
    }

    if (justificados.length > 0) {
      // sem falta e sem conclusão: continua devendo, mas nada a cobrar dele
      const { error } = await supabase
        .from("training_enrollments")
        .update({ status: "nao_iniciado", session_id: null, updated_at: new Date().toISOString() })
        .in("id", justificados);
      if (error) return { error: error.message };
    }

    if (fecharTurma) {
      const { error } = await supabase
        .from("training_sessions")
        .update({ status: "concluida", updated_at: new Date().toISOString() })
        .eq("id", sessionId);
      if (error) return { error: error.message };
    }

    revalidatePath("/treinamentos");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type CandidatoConvocacao = {
  userId: string;
  userName: string;
  deptId: string | null;
  deptName: string | null;
  positionName: string | null;
  jaNaTurma: boolean;
};

/**
 * Quem tem matrícula pendente do curso e ainda não está em turma nenhuma.
 *
 * Vem com setor e cargo porque a convocação de uma turma grande se faz por
 * recorte ("todo o Armazém"), e não procurando 40 nomes um a um.
 */
export async function getCandidatos(trainingId: string): Promise<CandidatoConvocacao[]> {
  try {
    const { supabase, tenantId } = await actionContext();
    const { data } = await supabase
      .from("training_enrollments")
      .select("user_id, session_id, status")
      .eq("training_id", trainingId)
      .in("status", ["nao_iniciado", "em_andamento", "no_show"]);
    if (!data || data.length === 0) return [];

    const userIds = data.map((e) => e.user_id);
    const [{ data: perfis }, { data: vinculos }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email").in("id", userIds),
      supabase
        .from("memberships")
        .select("user_id, department_id, departments(name), positions(name)")
        .eq("tenant_id", tenantId)
        .in("user_id", userIds),
    ]);

    const nome = new Map((perfis ?? []).map((p) => [p.id, p.full_name ?? p.email ?? "—"]));
    type VincDb = {
      user_id: string; department_id: string | null;
      departments: { name: string } | null; positions: { name: string } | null;
    };
    const org = new Map(
      ((vinculos ?? []) as unknown as VincDb[]).map((m) => [m.user_id, m]),
    );

    return data
      .map((e) => ({
        userId: e.user_id,
        userName: nome.get(e.user_id) ?? "—",
        deptId: org.get(e.user_id)?.department_id ?? null,
        deptName: org.get(e.user_id)?.departments?.name ?? null,
        positionName: org.get(e.user_id)?.positions?.name ?? null,
        jaNaTurma: !!e.session_id,
      }))
      .sort((a, b) => a.userName.localeCompare(b.userName, "pt-BR"));
  } catch {
    return [];
  }
}
