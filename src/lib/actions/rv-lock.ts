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
 * O atingimento vai junto: fechar a competência aprova todo lançamento que ainda
 * estava `aberta` naquele mês, e a partir daí o realizado também não muda mais
 * (`upsertGoalEntry` já recusa mexer em lançamento aprovado). Travar só o
 * dinheiro deixava a porta aberta pelo outro lado: bastava mudar o realizado
 * depois do mês fechado e o valor mudava com ele.
 *
 * `reopenGoalEntry` passa a recusar enquanto a competência estiver fechada, ou o
 * cadeado seria contornável um lançamento de cada vez.
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
    admin.from("memberships").select("id, user_id, position_id, admission_date, dismissed_at, department_id, subdepartment_id, manager_id").eq("tenant_id", tenantId),
    admin.from("individual_rv_config").select("scope, position_id, user_id, effective_from, value").eq("tenant_id", tenantId),
    admin.from("employee_absences").select("user_id, kind, start_date, end_date, discounts_rv, waived").eq("tenant_id", tenantId),
    admin.from("employee_sanctions").select("user_id, sanction_type_id, occurred_on").eq("tenant_id", tenantId),
    admin.from("rv_reducer_rules").select("id, name, source, absence_kind, sanction_type_id").eq("tenant_id", tenantId).eq("active", true).order("sort"),
    admin.from("rv_reducer_bands").select("rule_id, min_qtd, max_qtd, reduction_pct").eq("tenant_id", tenantId).order("min_qtd"),
  ]);

  // unidades por vínculo, para o carimbo do retrato
  const { data: vinculoUnidades } = await admin
    .from("membership_units").select("membership_id, unit_id")
    .in("membership_id", (mems ?? []).map((m) => m.id));
  const unidadesDe = new Map<string, string[]>();
  for (const vu of vinculoUnidades ?? []) {
    const arr = unidadesDe.get(vu.membership_id) ?? [];
    arr.push(vu.unit_id);
    unidadesDe.set(vu.membership_id, arr);
  }

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
    department_id: string | null; subdepartment_id: string | null; position_id: string | null;
    manager_id: string | null; unit_ids: string[];
  }[] = [];

  for (const m of mems ?? []) {
    const cheio = poteDe(m.user_id, m.position_id);
    // sem pote não há o que congelar: uma linha com zero sugeriria que houve RV
    // e ela foi cortada, que é uma história diferente
    if (!(cheio > 0)) continue;

    const minhasAus = (ausencias ?? []).filter((a) => a.user_id === m.user_id);
    const paraProporcional = minhasAus
      // abonada fica no histórico, mas não reduz remuneração variável
      .filter((a) => !a.waived)
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
      // o VÍNCULO da época vai junto com o dinheiro: transferência futura não
      // reescreve o rótulo do mês fechado. Lido de memberships mesmo, porque o
      // fechamento acontece agora: o estado atual É o da época do clique.
      department_id: m.department_id,
      subdepartment_id: m.subdepartment_id,
      position_id: m.position_id,
      manager_id: m.manager_id,
      unit_ids: (unidadesDe.get(m.id) ?? []).sort(),
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

    // Os lançamentos vão junto. Sem isto o cadeado travava só o dinheiro e o
    // desempenho continuava aberto: dava para mudar o realizado de julho depois
    // de julho estar fechado, e o valor mudava com ele.
    //
    // Só o que está `aberta`. `reprovada` não é tocada: uma meta recusada não
    // vira aprovada por o mês ter fechado.
    //
    // Aqui NÃO entra o service client, ao contrário da leitura do retrato:
    // `guard_goal_entry_closure` confere `auth.uid()` para decidir quem pode
    // fechar uma meta, e com a chave de serviço não há `auth.uid()` nenhum — a
    // gravação seria recusada pelo próprio trigger. Com o cliente do usuário o
    // guard reconhece o administrador e ainda vale como segunda camada, que é o
    // que se quer numa escrita em massa.
    const { data: abertas } = await supabase
      .from("individual_goal_entries")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("period", period)
      .eq("approval_status", "aberta");
    const idsFechados = (abertas ?? []).map((e) => e.id);
    if (idsFechados.length) {
      const { error: eFechar } = await supabase
        .from("individual_goal_entries")
        .update({
          approval_status: "aprovada",
          approved_by: userId,
          approved_at: new Date().toISOString(),
          reproval_note: null,
        })
        .in("id", idsFechados);
      if (eFechar) return { error: eFechar.message };
    }

    // o cadeado por último: se a gravação do retrato falhar, a competência
    // continua aberta em vez de ficar fechada em cima de nada
    const { error } = await supabase
      .from("rv_period_locks")
      .insert({ tenant_id: tenantId, period, locked_by: userId, closed_entry_ids: idsFechados });
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

    const { data: cadeado } = await supabase
      .from("rv_period_locks")
      .select("id, closed_entry_ids")
      .eq("tenant_id", tenantId).eq("period", period).maybeSingle();
    if (!cadeado) return { error: "Esta competência não está fechada." };

    // Devolve EXATAMENTE os lançamentos que o fechamento aprovou, e só eles. O
    // que o gestor já tinha aprovado à mão antes continua aprovado: aquilo foi
    // decisão dele, não do cadeado, e reabrir a competência não a desfaz.
    // cliente do usuário pelo mesmo motivo do fechamento: `guard_goal_entry_closure`
    // exige adm/owner para uma meta voltar a `aberta`, e lê isso do `auth.uid()`
    const ids = cadeado.closed_entry_ids ?? [];
    if (ids.length) {
      const { error: eAbrir } = await supabase
        .from("individual_goal_entries")
        .update({ approval_status: "aberta", approved_by: null, approved_at: null })
        .eq("tenant_id", tenantId)
        .in("id", ids);
      if (eAbrir) return { error: eAbrir.message };
    }

    const { error } = await supabase
      .from("rv_period_locks").delete().eq("tenant_id", tenantId).eq("period", period);
    if (error) return { error: error.message };

    revalidatePath("/metas");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
