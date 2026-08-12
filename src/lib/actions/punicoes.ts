"use server";

import { revalidatePath } from "next/cache";
import { actionContext, dpActionContext } from "./context";
import { souGestorDe } from "@/lib/team";
import { wantsActive } from "@/lib/catalogGuard";
import { MIMES_ANEXO, TAMANHO_ANEXO, recusaDeUpload } from "@/lib/uploads";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";

/**
 * Punições: catálogo de infrações e, adiante, o lançamento com aprovação do RH.
 *
 * Arquivo separado de `rv-redutores.ts` de propósito. Aquele é sobre o que CORTA
 * remuneração variável: os tipos de punição existem lá porque cada um tem uma
 * faixa de desconto atrelada. Infração é outra pergunta, a de o que a pessoa
 * fez, e não corta nada sozinha.
 *
 * O catálogo é do departamento pessoal (`dpActionContext`), pelo mesmo motivo de
 * `rv-redutores`: a RLS já recusa quem não pode, mas recusa em silêncio, e um
 * update fora da policy afeta zero linha e volta sem erro.
 */

const RP_CONFIG = "/configuracoes";
const RP_PUNICOES = "/punicoes";
const RP_METAS = "/metas";

function revalidar() {
  revalidatePath(RP_CONFIG);
  revalidatePath(RP_PUNICOES);
}

/**
 * Depois de uma decisão, `/metas` também precisa recarregar.
 *
 * Aprovar cria linha em `employee_sanctions`, e é dela que sai o redutor do mês:
 * sem isto o gestor veria o fator antigo até o cache expirar, e o número que ele
 * lê na tela não bateria com o que o fechamento vai calcular.
 */
function revalidarComRv() {
  revalidar();
  revalidatePath(RP_METAS);
}

/** Traduz o erro do banco em algo que a pessoa entenda na tela. */
function mensagem(e: { code?: string; message?: string }): string {
  const msg = e.message ?? "";
  if (msg.includes("infraction_types_codigo_unico")) {
    return "Já existe uma infração com esse código.";
  }
  if (msg.includes("infraction_types_nome_unico")) {
    return "Já existe uma infração com esse nome.";
  }
  if (msg.includes("infraction_types_codigo_nao_vazio")) return "Informe o código da infração.";
  if (msg.includes("infraction_types_nome_nao_vazio")) return "Informe o nome da infração.";
  return msg || "Não foi possível salvar.";
}

export type InfracaoInput = {
  id?: string;
  code: string;
  name: string;
  description: string;
  severity: Enums<"infraction_severity">;
};

export async function saveInfractionType(input: InfracaoInput): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await dpActionContext();

    const code = input.code.trim();
    const name = input.name.trim();
    if (!code) return { error: "Informe o código da infração." };
    if (!name) return { error: "Informe o nome da infração." };

    const campos = {
      tenant_id: tenantId,
      code,
      name,
      description: input.description.trim() || null,
      severity: input.severity,
      updated_at: new Date().toISOString(),
    };

    const { error } = input.id
      ? await supabase.from("infraction_types").update(campos).eq("id", input.id)
      : await supabase.from("infraction_types").insert(campos);
    if (error) return { error: mensagem(error) };

    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setInfractionTypeActive(formData: FormData): Promise<void> {
  const { supabase } = await dpActionContext();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await supabase.from("infraction_types").update({ active: wantsActive(formData) }).eq("id", id);
  revalidar();
}

/**
 * Excluir só enquanto ninguém usou.
 *
 * A FK do lançamento é `on delete restrict`, então uma infração já citada em
 * punição aplicada não sai: ela vira inativa e para de aparecer no formulário,
 * mas o registro antigo continua sabendo dizer o que a pessoa fez.
 */
export async function deleteInfractionType(formData: FormData): Promise<void> {
  const { supabase } = await dpActionContext();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { error } = await supabase.from("infraction_types").delete().eq("id", id);
  if (error) {
    await supabase.from("infraction_types").update({ active: false }).eq("id", id);
  }
  revalidar();
}

// ============================================================================
// Lançamento de punição
// ============================================================================
//
// O contexto aqui é `actionContext`, e não `dpActionContext`: quem lança é o
// GESTOR da pessoa, que não está no departamento pessoal. A alçada é verificada
// caso a caso, com a mesma função que a RLS consulta (`manages_user`), para a
// recusa sair em português em vez de virar erro cru de policy.

const BUCKET_DOC = "punicao-documentos";

type Contexto = Awaited<ReturnType<typeof actionContext>>;

/** RH, administrador e proprietário: a mão que aprova, e que também pode lançar. */
function ehDp(role: Enums<"member_role">) {
  return role === "owner" || role === "admin" || role === "hr";
}

/** Quem pode abrir um lançamento para esta pessoa. */
async function podeLancarPara(ctx: Contexto, userId: string): Promise<boolean> {
  if (ehDp(ctx.role)) return true;
  return souGestorDe(ctx.supabase, userId, ctx.tenantId);
}

/**
 * O carimbo de época, montado no SERVIDOR.
 *
 * Nada disso chega da tela de propósito. A gravidade é o caso mais claro: se ela
 * viesse do formulário, o gestor escolheria se a infração dele é leve ou grave,
 * e o catálogo viraria decoração. O mesmo vale para setor, função e chefia, que
 * precisam refletir o vínculo no dia da aplicação, e não o de hoje.
 */
async function montarCarimbo(
  ctx: Contexto,
  userId: string,
  infractionTypeId: string | null,
  sanctionTypeId: string | null,
) {
  const { supabase, tenantId } = ctx;

  const { data: vinculo } = await supabase
    .from("memberships")
    .select("id, employee_code, department_id, subdepartment_id, position_id, manager_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();

  const [{ data: pessoas }, { data: unidadesDoVinculo }] = await Promise.all([
    // só as colunas que `authenticated` pode ler (ver AGENTS.md): o CPF do
    // documento vem depois, pela RPC `punicao_documento`
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

  const [{ data: dep }, { data: sub }, { data: cargo }, { data: unidade }, { data: infracao }, { data: punicao }] =
    await Promise.all([
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
      infractionTypeId
        ? supabase.from("infraction_types").select("code, name, description, severity").eq("id", infractionTypeId).maybeSingle()
        : Promise.resolve({ data: null }),
      sanctionTypeId
        ? supabase.from("sanction_types").select("name").eq("id", sanctionTypeId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  return {
    infraction_type_id: infractionTypeId,
    infraction_code: infracao?.code ?? null,
    infraction_name: infracao?.name ?? null,
    infraction_description: infracao?.description ?? null,
    severity: infracao?.severity ?? null,
    sanction_type_id: sanctionTypeId,
    sanction_name: punicao?.name ?? null,
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

export type PunicaoInput = {
  id?: string;
  userId: string;
  appliedOn: string;
  infractionTypeId: string;
  sanctionTypeId: string;
  extraInfo: string;
};

/**
 * Salva o rascunho.
 *
 * Só rascunho: depois de enviado ao RH o lançamento é congelado pelo trigger, e
 * a tela nem oferece edição. Quem precisar corrigir pede a reprovação.
 */
export async function salvarRascunhoPunicao(input: PunicaoInput): Promise<ActionState & { id?: string }> {
  try {
    const ctx = await actionContext();
    const { supabase, tenantId, userId } = ctx;

    if (!input.userId) return { error: "Escolha o colaborador." };
    if (!(await podeLancarPara(ctx, input.userId))) {
      return { error: "Você só lança punição para quem está na sua equipe." };
    }
    if (input.userId === userId) return { error: "Ninguém aplica punição a si mesmo." };

    const carimbo = await montarCarimbo(
      ctx,
      input.userId,
      input.infractionTypeId || null,
      input.sanctionTypeId || null,
    );

    const campos = {
      ...carimbo,
      tenant_id: tenantId,
      user_id: input.userId,
      applied_on: input.appliedOn || null,
      extra_info: input.extraInfo.trim() || null,
      updated_at: new Date().toISOString(),
    };

    if (input.id) {
      const { error } = await supabase
        .from("punicao_lancamentos")
        .update(campos)
        .eq("id", input.id)
        .eq("status", "rascunho");
      if (error) return { error: mensagemDoLancamento(error) };
      revalidar();
      return { ok: true, id: input.id };
    }

    const { data, error } = await supabase
      .from("punicao_lancamentos")
      .insert({ ...campos, created_by: userId, status: "rascunho" })
      .select("id")
      .single();
    if (error) return { error: mensagemDoLancamento(error) };

    revalidar();
    return { ok: true, id: data.id };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Anexa o documento assinado.
 *
 * É este anexo que separa "preenchi o formulário" de "colhi as assinaturas": sem
 * ele o banco recusa a saída do rascunho, e a tela nem mostra o botão de enviar.
 */
export async function anexarDocumentoAssinado(formData: FormData): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId } = await actionContext();
    const id = String(formData.get("id") ?? "");
    const file = formData.get("file");
    if (!id) return { error: "Lançamento inválido." };
    if (!(file instanceof File)) return { error: "Escolha o arquivo assinado." };

    const recusa = recusaDeUpload(file, TAMANHO_ANEXO, MIMES_ANEXO);
    if (recusa) return { error: recusa };

    const { data: atual } = await supabase
      .from("punicao_lancamentos")
      .select("status, signed_path")
      .eq("id", id)
      .maybeSingle();
    if (!atual) return { error: "Lançamento não encontrado." };
    if (atual.status !== "rascunho" && atual.status !== "reprovada") {
      return { error: "Este lançamento já foi enviado ao RH." };
    }

    const limpo = file.name.replace(/[^\w.\- ]+/g, "_");
    const caminho = `${tenantId}/${id}/${Date.now()}-${limpo}`;
    const { error: e1 } = await supabase.storage
      .from(BUCKET_DOC)
      .upload(caminho, file, { contentType: file.type || undefined, upsert: false });
    if (e1) return { error: e1.message };

    const { error: e2 } = await supabase
      .from("punicao_lancamentos")
      .update({
        signed_path: caminho,
        signed_filename: file.name,
        signed_size: file.size,
        signed_content_type: file.type || null,
        signed_uploaded_at: new Date().toISOString(),
        signed_uploaded_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (e2) {
      // o arquivo já subiu: sem esta limpeza ele fica órfão no bucket
      await supabase.storage.from(BUCKET_DOC).remove([caminho]);
      return { error: mensagemDoLancamento(e2) };
    }

    // troca de anexo: o antigo sai do bucket, senão a versão sem a assinatura da
    // diretoria continuaria lá, indistinguível da boa
    if (atual.signed_path) await supabase.storage.from(BUCKET_DOC).remove([atual.signed_path]);

    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function removerDocumentoAssinado(formData: FormData): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const id = String(formData.get("id") ?? "");
    if (!id) return { error: "Lançamento inválido." };

    const { data: atual } = await supabase
      .from("punicao_lancamentos")
      .select("status, signed_path")
      .eq("id", id)
      .maybeSingle();
    if (!atual) return { error: "Lançamento não encontrado." };
    if (atual.status !== "rascunho" && atual.status !== "reprovada") {
      return { error: "Este lançamento já foi enviado ao RH." };
    }

    const { error } = await supabase
      .from("punicao_lancamentos")
      .update({
        signed_path: null, signed_filename: null, signed_size: null,
        signed_content_type: null, signed_uploaded_at: null, signed_uploaded_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return { error: mensagemDoLancamento(error) };

    if (atual.signed_path) await supabase.storage.from(BUCKET_DOC).remove([atual.signed_path]);

    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Link temporário para ler o documento assinado (o bucket é privado). */
export async function getDocumentoAssinadoUrl(path: string): Promise<string | null> {
  const { supabase } = await actionContext();
  const { data } = await supabase.storage.from(BUCKET_DOC).createSignedUrl(path, 60 * 10);
  return data?.signedUrl ?? null;
}

export async function submeterPunicao(formData: FormData): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const id = String(formData.get("id") ?? "");
    if (!id) return { error: "Lançamento inválido." };

    const { error } = await supabase.rpc("punicao_submeter", { p_id: id });
    if (error) return { error: error.message };

    revalidar();
    return { ok: true, message: "Enviado ao RH." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Excluir só enquanto é rascunho, e só de quem lançou (a policy diz o mesmo). */
export async function excluirRascunhoPunicao(formData: FormData): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const id = String(formData.get("id") ?? "");
    if (!id) return { error: "Lançamento inválido." };

    const { data: atual } = await supabase
      .from("punicao_lancamentos")
      .select("status, signed_path")
      .eq("id", id)
      .maybeSingle();
    if (!atual) return { error: "Lançamento não encontrado." };
    if (atual.status !== "rascunho") return { error: "Só um rascunho pode ser excluído." };

    const { error } = await supabase.from("punicao_lancamentos").delete().eq("id", id);
    if (error) return { error: mensagemDoLancamento(error) };

    if (atual.signed_path) await supabase.storage.from(BUCKET_DOC).remove([atual.signed_path]);

    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * A decisão do RH.
 *
 * A guarda de papel mora na RPC, e não aqui: é ela que grava, e é lá que a
 * verificação precisa estar para valer também contra quem chame o PostgREST
 * direto. Esta camada só traduz e recarrega as telas afetadas.
 */
export async function decidirPunicao(formData: FormData): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const id = String(formData.get("id") ?? "");
    const aprovar = String(formData.get("aprovar") ?? "") === "1";
    const nota = String(formData.get("nota") ?? "").trim();
    if (!id) return { error: "Lançamento inválido." };
    if (!aprovar && !nota) return { error: "Informe o motivo da reprovação." };

    const { error } = await supabase.rpc("punicao_decidir", {
      p_id: id, p_aprovar: aprovar, p_nota: nota || null,
    });
    if (error) return { error: error.message };

    revalidarComRv();
    return { ok: true, message: aprovar ? "Punição aprovada." : "Lançamento reprovado." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Desfaz uma punição aprovada: some de `employee_sanctions` e deixa de contar. */
export async function cancelarPunicao(formData: FormData): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const id = String(formData.get("id") ?? "");
    const nota = String(formData.get("nota") ?? "").trim();
    if (!id) return { error: "Lançamento inválido." };

    const { error } = await supabase.rpc("punicao_cancelar", { p_id: id, p_nota: nota || null });
    if (error) return { error: error.message };

    revalidarComRv();
    return { ok: true, message: "Punição cancelada." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Traduz o que o banco recusa.
 *
 * As mensagens das RPCs já saem em português; o que sobra aqui são os checks e a
 * RLS, que falam em inglês e por nome de constraint.
 */
function mensagemDoLancamento(e: { code?: string; message?: string }): string {
  const msg = e.message ?? "";
  if (msg.includes("punicao_anexo_para_sair_do_rascunho")) {
    return "Anexe o documento assinado antes de enviar ao RH.";
  }
  if (msg.includes("punicao_campos_para_sair_do_rascunho")) {
    return "Preencha a data, a infração e a punição aplicada antes de enviar.";
  }
  if (msg.includes("row-level security")) {
    return "Você só lança punição para quem está na sua equipe.";
  }
  if (msg.includes("punicao_lancamentos_sanction_id_fkey")) {
    return "Esta punição veio de um lançamento aprovado. Cancele o lançamento em Punições.";
  }
  return msg || "Não foi possível salvar.";
}
