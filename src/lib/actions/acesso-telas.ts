"use server";

import { revalidatePath } from "next/cache";
import { actionContext, adminActionContext } from "./context";
import type { ActionState } from "./types";
import { opcoesDeTelas, telasValidas, type GrupoDeTelas } from "@/lib/acesso-telas";
import { isentoDoAcesso, lerRegrasDeAcesso } from "@/lib/acesso-telas-servidor";

/**
 * Acesso às telas. Conceder acesso é da administração: só proprietário e
 * administrador gravam (a RPC recusa qualquer outro, aqui é a primeira porta).
 */

const msg = (e: unknown) => (e instanceof Error ? e.message : "Não foi possível salvar.");

/** `telas: null` = o nível volta a ver todas as telas contratadas. */
export async function definirTelasDoNivel(input: { nivelId: string; telas: string[] | null }): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await adminActionContext();
    const telas = input.telas === null ? null : telasValidas(input.telas);
    if (telas && telas.length === 0) return { error: "Escolha ao menos uma tela." };
    const { error } = await supabase.rpc("acesso_telas_definir_nivel", {
      p_tenant: tenantId, p_nivel: input.nivelId, p_modulos: telas,
    });
    if (error) return { error: error.message };
    revalidatePath("/configuracoes");
    return { ok: true, message: telas ? "Telas do nível salvas." : "O nível volta a ver todas as telas contratadas." };
  } catch (e) {
    return { error: msg(e) };
  }
}

/** "nivel" apaga a exceção; "livre" libera todas as contratadas; "lista" só as escolhidas. */
export async function definirTelasDaPessoa(input: {
  userId: string;
  modo: "nivel" | "livre" | "lista";
  telas: string[];
}): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await adminActionContext();
    const telas = input.modo === "lista" ? telasValidas(input.telas) : null;
    if (telas && telas.length === 0) return { error: "Escolha ao menos uma tela." };
    const { error } = await supabase.rpc("acesso_telas_definir_pessoa", {
      p_tenant: tenantId, p_user: input.userId, p_modo: input.modo, p_modulos: telas,
    });
    if (error) return { error: error.message };
    revalidatePath("/configuracoes");
    const recado = { nivel: "A pessoa volta a seguir a regra do nível.", livre: "Exceção salva: todas as telas contratadas.", lista: "Exceção salva." };
    return { ok: true, message: recado[input.modo] };
  } catch (e) {
    return { error: msg(e) };
  }
}

const tempoValido = (m: number | null) => m === null || (Number.isInteger(m) && m >= 5 && m <= 1440);

/** Padrão da empresa para encerrar a sessão sem uso (null = sem limite). */
export async function definirTempoPadrao(minutos: number | null): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await adminActionContext();
    if (!tempoValido(minutos)) return { error: "Escolha entre 5 minutos e 24 horas." };
    const { error } = await supabase.rpc("sessao_definir_padrao", { p_tenant: tenantId, p_minutos: minutos });
    if (error) return { error: error.message };
    revalidatePath("/configuracoes");
    return { ok: true, message: "Padrão da empresa salvo." };
  } catch (e) {
    return { error: msg(e) };
  }
}

/** Tempo de um nível (null = volta ao padrão da empresa). */
export async function definirTempoDoNivel(nivelId: string, minutos: number | null): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await adminActionContext();
    if (!tempoValido(minutos)) return { error: "Escolha entre 5 minutos e 24 horas." };
    const { error } = await supabase.rpc("sessao_definir_nivel", { p_tenant: tenantId, p_nivel: nivelId, p_minutos: minutos });
    if (error) return { error: error.message };
    revalidatePath("/configuracoes");
    return { ok: true, message: minutos === null ? "O nível volta ao padrão da empresa." : "Tempo do nível salvo." };
  } catch (e) {
    return { error: msg(e) };
  }
}

export type AcessoDaPessoa = {
  /** "Proprietário" / "Administrador" / "RH": vê tudo, a regra não se aplica */
  isento: string | null;
  modo: "nivel" | "livre" | "lista";
  telas: string[];
  nivel: { nome: string | null; telas: string[] | null };
  opcoes: GrupoDeTelas[];
  podeEditar: boolean;
};

/** O que vale para uma pessoa, para a seção de telas da ficha. */
export async function acessoTelasDaPessoa(userId: string): Promise<{ dados?: AcessoDaPessoa; error?: string }> {
  try {
    const { supabase, tenantId, role } = await actionContext();
    const [{ data: m }, regras] = await Promise.all([
      supabase.from("memberships").select("role, is_hr, hierarchy_level_id")
        .eq("tenant_id", tenantId).eq("user_id", userId).limit(1).maybeSingle(),
      lerRegrasDeAcesso(supabase, tenantId),
    ]);
    if (!m) return { error: "Colaborador não encontrado." };
    const { data: nivel } = m.hierarchy_level_id
      ? await supabase.from("hierarchy_levels").select("name").eq("id", m.hierarchy_level_id).maybeSingle()
      : { data: null };
    const excecao = regras.pessoas.get(userId);
    return {
      dados: {
        isento: isentoDoAcesso(m.role, m.is_hr),
        modo: excecao ? (excecao.livre ? "livre" : "lista") : "nivel",
        telas: excecao?.telas ?? [],
        nivel: { nome: nivel?.name ?? null, telas: (m.hierarchy_level_id && regras.niveis.get(m.hierarchy_level_id)) || null },
        opcoes: opcoesDeTelas(regras.contratadas),
        podeEditar: role === "owner" || role === "admin",
      },
    };
  } catch (e) {
    return { error: msg(e) };
  }
}
