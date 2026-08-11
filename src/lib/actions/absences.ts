"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { ActionState } from "./types";
import type { Enums } from "@/types/database";
import { parseDataPlanilha, parseTipo, parseDesconta, periodosCruzam } from "@/lib/absences-import";
import { indiceDeAlvos, resolverAlvo, MOTIVO_LABEL, ORIGEM_AVISO, type Origem } from "@/lib/import-pessoa";

/**
 * Férias e afastamentos do colaborador.
 *
 * Owner, admin e RH: é aqui que se decide quantos dias do mês entram na conta da
 * RV, então mexer nisto é mexer no que a pessoa recebe, e é justamente por isso
 * que faz parte da alçada do departamento pessoal.
 *
 * Os dois `revalidatePath` são obrigatórios: o cadastro vive em Configurações,
 * mas quem consome é a tela de Metas.
 */

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const SO_ADMIN = "Apenas proprietário, administrador e RH lançam férias e afastamentos.";

/** Espelha o `dpActionContext`: aqui a recusa vira mensagem na tela em vez de
 *  exceção, porque estas três actions devolvem `ActionState`. */
const PODE_DP = new Set<Enums<"member_role">>(["owner", "admin", "hr"]);

export type AbsenceInput = {
  /** ausente = criar */
  id?: string;
  user_id: string;
  kind: Enums<"absence_kind">;
  start_date: string;
  end_date: string;
  discounts_rv: boolean;
  note?: string | null;
};

/** Traduz o erro do banco em algo que a pessoa entenda na tela. */
function mensagem(e: { code?: string; message?: string }): string {
  const cod = e.code ?? "";
  const msg = e.message ?? "";
  if (cod === "23P01" || msg.includes("employee_absences_sem_sobreposicao")) {
    return "Já existe um período lançado para este colaborador que se sobrepõe a este.";
  }
  if (cod === "23514" || msg.includes("employee_absences_periodo")) {
    return "A data de fim não pode ser anterior à de início.";
  }
  return msg || "Não foi possível salvar.";
}

export async function upsertAbsence(input: AbsenceInput): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId, role } = await actionContext();
    if (!PODE_DP.has(role)) return { error: SO_ADMIN };

    const start_date = (input.start_date ?? "").trim();
    const end_date = (input.end_date ?? "").trim();
    if (!input.user_id) return { error: "Escolha o colaborador." };
    if (!DATA.test(start_date) || !DATA.test(end_date)) return { error: "Informe as datas de início e de fim." };
    if (end_date < start_date) return { error: "A data de fim não pode ser anterior à de início." };

    // A RLS confere o tenant da LINHA, e o tenant vem daqui, do servidor. O que
    // ela não confere é se a PESSOA é desta empresa: sem isto daria para gravar
    // uma ausência no id de alguém de outro tenant.
    const { data: vinculo } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", input.user_id)
      .maybeSingle();
    if (!vinculo) return { error: "Colaborador não encontrado nesta empresa." };

    const payload = {
      tenant_id: tenantId,
      user_id: input.user_id,
      kind: input.kind,
      start_date,
      end_date,
      discounts_rv: !!input.discounts_rv,
      note: (input.note ?? "").trim() || null,
      created_by: userId,
    };

    const { error } = input.id
      ? await supabase.from("employee_absences").update(payload).eq("id", input.id)
      : await supabase.from("employee_absences").insert(payload);
    if (error) return { error: mensagem(error) };

    revalidatePath("/configuracoes");
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------- Importação em lote (.xlsx) ----------

export type AbsenceImportRow = {
  /** nome: coluna informativa; o sistema NÃO casa por nome */
  name: string;
  /** matrícula do colaborador (coluna ID do modelo); identifica junto com a unidade */
  code?: string;
  /** unidade da linha; obrigatória em empresa com mais de uma unidade */
  unit?: string;
  kind: string;
  start: string;
  end: string;
  /** "sim" | "nao" | "" (vazio = padrão do tipo) */
  discounts: string;
  note: string;
};

export type AbsenceImportResult = {
  imported: number;
  updated: number;
  invalid: number;
  notFound: number;
  /** conflito de unidade e matrícula (não confere, falta unidade ou duplicada) */
  mismatch: number;
  /** recusadas por cruzar com um período já lançado */
  overlapping: number;
  /**
   * QUAIS linhas ficaram de fora. Sem isto o resumo dizia "3 não encontrados"
   * e a pessoa não tinha como descobrir quem: a contagem some, a planilha tem
   * centenas de linhas, e a prévia mostrava só as primeiras.
   */
  rejeitadas: LinhaRecusada[];
  error?: string;
};

export type LinhaRecusada = {
  /** número da linha na planilha, contando o cabeçalho */
  linha: number;
  code: string;
  unit: string;
  name: string;
  periodo: string;
  motivo: string;
};

/**
 * Importa períodos casando o nome com o cadastro.
 *
 * Reimportar a mesma planilha NÃO duplica nem falha: período com as mesmas datas
 * para a mesma pessoa é atualizado no lugar. O que cruza com um período
 * DIFERENTE é recusado e contado à parte, em vez de derrubar a planilha inteira
 * na constraint do banco. A constraint continua lá como rede de segurança.
 */
export async function importAbsences(rows: AbsenceImportRow[]): Promise<AbsenceImportResult> {
  const vazio: AbsenceImportResult = { imported: 0, updated: 0, invalid: 0, notFound: 0, mismatch: 0, overlapping: 0, rejeitadas: [] };
  try {
    const { supabase, tenantId, userId, role } = await actionContext();
    if (!PODE_DP.has(role)) return { ...vazio, error: SO_ADMIN };

    const [{ data: membros }, { data: unidades }, { data: vinculoUnidade }, { data: contratos }] = await Promise.all([
      supabase.from("memberships").select("id, user_id, is_active, employee_code, dismissed_at").eq("tenant_id", tenantId),
      supabase.from("units").select("id, name").eq("tenant_id", tenantId),
      // RLS já limita ao tenant; .in() com centenas de ids estouraria a URL
      supabase.from("membership_units").select("membership_id, unit_id").limit(20000),
      supabase.from("employee_contracts").select("user_id, employee_code").eq("tenant_id", tenantId),
    ]);
    const nomeUnidade = new Map((unidades ?? []).map((u) => [u.id, u.name]));
    const unidadesDoVinculo = new Map<string, string[]>();
    for (const v of vinculoUnidade ?? []) {
      const nm = nomeUnidade.get(v.unit_id);
      if (!nm) continue;
      const arr = unidadesDoVinculo.get(v.membership_id) ?? [];
      arr.push(nm);
      unidadesDoVinculo.set(v.membership_id, arr);
    }
    // Lançamento de histórico é caso legítimo: férias de quem já saiu, ou de um
    // contrato ANTERIOR da mesma pessoa (a matrícula muda na recontratação).
    // Por isso o índice cobre os três, e a origem só muda a preferência e o
    // aviso na tela. As unidades do contrato antigo são as do vínculo de hoje,
    // que é a única informação de unidade que existe: employee_contracts não
    // guarda unidade.
    const unidadesPorUser = new Map<string, string[]>();
    const refs: { id: string; code?: string | null; units?: string[]; origem?: Origem }[] = [];
    for (const m of membros ?? []) {
      const uns = unidadesDoVinculo.get(m.id) ?? [];
      unidadesPorUser.set(m.user_id, uns);
      refs.push({ id: m.user_id, code: m.employee_code, units: uns, origem: m.is_active ? "ativo" : "desligado" });
    }
    for (const c of contratos ?? []) {
      refs.push({ id: c.user_id, code: c.employee_code, units: unidadesPorUser.get(c.user_id) ?? [], origem: "contrato_anterior" });
    }
    const idx = indiceDeAlvos(refs, (unidades ?? []).map((u) => u.name));
    // desligamento por pessoa: uma ausência DEPOIS da saída é erro de digitação,
    // não histórico, e entrar mudaria a proporcionalidade de um mês que a pessoa
    // nem trabalhou
    const saidaPorUser = new Map<string, string>();
    for (const m of membros ?? []) if (m.dismissed_at) saidaPorUser.set(m.user_id, m.dismissed_at);

    const { data: existentes } = await supabase
      .from("employee_absences")
      .select("id, user_id, start_date, end_date")
      .eq("tenant_id", tenantId);

    // o que já está no banco, mais o que esta planilha já aceitou: as duas coisas
    // precisam entrar na conta, senão duas linhas cruzadas da MESMA planilha
    // passariam aqui e só quebrariam no insert
    const porDono = new Map<string, { id?: string; inicio: string; fim: string }[]>();
    for (const e of existentes ?? []) {
      const arr = porDono.get(e.user_id) ?? [];
      arr.push({ id: e.id, inicio: e.start_date, fim: e.end_date });
      porDono.set(e.user_id, arr);
    }

    const inserts: Record<string, unknown>[] = [];
    const updates: { id: string; payload: Record<string, unknown> }[] = [];
    const r: AbsenceImportResult = { ...vazio, rejeitadas: [] };

    let nLinha = 1; // 1 é o cabeçalho; a primeira linha de dados é a 2
    for (const linha of rows ?? []) {
      nLinha += 1;
      const recusar = (motivo: string) => {
        r.rejeitadas.push({
          linha: nLinha,
          code: (linha.code ?? "").trim(),
          unit: (linha.unit ?? "").trim(),
          name: (linha.name ?? "").trim(),
          periodo: [linha.start, linha.end].filter(Boolean).join(" a "),
          motivo,
        });
      };
      const inicio = parseDataPlanilha(linha.start ?? "");
      const fim = parseDataPlanilha(linha.end ?? "");
      const kind = parseTipo(linha.kind ?? "");
      if (!inicio || !fim || fim < inicio || !kind) {
        r.invalid += 1;
        recusar(!kind ? "Tipo não reconhecido" : !inicio || !fim ? "Data de início ou fim ilegível" : "Fim anterior ao início");
        continue;
      }

      const alvo = resolverAlvo(linha.code ?? "", linha.unit ?? "", idx);
      if (alvo.motivo === "sem_matricula") { r.invalid += 1; recusar(MOTIVO_LABEL.sem_matricula); continue; }
      if (alvo.motivo === "nao_encontrada") { r.notFound += 1; recusar(MOTIVO_LABEL.nao_encontrada); continue; }
      const userIdAlvo = alvo.alvoId;
      if (!userIdAlvo) { r.mismatch += 1; recusar(MOTIVO_LABEL[alvo.motivo!]); continue; }

      const saida = saidaPorUser.get(userIdAlvo);
      if (saida && inicio > saida) {
        r.invalid += 1;
        recusar(`Período começa depois do desligamento (${saida.slice(8, 10)}/${saida.slice(5, 7)}/${saida.slice(0, 4)})`);
        continue;
      }

      const payload = {
        tenant_id: tenantId,
        user_id: userIdAlvo,
        kind,
        start_date: inicio,
        end_date: fim,
        discounts_rv: parseDesconta(linha.discounts ?? "", kind),
        note: (linha.note ?? "").trim() || null,
        created_by: userId,
      };

      const doDono = porDono.get(userIdAlvo) ?? [];
      const igual = doDono.find((x) => x.inicio === inicio && x.fim === fim);
      if (igual?.id) { updates.push({ id: igual.id, payload }); continue; }
      if (doDono.some((x) => periodosCruzam(inicio, fim, x.inicio, x.fim))) {
        r.overlapping += 1;
        recusar("Cruza com um período já lançado");
        continue;
      }

      inserts.push(payload);
      doDono.push({ inicio, fim });
      porDono.set(userIdAlvo, doDono);
    }

    if (inserts.length) {
      const { error } = await supabase.from("employee_absences").insert(inserts as never);
      if (error) return { ...r, error: mensagem(error) };
      r.imported = inserts.length;
    }
    for (const u of updates) {
      const { error } = await supabase.from("employee_absences").update(u.payload as never).eq("id", u.id);
      if (error) return { ...r, error: mensagem(error) };
      r.updated += 1;
    }

    if (r.imported === 0 && r.updated === 0) {
      return {
        ...r,
        error: r.mismatch > 0
          ? "Nenhum período importado: conflito de unidade e matrícula (confira a coluna Unidade)."
          : r.notFound > 0
            ? "Nenhum período importado, matrícula não encontrada no cadastro."
            : r.overlapping > 0
              ? "Nenhum período importado: todos cruzam com períodos já lançados."
              : "Nenhuma linha válida, confira o colaborador e as datas de início e fim.",
      };
    }

    revalidatePath("/configuracoes");
    revalidatePath("/metas");
    return r;
  } catch (e) {
    return { ...vazio, error: (e as Error).message };
  }
}

export async function deleteAbsence(id: string): Promise<ActionState> {
  try {
    const { supabase, role } = await actionContext();
    if (!PODE_DP.has(role)) return { error: SO_ADMIN };
    const { error } = await supabase.from("employee_absences").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/configuracoes");
    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
