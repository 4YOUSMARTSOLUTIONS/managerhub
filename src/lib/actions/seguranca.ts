"use server";

import { revalidatePath } from "next/cache";
import { actionContext, adminActionContext } from "./context";
import { wantsActive } from "@/lib/catalogGuard";
import { MIMES_ANEXO, TAMANHO_ANEXO, recusaDeUpload } from "@/lib/uploads";
import { SEG_ICONE_BUCKET } from "@/lib/avatar";
import { hojeYmd, normalizar } from "@/lib/format";
import type { ActionState } from "./types";
import type { Enums, Json } from "@/types/database";

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
const RP_BLITZ = "/seguranca/blitz";

function revalidar() {
  revalidatePath(RP_CONFIG);
  revalidatePath(RP_RELATOS);
  revalidatePath(RP_ACIDENTES);
  revalidatePath(RP_PIRAMIDE);
  revalidatePath(RP_BLITZ);
}

/** As três tabelas de catálogo do módulo. A tela manda o nome; aqui ele é validado. */
export type CatalogoSeg =
  | "seg_tipos_relato" | "seg_locais" | "seg_areas" | "seg_causas" | "seg_ocorrencias"
  | "seg_blitz_meios" | "seg_blitz_perguntas" | "seg_blitz_motivos";

const CATALOGOS: CatalogoSeg[] = [
  "seg_tipos_relato", "seg_locais", "seg_areas", "seg_causas", "seg_ocorrencias",
  "seg_blitz_meios", "seg_blitz_perguntas", "seg_blitz_motivos",
];

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
  if (msg.includes("seg_causas_nome_unico")) return "Já existe uma causa com esse nome.";
  if (msg.includes("seg_ocorrencias_nome_unico")) return "Já existe uma ocorrência com esse nome.";
  if (msg.includes("seg_blitz_meios_nome_unico")) return "Já existe um meio de transporte com esse nome.";
  if (msg.includes("seg_blitz_perguntas_nome_unico")) return "Já existe uma pergunta com esse texto.";
  if (msg.includes("seg_blitz_motivos_nome_unico")) return "Já existe um motivo com esse nome.";
  if (msg.includes("seg_veiculos_placa_unica")) return "Já existe um veículo com essa placa nesta empresa.";
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

export type SegCausaInput = { id?: string; name: string; description?: string };

export async function saveSegCausa(input: SegCausaInput): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await adminActionContext();
    const name = input.name.trim();
    if (!name) return { error: "Informe o nome da causa." };

    const campos = { tenant_id: tenantId, name, description: input.description?.trim() || null };

    const { error } = input.id
      ? await supabase.from("seg_causas").update(campos).eq("id", input.id)
      : await supabase.from("seg_causas").insert(campos);
    if (error) return { error: mensagem(error) };

    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type SegOcorrenciaInput = {
  id?: string;
  name: string;
  description?: string;
  /** listas vazias = vale para todos, que é o que evita cadastro braçal */
  tipoIds: string[];
  localIds: string[];
  areaIds: string[];
};

export async function saveSegOcorrencia(input: SegOcorrenciaInput): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await adminActionContext();
    const name = input.name.trim();
    if (!name) return { error: "Informe o nome da ocorrência." };

    const campos = { tenant_id: tenantId, name, description: input.description?.trim() || null };

    let id = input.id;
    if (id) {
      const { error } = await supabase.from("seg_ocorrencias").update(campos).eq("id", id);
      if (error) return { error: mensagem(error) };
    } else {
      const { data, error } = await supabase.from("seg_ocorrencias").insert(campos).select("id").single();
      if (error) return { error: mensagem(error) };
      id = data.id;
    }

    const erro = await gravarVinculosOcorrencia(supabase, tenantId, id, input);
    if (erro) return { error: erro };

    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Substitui os vínculos por inteiro.
 *
 * Apagar e reinserir é o padrão da casa para lista pequena (o mesmo de
 * `setTicketManagerSectors`): mais simples que calcular o diff e sem o risco de
 * deixar sobra quando a tela manda menos do que existia.
 */
async function gravarVinculosOcorrencia(
  supabase: Awaited<ReturnType<typeof adminActionContext>>["supabase"],
  tenantId: string,
  ocorrenciaId: string,
  input: { tipoIds: string[]; localIds: string[]; areaIds: string[] },
): Promise<string | null> {
  await supabase.from("seg_ocorrencia_tipos").delete().eq("ocorrencia_id", ocorrenciaId);
  await supabase.from("seg_ocorrencia_locais").delete().eq("ocorrencia_id", ocorrenciaId);
  await supabase.from("seg_ocorrencia_areas").delete().eq("ocorrencia_id", ocorrenciaId);

  if (input.tipoIds.length) {
    const { error } = await supabase.from("seg_ocorrencia_tipos")
      .insert(input.tipoIds.map((tipo_id) => ({ tenant_id: tenantId, ocorrencia_id: ocorrenciaId, tipo_id })));
    if (error) return mensagem(error);
  }
  if (input.localIds.length) {
    const { error } = await supabase.from("seg_ocorrencia_locais")
      .insert(input.localIds.map((local_id) => ({ tenant_id: tenantId, ocorrencia_id: ocorrenciaId, local_id })));
    if (error) return mensagem(error);
  }
  if (input.areaIds.length) {
    const { error } = await supabase.from("seg_ocorrencia_areas")
      .insert(input.areaIds.map((area_id) => ({ tenant_id: tenantId, ocorrencia_id: ocorrenciaId, area_id })));
    if (error) return mensagem(error);
  }
  return null;
}

/** Restringe um LOCAL a certas classificações. Lista vazia = aparece em todas. */
export async function setLocalTipos(localId: string, tipoIds: string[]): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await adminActionContext();
    await supabase.from("seg_local_tipos").delete().eq("local_id", localId);
    if (tipoIds.length) {
      const { error } = await supabase.from("seg_local_tipos")
        .insert(tipoIds.map((tipo_id) => ({ tenant_id: tenantId, local_id: localId, tipo_id })));
      if (error) return { error: mensagem(error) };
    }
    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Restringe uma ÁREA a certas classificações. Lista vazia = aparece em todas. */
export async function setAreaTipos(areaId: string, tipoIds: string[]): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await adminActionContext();
    await supabase.from("seg_area_tipos").delete().eq("area_id", areaId);
    if (tipoIds.length) {
      const { error } = await supabase.from("seg_area_tipos")
        .insert(tipoIds.map((tipo_id) => ({ tenant_id: tenantId, area_id: areaId, tipo_id })));
      if (error) return { error: mensagem(error) };
    }
    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type LinhaImportOcorrencia = {
  nome: string;
  classificacoes?: string;
  locais?: string;
  areas?: string;
  descricao?: string;
};

/**
 * Importa ocorrências de uma planilha.
 *
 * Vínculo casa por NOME, e é o único jeito viável numa planilha: quem digita
 * não tem os ids. O que não casar não vira cadastro novo em silêncio, vira
 * aviso: catálogo criado por engano de digitação é pior que catálogo faltando.
 */
export async function importarOcorrencias(
  linhas: LinhaImportOcorrencia[],
): Promise<ActionState & { criadas?: number; atualizadas?: number; avisos?: string[] }> {
  try {
    const { supabase, tenantId } = await adminActionContext();

    const [{ data: tipos }, { data: locais }, { data: areas }, { data: existentes }] = await Promise.all([
      supabase.from("seg_tipos_relato").select("id, name").eq("tenant_id", tenantId),
      supabase.from("seg_locais").select("id, name").eq("tenant_id", tenantId),
      supabase.from("seg_areas").select("id, name").eq("tenant_id", tenantId),
      supabase.from("seg_ocorrencias").select("id, name").eq("tenant_id", tenantId),
    ]);

    const porNome = (linha: { id: string; name: string }[] | null) =>
      new Map((linha ?? []).map((x) => [normalizar(x.name), x.id]));
    const mapaTipo = porNome(tipos);
    const mapaLocal = porNome(locais);
    const mapaArea = porNome(areas);
    const mapaOcorrencia = porNome(existentes);

    const avisos: string[] = [];
    let criadas = 0;
    let atualizadas = 0;

    const separar = (valor: string | undefined) =>
      (valor ?? "").split(/[;,\n]/).map((s) => s.trim()).filter(Boolean);

    const resolver = (nomes: string[], mapa: Map<string, string>, rotulo: string, linha: number) =>
      nomes.flatMap((n) => {
        const id = mapa.get(normalizar(n));
        if (!id) { avisos.push(`Linha ${linha}: ${rotulo} "${n}" não existe no cadastro e foi ignorado.`); return []; }
        return [id];
      });

    for (const [i, l] of linhas.entries()) {
      const nome = (l.nome ?? "").trim();
      if (!nome) continue;
      const numero = i + 2; // a planilha tem cabeçalho na linha 1

      const tipoIds  = resolver(separar(l.classificacoes), mapaTipo, "classificação", numero);
      const localIds = resolver(separar(l.locais), mapaLocal, "local", numero);
      const areaIds  = resolver(separar(l.areas), mapaArea, "área", numero);

      const existente = mapaOcorrencia.get(normalizar(nome));
      const r = await saveSegOcorrencia({
        id: existente, name: nome, description: l.descricao,
        tipoIds, localIds, areaIds,
      });
      if (r.error) { avisos.push(`Linha ${numero}: ${r.error}`); continue; }
      if (existente) atualizadas++;
      else criadas++;
    }

    revalidar();
    return {
      ok: true, criadas, atualizadas, avisos,
      message: `${criadas} ocorrência(s) criada(s) e ${atualizadas} atualizada(s).`,
    };
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
  } else if (tabela === "seg_causas") {
    await supabase.from("seg_causas").update({ active }).eq("id", id);
  } else if (tabela === "seg_ocorrencias") {
    await supabase.from("seg_ocorrencias").update({ active }).eq("id", id);
  } else if (tabela === "seg_blitz_meios") {
    await supabase.from("seg_blitz_meios").update({ active }).eq("id", id);
  } else if (tabela === "seg_blitz_perguntas") {
    await supabase.from("seg_blitz_perguntas").update({ active }).eq("id", id);
  } else if (tabela === "seg_blitz_motivos") {
    await supabase.from("seg_blitz_motivos").update({ active }).eq("id", id);
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
        : tabela === "seg_causas"
          ? await supabase.from("seg_causas").delete().eq("id", id)
          : tabela === "seg_ocorrencias"
            ? await supabase.from("seg_ocorrencias").delete().eq("id", id)
            : tabela === "seg_blitz_meios"
              ? await supabase.from("seg_blitz_meios").delete().eq("id", id)
              : tabela === "seg_blitz_perguntas"
                ? await supabase.from("seg_blitz_perguntas").delete().eq("id", id)
                : tabela === "seg_blitz_motivos"
                  ? await supabase.from("seg_blitz_motivos").delete().eq("id", id)
                  : await supabase.from("seg_areas").delete().eq("id", id);

  if (apagou.error) {
    if (tabela === "seg_tipos_relato") {
      await supabase.from("seg_tipos_relato").update({ active: false }).eq("id", id);
    } else if (tabela === "seg_locais") {
      await supabase.from("seg_locais").update({ active: false }).eq("id", id);
    } else if (tabela === "seg_causas") {
      await supabase.from("seg_causas").update({ active: false }).eq("id", id);
    } else if (tabela === "seg_ocorrencias") {
      await supabase.from("seg_ocorrencias").update({ active: false }).eq("id", id);
    } else if (tabela === "seg_blitz_meios") {
      await supabase.from("seg_blitz_meios").update({ active: false }).eq("id", id);
    } else if (tabela === "seg_blitz_perguntas") {
      await supabase.from("seg_blitz_perguntas").update({ active: false }).eq("id", id);
    } else if (tabela === "seg_blitz_motivos") {
      await supabase.from("seg_blitz_motivos").update({ active: false }).eq("id", id);
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
  // causa, pergunta e motivo não têm figura: são vocabulário, não botão
  if (tabela === "seg_causas" || tabela === "seg_blitz_perguntas" || tabela === "seg_blitz_motivos") return null;
  const q =
    tabela === "seg_tipos_relato"
      ? await supabase.from("seg_tipos_relato").select("image_path").eq("id", id).maybeSingle()
      : tabela === "seg_locais"
        ? await supabase.from("seg_locais").select("image_path").eq("id", id).maybeSingle()
        : tabela === "seg_ocorrencias"
          ? await supabase.from("seg_ocorrencias").select("image_path").eq("id", id).maybeSingle()
          : tabela === "seg_blitz_meios"
            ? await supabase.from("seg_blitz_meios").select("image_path").eq("id", id).maybeSingle()
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
  if (tabela === "seg_causas" || tabela === "seg_blitz_perguntas" || tabela === "seg_blitz_motivos") {
    return { error: { message: "Este cadastro não tem figura." } };
  }
  if (tabela === "seg_blitz_meios") {
    return supabase.from("seg_blitz_meios").update({ image_path: path }).eq("id", id);
  }
  if (tabela === "seg_ocorrencias") {
    return supabase.from("seg_ocorrencias").update({ image_path: path }).eq("id", id);
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
  ocorrencia_id?: string | null;
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
        ocorrencia_id: input.ocorrencia_id ?? null,
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
        ocorrencia_id: input.ocorrencia_id ?? null,
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
  causaId?: string | null;
}): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("seg_triar_relato", {
      p_id: input.id,
      p_status: input.status,
      p_nota: input.nota?.trim() || null,
      p_duplicado_de: input.duplicadoDe || null,
      p_causa_id: input.causaId || null,
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
 * O que a tela de segurança decide ao abrir uma ação.
 *
 * `demandas` no plural porque o mesmo caso costuma exigir mais de uma
 * providência, e elas são o MESMO caso: uma ação por providência espalharia
 * códigos sem nada dizendo que vieram do mesmo fato.
 */
export type AcaoDeSegurancaInput = {
  demandas: { descricao: string; responsaveis: string[] }[];
  prazo: string;
  prioridade: Enums<"priority_level">;
  problema: string;
  /** quem pede; a tela manda o usuário atual como padrão */
  solicitante?: string | null;
  cc?: string[];
  unitId?: string | null;
  departmentId?: string | null;
  subdepartmentId?: string | null;
  /** false desliga o vínculo com o Programa nesta ação específica */
  vincularPrograma?: boolean;
};

/**
 * Valida o que as duas actions validam igual e monta o payload da
 * `create_action`. Sem isso, relato e acidente sairiam do sincronismo na
 * primeira mudança.
 */
function payloadDaAcao(
  input: AcaoDeSegurancaInput,
  userId: string,
  programa: { item_id: string; pilar_id: string | null; bloco_id: string } | null,
): { erro: string } | { p_data: Json } {
  const demandas = input.demandas
    .map((d) => ({ description: d.descricao.trim(), assignees: d.responsaveis }))
    .filter((d) => d.description);

  if (demandas.length === 0) return { erro: "Descreva o que deve ser feito." };
  if (demandas.some((d) => d.assignees.length === 0)) {
    return { erro: "Cada providência precisa de ao menos um responsável." };
  }
  if (!input.prazo) return { erro: "Informe o prazo." };

  return {
    p_data: {
      is_sdpo: !!programa,
      pilar_id: programa?.pilar_id ?? "",
      bloco_id: programa?.bloco_id ?? "",
      item_id: programa?.item_id ?? "",
      requester_id: input.solicitante || userId,
      problem_statement: input.problema,
      priority: input.prioridade,
      due_date: input.prazo,
      unit_id: input.unitId ?? "",
      department_id: input.departmentId ?? "",
      subdepartment_id: input.subdepartmentId ?? "",
      cc: input.cc ?? [],
      demandas,
    },
  };
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
export async function criarAcaoDoRelato(
  input: AcaoDeSegurancaInput & { relatoId: string },
): Promise<ActionState> {
  try {
    const { supabase, userId } = await actionContext();

    // O vínculo com o Programa é lido do servidor, nunca da tela: o item é
    // configuração da empresa, e mandar os ids pelo navegador seria abrir a
    // porta para uma ação nascer pendurada em qualquer item.
    const programa = input.vincularPrograma === false
      ? null
      : ((await supabase.rpc("seg_item_do_programa")).data as {
          item_id: string; pilar_id: string | null; bloco_id: string;
        } | null);

    const montado = payloadDaAcao(input, userId, programa);
    if ("erro" in montado) return { error: montado.erro };

    const { data, error } = await supabase.rpc("create_action", { p_data: montado.p_data });
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
  tipo: Enums<"seg_acidente_tipo">;
  unitId?: string | null;
  localId?: string | null;
  areaId?: string | null;
  descricao: string;
  testemunhas?: string | null;
  parteCorpo?: string | null;
  agenteCausador?: string | null;
  naturezaLesao?: string | null;
  analiseCausa?: string | null;
  causaId?: string | null;
  catNumero?: string | null;
  catEmitidaEm?: string | null;
  cidCode?: string | null;
  cidDescricao?: string | null;
  diasAfastamento?: number | null;
  afastamentoDe?: string | null;
  retornoEm?: string | null;
  houvePerdas?: boolean;
  perdasDescricao?: string | null;
  /** opcional de propósito: no dia do acidente quase nunca se sabe quanto custou */
  perdasValor?: number | null;
};

/** Traduz as constraints do acidente para a linguagem de quem preenche. */
function mensagemAcidente(e: { message?: string }): string {
  const msg = e.message ?? "";
  if (msg.includes("seg_acidente_lti_tem_afastamento")) {
    return "LTI é acidente com afastamento: informe quantos dias.";
  }
  if (msg.includes("seg_acidente_afastamento_positivo")) return "Os dias de afastamento não podem ser negativos.";
  if (msg.includes("seg_acidente_perdas_coerentes")) {
    return "Descreva o que foi perdido ou danificado.";
  }
  if (msg.includes("seg_acidente_perdas_valor_positivo")) return "O valor das perdas não pode ser negativo.";
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
    // retroativo é a regra (a CAT sai depois), futuro é sempre erro de digitação
    if (input.occurredOn > hojeYmd()) {
      return { error: "A data do acidente não pode estar no futuro." };
    }
    if (input.catEmitidaEm && input.catEmitidaEm > hojeYmd()) {
      return { error: "A data de emissão da CAT não pode estar no futuro." };
    }
    if (!input.descricao.trim()) return { error: "Descreva o acidente." };
    if (input.houvePerdas && !input.perdasDescricao?.trim()) {
      return { error: "Descreva o que foi perdido ou danificado." };
    }
    if ((input.perdasValor ?? 0) < 0) return { error: "O valor das perdas não pode ser negativo." };

    const campos = {
      unit_id: input.unitId || null,
      occurred_on: input.occurredOn,
      occurred_at: input.occurredAt || null,
      turno: input.turno?.trim() || null,
      classe: input.classe,
      tipo: input.tipo,
      local_id: input.localId || null,
      area_id: input.areaId || null,
      descricao: input.descricao.trim(),
      testemunhas: input.testemunhas?.trim() || null,
      parte_corpo: input.parteCorpo?.trim() || null,
      agente_causador: input.agenteCausador?.trim() || null,
      natureza_lesao: input.naturezaLesao?.trim() || null,
      analise_causa: input.analiseCausa?.trim() || null,
      causa_id: input.causaId || null,
      cat_numero: input.catNumero?.trim() || null,
      cat_emitida_em: input.catEmitidaEm || null,
      cid_code: input.cidCode || null,
      cid_descricao: input.cidDescricao || null,
      dias_afastamento: input.diasAfastamento ?? null,
      afastamento_de: input.afastamentoDe || null,
      retorno_em: input.retornoEm || null,
      // sem a marca, descrição e valor voltam a nulo: o banco recusa dado de
      // perda pendurado num acidente que diz não ter tido perda
      houve_perdas: !!input.houvePerdas,
      perdas_descricao: input.houvePerdas ? (input.perdasDescricao?.trim() || null) : null,
      perdas_valor: input.houvePerdas ? (input.perdasValor ?? null) : null,
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

/**
 * As URLs das FOTOS de um acidente, de uma vez.
 *
 * A `urlAnexoAcidente` assina um arquivo por chamada, o que serve para abrir um
 * documento no clique. Miniatura é outro caso: a galeria precisa de todas as
 * imagens já ao abrir a ficha, e uma ida por foto deixaria a tela piscando.
 * `createSignedUrls` assina o lote inteiro numa chamada.
 */
export async function urlsDasFotosDoAcidente(
  acidenteId: string,
): Promise<{ id: string; url: string }[]> {
  const ctx = await actionContext();
  const { data: anexos } = await ctx.supabase
    .from("seg_acidente_anexos")
    .select("id, path, content_type")
    .eq("acidente_id", acidenteId);

  const fotos = (anexos ?? []).filter((a) => (a.content_type ?? "").startsWith("image/"));
  if (fotos.length === 0) return [];

  const { data } = await ctx.supabase.storage
    .from(BUCKET_ACIDENTE)
    .createSignedUrls(fotos.map((f) => f.path), 600);

  return (data ?? [])
    .map((assinada, i) => ({ id: fotos[i].id, url: assinada.signedUrl ?? "" }))
    .filter((x) => x.url);
}

/** Relato e acidente se amarram a itens vizinhos do Programa: 1.2 e 1.1. */
export type AlvoDoPrograma = "relato" | "acidente";

/** O item do Programa hoje configurado, para a tela dizer a que a ação será amarrada. */
export async function getItemDoPrograma(para: AlvoDoPrograma = "relato"): Promise<{
  itemId: string; item: string; bloco: string; secao: string | null; pilar: string | null;
} | null> {
  const { supabase } = await actionContext();
  const { data } = await supabase.rpc("seg_item_do_programa", { p_para: para });
  const v = data as {
    item_id: string; item: string; bloco: string; secao: string | null; pilar: string | null;
  } | null;
  if (!v?.item_id) return null;
  return { itemId: v.item_id, item: v.item, bloco: v.bloco, secao: v.secao, pilar: v.pilar };
}

/** Define (ou limpa) o item do Programa das ações de relato. owner/admin. */
export async function setItemDoPrograma(
  itemId: string | null,
  para: AlvoDoPrograma = "relato",
): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await adminActionContext();
    // duas chamadas literais em vez de uma com chave computada: o tipo do
    // upsert recusa tanto `[coluna]` quanto a união dos dois objetos, e
    // perder a checagem aqui é perder a única rede que impede gravar item
    // do Programa na coluna errada
    const { error } = para === "acidente"
      ? await supabase.from("seg_settings")
          .upsert({ tenant_id: tenantId, acidente_item_id: itemId || null }, { onConflict: "tenant_id" })
      : await supabase.from("seg_settings")
          .upsert({ tenant_id: tenantId, relato_item_id: itemId || null }, { onConflict: "tenant_id" });
    if (error) return { error: mensagem(error) };
    revalidar();
    return { ok: true, message: itemId ? "Vínculo com o Programa salvo." : "Vínculo removido." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Abre a ação de tratamento do acidente e a amarra ao caso.
 *
 * Mesmo caminho do relato: a ação nasce pelo `create_action` do resto do
 * sistema e cai em /acoes com prazo e cobrança. A diferença é o item do
 * Programa (1.1, investigação de acidentes) e o fato de que concluir a ação
 * NÃO encerra o acidente: encerrar é sobre o retorno ao trabalho, e a ação
 * corretiva pode levar meses.
 */
export async function criarAcaoDoAcidente(
  input: AcaoDeSegurancaInput & { acidenteId: string },
): Promise<ActionState> {
  try {
    const { supabase, userId } = await actionContext();

    // o item vem do servidor, nunca da tela: mandar os ids pelo navegador
    // abriria a porta para a ação nascer pendurada em qualquer item
    const programa = input.vincularPrograma === false
      ? null
      : ((await supabase.rpc("seg_item_do_programa", { p_para: "acidente" })).data as {
          item_id: string; pilar_id: string | null; bloco_id: string;
        } | null);

    const montado = payloadDaAcao(input, userId, programa);
    if ("erro" in montado) return { error: montado.erro };

    const { data, error } = await supabase.rpc("create_action", { p_data: montado.p_data });
    if (error) return { error: error.message };

    const acao = (data ?? {}) as { action_id?: string };
    if (!acao.action_id) return { error: "A ação não foi criada." };

    const vinculo = await supabase.rpc("seg_vincular_acao_acidente", {
      p_acidente_id: input.acidenteId,
      p_action_id: acao.action_id,
    });
    // a ação existe mesmo se o vínculo falhar; avisar é melhor que fingir sucesso
    if (vinculo.error) {
      return { ok: true, warning: `Ação criada, mas não foi possível vinculá-la ao acidente: ${vinculo.error.message}` };
    }

    revalidar();
    revalidatePath("/acoes");
    return { ok: true, message: "Ação de tratamento criada e vinculada ao acidente." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ============================================================================
// Blitz de trajeto: catálogos e veículos
// ============================================================================

export type BlitzMeioInput = { id?: string; name: string; tem_veiculo: boolean };

export async function saveBlitzMeio(input: BlitzMeioInput): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await adminActionContext();
    const name = input.name.trim();
    if (!name) return { error: "Informe o nome do meio de transporte." };

    const { error } = input.id
      ? await supabase.from("seg_blitz_meios").update({ name, tem_veiculo: input.tem_veiculo }).eq("id", input.id)
      : await supabase.from("seg_blitz_meios").insert({ tenant_id: tenantId, name, tem_veiculo: input.tem_veiculo });
    if (error) return { error: mensagem(error) };

    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type BlitzPerguntaInput = {
  id?: string;
  name: string;
  /** vazio = a pergunta vale para todo meio (regra da cascata) */
  meioIds: string[];
};

export async function saveBlitzPergunta(input: BlitzPerguntaInput): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await adminActionContext();
    const name = input.name.trim();
    if (!name) return { error: "Escreva a pergunta." };

    let id = input.id;
    if (id) {
      const { error } = await supabase.from("seg_blitz_perguntas").update({ name }).eq("id", id);
      if (error) return { error: mensagem(error) };
    } else {
      const { data, error } = await supabase
        .from("seg_blitz_perguntas")
        .insert({ tenant_id: tenantId, name })
        .select("id")
        .single();
      if (error) return { error: mensagem(error) };
      id = data.id;
    }

    // vínculos por substituição total, como nas ocorrências: o estado da tela
    // é a verdade, e diff aqui só criaria bugs de borda
    const del = await supabase.from("seg_blitz_pergunta_meios").delete().eq("pergunta_id", id);
    if (del.error) return { error: mensagem(del.error) };
    if (input.meioIds.length) {
      const { error } = await supabase.from("seg_blitz_pergunta_meios").insert(
        input.meioIds.map((meioId) => ({ tenant_id: tenantId, pergunta_id: id as string, meio_id: meioId })),
      );
      if (error) return { error: mensagem(error) };
    }

    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function saveBlitzMotivo(input: { id?: string; name: string }): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await adminActionContext();
    const name = input.name.trim();
    if (!name) return { error: "Informe o motivo." };

    const { error } = input.id
      ? await supabase.from("seg_blitz_motivos").update({ name }).eq("id", input.id)
      : await supabase.from("seg_blitz_motivos").insert({ tenant_id: tenantId, name });
    if (error) return { error: mensagem(error) };

    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type VeiculoInput = {
  id?: string;
  userId: string;
  meioId?: string | null;
  placa: string;
  tipoDescricao?: string | null;
  propriedade: Enums<"seg_veiculo_propriedade">;
};

/**
 * Cadastro de veículo pela tela de Configurações. A RLS já limita a quem pode
 * avaliar blitz; a placa é normalizada por trigger no banco (maiúscula, sem
 * separador), então "abc-1d23" e "ABC1D23" caem na mesma linha.
 */
export async function salvarVeiculo(input: VeiculoInput): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await actionContext();
    if (!input.userId) return { error: "Informe o colaborador." };
    if (!input.placa.trim()) return { error: "Informe a placa." };

    const campos = {
      meio_id: input.meioId || null,
      placa: input.placa,
      tipo_descricao: input.tipoDescricao?.trim() || null,
      propriedade: input.propriedade,
    };
    const { error } = input.id
      ? await supabase.from("seg_veiculos").update(campos).eq("id", input.id)
      : await supabase.from("seg_veiculos").insert({ ...campos, tenant_id: tenantId, user_id: input.userId });
    if (error) return { error: mensagem(error) };

    revalidar();
    return { ok: true, message: "Veículo salvo." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setVeiculoAtivo(id: string, active: boolean): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.from("seg_veiculos").update({ active }).eq("id", id);
    if (error) return { error: mensagem(error) };
    revalidar();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type BlitzInput = {
  userId: string;
  occurredOn: string;
  meioId: string;
  placa?: string | null;
  veiculoTipo?: string | null;
  propriedade?: Enums<"seg_veiculo_propriedade"> | null;
  liberado: boolean;
  motivoBloqueioId?: string | null;
  observacao?: string | null;
  respostas: { perguntaId: string; resposta: Enums<"seg_blitz_resposta"> }[];
};

/**
 * Lança a blitz. Tudo acontece na RPC, numa transação só: validação, cálculo
 * do conforme, carimbo das respostas e o upsert do veículo (que é o "lembrar
 * da última blitz"). Aqui só passa o payload e traduz o retorno.
 */
export async function criarBlitz(input: BlitzInput): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("seg_criar_blitz", {
      p_data: {
        user_id: input.userId,
        occurred_on: input.occurredOn,
        meio_id: input.meioId,
        placa: input.placa ?? null,
        veiculo_tipo: input.veiculoTipo ?? null,
        propriedade: input.propriedade ?? null,
        liberado: input.liberado,
        motivo_bloqueio_id: input.motivoBloqueioId ?? null,
        observacao: input.observacao ?? null,
        respostas: input.respostas.map((r) => ({ pergunta_id: r.perguntaId, resposta: r.resposta })),
      },
    });
    if (error) return { error: error.message };

    revalidar();
    return { ok: true, message: "Blitz registrada." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function excluirBlitz(id: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("seg_excluir_blitz", { p_id: id });
    if (error) return { error: error.message };
    revalidar();
    return { ok: true, message: "Blitz excluída." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type BlitzAlerta = {
  id: string;
  enviado_em: string;
  colaborador: string | null;
  occurred_on: string;
  meio: string | null;
  liberado: boolean;
  motivo: string | null;
  observacao: string | null;
  respostas_nao: string[];
  tratativa_em: string | null;
  tratativa_resumo: string | null;
  tratativa_acordo: string | null;
};

/** Os alertas de blitz do gestor logado, projetados coluna a coluna pela RPC. */
export async function getBlitzAlertas(): Promise<BlitzAlerta[]> {
  try {
    const { supabase } = await actionContext();
    const { data, error } = await supabase.rpc("seg_blitz_meus_alertas");
    if (error || !data) return [];
    return data as BlitzAlerta[];
  } catch {
    return [];
  }
}

export async function registrarTratativaBlitz(input: {
  alertaId: string;
  em: string;
  resumo: string;
  acordo?: string | null;
}): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("seg_blitz_registrar_tratativa", {
      p_alerta: input.alertaId,
      p_em: input.em,
      p_resumo: input.resumo,
      p_acordo: input.acordo || null,
    });
    if (error) return { error: error.message };
    revalidar();
    return { ok: true, message: "Tratativa registrada." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ============================================================================
// Exclusão (proprietário)
// ============================================================================
//
// A alçada mora na RPC. Aqui a única coisa que muda é a mensagem que a pessoa
// lê quando não pode.

export async function excluirRelato(id: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("seg_excluir_relato", { p_id: id });
    if (error) return { error: error.message };

    revalidar();
    return { ok: true, message: "Relato excluído." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** O motivo é obrigatório: ele viaja para o `audit_logs` junto com a linha apagada. */
export async function excluirAcidente(id: string, motivo: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("seg_excluir_acidente", {
      p_id: id,
      p_motivo: motivo.trim(),
    });
    if (error) return { error: error.message };

    revalidar();
    return { ok: true, message: "Acidente excluído." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ============================================================================
// Alerta ao gestor e a conversa dele
// ============================================================================

export type AlertaDoGestor = {
  id: string;
  enviado_em: string;
  envolvido_nome: string | null;
  occurred_on: string;
  tipo: string | null;
  ocorrencia: string | null;
  local: string | null;
  area: string | null;
  descricao: string;
  status: Enums<"seg_relato_status">;
  abordagem_em: string | null;
  abordagem_resumo: string | null;
  abordagem_acordo: string | null;
};

/** Os alertas recebidos por quem está pedindo. Nunca traz o relator. */
export async function getMeusAlertas(): Promise<AlertaDoGestor[]> {
  try {
    const { supabase } = await actionContext();
    const { data, error } = await supabase.rpc("seg_meus_alertas");
    if (error || !data) return [];
    return data as AlertaDoGestor[];
  } catch {
    return [];
  }
}

export async function registrarAbordagem(input: {
  alertaId: string;
  em: string;
  resumo: string;
  acordo?: string | null;
}): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("seg_registrar_abordagem", {
      p_alerta: input.alertaId,
      p_em: input.em,
      p_resumo: input.resumo,
      p_acordo: input.acordo || null,
    });
    if (error) return { error: error.message };

    revalidar();
    return { ok: true, message: "Conversa registrada." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Alertas enviados no ano e quantos viraram conversa. Vazio para quem não trata. */
export async function getAlertasResumo(ano: number): Promise<{
  enviados: number; comConversa: number; visivel: boolean;
}> {
  const vazio = { enviados: 0, comConversa: 0, visivel: false };
  try {
    const { supabase } = await actionContext();
    const { data, error } = await supabase.rpc("seg_alertas_resumo", { p_ano: ano });
    if (error || !data) return vazio;
    const v = data as { enviados: number; com_conversa: number; visivel: boolean };
    return { enviados: v.enviados ?? 0, comConversa: v.com_conversa ?? 0, visivel: !!v.visivel };
  } catch {
    return vazio;
  }
}

// ============================================================================
// Foco da área
// ============================================================================
//
// A alçada mora na RPC (`seg_exige_tratativa`), como no resto do módulo. Aqui
// só passa o que a tela mandou e devolve a mensagem pronta.

export type FocoInput = {
  id?: string | null;
  areaId: string;
  causaId?: string | null;
  titulo: string;
  orientacao?: string | null;
  inicio: string;
  fim: string;
};

export type FocoVigente = {
  id: string;
  area_id: string;
  area_nome: string;
  causa_id: string | null;
  causa_nome: string | null;
  titulo: string;
  orientacao: string | null;
  inicio: string;
  fim: string;
  relatos: number;
  na_causa: number;
  na_causa_antes: number;
};

export type FocoSugestao = {
  area_id: string;
  area_nome: string;
  causa_id: string;
  causa_nome: string;
  qtd: number;
  total: number;
};

export type FocosStatus = {
  podeDefinir: boolean;
  dias: number;
  vigentes: FocoVigente[];
  sugestoes: FocoSugestao[];
};

export async function getFocosStatus(dias = 90): Promise<FocosStatus> {
  const vazio: FocosStatus = { podeDefinir: false, dias, vigentes: [], sugestoes: [] };
  try {
    const { supabase } = await actionContext();
    const { data, error } = await supabase.rpc("seg_focos_status", { p_dias: dias });
    if (error || !data) return vazio;
    const v = data as {
      pode_definir: boolean; dias: number; vigentes: FocoVigente[]; sugestoes: FocoSugestao[];
    };
    return {
      podeDefinir: !!v.pode_definir,
      dias: v.dias ?? dias,
      vigentes: v.vigentes ?? [],
      sugestoes: v.sugestoes ?? [],
    };
  } catch {
    return vazio;
  }
}

export async function salvarFoco(input: FocoInput): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("seg_salvar_foco", {
      p_data: {
        id: input.id || null,
        area_id: input.areaId,
        causa_id: input.causaId || null,
        titulo: input.titulo,
        orientacao: input.orientacao ?? null,
        inicio: input.inicio,
        fim: input.fim,
      },
    });
    if (error) return { error: error.message };

    revalidar();
    return { ok: true, message: input.id ? "Foco atualizado." : "Foco definido." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function excluirFoco(id: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("seg_excluir_foco", { p_id: id });
    if (error) return { error: error.message };

    revalidar();
    return { ok: true, message: "Foco removido." };
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
