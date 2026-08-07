"use server";

import { revalidatePath } from "next/cache";
import { adminActionContext } from "./context";
import { createServiceClient } from "@/lib/supabase/admin";
import { verifyOwnPassword } from "./verify-password";
import { fatorRv } from "@/lib/rv-proporcional";
import { redutoresDoMes, kindsComRedutor, type RegraRedutor } from "@/lib/rv-redutores";
import type { ActionState } from "./types";

/**
 * Fechar e reabrir a competência da remuneração variável.
 *
 * O valor pago é recalculado a cada abertura da tela, e é isso que fazia uma
 * punição lançada em outubro mudar a RV de julho. Fechar a competência tira do
 * cálculo os três números que vêm de FORA do lançamento da meta, que são
 * exatamente os que um lançamento retroativo mexe: o pote vigente, a proporção
 * de dias trabalhados e o corte por conduta.
 *
 * O atingimento das metas NÃO entra aqui: ele já tem o próprio fechamento, por
 * lançamento (`approveMonth` / `reopenGoalEntry`). Aqui se trava o dinheiro; lá
 * se trava o desempenho.
 *
 * O retrato é tirado no servidor, com os MESMOS módulos puros que a tela usa. O
 * navegador não manda valor nenhum: quem fecha escolhe a competência, e só. Se
 * fosse o cliente a mandar o número, fechar a competência seria a única operação
 * do sistema em que o valor do dinheiro chega de fora.
 */

const PERIODO = /^\d{4}-\d{2}-01$/;

type Detalhe = { motivo: string; quantidade: number; pct: number };

/**
 * Lê tudo pelo service client, como a tela de metas já faz: a RLS de
 * `employee_absences` e `employee_sanctions` é owner/admin/RH, e o cálculo
 * precisa da empresa inteira, não do recorte de quem clicou.
 *
 * A guarda de quem pode está no `adminActionContext`, antes de chegar aqui.
 */
async function retratoDaCompetencia(tenantId: string, period: string) {
  const admin = createServiceClient();

  const [
    { data: mems }, { data: cfgs }, { data: ausencias }, { data: sancoes },
    { data: regrasRaw }, { data: faixasRaw },
  ] = await Promise.all([
    admin.from("memberships").select("user_id, position_id, admission_date, dismissed_at").eq("tenant_id", tenantId),
    admin.from("individual_rv_config").select("scope, position_id, user_id, effective_from, value").eq("tenant_id", tenantId),
    admin.from("employee_absences").select("user_id, kind, start_date, end_date, discounts_rv").eq("tenant_id", tenantId),
    admin.from("employee_sanctions").select("user_id, sanction_type_id, occurred_on").eq("tenant_id", tenantId),
    admin.from("rv_reducer_rules").select("id, name, source, absence_kind, sanction_type_id").eq("tenant_id", tenantId).eq("active", true).order("sort"),
    admin.from("rv_reducer_bands").select("rule_id, min_qtd, max_qtd, reduction_pct").eq("tenant_id", tenantId).order("min_qtd"),
  ]);

  const faixasPorRegra = new Map<string, { min: number; max: number | null; pct: number }[]>();
  for (const b of faixasRaw ?? []) {
    const arr = faixasPorRegra.get(b.rule_id) ?? [];
    arr.push({ min: b.min_qtd, max: b.max_qtd, pct: Number(b.reduction_pct) });
    faixasPorRegra.set(b.rule_id, arr);
  }
  const regras: RegraRedutor[] = (regrasRaw ?? [])
    .map((r) => ({
      id: r.id, nome: r.name, fonte: r.source as "absence" | "sanction",
      absenceKind: r.absence_kind, sanctionTypeId: r.sanction_type_id,
      faixas: faixasPorRegra.get(r.id) ?? [],
    }))
    .filter((r) => r.faixas.length > 0);
  const kindsPorFaixa = kindsComRedutor(regras);

  // pote vigente na competência: a última vigência <= o mês, com o valor do
  // colaborador ganhando do valor da função. É a mesma resolução da tela.
  const lista = cfgs ?? [];
  const poteDe = (userId: string, positionId: string | null): number => {
    const ultimo = (escopo: "user" | "position") => {
      let best: (typeof lista)[number] | null = null;
      for (const c of lista) {
        if (c.scope !== escopo) continue;
        if (escopo === "user" ? c.user_id !== userId : c.position_id !== positionId) continue;
        if (c.effective_from <= period && (!best || c.effective_from > best.effective_from)) best = c;
      }
      return best;
    };
    const u = ultimo("user");
    if (u) return Number(u.value);
    const p = positionId ? ultimo("position") : null;
    return p ? Number(p.value) : 0;
  };

  const linhas: {
    tenant_id: string; period: string; user_id: string;
    rv_full: number; prop_factor: number; reducer_pct: number; pool: number; detail: Detalhe[];
  }[] = [];

  for (const m of mems ?? []) {
    const cheio = poteDe(m.user_id, m.position_id);
    // sem pote não há o que congelar: uma linha com zero sugeriria que houve RV
    // e ela foi cortada, que é uma história diferente
    if (!(cheio > 0)) continue;

    const minhasAus = (ausencias ?? []).filter((a) => a.user_id === m.user_id);
    const paraProporcional = minhasAus
      .filter((a) => a.discounts_rv || kindsPorFaixa.has(a.kind))
      .map((a) => ({ inicio: a.start_date, fim: a.end_date, kind: a.kind }));
    const minhasSanc = (sancoes ?? [])
      .filter((x) => x.user_id === m.user_id)
      .map((x) => ({ tipoId: x.sanction_type_id, data: x.occurred_on }));

    const f = fatorRv(
      period, paraProporcional,
      { admissao: m.admission_date, desligamento: m.dismissed_at },
      kindsPorFaixa,
    );
    const red = redutoresDoMes(
      period,
      paraProporcional.map((a) => ({ kind: a.kind ?? "", inicio: a.inicio, fim: a.fim })),
      minhasSanc,
      regras,
    );

    const prop = Number(f.fator.toFixed(6));
    const pct = Number(red.pctTotal.toFixed(2));
    linhas.push({
      tenant_id: tenantId,
      period,
      user_id: m.user_id,
      rv_full: cheio,
      prop_factor: prop,
      reducer_pct: pct,
      pool: Number((cheio * prop * (1 - pct / 100)).toFixed(2)),
      detail: red.aplicados.map((a) => ({ motivo: a.nome, quantidade: a.quantidade, pct: a.pct })),
    });
  }

  return linhas;
}

/** Fecha a competência e grava o retrato. Já fechada, não faz nada. */
export async function lockRvPeriod(period: string): Promise<ActionState> {
  try {
    const { supabase, tenantId, userId } = await adminActionContext();
    if (!PERIODO.test(period)) return { error: "Competência inválida." };

    const { data: existente } = await supabase
      .from("rv_period_locks").select("id").eq("tenant_id", tenantId).eq("period", period).maybeSingle();
    if (existente) return { error: "Esta competência já está fechada." };

    const linhas = await retratoDaCompetencia(tenantId, period);

    // o retrato anterior sai antes: se a competência já foi fechada e reaberta,
    // as linhas velhas ficaram para trás e não podem se misturar com estas
    const admin = createServiceClient();
    await admin.from("rv_period_snapshots").delete().eq("tenant_id", tenantId).eq("period", period);
    if (linhas.length) {
      const { error } = await admin.from("rv_period_snapshots").insert(linhas as never);
      if (error) return { error: error.message };
    }

    // o cadeado por último: se a gravação do retrato falhar, a competência
    // continua aberta em vez de ficar fechada em cima de nada
    const { error } = await supabase
      .from("rv_period_locks").insert({ tenant_id: tenantId, period, locked_by: userId });
    if (error) return { error: error.message };

    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Reabre a competência, exigindo a senha de quem está pedindo.
 *
 * A senha não é uma segunda autorização: quem chega aqui já passou pelo
 * `adminActionContext`. Ela é um freio contra o clique distraído numa tela que
 * está aberta há horas, e é o que amarra o registro no log a uma pessoa que
 * estava de fato no teclado.
 *
 * O retrato NÃO é apagado: ele fica como estava até o próximo fechamento
 * substituí-lo, e enquanto isso o valor volta a ser recalculado ao vivo.
 */
export async function reopenRvPeriod(period: string, password: string): Promise<ActionState> {
  try {
    const { supabase, tenantId } = await adminActionContext();
    if (!PERIODO.test(period)) return { error: "Competência inválida." };
    if (!(await verifyOwnPassword(password))) return { error: "Senha incorreta." };

    const { error } = await supabase
      .from("rv_period_locks").delete().eq("tenant_id", tenantId).eq("period", period);
    if (error) return { error: error.message };

    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
