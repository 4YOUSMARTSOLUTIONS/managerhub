"use server";

import { revalidatePath } from "next/cache";
import { actionContext, dpActionContext } from "./context";
import { souGestorDe } from "@/lib/team";
import { MIMES_ANEXO, TAMANHO_ANEXO, recusaDeUpload } from "@/lib/uploads";
import {
  dispatchComunicadoAbsenteismo, type EventoComunicado, type ResultadoComunicado,
} from "@/lib/absenteismo-email";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";
import { wantsActive } from "@/lib/catalogGuard";

/**
 * Absenteísmos: o catálogo de tipos, a lista de quem recebe o comunicado e,
 * adiante, o lançamento de não comparecimento com aprovação do RH.
 *
 * Arquivo separado de `absences.ts` de propósito. Aquele é o cadastro
 * ADMINISTRATIVO que grava direto em `employee_absences` (a base que a
 * remuneração variável lê), usado pelo departamento pessoal e pela importação
 * em lote. Este é o PROCESSO: quem lança é o gestor, e a ausência só nasce
 * quando o RH aprova.
 *
 * Catálogo e destinatários são do departamento pessoal (`dpActionContext`): a
 * RLS já recusa quem não pode, mas recusa em silêncio, e um update fora da
 * policy afeta zero linha e volta sem erro.
 */

const RP_CONFIG = "/configuracoes";
const RP_ABSENTEISMOS = "/absenteismos";
const RP_METAS = "/metas";

function revalidar() {
  revalidatePath(RP_CONFIG);
  revalidatePath(RP_ABSENTEISMOS);
}

/**
 * Depois de uma decisão, `/metas` também precisa recarregar.
 *
 * Aprovar cria linha em `employee_absences`, e é dela que saem o fator
 * proporcional e o redutor por faixa: sem isto o gestor veria o valor antigo
 * até o cache expirar, e o número na tela não bateria com o fechamento.
 */
function revalidarComRv() {
  revalidar();
  revalidatePath(RP_METAS);
}

/** Traduz o erro do banco em algo que a pessoa entenda na tela. */
function mensagem(e: { code?: string; message?: string }): string {
  const msg = e.message ?? "";
  if (msg.includes("absence_types_nome_unico")) {
    return "Já existe um tipo de absenteísmo com esse nome.";
  }
  if (msg.includes("absence_types_nome_nao_vazio")) return "Informe o nome do tipo.";
  if (msg.includes("absence_types_medico_pede_documento")) {
    return "Um tipo que pede dados médicos precisa exigir o documento anexado.";
  }
  if (msg.includes("absenteismo_dest_email_valido")) return "Informe um e-mail válido.";
  if (msg.includes("absenteismo_dest_geral_uk") || msg.includes("absenteismo_dest_unidade_uk")) {
    return "Este e-mail já está na lista para essa unidade.";
  }
  return msg || "Não foi possível salvar.";
}

// ============================================================================
// Catálogo de tipos
// ============================================================================

export type TipoAbsenteismoInput = {
  id?: string;
  name: string;
  description: string;
  kind: Enums<"absence_kind">;
  requiresDocument: boolean;
  requiresMedical: boolean;
  requiresCompanion: boolean;
  requiresKinship: boolean;
  discountsRvDefault: boolean;
  countsAsAbsenteeism: boolean;
};

export async function saveAbsenceType(input: TipoAbsenteismoInput): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await dpActionContext();

    const name = input.name.trim();
    if (!name) return { error: "Informe o nome do tipo." };

    // A coerência também é garantida por check no banco; aqui ela vira uma
    // mensagem em vez de um erro de constraint.
    const requiresDocument = input.requiresMedical ? true : input.requiresDocument;

    const campos = {
      tenant_id: tenantId,
      name,
      description: input.description.trim() || null,
      kind: input.kind,
      requires_document: requiresDocument,
      requires_medical: input.requiresMedical,
      requires_companion: input.requiresCompanion,
      requires_kinship: input.requiresKinship,
      discounts_rv_default: input.discountsRvDefault,
      counts_as_absenteeism: input.countsAsAbsenteeism,
      updated_at: new Date().toISOString(),
    };

    const { error } = input.id
      ? await supabase.from("absence_types").update(campos).eq("id", input.id)
      : await supabase.from("absence_types").insert(campos);
    if (error) return { error: mensagem(error) };

    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setAbsenceTypeActive(formData: FormData): Promise<void> {
  const { supabase } = await dpActionContext();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await supabase.from("absence_types").update({ active: wantsActive(formData) }).eq("id", id);
  revalidar();
}

/**
 * Excluir só enquanto ninguém usou.
 *
 * A FK do lançamento é `on delete restrict`, então um tipo já citado em
 * absenteísmo lançado não sai: ele vira inativo e para de aparecer no
 * formulário, mas o registro antigo continua sabendo dizer o que aconteceu.
 */
export async function deleteAbsenceType(formData: FormData): Promise<void> {
  const { supabase } = await dpActionContext();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { error } = await supabase.from("absence_types").delete().eq("id", id);
  if (error) {
    await supabase.from("absence_types").update({ active: false }).eq("id", id);
  }
  revalidar();
}

// ============================================================================
// Destinatários do comunicado
// ============================================================================

export type DestinatarioInput = {
  id?: string;
  email: string;
  name: string;
  /** vazio = recebe de todas as unidades */
  unitId: string;
};

export async function saveEmailRecipient(input: DestinatarioInput): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await dpActionContext();

    const email = input.email.trim().toLowerCase();
    if (!email) return { error: "Informe o e-mail." };

    const campos = {
      tenant_id: tenantId,
      email,
      name: input.name.trim() || null,
      unit_id: input.unitId || null,
      updated_at: new Date().toISOString(),
    };

    const { error } = input.id
      ? await supabase.from("absenteismo_email_recipients").update(campos).eq("id", input.id)
      : await supabase.from("absenteismo_email_recipients").insert(campos);
    if (error) return { error: mensagem(error) };

    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setEmailRecipientActive(formData: FormData): Promise<void> {
  const { supabase } = await dpActionContext();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await supabase
    .from("absenteismo_email_recipients")
    .update({ active: wantsActive(formData) })
    .eq("id", id);
  revalidar();
}

/** Destinatário não é referenciado por nada: excluir é excluir mesmo. */
export async function deleteEmailRecipient(formData: FormData): Promise<void> {
  const { supabase } = await dpActionContext();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await supabase.from("absenteismo_email_recipients").delete().eq("id", id);
  revalidar();
}

// ============================================================================
// O lançamento
// ============================================================================
//
// Contexto é `actionContext`, e não `dpActionContext`: quem lança é o GESTOR da
// pessoa, que não está no departamento pessoal. A alçada é verificada caso a
// caso com a mesma função que a RLS consulta, para a recusa sair em português.

const BUCKET_DOC = "absenteismo-documentos";

type Contexto = Awaited<ReturnType<typeof actionContext>>;

function ehDp(role: Enums<"member_role">) {
  return role === "owner" || role === "admin" || role === "hr";
}

async function podeLancarPara(ctx: Contexto, userId: string): Promise<boolean> {
  if (ehDp(ctx.role)) return true;
  return souGestorDe(ctx.supabase, userId, ctx.tenantId);
}

/**
 * O carimbo do vínculo, montado no SERVIDOR.
 *
 * Sem CPF: o documento de absenteísmo não precisa dele, e a coluna está
 * revogada de `authenticated` (ver AGENTS.md).
 */
async function montarCarimbo(ctx: Contexto, userId: string) {
  const { supabase, tenantId } = ctx;

  const { data: vinculo } = await supabase
    .from("memberships")
    .select("id, employee_code, department_id, subdepartment_id, position_id, manager_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();

  const [{ data: pessoas }, { data: unidadesDoVinculo }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").in(
      "id",
      [userId, vinculo?.manager_id].filter((v): v is string => Boolean(v)),
    ),
    vinculo?.id
      ? supabase.from("membership_units").select("unit_id").eq("membership_id", vinculo.id).limit(1)
      : Promise.resolve({ data: null as { unit_id: string }[] | null }),
  ]);

  const unitId = unidadesDoVinculo?.[0]?.unit_id ?? null;
  const nomePorId = new Map((pessoas ?? []).map((p) => [p.id, p.full_name]));

  const [{ data: dep }, { data: sub }, { data: cargo }, { data: unidade }] = await Promise.all([
    vinculo?.department_id
      ? supabase.from("departments").select("name").eq("id", vinculo.department_id).maybeSingle()
      : Promise.resolve({ data: null }),
    vinculo?.subdepartment_id
      ? supabase.from("subdepartments").select("name").eq("id", vinculo.subdepartment_id).maybeSingle()
      : Promise.resolve({ data: null }),
    vinculo?.position_id
      ? supabase.from("positions").select("name").eq("id", vinculo.position_id).maybeSingle()
      : Promise.resolve({ data: null }),
    unitId
      ? supabase.from("units").select("name").eq("id", unitId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    snap_full_name: nomePorId.get(userId) ?? null,
    snap_employee_code: vinculo?.employee_code ?? null,
    snap_department_id: vinculo?.department_id ?? null,
    snap_department_name: dep?.name ?? null,
    snap_subdepartment_id: vinculo?.subdepartment_id ?? null,
    snap_subdepartment_name: sub?.name ?? null,
    snap_position_id: vinculo?.position_id ?? null,
    snap_position_name: cargo?.name ?? null,
    snap_manager_id: vinculo?.manager_id ?? null,
    snap_manager_name: vinculo?.manager_id ? nomePorId.get(vinculo.manager_id) ?? null : null,
    snap_unit_id: unitId,
    snap_unit_name: unidade?.name ?? null,
  };
}

/**
 * O aviso de que a pessoa não apareceu.
 *
 * Pode ser lançado a qualquer hora do dia: o gestor às vezes descobre logo cedo,
 * às vezes só quando alguém dá falta na escala da tarde.
 *
 * `occurredOn` vem do CLIENTE porque é o dia local de quem lança. Um
 * `now()::date` no servidor viraria o dia seguinte às 21h de Brasília.
 */
export async function lancarNaoComparecimento(input: {
  userId: string;
  occurredOn: string;
  reasonNote: string;
}): Promise<ActionState & { id?: string }> {
  try {
    const ctx = await actionContext();
    const { supabase, tenantId, userId } = ctx;

    if (!input.userId) return { error: "Escolha o colaborador." };
    if (!input.occurredOn) return { error: "Informe o dia do não comparecimento." };
    if (!(await podeLancarPara(ctx, input.userId))) {
      return { error: "Você só lança absenteísmo para quem está na sua equipe." };
    }
    if (input.userId === userId) return { error: "Ninguém lança o próprio não comparecimento." };

    const carimbo = await montarCarimbo(ctx, input.userId);

    const { data, error } = await supabase
      .from("absenteismo_lancamentos")
      .insert({
        ...carimbo,
        tenant_id: tenantId,
        user_id: input.userId,
        created_by: userId,
        status: "aberto",
        occurred_on: input.occurredOn,
        reason_note: input.reasonNote.trim() || null,
      })
      .select("id")
      .single();
    if (error) return { error: mensagemDoLancamento(error) };

    // O comunicado sai DEPOIS do insert commitado: o lançamento nunca deixa de
    // ser gravado por causa do e-mail, e a falha vira aviso na tela.
    const envio = await dispatchComunicadoAbsenteismo(data.id, "aberto", userId);

    revalidar();
    return { ok: true, id: data.id, ...avisoDoEnvio(envio) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Traduz o resultado do disparo em `warning`, no padrão de `meetings.ts`. */
function avisoDoEnvio(r: ResultadoComunicado): { warning?: string } {
  if (r.status === "sent") return {};
  if (r.status === "skipped") {
    return {
      warning: r.error?.includes("destinatário")
        ? "Registrado, mas nenhum comunicado saiu: não há destinatário cadastrado em Configurações, na aba Absenteísmos."
        : "Registrado, mas nenhum comunicado saiu: a integração de e-mail não está configurada.",
    };
  }
  return { warning: "Registrado, mas o comunicado por e-mail não pôde ser enviado. Use o botão de reenviar na ficha do lançamento." };
}

export type ConfirmacaoInput = {
  id: string;
  absenceTypeId: string;
  startDate: string;
  endDate: string;
  note: string;
  /** grau de parentesco do falecido; só quando o tipo exige (licença nojo) */
  parentesco?: string;
  /** só quando o tipo exige */
  atestado?: {
    cid: string;
    cidDescricao: string;
    medico: string;
    crm: string;
    local: string;
    emitidoEm: string;
    /** nome de quem foi acompanhado; só quando o tipo exige */
    acompanhado: string;
    /** atestado de horas: entrada e saída no dia (vazio = atestado de dias) */
    horaInicio: string;
    horaFim: string;
  };
};

/**
 * O que a confirmação descobriu.
 *
 * As exigências (documento, dado médico) vêm do CATÁLOGO e são carimbadas aqui:
 * se viessem da tela, o gestor escolheria o que precisa preencher.
 *
 * O MESMO vale para o desconto de remuneração variável: ele é política da
 * empresa, definida por tipo em Configurações, e não escolha de quem lança.
 * Se cada gestor marcasse por conta, o mesmo atestado descontaria numa equipe
 * e não descontaria na outra.
 */
export async function salvarConfirmacao(input: ConfirmacaoInput): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId } = await actionContext();
    if (!input.id) return { error: "Lançamento inválido." };
    if (!input.absenceTypeId) return { error: "Escolha o tipo de absenteísmo." };
    if (!input.startDate || !input.endDate) return { error: "Informe o período." };

    const { data: tipo } = await supabase
      .from("absence_types")
      .select("id, name, kind, requires_document, requires_medical, requires_companion, requires_kinship, discounts_rv_default")
      .eq("id", input.absenceTypeId)
      .maybeSingle();
    if (!tipo) return { error: "Tipo de absenteísmo não encontrado." };

    const { error } = await supabase
      .from("absenteismo_lancamentos")
      .update({
        absence_type_id: tipo.id,
        snap_type_name: tipo.name,
        snap_kind: tipo.kind,
        snap_requires_document: tipo.requires_document,
        snap_requires_medical: tipo.requires_medical,
        snap_requires_companion: tipo.requires_companion,
        snap_requires_kinship: tipo.requires_kinship,
        snap_discounts_rv_default: tipo.discounts_rv_default,
        start_date: input.startDate,
        end_date: input.endDate,
        discounts_rv: tipo.discounts_rv_default,
        note: input.note.trim() || null,
        kinship_of_deceased: tipo.requires_kinship ? (input.parentesco?.trim() || null) : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.id);
    if (error) return { error: mensagemDoLancamento(error) };

    // O dado clínico vai para a tabela filha, sempre. Mesmo que o tipo não
    // exija, se o gestor digitou, o lugar é o mesmo.
    if (input.atestado) {
      const a = input.atestado;
      const temAlgo = [a.cid, a.cidDescricao, a.medico, a.crm, a.local, a.emitidoEm, a.acompanhado, a.horaInicio, a.horaFim]
        .some((v) => v.trim());
      if (temAlgo) {
        // Os dias de afastamento são CALCULADOS do período, nunca digitados: o
        // número na filha não pode divergir das datas que o RH vai aprovar.
        // Atestado de horas não conta dia nenhum; ele carrega o intervalo.
        const emHoras = Boolean(a.horaInicio.trim() && a.horaFim.trim());
        const diasCorridos =
          Math.round((Date.parse(input.endDate) - Date.parse(input.startDate)) / 86400000) + 1;
        const { error: e2 } = await supabase
          .from("absenteismo_atestados")
          .upsert({
            lancamento_id: input.id,
            tenant_id: tenantId,
            cid_code: a.cid.trim().toUpperCase() || null,
            cid_description: a.cidDescricao.trim() || null,
            doctor_name: a.medico.trim() || null,
            doctor_crm: a.crm.trim() || null,
            facility: a.local.trim() || null,
            issued_on: a.emitidoEm || null,
            days_off: emHoras || !Number.isFinite(diasCorridos) ? null : diasCorridos,
            companion_name: a.acompanhado.trim() || null,
            hours_start: emHoras ? a.horaInicio : null,
            hours_end: emHoras ? a.horaFim : null,
            updated_by: userId,
            updated_at: new Date().toISOString(),
          });
        if (e2) return { error: mensagemDoLancamento(e2) };
      }
    }

    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function anexarDocumentoAbsenteismo(formData: FormData): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId } = await actionContext();
    const id = String(formData.get("id") ?? "");
    const file = formData.get("file");
    if (!id) return { error: "Lançamento inválido." };
    if (!(file instanceof File)) return { error: "Escolha o arquivo." };

    const recusa = recusaDeUpload(file, TAMANHO_ANEXO, MIMES_ANEXO);
    if (recusa) return { error: recusa };

    const { data: atual } = await supabase
      .from("absenteismo_lancamentos")
      .select("status, doc_path")
      .eq("id", id)
      .maybeSingle();
    if (!atual) return { error: "Lançamento não encontrado." };
    if (atual.status !== "aberto" && atual.status !== "reprovado") {
      return { error: "Este lançamento já foi enviado ao RH." };
    }

    const limpo = file.name.replace(/[^\w.\- ]+/g, "_");
    const caminho = `${tenantId}/${id}/${Date.now()}-${limpo}`;
    const { error: e1 } = await supabase.storage
      .from(BUCKET_DOC)
      .upload(caminho, file, { contentType: file.type || undefined, upsert: false });
    if (e1) return { error: e1.message };

    const { error: e2 } = await supabase
      .from("absenteismo_lancamentos")
      .update({
        doc_path: caminho,
        doc_filename: file.name,
        doc_size: file.size,
        doc_content_type: file.type || null,
        doc_uploaded_at: new Date().toISOString(),
        doc_uploaded_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (e2) {
      // o arquivo já subiu: sem esta limpeza ele fica órfão no bucket
      await supabase.storage.from(BUCKET_DOC).remove([caminho]);
      return { error: mensagemDoLancamento(e2) };
    }

    if (atual.doc_path) await supabase.storage.from(BUCKET_DOC).remove([atual.doc_path]);

    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function removerDocumentoAbsenteismo(formData: FormData): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const id = String(formData.get("id") ?? "");
    if (!id) return { error: "Lançamento inválido." };

    const { data: atual } = await supabase
      .from("absenteismo_lancamentos")
      .select("status, doc_path")
      .eq("id", id)
      .maybeSingle();
    if (!atual) return { error: "Lançamento não encontrado." };
    if (atual.status !== "aberto" && atual.status !== "reprovado") {
      return { error: "Este lançamento já foi enviado ao RH." };
    }

    const { error } = await supabase
      .from("absenteismo_lancamentos")
      .update({
        doc_path: null, doc_filename: null, doc_size: null,
        doc_content_type: null, doc_uploaded_at: null, doc_uploaded_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return { error: mensagemDoLancamento(error) };

    if (atual.doc_path) await supabase.storage.from(BUCKET_DOC).remove([atual.doc_path]);

    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Link temporário para ler o documento (o bucket é privado). */
export async function getDocumentoAbsenteismoUrl(path: string): Promise<string | null> {
  const { supabase } = await actionContext();
  const { data } = await supabase.storage.from(BUCKET_DOC).createSignedUrl(path, 60 * 10);
  return data?.signedUrl ?? null;
}

/**
 * O dado do atestado, pela única porta que existe.
 *
 * A tela pede sob demanda, ao abrir a ficha: assim o CID não viaja na listagem
 * de dezenas de lançamentos.
 */
export type AtestadoLido = {
  cid: string | null;
  cidDescricao: string | null;
  medico: string | null;
  crm: string | null;
  local: string | null;
  emitidoEm: string | null;
  diasAfastamento: number | null;
  acompanhado: string | null;
  horaInicio: string | null;
  horaFim: string | null;
};

export async function getAtestado(id: string): Promise<AtestadoLido | null> {
  const { supabase } = await actionContext();
  const { data } = await supabase.rpc("absenteismo_atestado", { p_id: id });
  return (data ?? null) as AtestadoLido | null;
}

/**
 * Busca na tabela CID-10 oficial (catálogo global, carregado do DATASUS).
 *
 * A descrição deixa de ser digitada: quem digita descrição erra, e o RH recebe
 * "gripe" onde o documento diz outra coisa. O gestor busca pelo código ou por
 * um pedaço da descrição e a tela preenche o resto.
 */
export async function buscarCid(q: string): Promise<{ code: string; description: string }[]> {
  const termo = q.trim();
  if (termo.length < 2) return [];
  const { supabase } = await actionContext();
  // vírgula e parêntese quebrariam a sintaxe do `.or()` do PostgREST
  const escapado = termo.replace(/[%_\\]/g, "\\$&").replace(/[,()]/g, " ").trim();
  if (escapado.length < 2) return [];
  const { data } = await supabase
    .from("cid10")
    .select("code, description")
    .or(`code.ilike.${escapado}%,description.ilike.%${escapado}%`)
    .order("code")
    .limit(20);
  return data ?? [];
}

export async function confirmarAbsenteismo(formData: FormData): Promise<ActionState> {
  try {
    const { supabase, userId } = await actionContext();
    const id = String(formData.get("id") ?? "");
    if (!id) return { error: "Lançamento inválido." };

    const { error } = await supabase.rpc("absenteismo_confirmar", { p_id: id });
    if (error) return { error: error.message };

    const envio = await dispatchComunicadoAbsenteismo(id, "confirmado", userId);

    revalidar();
    return { ok: true, message: "Enviado ao RH.", ...avisoDoEnvio(envio) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Reenviar o comunicado.
 *
 * Sem fila e sem retry automático, esta é a única recuperação quando o provedor
 * está fora do ar ou a lista de destinatários foi corrigida depois do fato.
 */
export async function reenviarComunicado(formData: FormData): Promise<ActionState> {
  try {
    const { supabase, userId } = await actionContext();
    const id = String(formData.get("id") ?? "");
    if (!id) return { error: "Lançamento inválido." };

    // A RLS decide se esta pessoa alcança o lançamento; sem isso, um id
    // adivinhado mandaria e-mail sobre gente de outra equipe.
    const { data: linha } = await supabase
      .from("absenteismo_lancamentos")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (!linha) return { error: "Lançamento não encontrado." };

    const envio = await dispatchComunicadoAbsenteismo(id, "reenvio", userId);
    revalidar();
    if (envio.status === "sent") {
      return { ok: true, message: `Comunicado reenviado para ${envio.destinatarios} destinatário(s).` };
    }
    return { ok: true, ...avisoDoEnvio(envio) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * A decisão do RH.
 *
 * A guarda de papel mora na RPC, e não aqui: é ela que grava, e é lá que a
 * verificação precisa estar para valer contra quem chame o PostgREST direto.
 */
export async function decidirAbsenteismo(formData: FormData): Promise<ActionState> {
  try {
    const { supabase, userId } = await actionContext();
    const id = String(formData.get("id") ?? "");
    const aprovar = String(formData.get("aprovar") ?? "") === "1";
    const nota = String(formData.get("nota") ?? "").trim();
    if (!id) return { error: "Lançamento inválido." };
    if (!aprovar && !nota) return { error: "Informe o motivo da reprovação." };

    const { error } = await supabase.rpc("absenteismo_decidir", {
      p_id: id, p_aprovar: aprovar, p_nota: nota || null,
    });
    if (error) return { error: error.message };

    // Fecha o ciclo com quem recebeu o comunicado da abertura. O corpo leva o
    // tipo e o período; nada clínico, nem na aprovação.
    const evento: EventoComunicado = aprovar ? "aprovado" : "reprovado";
    const envio = await dispatchComunicadoAbsenteismo(id, evento, userId);

    revalidarComRv();
    return {
      ok: true,
      message: aprovar ? "Absenteísmo aprovado." : "Lançamento reprovado.",
      ...avisoDoEnvio(envio),
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function cancelarAbsenteismo(formData: FormData): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const id = String(formData.get("id") ?? "");
    const nota = String(formData.get("nota") ?? "").trim();
    if (!id) return { error: "Lançamento inválido." };
    if (!nota) return { error: "Informe o motivo do cancelamento." };

    const { error } = await supabase.rpc("absenteismo_cancelar", { p_id: id, p_nota: nota });
    if (error) return { error: error.message };

    revalidarComRv();
    return { ok: true, message: "Lançamento cancelado." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Traduz o que o banco recusa.
 *
 * As mensagens das RPCs já saem em português; o que sobra aqui são os checks, a
 * RLS e os índices, que falam em inglês e por nome de constraint.
 */
function mensagemDoLancamento(e: { code?: string; message?: string }): string {
  const msg = e.message ?? "";
  if (msg.includes("absenteismo_do_dia_uk")) {
    return "Já existe um lançamento de não comparecimento para esta pessoa neste dia.";
  }
  if (msg.includes("absenteismo_periodo_cobre_o_dia")) {
    return "O período informado precisa incluir o dia do não comparecimento.";
  }
  if (msg.includes("absenteismo_periodo")) return "O término não pode ser antes do início.";
  if (msg.includes("absenteismo_anexo_quando_o_tipo_exige")) {
    return "Este tipo exige o documento anexado.";
  }
  if (msg.includes("row-level security")) {
    return "Você só lança absenteísmo para quem está na sua equipe.";
  }
  if (msg.includes("absenteismo_lancamentos_absence_id_fkey")) {
    return "Esta ausência veio de um lançamento aprovado. Cancele o lançamento em Absenteísmos.";
  }
  return msg || "Não foi possível salvar.";
}
