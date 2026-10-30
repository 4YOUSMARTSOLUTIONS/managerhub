"use server";

import { revalidatePath } from "next/cache";
import { actionContext, dpActionContext } from "./context";
import type { ActionState } from "./types";
import type { Json } from "@/types/database";
import { aquisitivoDaLinha, type AquisitivoInfo } from "@/lib/ferias";
import type { PeriodoFolha } from "@/lib/ferias-folha";
import type { AgendaItem } from "@/lib/ferias-agenda";
import type { ModeloLotePessoa } from "@/lib/ferias-lote";
import { indiceDeAlvos, resolverAlvo, MOTIVO_LABEL, type IndiceDeAlvos } from "@/lib/import-pessoa";
import { fetchAll } from "@/lib/supabase/fetch-all";

/**
 * Férias: o PROCESSO da previsão (solicitação -> aprovação do gestor ->
 * efetivação do DP), com as regras CLT validadas no banco.
 *
 * As actions são finas de propósito: contexto -> RPC -> revalidate. Toda a
 * autorização mora nas funções `ferias_*` (security definer com guarda no
 * corpo) e no guard de transições; aqui só se traduz o transporte. O `hoje`
 * viaja do CLIENTE porque o servidor está em UTC e às 21h de Brasília o
 * `current_date` do banco já virou (lição do occurred_on do absenteísmo).
 */

const RP_FERIAS = "/ferias";

function revalidar() {
  revalidatePath(RP_FERIAS);
}

/** Efetivar e desfazer efetivada mexem em `employee_absences`, que a RV lê. */
function revalidarComRv() {
  revalidar();
  revalidatePath("/metas");
  revalidatePath("/configuracoes");
}

export type PeriodoFerias = {
  inicio: string;
  fim: string;
  abono: number;
  decimo: boolean;
};

function comoJson(periodos: PeriodoFerias[]): Json {
  return periodos.map((p) => ({
    inicio: p.inicio, fim: p.fim, abono: p.abono, decimo: p.decimo,
  }));
}

export async function solicitarFerias(
  input: { periodos: PeriodoFerias[]; hoje: string },
): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await actionContext();
    const { error } = await supabase.rpc("ferias_solicitar", {
      p_tenant: tenantId, p_periodos: comoJson(input.periodos), p_hoje: input.hoje,
    });
    if (error) return { error: error.message };
    revalidar();
    return { ok: true, message: "Solicitação enviada ao seu gestor." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function lancarFerias(
  input: { userId: string; periodos: PeriodoFerias[]; hoje: string; justificativaDobro?: string },
): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await actionContext();
    const { error } = await supabase.rpc("ferias_lancar", {
      p_tenant: tenantId, p_user: input.userId,
      p_periodos: comoJson(input.periodos), p_hoje: input.hoje,
      // só o DP lança em dobro; o banco recusa a justificativa vinda de outro papel
      p_justificativa_dobro: input.justificativaDobro?.trim() || null,
    });
    if (error) return { error: error.message };
    revalidar();
    return { ok: true, message: "Previsão lançada e enviada ao departamento pessoal." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function decidirFerias(
  input: { id: string; aprovar: boolean; nota?: string },
): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("ferias_decidir", {
      p_id: input.id, p_aprovar: input.aprovar, p_nota: input.nota?.trim() || null,
    });
    if (error) return { error: error.message };
    revalidar();
    return { ok: true, message: input.aprovar ? "Previsão aprovada." : "Previsão devolvida." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function reenviarFerias(
  input: { id: string; inicio: string; fim: string; abono: number; decimo: boolean; hoje: string },
): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("ferias_reenviar", {
      p_id: input.id, p_inicio: input.inicio, p_fim: input.fim,
      p_abono: input.abono, p_decimo: input.decimo, p_hoje: input.hoje,
    });
    if (error) return { error: error.message };
    revalidar();
    return { ok: true, message: "Previsão corrigida e reenviada." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function cancelarFerias(
  input: { id: string; nota: string },
): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("ferias_cancelar", {
      p_id: input.id, p_nota: input.nota.trim() || null,
    });
    if (error) return { error: error.message };
    // pode ter desfeito uma efetivada (a RPC decide pela alçada)
    revalidarComRv();
    return { ok: true, message: "Previsão cancelada." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function efetivarFerias(
  input: { id: string; descontaRv: boolean; nota?: string },
): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("ferias_efetivar", {
      p_id: input.id, p_desconta_rv: input.descontaRv, p_nota: input.nota?.trim() || null,
    });
    if (error) return { error: error.message };
    revalidarComRv();
    return { ok: true, message: "Férias efetivadas." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function reagendarFerias(
  input: { id: string; inicio: string; fim: string; abono: number; decimo: boolean; hoje: string },
): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error } = await supabase.rpc("ferias_reagendar", {
      p_id: input.id, p_inicio: input.inicio, p_fim: input.fim,
      p_abono: input.abono, p_decimo: input.decimo, p_hoje: input.hoje,
    });
    if (error) return { error: error.message };
    revalidar();
    return { ok: true, message: "Reagendamento enviado. As férias atuais continuam valendo até a verificação do DP." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type ContextoEfetivacao = {
  faltasQtd: number;
  faltasDias: number;
  direitoArt130: number;
  saldo: number | null;
  abonoUsado: number | null;
  qtdPeriodos: number | null;
  situacao: string | null;
  concessivoFim: string | null;
  /** "folha" quando o aquisitivo veio do relatório importado */
  origem: string | null;
  direitoFolha: number | null;
  gozadosFolha: number | null;
  /** emissão do relatório da folha */
  referencia: string | null;
  irmas: { id: string; inicio: string; fim: string; dias: number; abono: number; status: string }[];
};

/** O informativo que o DP olha antes de efetivar (faltas art. 130, saldo, irmãs). */
export async function getContextoEfetivacao(id: string): Promise<ContextoEfetivacao | null> {
  const { supabase } = await actionContext();
  const { data, error } = await supabase.rpc("ferias_contexto_efetivacao", { p_id: id });
  if (error || !data) return null;
  return data as unknown as ContextoEfetivacao;
}

/** Excluir é limpeza administrativa: a RLS só deixa o proprietário. */
export async function excluirFerias(id: string): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const { error, count } = await supabase
      .from("ferias_solicitacoes")
      .delete({ count: "exact" })
      .eq("id", id);
    if (error) return { error: error.message };
    if (!count) return { error: "Apenas o proprietário exclui um registro de férias." };
    revalidar();
    return { ok: true, message: "Registro excluído." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Configuração: marca ou desmarca um nível de hierarquia como "não solicita". */
export async function setNivelSolicitaFerias(
  input: { hierarchyLevelId: string; solicita: boolean },
): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await dpActionContext();
    if (input.solicita) {
      const { error } = await supabase
        .from("ferias_niveis_bloqueados")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("hierarchy_level_id", input.hierarchyLevelId);
      if (error) return { error: error.message };
    } else {
      const { error } = await supabase
        .from("ferias_niveis_bloqueados")
        .insert({ tenant_id: tenantId, hierarchy_level_id: input.hierarchyLevelId });
      if (error && !error.message.includes("duplicate")) return { error: error.message };
    }
    revalidar();
    revalidatePath("/configuracoes");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Saldo de outra pessoa: o lançamento do gestor e do DP confere antes de enviar
// ---------------------------------------------------------------------------

/**
 * Os aquisitivos de quem vai sair de férias, para o formulário de lançamento
 * mostrar o saldo e recusar antes do envio. A alçada é da RPC (o próprio, o
 * gestor da cadeia ou o DP); o banco revalida tudo no envio de qualquer jeito.
 */
export async function getAquisitivosDe(
  input: { userId: string; hoje: string },
): Promise<{ aquisitivos: AquisitivoInfo[]; error?: undefined } | { error: string }> {
  try {
    const { supabase, tenantId } = await actionContext();
    const { data, error } = await supabase.rpc("ferias_periodos_aquisitivos", {
      p_tenant: tenantId, p_user: input.userId, p_hoje: input.hoje,
    });
    if (error) return { error: error.message };
    return { aquisitivos: (data ?? []).map(aquisitivoDaLinha) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Férias num período: calendário, acompanhamento e programação
// ---------------------------------------------------------------------------

/**
 * As férias (fato e processo em trâmite) que cruzam [inicio, fim]. O recorte
 * de quem aparece é da RPC (DP e gerencial: empresa; gestor: cadeia); as
 * unidades do seletor do topo só encolhem.
 */
export async function getAgendaFerias(
  input: { inicio: string; fim: string; unidades: string[] | null },
): Promise<{ itens: AgendaItem[]; error?: undefined } | { error: string }> {
  try {
    const { supabase, tenantId } = await actionContext();
    const { data, error } = await supabase.rpc("ferias_agenda", {
      p_tenant: tenantId, p_inicio: input.inicio, p_fim: input.fim,
      p_unit_ids: input.unidades && input.unidades.length ? input.unidades : null,
    });
    if (error) return { error: error.message };
    return { itens: (data ?? []) as unknown as AgendaItem[] };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Lançamento em lote pelo gestor (planilha de programação da equipe)
// ---------------------------------------------------------------------------

/** O modelo: quem só o gestor lança (na alçada de quem baixa), com o saldo. */
export async function modeloDeLancamentoEmLote(
  input: { hoje: string },
): Promise<{ pessoas: ModeloLotePessoa[]; error?: string }> {
  try {
    const { supabase, tenantId } = await actionContext();
    const { data, error } = await supabase.rpc("ferias_modelo_lancamento", { p_tenant: tenantId, p_hoje: input.hoje });
    if (error) return { pessoas: [], error: error.message };
    return { pessoas: (data ?? []) as unknown as ModeloLotePessoa[] };
  } catch (e) {
    return { pessoas: [], error: (e as Error).message };
  }
}

export type PessoaLoteEnvio = {
  linhas: number[];
  unidade?: string;
  codigo: string;
  nome: string;
  periodos: PeriodoFerias[];
};

export type ResultadoLote = {
  linhas: number[];
  codigo: string;
  nome: string;
  periodos: PeriodoFerias[];
  ok: boolean;
  motivo?: string;
};

/**
 * Prévia (`somenteValidar`) ou envio da programação. As pessoas são achadas
 * por unidade + matrícula, como nas outras importações; cada uma é lançada
 * por `ferias_lancar_lote`, que roda o mesmo `ferias_lancar` do botão
 * individual (alçada e regras inclusas). Na prévia o banco desfaz tudo.
 */
export async function lancarFeriasEmLote(input: {
  pessoas: PessoaLoteEnvio[];
  hoje: string;
  somenteValidar: boolean;
}): Promise<{ resultados: ResultadoLote[]; error?: string }> {
  try {
    const { supabase, tenantId } = await actionContext();
    const { idx, ativo } = await indiceDaEmpresa(supabase, tenantId);

    const resultados: ResultadoLote[] = [];
    const paraEnviar: { pos: number; userId: string; periodos: PeriodoFerias[] }[] = [];
    const vistos = new Map<string, number[]>();
    for (const p of input.pessoas ?? []) {
      const base = { linhas: p.linhas, codigo: p.codigo, nome: p.nome, periodos: p.periodos };
      const alvo = resolverAlvo(p.codigo, p.unidade ?? "", idx);
      if (!alvo.alvoId) { resultados.push({ ...base, ok: false, motivo: MOTIVO_LABEL[alvo.motivo!] }); continue; }
      if (!ativo.get(alvo.alvoId)) { resultados.push({ ...base, ok: false, motivo: "desligado no cadastro" }); continue; }
      const antes = vistos.get(alvo.alvoId);
      if (antes) {
        resultados.push({ ...base, ok: false, motivo: `mesma pessoa das linhas ${antes.join(", ")} com outra unidade ou matrícula` });
        continue;
      }
      vistos.set(alvo.alvoId, p.linhas);
      paraEnviar.push({ pos: resultados.length, userId: alvo.alvoId, periodos: p.periodos });
      resultados.push({ ...base, ok: false, motivo: "" });
    }

    if (paraEnviar.length > 0) {
      const { data, error } = await supabase.rpc("ferias_lancar_lote", {
        p_tenant: tenantId,
        p_lancamentos: paraEnviar.map((x) => ({ user_id: x.userId, periodos: comoJson(x.periodos) })) as unknown as Json,
        p_hoje: input.hoje,
        p_somente_validar: input.somenteValidar,
      });
      if (error) return { resultados, error: error.message };
      const volta = (data ?? []) as unknown as { user_id: string; ok: boolean; erro?: string }[];
      paraEnviar.forEach((x, i) => {
        const r = volta[i];
        resultados[x.pos] = { ...resultados[x.pos], ok: !!r?.ok, motivo: r?.ok ? undefined : r?.erro ?? "não foi possível lançar" };
      });
    }

    if (!input.somenteValidar && resultados.some((r) => r.ok)) revalidar();
    return { resultados };
  } catch (e) {
    return { resultados: [], error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Importação do relatório "Programação de Férias" da folha
// ---------------------------------------------------------------------------

export type PessoaFolhaEnvio = {
  bloco: number;
  linha: number;
  codigo: string;
  nome: string;
  /** modelo do MANAGERHUB: a unidade vem na linha; no relatório da folha, vem do bloco */
  unidade?: string;
  periodos: PeriodoFolha[];
};

export type RecusaFolha = { linha: number; codigo: string; nome: string; motivo: string };

export type AnaliseFolha = {
  unidades: string[];
  multiUnidade: boolean;
  /** a unidade de cada bloco: a escolhida na tela ou, sem escolha, a sugerida */
  unidadePorBloco: Record<string, string>;
  aImportar: number;
  periodos: number;
  recusadas: RecusaFolha[];
  error?: string;
};

export type ResultadoImportacaoFolha = {
  ok?: true;
  error?: string;
  pessoas?: number;
  periodos?: number;
  reatribuidas?: number;
  conflitos?: { id: string; nome: string; inicio: string; fim: string }[];
  recusadas?: RecusaFolha[];
};

type Supa = Awaited<ReturnType<typeof actionContext>>["supabase"];

/**
 * Índice de matrícula da empresa, no mesmo molde das outras importações
 * (`import-pessoa.ts`): unidade + matrícula, nunca nome. O desligado entra no
 * índice para a recusa dizer "desligado" em vez de "não encontrada".
 */
async function indiceDaEmpresa(supabase: Supa, tenantId: string) {
  const [{ data: membros }, { data: unidades }, { data: vinculoUnidade }] = await Promise.all([
    fetchAll(() => supabase.from("memberships")
      .select("id, user_id, is_active, employee_code").eq("tenant_id", tenantId).order("id")),
    supabase.from("units").select("id, name").eq("tenant_id", tenantId).order("name"),
    // a RLS já limita ao tenant; .in() com centenas de ids estouraria a URL
    fetchAll(() => supabase.from("membership_units")
      .select("membership_id, unit_id").order("membership_id").order("unit_id")),
  ]);
  const nomeUnidade = new Map((unidades ?? []).map((u) => [u.id, u.name]));
  const unidadesDoVinculo = new Map<string, string[]>();
  for (const v of vinculoUnidade ?? []) {
    const nm = nomeUnidade.get(v.unit_id);
    if (!nm) continue;
    unidadesDoVinculo.set(v.membership_id, [...(unidadesDoVinculo.get(v.membership_id) ?? []), nm]);
  }
  const ativo = new Map<string, boolean>();
  const refs = (membros ?? []).map((m) => {
    ativo.set(m.user_id, m.is_active);
    return {
      id: m.user_id, code: m.employee_code, units: unidadesDoVinculo.get(m.id) ?? [],
      origem: (m.is_active ? "ativo" : "desligado") as "ativo" | "desligado",
    };
  });
  const nomes = (unidades ?? []).map((u) => u.name);
  return { idx: indiceDeAlvos(refs, nomes), unidades: nomes, ativo };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function periodosLegiveis(ps: PeriodoFolha[]): boolean {
  if (!Array.isArray(ps) || ps.length === 0) return false;
  const ok = ps.every((p) =>
    ISO.test(p.aqInicio) && ISO.test(p.aqFim) && p.aqFim >= p.aqInicio
    && Number.isInteger(p.gozados) && Number.isInteger(p.restantes)
    && p.gozados >= 0 && p.restantes >= 0 && p.gozados + p.restantes <= 30
    && (p.limite === null || ISO.test(p.limite)));
  if (!ok) return false;
  // dois aquisitivos da mesma pessoa não se cruzam (e o banco tem chave pelo início)
  const ordem = [...ps].sort((a, b) => a.aqInicio.localeCompare(b.aqInicio));
  return ordem.every((p, i) => i === 0 || p.aqInicio > ordem[i - 1].aqFim);
}

/**
 * Cada bloco do relatório é uma empresa, e o relatório não diz qual. A
 * sugestão é a unidade em que mais matrículas do bloco resolvem; quem decide é
 * o DP na tela, e a sugestão só preenche o seletor.
 */
function sugerirUnidades(pessoas: PessoaFolhaEnvio[], unidades: string[], idx: IndiceDeAlvos) {
  const out: Record<string, string> = {};
  // no modelo cada linha diz a própria unidade: só os blocos da folha precisam de sugestão
  const semUnidade = pessoas.filter((p) => !p.unidade);
  for (const b of [...new Set(semUnidade.map((p) => p.bloco))]) {
    const doBloco = semUnidade.filter((p) => p.bloco === b);
    let melhor = unidades[0] ?? "";
    let max = -1;
    for (const u of unidades) {
      const n = doBloco.filter((p) => resolverAlvo(p.codigo, u, idx).alvoId).length;
      if (n > max) { max = n; melhor = u; }
    }
    out[String(b)] = melhor;
  }
  return out;
}

function resolverFolha(
  pessoas: PessoaFolhaEnvio[],
  unidadePorBloco: Record<string, string>,
  idx: IndiceDeAlvos,
  ativo: Map<string, boolean>,
) {
  const aceitas: { pessoa: PessoaFolhaEnvio; userId: string }[] = [];
  const recusadas: RecusaFolha[] = [];
  const vistos = new Map<string, number>();
  for (const p of pessoas) {
    const recusar = (motivo: string) =>
      recusadas.push({ linha: p.linha, codigo: p.codigo, nome: p.nome, motivo });
    // a unidade da linha (modelo) vale mesmo em empresa de unidade única: se
    // veio, é conferida; a do bloco (folha) só é usada quando há mais de uma
    const unidade = p.unidade?.trim()
      ? p.unidade
      : idx.multiUnidade ? unidadePorBloco[String(p.bloco)] ?? "" : "";
    const alvo = resolverAlvo(p.codigo, unidade, idx);
    if (!alvo.alvoId) { recusar(MOTIVO_LABEL[alvo.motivo!]); continue; }
    if (!ativo.get(alvo.alvoId)) { recusar("desligado no cadastro"); continue; }
    const antes = vistos.get(alvo.alvoId);
    if (antes !== undefined) { recusar(`repetido no relatório (linha ${antes})`); continue; }
    if (!periodosLegiveis(p.periodos)) { recusar("período aquisitivo ilegível"); continue; }
    vistos.set(alvo.alvoId, p.linha);
    aceitas.push({ pessoa: p, userId: alvo.alvoId });
  }
  return { aceitas, recusadas };
}

/**
 * A lista que vai pré-preenchida no modelo: os ativos com matrícula, uma linha
 * por pessoa, ordenados por unidade e nome. Quem não tem matrícula fica de
 * fora porque não teria como ser importado (a chave é unidade + matrícula).
 */
export async function dadosDoModeloDeFerias(): Promise<{
  pessoas: { unidade: string; matricula: string; nome: string }[];
  error?: string;
}> {
  try {
    const { supabase, tenantId } = await dpActionContext();
    const [{ data: membros }, { data: unidades }, { data: vinculoUnidade }] = await Promise.all([
      fetchAll(() => supabase.from("memberships")
        .select("id, employee_code, profiles!memberships_user_id_fkey(full_name)")
        .eq("tenant_id", tenantId).eq("is_active", true).order("id")),
      supabase.from("units").select("id, name").eq("tenant_id", tenantId),
      fetchAll(() => supabase.from("membership_units")
        .select("membership_id, unit_id").order("membership_id").order("unit_id")),
    ]);
    const nomeUnidade = new Map((unidades ?? []).map((u) => [u.id, u.name]));
    const unidadesDo = new Map<string, string[]>();
    for (const v of vinculoUnidade ?? []) {
      const nm = nomeUnidade.get(v.unit_id);
      if (nm) unidadesDo.set(v.membership_id, [...(unidadesDo.get(v.membership_id) ?? []), nm]);
    }
    const pessoas = (membros ?? [])
      .filter((m) => (m.employee_code ?? "").trim())
      .map((m) => {
        const perfil = m.profiles as unknown as { full_name: string | null } | { full_name: string | null }[] | null;
        const nome = (Array.isArray(perfil) ? perfil[0]?.full_name : perfil?.full_name) ?? "";
        // quem está em mais de uma unidade (diretoria) sai com a primeira: qualquer
        // uma delas resolve a matrícula
        const uns = (unidadesDo.get(m.id) ?? []).sort((a, b) => a.localeCompare(b, "pt-BR"));
        return { unidade: uns[0] ?? "", matricula: String(m.employee_code).trim(), nome };
      })
      .sort((a, b) => a.unidade.localeCompare(b.unidade, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR"));
    return { pessoas };
  } catch (e) {
    return { pessoas: [], error: (e as Error).message };
  }
}

/** A prévia: quem entra, quem fica de fora e por quê, sem gravar nada. */
export async function analisarFolha(
  input: { pessoas: PessoaFolhaEnvio[]; unidadePorBloco?: Record<string, string> },
): Promise<AnaliseFolha> {
  const vazia: AnaliseFolha = {
    unidades: [], multiUnidade: false, unidadePorBloco: {}, aImportar: 0, periodos: 0, recusadas: [],
  };
  try {
    const { supabase, tenantId } = await dpActionContext();
    const { idx, unidades, ativo } = await indiceDaEmpresa(supabase, tenantId);
    const sugeridas = sugerirUnidades(input.pessoas, unidades, idx);
    const unidadePorBloco = { ...sugeridas, ...(input.unidadePorBloco ?? {}) };
    const { aceitas, recusadas } = resolverFolha(input.pessoas, unidadePorBloco, idx, ativo);
    return {
      unidades,
      multiUnidade: idx.multiUnidade,
      unidadePorBloco,
      aImportar: aceitas.length,
      periodos: aceitas.reduce((s, a) => s + a.pessoa.periodos.length, 0),
      recusadas,
    };
  } catch (e) {
    return { ...vazia, error: (e as Error).message };
  }
}

export async function importarFolha(input: {
  pessoas: PessoaFolhaEnvio[];
  unidadePorBloco: Record<string, string>;
  emissao: string;
  dataBase: string | null;
  arquivo: string;
}): Promise<ResultadoImportacaoFolha> {
  try {
    const { supabase, tenantId } = await dpActionContext();
    if (!ISO.test(input.emissao)) return { error: "A data de emissão do relatório não foi reconhecida." };
    const { idx, ativo } = await indiceDaEmpresa(supabase, tenantId);
    if (idx.multiUnidade) {
      const semUnidade = [...new Set(input.pessoas.filter((p) => !p.unidade).map((p) => p.bloco))]
        .filter((b) => !input.unidadePorBloco[String(b)]);
      if (semUnidade.length) return { error: "Escolha a unidade de cada bloco do relatório." };
    }
    const { aceitas, recusadas } = resolverFolha(input.pessoas, input.unidadePorBloco, idx, ativo);
    if (aceitas.length === 0) {
      return { error: "Nenhum colaborador do relatório foi encontrado no cadastro. Confira a unidade de cada bloco.", recusadas };
    }

    const { data, error } = await supabase.rpc("ferias_importar_aquisitivos", {
      p_tenant: tenantId,
      p_referencia: input.emissao,
      p_data_base: input.dataBase && ISO.test(input.dataBase) ? input.dataBase : null,
      p_arquivo: input.arquivo,
      p_pessoas: aceitas.map(({ pessoa, userId }) => ({
        user_id: userId,
        nome: pessoa.nome,
        periodos: pessoa.periodos.map((q) => ({
          aq_inicio: q.aqInicio, aq_fim: q.aqFim,
          gozados: q.gozados, restantes: q.restantes, proporcionais: q.proporcionais,
          limite: q.limite, afastamento: q.afastamento, faltas: q.faltas,
        })),
      })) as unknown as Json,
      p_recusadas: recusadas as unknown as Json,
    });
    if (error) return { error: error.message, recusadas };

    const r = (data ?? {}) as {
      pessoas?: number; periodos?: number; reatribuidas?: number;
      conflitos?: { id: string; nome: string; inicio: string; fim: string }[];
    };
    revalidatePath(RP_FERIAS);
    revalidatePath("/configuracoes");
    return {
      ok: true,
      pessoas: r.pessoas ?? aceitas.length,
      periodos: r.periodos ?? 0,
      reatribuidas: r.reatribuidas ?? 0,
      conflitos: r.conflitos ?? [],
      recusadas,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
