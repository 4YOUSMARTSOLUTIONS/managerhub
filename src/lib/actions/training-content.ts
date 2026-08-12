"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";

/**
 * Conteúdo do treinamento: material, progresso e conclusão.
 *
 * O registro de progresso é o que sustenta o EAD diante da NR-1: além de
 * "concluiu", o sistema guarda quanto tempo a pessoa permaneceu e em que
 * janelas. Por isso o heartbeat grava duas coisas a cada batida, o estado
 * atual e a janela vista.
 */

// não exportados: arquivo "use server" só pode exportar função assíncrona
const BUCKET_VIDEO = "training-videos";
const BUCKET_ARQUIVO = "training-files";

export type MaterialInput = {
  id?: string;
  trainingId: string;
  kind: Enums<"training_material_kind">;
  title: string;
  sort: number;
  required: boolean;
  minWatchPct: number;
  storagePath?: string | null;
  filename?: string | null;
  sizeBytes?: number | null;
  contentType?: string | null;
  externalUrl?: string | null;
  body?: string | null;
  durationSeconds?: number | null;
};

const limpo = (v: string | null | undefined) => (v ?? "").trim() || null;

export async function saveMaterial(input: MaterialInput): Promise<ActionState & { id?: string }> {
  try {
    const { supabase, tenantId, userId } = await actionContext();
    const title = (input.title ?? "").trim();
    if (!title) return { error: "Informe o título do material." };

    if ((input.kind === "video_url" || input.kind === "link") && !limpo(input.externalUrl)) {
      return { error: "Informe o endereço do conteúdo." };
    }
    if ((input.kind === "video_upload" || input.kind === "arquivo") && !limpo(input.storagePath)) {
      return { error: "Envie o arquivo antes de salvar." };
    }
    if (input.kind === "texto" && !limpo(input.body)) {
      return { error: "Escreva o conteúdo do material." };
    }

    const campos = {
      tenant_id: tenantId,
      training_id: input.trainingId,
      kind: input.kind,
      title,
      sort: input.sort,
      required: input.required,
      min_watch_pct: input.minWatchPct,
      storage_path: limpo(input.storagePath),
      filename: limpo(input.filename),
      size_bytes: input.sizeBytes ?? null,
      content_type: limpo(input.contentType),
      external_url: limpo(input.externalUrl),
      body: limpo(input.body),
      duration_seconds: input.durationSeconds ?? null,
      updated_at: new Date().toISOString(),
    };

    if (input.id) {
      const { error } = await supabase.from("training_materials").update(campos).eq("id", input.id);
      if (error) return { error: error.message };
      revalidatePath("/treinamentos");
      return { ok: true, id: input.id };
    }

    const { data, error } = await supabase
      .from("training_materials")
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

/** Soft delete: o material sai da trilha, o progresso de quem já assistiu fica. */
export async function deleteMaterial(id: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase
      .from("training_materials")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/treinamentos");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type MaterialRow = {
  id: string;
  kind: Enums<"training_material_kind">;
  title: string;
  sort: number;
  required: boolean;
  minWatchPct: number;
  storagePath: string | null;
  filename: string | null;
  sizeBytes: number | null;
  contentType: string | null;
  externalUrl: string | null;
  body: string | null;
  durationSeconds: number | null;
};

export async function listarMateriais(trainingId: string): Promise<MaterialRow[]> {
  try {
    const { supabase } = await actionContext();
    const { data } = await supabase
      .from("training_materials")
      .select("id, kind, title, sort, required, min_watch_pct, storage_path, filename, size_bytes, content_type, external_url, body, duration_seconds")
      .eq("training_id", trainingId)
      .is("deleted_at", null)
      .order("sort");
    return (data ?? []).map((m) => ({
      id: m.id,
      kind: m.kind,
      title: m.title,
      sort: m.sort,
      required: m.required,
      minWatchPct: m.min_watch_pct,
      storagePath: m.storage_path,
      filename: m.filename,
      sizeBytes: m.size_bytes,
      contentType: m.content_type,
      externalUrl: m.external_url,
      body: m.body,
      durationSeconds: m.duration_seconds,
    }));
  } catch {
    return [];
  }
}

/** Teto de vídeo da empresa, para a tela avisar ANTES de o envio começar. */
export async function limiteDeVideoMb(): Promise<number> {
  try {
    const { supabase, tenantId } = await actionContext();
    const { data } = await supabase
      .from("tenants")
      .select("training_video_max_mb")
      .eq("id", tenantId)
      .maybeSingle();
    return data?.training_video_max_mb ?? 100;
  } catch {
    return 100;
  }
}

/**
 * Autoriza o envio de um arquivo grande direto ao armazenamento.
 *
 * O upload NÃO passa por aqui: server action tem teto de 25 MB, e vídeo de aula
 * não cabe. O servidor só confere permissão, tipo e tamanho e devolve um token
 * de escrita para um caminho específico; o navegador envia o arquivo direto.
 *
 * O limite em MB é do CLIENTE (`tenants.training_video_max_mb`, padrão 100), e
 * não uma constante no código: cada empresa acomoda um tamanho de aula. O teto
 * do bucket continua sendo a barreira que vale mesmo fora do sistema.
 */
export async function autorizarUpload(input: {
  trainingId: string;
  kind: "video_upload" | "arquivo";
  filename: string;
  sizeBytes: number;
  contentType: string;
}): Promise<{ path?: string; token?: string; bucket?: string; error?: string }> {
  try {
    const { supabase, tenantId } = await actionContext();

    const podeGerir = await supabase.rpc("pode_gerir_treinamento", { p_training: input.trainingId });
    if (!podeGerir.data) return { error: "Sem permissão para adicionar conteúdo a este treinamento." };

    const bucket = input.kind === "video_upload" ? BUCKET_VIDEO : BUCKET_ARQUIVO;

    if (input.kind === "video_upload") {
      const { data: tenant } = await supabase
        .from("tenants")
        .select("training_video_max_mb")
        .eq("id", tenantId)
        .maybeSingle();
      const limiteMb = tenant?.training_video_max_mb ?? 100;
      if (input.sizeBytes > limiteMb * 1024 * 1024) {
        return {
          error: `O vídeo tem ${(input.sizeBytes / 1024 / 1024).toFixed(0)} MB e o limite da empresa é ${limiteMb} MB. Comprima o arquivo ou use um vídeo por link.`,
        };
      }
      if (!input.contentType.startsWith("video/")) return { error: "Envie um arquivo de vídeo." };
    } else {
      if (input.sizeBytes > 50 * 1024 * 1024) return { error: "O arquivo passa de 50 MB." };
    }

    // tenant no primeiro segmento: é o que a policy do bucket confere
    const seguro = input.filename.replace(/[^\w.\-]+/g, "_").slice(-80);
    const path = `${tenantId}/${input.trainingId}/${Date.now()}_${seguro}`;

    const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path);
    if (error) return { error: error.message };

    return { path: data.path, token: data.token, bucket };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** URL de leitura, válida por 2 horas: o suficiente para assistir sem renovar. */
export async function urlDoMaterial(materialId: string): Promise<{ url?: string; error?: string }> {
  try {
    const { supabase } = await actionContext();
    const { data: m } = await supabase
      .from("training_materials")
      .select("kind, storage_path, external_url")
      .eq("id", materialId)
      .maybeSingle();
    if (!m) return { error: "Material não encontrado." };
    if (m.external_url) return { url: m.external_url };
    if (!m.storage_path) return { error: "Material sem arquivo." };

    const bucket = m.kind === "video_upload" ? BUCKET_VIDEO : BUCKET_ARQUIVO;
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(m.storage_path, 7200);
    if (error) return { error: error.message };
    return { url: data.signedUrl };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Heartbeat do player.
 *
 * `assistidoSegundos` é o tempo que passou de fato desde a última batida, e não
 * a posição do vídeo: quem arrasta a barra para o fim aumenta a posição, mas
 * não o tempo. O material só conclui quando o TEMPO assistido cobre o
 * percentual mínimo.
 *
 * Cada batida também grava a janela vista, que é o log de permanência que a
 * NR-1 pede para EAD.
 */
export async function registrarProgresso(input: {
  enrollmentId: string;
  materialId: string;
  assistidoSegundos: number;
  posicaoSegundos: number;
  duracaoSegundos: number;
  deSegundos: number;
}): Promise<{ ok?: true; pct?: number; concluido?: boolean; error?: string }> {
  try {
    const { supabase, tenantId } = await actionContext();

    const [{ data: atual }, { data: material }] = await Promise.all([
      supabase
        .from("training_material_progress")
        .select("id, watched_seconds, max_position_seconds, completed_at")
        .eq("enrollment_id", input.enrollmentId)
        .eq("material_id", input.materialId)
        .maybeSingle(),
      supabase
        .from("training_materials")
        .select("min_watch_pct, duration_seconds")
        .eq("id", input.materialId)
        .maybeSingle(),
    ]);
    if (!material) return { error: "Material não encontrado." };

    const duracao = input.duracaoSegundos || material.duration_seconds || 0;
    // o incremento é limitado pelo intervalo real entre batidas: sem isso, um
    // cliente adulterado somaria horas numa chamada só
    const incremento = Math.max(0, Math.min(input.assistidoSegundos, 120));
    const assistido = (atual?.watched_seconds ?? 0) + incremento;
    const maxPos = Math.max(atual?.max_position_seconds ?? 0, Math.round(input.posicaoSegundos));
    const pct = duracao > 0 ? Math.min(100, Math.round((assistido / duracao) * 100)) : 0;
    const concluido = pct >= (material.min_watch_pct ?? 90);

    const { error } = await supabase.from("training_material_progress").upsert(
      {
        tenant_id: tenantId,
        enrollment_id: input.enrollmentId,
        material_id: input.materialId,
        watched_seconds: assistido,
        max_position_seconds: maxPos,
        pct,
        completed_at: atual?.completed_at ?? (concluido ? new Date().toISOString() : null),
        last_heartbeat_at: new Date().toISOString(),
      },
      { onConflict: "enrollment_id,material_id" },
    );
    if (error) return { error: error.message };

    // janela vista: append-only, nunca editada
    if (incremento > 0) {
      await supabase.from("training_watch_spans").insert({
        tenant_id: tenantId,
        enrollment_id: input.enrollmentId,
        material_id: input.materialId,
        started_at: new Date(Date.now() - incremento * 1000).toISOString(),
        ended_at: new Date().toISOString(),
        from_seconds: Math.round(input.deSegundos),
        to_seconds: Math.round(input.posicaoSegundos),
      });
    }

    // A matrícula sai de "não iniciado" no primeiro sinal de vida. Vai por RPC
    // porque a RLS de `training_enrollments` só dá escrita a quem gere o curso,
    // e afrouxá-la deixaria o aluno mexer também no próprio vencimento.
    await supabase.rpc("treinamento_iniciar", { p_enrollment: input.enrollmentId });

    return { ok: true, pct, concluido: concluido || !!atual?.completed_at };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Material sem tempo (arquivo, link, texto) conclui por confirmação de leitura. */
export async function marcarComoLido(enrollmentId: string, materialId: string): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await actionContext();
    const { error } = await supabase.from("training_material_progress").upsert(
      {
        tenant_id: tenantId,
        enrollment_id: enrollmentId,
        material_id: materialId,
        pct: 100,
        completed_at: new Date().toISOString(),
        last_heartbeat_at: new Date().toISOString(),
      },
      { onConflict: "enrollment_id,material_id" },
    );
    if (error) return { error: error.message };

    await supabase.rpc("treinamento_iniciar", { p_enrollment: enrollmentId });

    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Conclui o treinamento e emite o certificado.
 *
 * Quem decide é o banco (`treinamento_concluir`), não esta action e muito menos
 * o navegador: a conferência de "fez tudo que era obrigatório" precisa valer
 * mesmo para quem chamar a API por fora. A RLS de `training_enrollments` só dá
 * escrita a quem GERE o curso, e o certificado não tem policy de insert
 * nenhuma, então esta é a única porta.
 */
export async function concluirTreinamento(enrollmentId: string): Promise<ActionState & { certificado?: string }> {
  try {
    const { supabase } = await actionContext();
    const { data, error } = await supabase.rpc("treinamento_concluir", { p_enrollment: enrollmentId });
    if (error) return { error: error.message };

    revalidatePath("/treinamentos");
    return { ok: true, certificado: data ?? undefined };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type MaterialParaFazer = {
  id: string;
  kind: Enums<"training_material_kind">;
  title: string;
  required: boolean;
  minWatchPct: number;
  externalUrl: string | null;
  body: string | null;
  durationSeconds: number | null;
  filename: string | null;
  pct: number;
  concluido: boolean;
};

export type ConteudoParaFazer = {
  enrollmentId: string;
  trainingId: string;
  trainingName: string;
  description: string | null;
  workloadMinutes: number;
  status: Enums<"training_enrollment_status">;
  /** turma com instrutor que ainda não liberou o início */
  bloqueadoPorTurma: boolean;
  turmaQuando: string | null;
  /** passo de trilha cujo anterior obrigatório ainda não foi concluído */
  bloqueadoPorPreRequisito: boolean;
  preRequisitoNome: string | null;
  trilhaNome: string | null;
  materiais: MaterialParaFazer[];
};

export async function getConteudoParaFazer(enrollmentId: string): Promise<ConteudoParaFazer | null> {
  try {
    const { supabase, userId } = await actionContext();

    const { data: e } = await supabase
      .from("training_enrollments")
      .select("id, user_id, training_id, status, session_id, path_id")
      .eq("id", enrollmentId)
      .maybeSingle();
    if (!e || e.user_id !== userId) return null;

    const [{ data: curso }, { data: materiais }, { data: progresso }] = await Promise.all([
      supabase
        .from("trainings")
        .select("name, description, workload_minutes")
        .eq("id", e.training_id)
        .maybeSingle(),
      supabase
        .from("training_materials")
        .select("id, kind, title, required, min_watch_pct, external_url, body, duration_seconds, filename, sort")
        .eq("training_id", e.training_id)
        .is("deleted_at", null)
        .order("sort"),
      supabase
        .from("training_material_progress")
        .select("material_id, pct, completed_at")
        .eq("enrollment_id", enrollmentId),
    ]);
    if (!curso) return null;

    let bloqueado = false;
    let quando: string | null = null;
    if (e.session_id) {
      const { data: turma } = await supabase
        .from("training_sessions")
        .select("released_at, starts_at, status")
        .eq("id", e.session_id)
        .maybeSingle();
      // turma conduzida só abre depois que o instrutor libera
      bloqueado = !!turma && !turma.released_at && turma.status !== "cancelada";
      quando = turma?.starts_at ?? null;
    }

    // Pré-requisito da trilha, para a tela EXPLICAR o bloqueio.
    //
    // Quem impede de fato é a guarda no banco (`trilha_passo_bloqueado`, dentro
    // de treinamento_iniciar/prova_iniciar/treinamento_concluir). Isto aqui é a
    // mesma pergunta feita de novo só para dizer qual curso falta, porque uma
    // tela que trava sem dizer o motivo vira chamado no RH.
    let preRequisito: { curso: string; trilha: string } | null = null;
    if (e.path_id) {
      const [{ data: trilha }, { data: passos }] = await Promise.all([
        supabase.from("training_paths").select("name").eq("id", e.path_id).maybeSingle(),
        supabase
          .from("training_path_steps")
          .select("training_id, sort, required, trainings(name, active, deleted_at)")
          .eq("path_id", e.path_id)
          .order("sort"),
      ]);

      type PassoDb = {
        training_id: string; sort: number; required: boolean;
        trainings: { name: string; active: boolean; deleted_at: string | null } | null;
      };
      const lista = (passos ?? []) as unknown as PassoDb[];
      const meu = lista.find((p) => p.training_id === e.training_id);

      if (meu) {
        const anteriores = lista.filter(
          (p) => p.sort < meu.sort && p.required && p.trainings?.active && !p.trainings.deleted_at,
        );
        if (anteriores.length > 0) {
          const { data: feitas } = await supabase
            .from("training_enrollments")
            .select("training_id, status")
            .eq("user_id", userId)
            .in("training_id", anteriores.map((p) => p.training_id))
            .in("status", ["concluido", "isento"]);
          const cumpridos = new Set((feitas ?? []).map((f) => f.training_id));
          const falta = anteriores.find((p) => !cumpridos.has(p.training_id));
          if (falta) {
            preRequisito = {
              curso: falta.trainings?.name ?? "o treinamento anterior",
              trilha: trilha?.name ?? "trilha",
            };
          }
        }
      }
    }

    const prog = new Map((progresso ?? []).map((p) => [p.material_id, p]));

    return {
      enrollmentId,
      trainingId: e.training_id,
      trainingName: curso.name,
      description: curso.description,
      workloadMinutes: curso.workload_minutes,
      status: e.status,
      bloqueadoPorTurma: bloqueado,
      turmaQuando: quando,
      bloqueadoPorPreRequisito: !!preRequisito,
      preRequisitoNome: preRequisito?.curso ?? null,
      trilhaNome: preRequisito?.trilha ?? null,
      materiais: (materiais ?? []).map((m) => ({
        id: m.id,
        kind: m.kind,
        title: m.title,
        required: m.required,
        minWatchPct: m.min_watch_pct,
        externalUrl: m.external_url,
        body: m.body,
        durationSeconds: m.duration_seconds,
        filename: m.filename,
        pct: prog.get(m.id)?.pct ?? 0,
        concluido: !!prog.get(m.id)?.completed_at,
      })),
    };
  } catch {
    return null;
  }
}
