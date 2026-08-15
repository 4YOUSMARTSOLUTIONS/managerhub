"use server";

import { revalidatePath } from "next/cache";
import { actionContext, adminActionContext } from "./context";
import { wantsActive } from "@/lib/catalogGuard";
import { recusaDeUpload } from "@/lib/uploads";
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
  unit_id?: string | null;
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
        unit_id: input.unit_id ?? null,
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
