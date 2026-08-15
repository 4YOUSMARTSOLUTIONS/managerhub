"use server";

import { revalidatePath } from "next/cache";
import { actionContext, adminActionContext } from "./context";
import { wantsActive } from "@/lib/catalogGuard";
import { MIMES_ANEXO, TAMANHO_ANEXO, recusaDeUpload } from "@/lib/uploads";
import { SEG_ICONE_BUCKET } from "@/lib/avatar";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";

/**
 * Segurança do trabalho: catálogos, equipe e (nas levas seguintes) relatos,
 * triagem e acidentes.
 *
 * Tudo aqui é `adminActionContext`, e não `dpActionContext`: segurança do
 * trabalho não é departamento pessoal. O RH não configura o catálogo de riscos
 * da operação nem diz quem é o técnico de segurança; quem faz isso é a
 * administração da empresa. A RLS já recusa quem não pode, mas recusa em
 * silêncio (um update fora da policy afeta zero linha e volta sem erro), então
 * a trava também mora aqui, para a mensagem sair em português.
 */

const RP_CONFIG = "/configuracoes";
const RP_RELATOS = "/seguranca/relatos";
const RP_ACIDENTES = "/seguranca/acidentes";
const RP_PIRAMIDE = "/seguranca/piramide";

function revalidar() {
  revalidatePath(RP_CONFIG);
  revalidatePath(RP_RELATOS);
  revalidatePath(RP_ACIDENTES);
  revalidatePath(RP_PIRAMIDE);
}

/** As três tabelas de catálogo do módulo. A tela manda o nome; aqui ele é validado. */
export type CatalogoSeg = "seg_tipos_relato" | "seg_locais" | "seg_areas";

const CATALOGOS: CatalogoSeg[] = ["seg_tipos_relato", "seg_locais", "seg_areas"];

function catalogoValido(valor: unknown): CatalogoSeg | null {
  const t = String(valor ?? "") as CatalogoSeg;
  return CATALOGOS.includes(t) ? t : null;
}

/** Traduz o erro do banco em algo que a pessoa entenda na tela. */
function mensagem(e: { message?: string }): string {
  const msg = e.message ?? "";
  if (msg.includes("seg_tipos_relato_nome_unico")) return "Já existe um tipo de relato com esse nome.";
  if (msg.includes("seg_locais_nome_unico")) return "Já existe um local com esse nome.";
  if (msg.includes("seg_areas_nome_unico")) return "Já existe uma área com esse nome nesse local.";
  if (msg.includes("_nome_nao_vazio")) return "Informe o nome.";
  if (msg.includes("row-level security")) return "Você não tem permissão para alterar este cadastro.";
  return msg || "Não foi possível salvar.";
}

// ============================================================================
// Catálogos: tipo de relato, local e área
// ============================================================================

export type SegTipoInput = {
  id?: string;
  name: string;
  natureza: Enums<"seg_relato_natureza">;
  description?: string;
};

export async function saveSegTipoRelato(input: SegTipoInput): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await adminActionContext();
    const name = input.name.trim();
    if (!name) return { error: "Informe o nome do tipo de relato." };

    const campos = {
      tenant_id: tenantId,
      name,
      natureza: input.natureza,
      description: input.description?.trim() || null,
    };

    const { error } = input.id
      ? await supabase.from("seg_tipos_relato").update(campos).eq("id", input.id)
      : await supabase.from("seg_tipos_relato").insert(campos);
    if (error) return { error: mensagem(error) };

    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type SegLocalInput = { id?: string; name: string; description?: string };

export async function saveSegLocal(input: SegLocalInput): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await adminActionContext();
    const name = input.name.trim();
    if (!name) return { error: "Informe o nome do local." };

    const campos = { tenant_id: tenantId, name, description: input.description?.trim() || null };

    const { error } = input.id
      ? await supabase.from("seg_locais").update(campos).eq("id", input.id)
      : await supabase.from("seg_locais").insert(campos);
    if (error) return { error: mensagem(error) };

    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type SegAreaInput = { id?: string; name: string; local_id?: string | null; description?: string };

export async function saveSegArea(input: SegAreaInput): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await adminActionContext();
    const name = input.name.trim();
    if (!name) return { error: "Informe o nome da área." };

    const campos = {
      tenant_id: tenantId,
      name,
      // sem local, a área vale para qualquer um: é o caso do "Escritório", que
      // existe no armazém e na revenda e não deve ser cadastrado duas vezes
      local_id: input.local_id || null,
      description: input.description?.trim() || null,
    };

    const { error } = input.id
      ? await supabase.from("seg_areas").update(campos).eq("id", input.id)
      : await supabase.from("seg_areas").insert(campos);
    if (error) return { error: mensagem(error) };

    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Liga e desliga o item no formulário sem apagar o histórico que já o cita. */
export async function setSegCatalogoAtivo(formData: FormData): Promise<void> {
  const tabela = catalogoValido(formData.get("tabela"));
  const id = String(formData.get("id") ?? "");
  if (!tabela || !id) return;

  const { supabase } = await adminActionContext();
  const active = wantsActive(formData);

  if (tabela === "seg_tipos_relato") {
    await supabase.from("seg_tipos_relato").update({ active }).eq("id", id);
  } else if (tabela === "seg_locais") {
    await supabase.from("seg_locais").update({ active }).eq("id", id);
  } else {
    await supabase.from("seg_areas").update({ active }).eq("id", id);
  }
  revalidar();
}

/**
 * Excluir só enquanto ninguém usou.
 *
 * As FKs do relato e do acidente são `on delete restrict`, então um tipo já
 * citado não sai: ele vira inativo e some do formulário, mas o registro antigo
 * continua sabendo dizer o que aconteceu. Mesmo desenho do catálogo de
 * infrações.
 */
export async function deleteSegCatalogo(formData: FormData): Promise<void> {
  const tabela = catalogoValido(formData.get("tabela"));
  const id = String(formData.get("id") ?? "");
  if (!tabela || !id) return;

  const { supabase } = await adminActionContext();

  const apagou =
    tabela === "seg_tipos_relato"
      ? await supabase.from("seg_tipos_relato").delete().eq("id", id)
      : tabela === "seg_locais"
        ? await supabase.from("seg_locais").delete().eq("id", id)
        : await supabase.from("seg_areas").delete().eq("id", id);

  if (apagou.error) {
    if (tabela === "seg_tipos_relato") {
      await supabase.from("seg_tipos_relato").update({ active: false }).eq("id", id);
    } else if (tabela === "seg_locais") {
      await supabase.from("seg_locais").update({ active: false }).eq("id", id);
    } else {
      await supabase.from("seg_areas").update({ active: false }).eq("id", id);
    }
  }
  revalidar();
}

// ============================================================================
// A figura do item do catálogo
// ============================================================================
//
// Bucket público de 2 MB, só imagem, caminho `{tenant}/{uuid}.ext`. A gravação
// segue o padrão do avatar: sobe primeiro, grava a coluna depois e, se a coluna
// falhar, apaga o arquivo recém-subido (senão fica órfão pagando storage). A
// figura ANTERIOR só é removida depois que a nova está gravada.

const MIMES_ICONE = ["image/jpeg", "image/png", "image/webp"];
const TAMANHO_ICONE = 2 * 1024 * 1024;

async function lerIcone(
  supabase: Awaited<ReturnType<typeof adminActionContext>>["supabase"],
  tabela: CatalogoSeg,
  id: string,
): Promise<string | null> {
  const q =
    tabela === "seg_tipos_relato"
      ? await supabase.from("seg_tipos_relato").select("image_path").eq("id", id).maybeSingle()
      : tabela === "seg_locais"
        ? await supabase.from("seg_locais").select("image_path").eq("id", id).maybeSingle()
        : await supabase.from("seg_areas").select("image_path").eq("id", id).maybeSingle();
  return q.data?.image_path ?? null;
}

async function gravarIcone(
  supabase: Awaited<ReturnType<typeof adminActionContext>>["supabase"],
  tabela: CatalogoSeg,
  id: string,
  path: string | null,
) {
  if (tabela === "seg_tipos_relato") {
    return supabase.from("seg_tipos_relato").update({ image_path: path }).eq("id", id);
  }
  if (tabela === "seg_locais") {
    return supabase.from("seg_locais").update({ image_path: path }).eq("id", id);
  }
  return supabase.from("seg_areas").update({ image_path: path }).eq("id", id);
}

export async function definirIconeSeg(formData: FormData): Promise<ActionState> {
  try {
    const tabela = catalogoValido(formData.get("tabela"));
    const id = String(formData.get("id") ?? "");
    const file = formData.get("file");
    if (!tabela || !id) return { error: "Item inválido." };
    if (!(file instanceof File)) return { error: "Escolha uma imagem." };

    const recusa = recusaDeUpload(file, TAMANHO_ICONE, MIMES_ICONE);
    if (recusa) return { error: recusa };

    const { supabase, tenantId } = await adminActionContext();
    const anterior = await lerIcone(supabase, tabela, id);

    const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
    const caminho = `${tenantId}/${crypto.randomUUID()}.${ext}`;

    const subida = await supabase.storage
      .from(SEG_ICONE_BUCKET)
      .upload(caminho, file, { contentType: file.type || undefined, upsert: false });
    if (subida.error) return { error: subida.error.message };

    const { error } = await gravarIcone(supabase, tabela, id, caminho);
    if (error) {
      await supabase.storage.from(SEG_ICONE_BUCKET).remove([caminho]);
      return { error: mensagem(error) };
    }

    if (anterior) await supabase.storage.from(SEG_ICONE_BUCKET).remove([anterior]);

    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function removerIconeSeg(formData: FormData): Promise<ActionState> {
  try {
    const tabela = catalogoValido(formData.get("tabela"));
    const id = String(formData.get("id") ?? "");
    if (!tabela || !id) return { error: "Item inválido." };

    const { supabase } = await adminActionContext();
    const anterior = await lerIcone(supabase, tabela, id);

    const { error } = await gravarIcone(supabase, tabela, id, null);
    if (error) return { error: mensagem(error) };

    if (anterior) await supabase.storage.from(SEG_ICONE_BUCKET).remove([anterior]);

    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ============================================================================
// Relatos
// ============================================================================
//
// Aqui o contexto é `actionContext`: quem relata é a operação inteira, não a
// administração. A gravação é pela RPC `seg_criar_relato`, que faz relato e
// envolvidos na mesma transação, copia a natureza do tipo e avisa a equipe de
// segurança. Nada disso pode depender da tela.

export type RelatoInput = {
  occurred_on: string;
  tipo_id: string;
  local_id?: string | null;
  area_id?: string | null;
  descricao: string;
  envolvidos: string[];
};

export async function criarRelato(input: RelatoInput): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();

    const { error } = await supabase.rpc("seg_criar_relato", {
      p_data: {
        occurred_on: input.occurred_on,
        tipo_id: input.tipo_id,
        local_id: input.local_id ?? null,
        area_id: input.area_id ?? null,
        // a unidade não vai daqui: a RPC deriva do vínculo do envolvido e,
        // sem envolvido, do vínculo de quem relatou
        descricao: input.descricao,
        envolvidos: input.envolvidos,
      },
    });
    // a RPC já fala português; repassar direto evita traduzir duas vezes
    if (error) return { error: error.message };

    revalidar();
    return { ok: true, message: "Relato registrado. A equipe de segurança foi avisada." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Corrige o próprio relato, enquanto a segurança não pegou.
 *
 * A janela e a alçada são conferidas dentro da RPC, que é onde precisam estar:
 * a policy de update é da equipe de segurança, e o autor não faz parte dela.
 */
export async function editarRelato(id: string, input: RelatoInput): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();

    const { error } = await supabase.rpc("seg_editar_relato", {
      p_id: id,
      p_data: {
        occurred_on: input.occurred_on,
        tipo_id: input.tipo_id,
        local_id: input.local_id ?? null,
        area_id: input.area_id ?? null,
        descricao: input.descricao,
        envolvidos: input.envolvidos,
      },
    });
    if (error) return { error: error.message };

    revalidar();
    return { ok: true, message: "Relato atualizado." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ============================================================================
// Triagem
// ============================================================================
//
// A alçada é verificada dentro das RPCs (`seg_exige_tratativa`), que é onde
// precisa estar para valer contra quem chame o PostgREST direto. Aqui o
// contexto é só o da sessão, e a mensagem de recusa já vem em português.

export async function triarRelato(input: {
  id: string;
  status: Enums<"seg_relato_status">;
  nota?: string;
  duplicadoDe?: string | null;
}): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("seg_triar_relato", {
      p_id: input.id,
      p_status: input.status,
      p_nota: input.nota?.trim() || null,
      p_duplicado_de: input.duplicadoDe || null,
    });
    if (error) return { error: error.message };

    revalidar();
    return { ok: true, message: "Relato atualizado." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function alertarGestor(id: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { data, error } = await supabase.rpc("seg_alertar_gestor", { p_id: id });
    if (error) return { error: error.message };

    revalidar();
    const n = data ?? 0;
    if (n === 0) {
      return { ok: true, message: "Nenhum gestor a avisar: os envolvidos não têm gestor cadastrado." };
    }
    return { ok: true, message: n === 1 ? "Gestor avisado." : `${n} gestores avisados.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Abre a ação de tratamento e a amarra ao relato.
 *
 * A ação nasce pelo mesmo `create_action` do resto do sistema, para cair na
 * tela de Ações com prazo, responsável e cobrança como qualquer outra. O que
 * este módulo acrescenta é o vínculo e o desfecho do relato, numa RPC própria
 * (`seg_vincular_acao`) que não obriga a mexer na `create_action`.
 *
 * O texto da ação NÃO cita o relator, e o responsável costuma ser o gestor do
 * envolvido: é ele quem precisa agir.
 */
export async function criarAcaoDoRelato(input: {
  relatoId: string;
  descricao: string;
  responsaveis: string[];
  prazo: string;
  prioridade: Enums<"priority_level">;
  problema: string;
  unitId?: string | null;
  departmentId?: string | null;
  subdepartmentId?: string | null;
  /** false desliga o vínculo com o Programa nesta ação específica */
  vincularPrograma?: boolean;
}): Promise<ActionState> {
  try {
    const { supabase, userId } = await actionContext();

    if (!input.descricao.trim()) return { error: "Descreva o que deve ser feito." };
    if (input.responsaveis.length === 0) return { error: "Escolha ao menos um responsável." };
    if (!input.prazo) return { error: "Informe o prazo." };

    // O vínculo com o Programa é lido do servidor, nunca da tela: o item é
    // configuração da empresa, e mandar os ids pelo navegador seria abrir a
    // porta para uma ação nascer pendurada em qualquer item.
    const programa = input.vincularPrograma === false
      ? null
      : ((await supabase.rpc("seg_item_do_programa")).data as {
          item_id: string; pilar_id: string | null; bloco_id: string;
        } | null);

    const { data, error } = await supabase.rpc("create_action", {
      p_data: {
        is_sdpo: !!programa,
        pilar_id: programa?.pilar_id ?? "",
        bloco_id: programa?.bloco_id ?? "",
        item_id: programa?.item_id ?? "",
        requester_id: userId,
        problem_statement: input.problema,
        priority: input.prioridade,
        due_date: input.prazo,
        unit_id: input.unitId ?? "",
        department_id: input.departmentId ?? "",
        subdepartment_id: input.subdepartmentId ?? "",
        cc: [],
        demandas: [{ description: input.descricao.trim(), assignees: input.responsaveis }],
      },
    });
    if (error) return { error: error.message };

    const acao = (data ?? {}) as { action_id?: string };
    if (!acao.action_id) return { error: "A ação não foi criada." };

    const vinculo = await supabase.rpc("seg_vincular_acao", {
      p_relato_id: input.relatoId,
      p_action_id: acao.action_id,
    });
    // a ação existe mesmo se o vínculo falhar; avisar é melhor que fingir sucesso
    if (vinculo.error) {
      return { ok: true, warning: `Ação criada, mas não foi possível vinculá-la ao relato: ${vinculo.error.message}` };
    }

    revalidar();
    revalidatePath("/acoes");
    return { ok: true, message: "Ação de tratamento criada e vinculada ao relato." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ============================================================================
// Acidentes
// ============================================================================
//
// Escrita e leitura são da equipe de segurança e da administração, e isso está
// na RLS. Aqui a trava é repetida em `souDaSeguranca` só para a recusa sair em
// português: um insert fora da policy volta como erro cru, e um update afeta
// zero linhas em silêncio.

const BUCKET_ACIDENTE = "seg-acidentes";

type Ctx = Awaited<ReturnType<typeof actionContext>>;

async function souDaSeguranca(ctx: Ctx): Promise<boolean> {
  if (ctx.role === "owner" || ctx.role === "admin") return true;
  const { data } = await ctx.supabase.rpc("pode_tratar_seguranca", { p_tenant: ctx.tenantId });
  return data === true;
}

export type AcidenteInput = {
  id?: string;
  userId: string;
  occurredOn: string;
  occurredAt?: string | null;
  turno?: string | null;
  classe: Enums<"seg_acidente_class">;
  unitId?: string | null;
  localId?: string | null;
  areaId?: string | null;
  descricao: string;
  testemunhas?: string | null;
  parteCorpo?: string | null;
  agenteCausador?: string | null;
  naturezaLesao?: string | null;
  analiseCausa?: string | null;
  catNumero?: string | null;
  catEmitidaEm?: string | null;
  cidCode?: string | null;
  cidDescricao?: string | null;
  diasAfastamento?: number | null;
  afastamentoDe?: string | null;
  retornoEm?: string | null;
};

/** Traduz as constraints do acidente para a linguagem de quem preenche. */
function mensagemAcidente(e: { message?: string }): string {
  const msg = e.message ?? "";
  if (msg.includes("seg_acidente_lti_tem_afastamento")) {
    return "LTI é acidente com afastamento: informe quantos dias.";
  }
  if (msg.includes("seg_acidente_afastamento_positivo")) return "Os dias de afastamento não podem ser negativos.";
  if (msg.includes("seg_acidente_descricao_nao_vazia")) return "Descreva o acidente.";
  if (msg.includes("row-level security")) return "Só a equipe de segurança pode registrar acidentes.";
  return msg || "Não foi possível salvar o acidente.";
}

export async function salvarAcidente(input: AcidenteInput): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    if (!(await souDaSeguranca(ctx))) {
      return { error: "Só a equipe de segurança pode registrar acidentes." };
    }
    if (!input.userId) return { error: "Informe quem se acidentou." };
    if (!input.occurredOn) return { error: "Informe a data do acidente." };
    if (!input.descricao.trim()) return { error: "Descreva o acidente." };

    const campos = {
      unit_id: input.unitId || null,
      occurred_on: input.occurredOn,
      occurred_at: input.occurredAt || null,
      turno: input.turno?.trim() || null,
      classe: input.classe,
      local_id: input.localId || null,
      area_id: input.areaId || null,
      descricao: input.descricao.trim(),
      testemunhas: input.testemunhas?.trim() || null,
      parte_corpo: input.parteCorpo?.trim() || null,
      agente_causador: input.agenteCausador?.trim() || null,
      natureza_lesao: input.naturezaLesao?.trim() || null,
      analise_causa: input.analiseCausa?.trim() || null,
      cat_numero: input.catNumero?.trim() || null,
      cat_emitida_em: input.catEmitidaEm || null,
      cid_code: input.cidCode || null,
      cid_descricao: input.cidDescricao || null,
      dias_afastamento: input.diasAfastamento ?? null,
      afastamento_de: input.afastamentoDe || null,
      retorno_em: input.retornoEm || null,
    };

    const { error } = input.id
      // a pessoa acidentada não muda na edição: se errou quem foi, é outro
      // registro, e o carimbo do vínculo já foi tirado
      ? await ctx.supabase.from("seg_acidentes").update(campos).eq("id", input.id)
      : await ctx.supabase.from("seg_acidentes").insert({
          ...campos,
          tenant_id: ctx.tenantId,
          user_id: input.userId,
          created_by: ctx.userId,
        });
    if (error) return { error: mensagemAcidente(error) };

    revalidar();
    return { ok: true, message: input.id ? "Acidente atualizado." : "Acidente registrado." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function encerrarAcidente(id: string, retorno?: string | null): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("seg_encerrar_acidente", {
      p_id: id, p_retorno: retorno || null,
    });
    if (error) return { error: error.message };
    revalidar();
    return { ok: true, message: "Acidente encerrado." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function reabrirAcidente(id: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("seg_reabrir_acidente", { p_id: id });
    if (error) return { error: error.message };
    revalidar();
    return { ok: true, message: "Acidente reaberto." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Sobe CAT digitalizada, laudo ou foto do local. Bucket privado. */
export async function anexarAoAcidente(formData: FormData): Promise<ActionState> {
  try {
    const id = String(formData.get("id") ?? "");
    const file = formData.get("file");
    if (!id) return { error: "Acidente inválido." };
    if (!(file instanceof File)) return { error: "Escolha um arquivo." };

    const recusa = recusaDeUpload(file, TAMANHO_ANEXO, MIMES_ANEXO);
    if (recusa) return { error: recusa };

    const ctx = await actionContext();
    if (!(await souDaSeguranca(ctx))) {
      return { error: "Só a equipe de segurança pode anexar documentos ao acidente." };
    }

    const limpo = file.name.replace(/[^\w.\- ]+/g, "_");
    const caminho = `${ctx.tenantId}/${id}/${Date.now()}-${limpo}`;

    const subida = await ctx.supabase.storage
      .from(BUCKET_ACIDENTE)
      .upload(caminho, file, { contentType: file.type || undefined, upsert: false });
    if (subida.error) return { error: subida.error.message };

    const { error } = await ctx.supabase.from("seg_acidente_anexos").insert({
      acidente_id: id,
      tenant_id: ctx.tenantId,
      path: caminho,
      filename: file.name,
      size: file.size,
      content_type: file.type || null,
      uploaded_by: ctx.userId,
    });
    if (error) {
      // compensação: sem isso o arquivo fica órfão pagando storage
      await ctx.supabase.storage.from(BUCKET_ACIDENTE).remove([caminho]);
      return { error: error.message };
    }

    revalidar();
    return { ok: true, message: "Documento anexado." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function removerAnexoAcidente(anexoId: string): Promise<ActionState> {
  try {
    const ctx = await actionContext();
    const { data: anexo } = await ctx.supabase
      .from("seg_acidente_anexos").select("path").eq("id", anexoId).maybeSingle();
    if (!anexo) return { error: "Anexo não encontrado." };

    const { error } = await ctx.supabase.from("seg_acidente_anexos").delete().eq("id", anexoId);
    if (error) return { error: error.message };

    await ctx.supabase.storage.from(BUCKET_ACIDENTE).remove([anexo.path]);
    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** URL assinada de 10 minutos: o bucket é privado e assim continua. */
export async function urlAnexoAcidente(anexoId: string): Promise<string | null> {
  const ctx = await actionContext();
  const { data: anexo } = await ctx.supabase
    .from("seg_acidente_anexos").select("path").eq("id", anexoId).maybeSingle();
  if (!anexo) return null;
  const { data } = await ctx.supabase.storage.from(BUCKET_ACIDENTE).createSignedUrl(anexo.path, 600);
  return data?.signedUrl ?? null;
}

/** O item do Programa hoje configurado, para a tela dizer a que a ação será amarrada. */
export async function getItemDoPrograma(): Promise<{
  itemId: string; item: string; bloco: string; secao: string | null; pilar: string | null;
} | null> {
  const { supabase } = await actionContext();
  const { data } = await supabase.rpc("seg_item_do_programa");
  const v = data as {
    item_id: string; item: string; bloco: string; secao: string | null; pilar: string | null;
  } | null;
  if (!v?.item_id) return null;
  return { itemId: v.item_id, item: v.item, bloco: v.bloco, secao: v.secao, pilar: v.pilar };
}

/** Define (ou limpa) o item do Programa das ações de relato. owner/admin. */
export async function setItemDoPrograma(itemId: string | null): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await adminActionContext();
    const { error } = await supabase
      .from("seg_settings")
      .upsert({ tenant_id: tenantId, relato_item_id: itemId || null }, { onConflict: "tenant_id" });
    if (error) return { error: mensagem(error) };
    revalidar();
    return { ok: true, message: itemId ? "Vínculo com o Programa salvo." : "Vínculo removido." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ============================================================================
// Equipe de segurança
// ============================================================================

/**
 * Substitui a lista inteira.
 *
 * Só entra quem tem vínculo ativo na empresa: a lista é a porta para ler todo
 * relato, inclusive o nome de quem relatou, então um id solto vindo da tela não
 * pode virar acesso.
 */
export async function setSegEquipe(input: { user_ids: string[] }): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId } = await adminActionContext();

    const { data: membros } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("is_active", true);
    const validos = new Set((membros ?? []).map((m) => m.user_id));
    const ids = [...new Set(input.user_ids.filter((id) => validos.has(id)))];

    const apagar = await supabase.from("seg_equipe").delete().eq("tenant_id", tenantId);
    if (apagar.error) return { error: mensagem(apagar.error) };

    if (ids.length) {
      const linhas = ids.map((uid) => ({ tenant_id: tenantId, user_id: uid, created_by: userId }));
      const { error } = await supabase.from("seg_equipe").insert(linhas);
      if (error) return { error: mensagem(error) };
    }

    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
