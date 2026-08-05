"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { MonthInput } from "@/components/ui/MonthInput";
import { YearSelect } from "@/components/ui/YearSelect";
import { Dropdown, ItemDeMenu } from "@/components/ui/Dropdown";
import { BotaoFiltros, PainelDeFiltros } from "@/components/ui/Filtros";
import { OkNokInput } from "@/components/ui/OkNokInput";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  createIndividualGoal, updateIndividualGoal, deleteIndividualGoal,
  upsertGoalEntry, deleteGoalEntry, setEntryWeights,
  approveGoalEntry, reproveGoalEntry, approveMonth, reopenGoalEntry,
  copyPreviousMonthEntries,
} from "@/lib/actions/individual-goals";
import { GOAL_DIRECTION, FAROL_LABEL, FAROL_TONE, GOAL_ENTRY_STATUS, GOAL_ENTRY_STATUS_TONE, isMetaBinaria, BINARIA_OK } from "@/lib/constants";
import { farolAttainment, attainmentCredit, type FarolStatus } from "@/lib/goals-farol";
import { formatNumber, formatMetaValor } from "@/lib/format";
import type { Enums } from "@/types/database";
import { confirmDialog } from "@/components/ui/confirm";

const fmtBRL = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

export type GoalEntryLite = { period: string; target: number; actual: number | null; weight: number; note: string | null; partial: number | null; status: Enums<"goal_entry_status">; approvedAt: string | null; reprovalNote: string | null };
// linha do tempo da RV resolvida em Configurações: valor vale a partir de `from` até a próxima vigência
export type RvTimeline = { ownerId: string; from: string; value: number };
export type GoalRow = {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  direction: Enums<"goal_direction">;
  partialPct: number | null;
  ownerId: string;
  ownerName: string;
  deptId: string | null;
  subdeptId: string | null;
  entries: GoalEntryLite[];
};
export type Opt = { id: string; name: string };
export type SubOpt = { id: string; name: string; departmentId: string };
export type Member = { id: string; name: string };

/**
 * Mes de abertura do farol: o ANTERIOR, nao o corrente.
 *
 * Meta mensal se apura depois que o mes fecha. Abrir em agosto significava cair
 * num mes ainda em curso, sempre vazio, e obrigar o usuario a voltar um mes toda
 * vez que entra na tela.
 */
function mesAnterior() {
  const d = new Date();
  d.setDate(1); // evita o salto de 31/03 para 03/03 ao voltar um mes
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function nowYear() {
  return String(new Date().getFullYear());
}
const periodOf = (month: string) => `${month}-01`;
const prevMonthOf = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (month: string) => {
  const [y, m] = month.split("-");
  return `${m}/${y}`;
};

const BAR_COLOR: Record<FarolStatus, string> = { atingida: "var(--mh-success)", parcial: "var(--mh-warning)", nao_atingida: "var(--mh-danger)", pendente: "transparent" };

type Row = { goal: GoalRow; pct: number | null; status: FarolStatus; target: number | null; actual: number | null; weight: number; partial: number | null; rvShare: number | null; rvPay: number; entryStatus: Enums<"goal_entry_status"> | null; reprovalNote: string | null };

export function IndividualGoalsFarol({
  goals, canManageOthers, canCreateGoals, isAdmin, reportIds, currentUserId, members, departments, subdepartments, rvTimelines = [],
}: {
  goals: GoalRow[];
  canManageOthers: boolean;
  canCreateGoals: boolean;
  isAdmin: boolean;
  reportIds: string[];
  currentUserId: string;
  members: Member[];
  departments: Opt[];
  subdepartments: SubOpt[];
  rvTimelines?: RvTimeline[];
}) {
  const reportSet = useMemo(() => new Set(reportIds), [reportIds]);
  // pode editar a DEFINIÇÃO da meta (alvo, peso, conceito) do dono
  const canEditDef = (ownerId: string) => isAdmin || reportSet.has(ownerId);
  // pode fechar (aprovar/reprovar) as metas do dono
  const canClose = (ownerId: string) => isAdmin || reportSet.has(ownerId);
  // pode lançar a apuração (realizado) — o próprio dono, o gestor ou admin
  const canApurar = (ownerId: string) => ownerId === currentUserId || isAdmin || reportSet.has(ownerId);
  const [mode, setMode] = useState<"mes" | "ano">("mes");
  const [month, setMonth] = useState(mesAnterior());
  const [year, setYear] = useState(nowYear());
  const [deptId, setDeptId] = useState("");
  const [subId, setSubId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [editGoal, setEditGoal] = useState<GoalRow | null>(null);
  const [entryGoal, setEntryGoal] = useState<GoalRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [weightsOpen, setWeightsOpen] = useState(false);
  const [reproveTarget, setReproveTarget] = useState<{ goalId: string; name: string } | null>(null);
  const [reopenTarget, setReopenTarget] = useState<{ goalId: string; name: string } | null>(null);
  const [closeMonthOpen, setCloseMonthOpen] = useState(false);
  const [copyPrevOpen, setCopyPrevOpen] = useState(false);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);

  const subOpts = useMemo(
    () => (deptId ? subdepartments.filter((s) => s.departmentId === deptId) : subdepartments),
    [subdepartments, deptId],
  );
  const ownerOpts = useMemo(() => {
    const seen = new Map<string, string>();
    for (const g of goals) if (!seen.has(g.ownerId)) seen.set(g.ownerId, g.ownerName);
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [goals]);

  const filtered = useMemo(
    () => goals.filter((g) =>
      (!deptId || g.deptId === deptId) && (!subId || g.subdeptId === subId) && (!ownerId || g.ownerId === ownerId)),
    [goals, deptId, subId, ownerId],
  );

  const period = periodOf(month);
  // anos que têm lançamento: entram na lista do seletor de ano
  const periodosCarregados = useMemo(() => goals.flatMap((g) => g.entries.map((e) => e.period)), [goals]);
  // RV vinda de Configurações: valor vigente = última vigência <= competência (0/ausente = sem RV)
  const rvByOwner = useMemo(() => {
    const m = new Map<string, RvTimeline[]>();
    for (const t of rvTimelines) { const a = m.get(t.ownerId) ?? []; a.push(t); m.set(t.ownerId, a); }
    for (const a of m.values()) a.sort((x, y) => x.from.localeCompare(y.from));
    return m;
  }, [rvTimelines]);
  const rvFor = useMemo(() => (owner: string, at: string): number | null => {
    const list = rvByOwner.get(owner);
    if (!list) return null;
    let best: RvTimeline | null = null;
    for (const t of list) if (t.from <= at && (!best || t.from > best.from)) best = t;
    return best && best.value > 0 ? best.value : null;
  }, [rvByOwner]);

  const view = useMemo(() => {
    const counts: Record<FarolStatus, number> = { atingida: 0, parcial: 0, nao_atingida: 0, pendente: 0 };
    const rows: Row[] = [];
    let rvPayTotal = 0;
    let rvHasPool = false; // existe pote de RV no período em vista
    let rvWarn = false;    // pote existe mas pesos ≠ 100% em algum colaborador/mês

    if (mode === "ano") {
      const prefix = `${year}-`;
      let tot = 0, creditSum = 0, aw = 0, tw = 0, allW = true;
      // RV anual: rateia mês a mês por colaborador (pesos do mês devem somar 100%)
      const rvPayByGoal = new Map<string, number>();
      // agrupa lançamentos do ano por colaborador+mês
      const byOwnerMonth = new Map<string, { goalId: string; ownerId: string; period: string; weight: number; credit: number }[]>();
      for (const g of filtered) {
        const pp = g.partialPct ?? 0;
        const ye = g.entries.filter((e) => e.period.startsWith(prefix));
        let tSum = 0, aSum = 0, pSum = 0, hasP = false, has = false;
        for (const e of ye) {
          tot += 1;
          const st = farolAttainment(g.direction, e.target, e.actual, e.partial).status;
          counts[st] += 1;
          const credit = attainmentCredit(st, pp);
          creditSum += credit;
          if (e.weight > 0) { tw += e.weight; aw += e.weight * credit; }
          else allW = false;
          const k = `${g.ownerId}|${e.period}`;
          const arr = byOwnerMonth.get(k) ?? [];
          arr.push({ goalId: g.id, ownerId: g.ownerId, period: e.period, weight: e.weight, credit });
          byOwnerMonth.set(k, arr);
          if (e.actual != null) { tSum += e.target; aSum += e.actual; has = true; }
          if (e.partial != null) { pSum += e.partial; hasP = true; }
        }
        if (ye.length === 0) continue;
        const r = farolAttainment(g.direction, tSum, has ? aSum : null, hasP ? pSum : null);
        rows.push({ goal: g, pct: r.pct, status: r.status, target: has ? tSum : null, actual: has ? aSum : null, weight: 0, partial: hasP ? pSum : null, rvShare: null, rvPay: 0, entryStatus: null, reprovalNote: null });
      }
      for (const [, items] of byOwnerMonth) {
        const pool = rvFor(items[0].ownerId, items[0].period);
        if (pool == null) continue;
        rvHasPool = true;
        const sumW = Math.round(items.reduce((s, x) => s + x.weight, 0));
        if (sumW !== 100) { rvWarn = true; continue; }
        for (const x of items) {
          const pay = pool * (x.weight / 100) * x.credit;
          rvPayByGoal.set(x.goalId, (rvPayByGoal.get(x.goalId) ?? 0) + pay);
          rvPayTotal += pay;
        }
      }
      for (const r of rows) r.rvPay = rvPayByGoal.get(r.goal.id) ?? 0;
      const allWeighted = tot > 0 && allW;
      const accum = tot === 0 ? null : Math.round((allWeighted && tw > 0 ? aw / tw : creditSum / tot) * 100);
      return { rows, counts, accum, allWeighted, rvPayTotal, rvHasPool, rvWarn, sub: accum == null ? "Sem registros no ano" : `${counts.atingida} atingidas · ${counts.parcial} parciais em ${tot} metas-mês${allWeighted ? " · ponderado" : ""}` };
    }

    // ---- mensal ----
    const raw: { goal: GoalRow; e: GoalEntryLite; status: FarolStatus; pct: number | null; credit: number }[] = [];
    for (const g of filtered) {
      const e = g.entries.find((x) => x.period === period);
      if (!e) continue;
      const r = farolAttainment(g.direction, e.target, e.actual, e.partial);
      counts[r.status] += 1;
      raw.push({ goal: g, e, status: r.status, pct: r.pct, credit: attainmentCredit(r.status, g.partialPct ?? 0) });
    }
    // rateio da RV por colaborador (exige pesos do mês = 100%)
    const rvByGoal = new Map<string, { share: number | null; pay: number }>();
    const byOwner = new Map<string, typeof raw>();
    for (const x of raw) { const arr = byOwner.get(x.goal.ownerId) ?? []; arr.push(x); byOwner.set(x.goal.ownerId, arr); }
    for (const [ownerId, items] of byOwner) {
      const pool = rvFor(ownerId, period);
      if (pool == null) continue;
      rvHasPool = true;
      const sumW = Math.round(items.reduce((s, x) => s + x.e.weight, 0));
      if (sumW !== 100) { rvWarn = true; for (const x of items) rvByGoal.set(x.goal.id, { share: null, pay: 0 }); continue; }
      for (const x of items) {
        const share = pool * (x.e.weight / 100);
        const pay = share * x.credit;
        rvByGoal.set(x.goal.id, { share, pay });
        rvPayTotal += pay;
      }
    }
    for (const x of raw) {
      const rv = rvByGoal.get(x.goal.id);
      rows.push({ goal: x.goal, pct: x.pct, status: x.status, target: x.e.target, actual: x.e.actual, weight: x.e.weight, partial: x.e.partial, rvShare: rv?.share ?? null, rvPay: rv?.pay ?? 0, entryStatus: x.e.status, reprovalNote: x.e.reprovalNote });
    }
    const allWeighted = rows.length > 0 && rows.every((r) => r.weight > 0);
    let accum: number | null = null;
    if (rows.length) {
      if (allWeighted) {
        let aw = 0, tw = 0;
        for (const r of rows) { tw += r.weight; aw += r.weight * attainmentCredit(r.status, r.goal.partialPct ?? 0); }
        accum = tw > 0 ? Math.round((aw / tw) * 100) : null;
      } else {
        const creditSum = rows.reduce((s, r) => s + attainmentCredit(r.status, r.goal.partialPct ?? 0), 0);
        accum = Math.round((creditSum / rows.length) * 100);
      }
    }
    return { rows, counts, accum, allWeighted, rvPayTotal, rvHasPool, rvWarn, sub: accum == null ? "Sem registros no mês" : `${counts.atingida} atingidas · ${counts.parcial} parciais em ${rows.length}${allWeighted ? " · ponderado" : ""}` };
  }, [filtered, mode, period, year, rvFor]);

  const owners = useMemo(() => new Set(view.rows.map((r) => r.goal.ownerId)), [view.rows]);

  /**
   * Filtro por status, acionado clicando nos cards do resumo.
   *
   * O valor guardado é "bruto" e o que vale é o derivado: se o status escolhido
   * deixar de existir no período (trocou de mês, de colaborador, de setor), o
   * filtro simplesmente para de valer, em vez de deixar a pessoa olhando uma
   * tabela vazia sem entender por quê. Derivar resolve isso sem um `useEffect`
   * de sincronia, que é justamente o tipo de efeito que costuma virar bug.
   */
  const [filtroBruto, setFiltroBruto] = useState<FarolStatus | null>(null);
  const filtroStatus = filtroBruto && view.counts[filtroBruto] > 0 ? filtroBruto : null;

  // card sem nenhuma meta não vira botão: não haveria o que mostrar ao clicar
  const cardFiltravel = (status: FarolStatus) =>
    view.counts[status] > 0
      ? () => setFiltroBruto((atual) => (atual === status ? null : status))
      : undefined;

  const linhasVisiveis = filtroStatus ? view.rows.filter((r) => r.status === filtroStatus) : view.rows;

  // quantos filtros estao ligados: e o selo no botao, para o funil nao esconder
  // que a tela esta recortada. Sem ele, filtro fechado vira filtro esquecido.
  const filtrosAtivos = [deptId, subId, ownerId].filter(Boolean).length;
  const hasRv = view.rvHasPool;
  const canWeights = mode === "mes" && view.rows.length > 0 && owners.size === 1;
  const showOwner = canManageOthers && owners.size > 1;
  const periodText = mode === "ano" ? `Ano ${year}` : monthLabel(month);
  // fechamento do mês: um único colaborador em vista, o gestor pode fechar e há metas abertas
  const singleOwner = owners.size === 1 ? [...owners][0] : null;
  const hasAberta = view.rows.some((r) => r.entryStatus === "aberta");
  const canCloseMonth = mode === "mes" && !!singleOwner && canClose(singleOwner) && hasAberta;
  const abertaCount = view.rows.filter((r) => r.entryStatus === "aberta").length;
  const singleOwnerName = singleOwner ? view.rows.find((r) => r.goal.ownerId === singleOwner)?.goal.ownerName ?? null : null;

  // reaproveitar metas do mês anterior: exige um colaborador selecionado que o usuário gerencie
  const prevMonth = prevMonthOf(month);
  const prevPeriod = periodOf(prevMonth);
  const copyCandidates = useMemo(
    () => (ownerId
      ? goals.filter((g) => g.ownerId === ownerId && g.entries.some((e) => e.period === prevPeriod) && !g.entries.some((e) => e.period === period))
      : []),
    [goals, ownerId, prevPeriod, period],
  );
  const copyOwnerName = ownerId ? goals.find((g) => g.ownerId === ownerId)?.ownerName ?? null : null;
  const canCopyPrev = mode === "mes" && !!ownerId && canEditDef(ownerId) && copyCandidates.length > 0;

  // metas (indicadores) que ainda não têm registro neste mês (para "Adicionar meta")
  const addableExisting = useMemo(
    () => filtered.filter((g) => !g.entries.some((e) => e.period === period)),
    [filtered, period],
  );
  const defaultOwner = owners.size === 1 ? [...owners][0] : ownerId || "";

  return (
    <div>
      {/* UMA barra só, tudo alinhado à esquerda. Antes os filtros ficavam de um
          lado e os botões do outro, e o olho tinha de atravessar a tela para ir
          de um ao outro. Período primeiro (é o contexto de tudo), depois o que
          recorta, depois o que faz. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "flex-end", marginBottom: "1.1rem" }}>
        <div>
          <label className="label">Período</label>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <select className="select" value={mode} onChange={(e) => setMode(e.target.value as "mes" | "ano")} style={{ width: "auto" }}>
              <option value="mes">Mês</option>
              <option value="ano">Ano</option>
            </select>
            {mode === "mes" ? (
              <MonthInput value={month} onChange={(v) => setMonth(v || mesAnterior())} />
            ) : (
              <YearSelect value={year} onChange={setYear} periodos={periodosCarregados} />
            )}
          </div>
        </div>
        {canManageOthers && (
          <BotaoFiltros aberto={filtrosAbertos} onToggle={() => setFiltrosAbertos((v) => !v)} contador={filtrosAtivos} />
        )}
        {mode === "mes" && canCreateGoals && (
          <>
            {/* As secundárias vão para o menu; a primária continua um botão só,
                à vista. Enterrar "Adicionar meta" num dropdown deixaria a tela
                mais limpa e o trabalho mais lento, que é uma troca ruim. */}
            <Dropdown rotulo="Ações" largura={260}>
              {(fechar) => (
                <>
                  <ItemDeMenu
                    disabled={!canCopyPrev}
                    titulo={ownerId ? (copyCandidates.length ? `Copia as ${copyCandidates.length} metas de ${monthLabel(prevMonth)} para este mês` : "Nenhuma meta do mês anterior para reaproveitar") : "Selecione um colaborador para reaproveitar as metas do mês anterior"}
                    onClick={() => { setCopyPrevOpen(true); fechar(); }}
                  >
                    Copiar metas do mês anterior
                  </ItemDeMenu>
                  <ItemDeMenu
                    disabled={!canCloseMonth}
                    titulo={canCloseMonth ? "Aprova todas as metas abertas do colaborador nesta competência" : "Selecione um colaborador com metas em apuração"}
                    onClick={() => { setCloseMonthOpen(true); fechar(); }}
                  >
                    Fechar mês
                  </ItemDeMenu>
                  <ItemDeMenu
                    disabled={!canWeights}
                    titulo={canWeights ? "" : "Selecione um colaborador para distribuir pesos"}
                    onClick={() => { setWeightsOpen(true); fechar(); }}
                  >
                    Distribuir pesos
                  </ItemDeMenu>
                </>
              )}
            </Dropdown>
            <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>+ Adicionar meta</button>
          </>
        )}
      </div>

      {canManageOthers && filtrosAbertos && (
        <PainelDeFiltros contador={filtrosAtivos} onLimpar={() => { setDeptId(""); setSubId(""); setOwnerId(""); }}>
          <div>
            <label className="label">Setor</label>
            <select className="select" value={deptId} onChange={(e) => { setDeptId(e.target.value); setSubId(""); }}>
              <option value="">Todos</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Subsetor</label>
            <select className="select" value={subId} onChange={(e) => setSubId(e.target.value)}>
              <option value="">Todos</option>
              {subOpts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Colaborador</label>
            <select className="select" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Todos</option>
              {ownerOpts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        </PainelDeFiltros>
      )}

      {view.rows.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "1rem", marginBottom: "1.2rem" }}>
          <SummaryCard
            label={`Acumulado · ${periodText}`}
            value={view.accum == null ? "—" : `${view.accum}%`}
            tone={view.accum === 100 ? "green" : "neutral"}
            sub={view.sub}
          />
          <SummaryCard label="Metas atingidas" value={String(view.counts.atingida)} tone="green"
            active={filtroStatus === "atingida"} onClick={cardFiltravel("atingida")} />
          <SummaryCard label="Parciais" value={String(view.counts.parcial)} tone="amber"
            active={filtroStatus === "parcial"} onClick={cardFiltravel("parcial")} />
          <SummaryCard label="Não atingidas" value={String(view.counts.nao_atingida)} tone="red"
            active={filtroStatus === "nao_atingida"} onClick={cardFiltravel("nao_atingida")} />
          <SummaryCard label="Pendentes" value={String(view.counts.pendente)} tone="gray"
            active={filtroStatus === "pendente"} onClick={cardFiltravel("pendente")} />
          {hasRv && <SummaryCard label="RV a pagar" value={fmtBRL(view.rvPayTotal)} tone={view.rvWarn ? "amber" : "green"} sub={view.rvWarn ? "Ajuste os pesos p/ somar 100%" : (mode === "ano" ? `Ano ${year}` : monthLabel(month))} />}
        </div>
      )}

      {view.rows.length === 0 ? (
        <EmptyState
          title={mode === "ano" ? "Nenhum registro no ano" : "Nenhuma meta neste mês"}
          description={mode === "ano" ? "Não há registros de metas para o ano selecionado." : "Use “+ Adicionar meta” para incluir as metas desta competência."}
        />
      ) : (
        <>
          {/* a tabela filtrada precisa dizer que está filtrada: sem isso, "sumiu
              meta" vira chamado de suporte */}
          {filtroStatus && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.6rem", flexWrap: "wrap" }}>
              <span className="muted" style={{ fontSize: "0.85rem" }}>
                Mostrando {linhasVisiveis.length} de {view.rows.length} · só <strong>{FAROL_LABEL[filtroStatus]}</strong>
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFiltroBruto(null)}>Mostrar todas</button>
            </div>
          )}
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table metas-table">
            <thead>
              <tr>
                <th>KPI</th>
                <th>Un. medida</th>
                <th>Conceito</th>
                <th style={{ textAlign: "right" }}>Peso</th>
                {showOwner && <th>Colaborador</th>}
                <th style={{ textAlign: "right" }}>Meta</th>
                <th style={{ textAlign: "right" }}>Meta parcial</th>
                <th style={{ textAlign: "right" }}>Realizado</th>
                <th>Status</th>
                <th style={{ minWidth: 180 }}>Atingimento</th>
                {mode === "mes" && <th>Fechamento</th>}
                {hasRv && <th style={{ textAlign: "right" }}>RV a pagar</th>}
                {mode === "mes" && <th style={{ textAlign: "right" }}>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {linhasVisiveis.map(({ goal: g, pct, status, target, actual, weight, partial, rvShare, rvPay, entryStatus, reprovalNote }) => (
                <tr key={g.id} style={entryStatus === "reprovada" ? { background: "rgba(220,38,38,0.06)" } : undefined}>
                  <td>
                    {canEditDef(g.ownerId) ? (
                      <button type="button" onClick={() => setEditGoal(g)} title="Editar indicador" style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 600, color: "var(--text)", cursor: "pointer", textAlign: "left" }}>
                        {g.name}
                      </button>
                    ) : <span style={{ fontWeight: 600 }}>{g.name}</span>}
                  </td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{g.unit || <span className="soft">—</span>}</td>
                  <td className="muted" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.85rem" }} title={g.description ?? ""}>
                    {g.description || <span className="soft">—</span>}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{mode === "mes" ? `${weight}%` : "—"}</td>
                  {showOwner && (
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                        <Avatar name={g.ownerName} userId={g.ownerId} /> {g.ownerName}
                      </span>
                    </td>
                  )}
                  {/* na meta de sim/não o número gravado é 100/0, mas quem lê
                      precisa ver OK/NOK; a meta e o parcial nem fazem sentido ali */}
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{isMetaBinaria(g.direction) ? "—" : formatMetaValor(target, false)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }} className="muted">{isMetaBinaria(g.direction) ? "—" : formatMetaValor(partial, false)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600 }}>{formatMetaValor(actual, isMetaBinaria(g.direction))}</td>
                  <td><Badge tone={FAROL_TONE[status]}>{FAROL_LABEL[status]}</Badge></td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <div className="progress-track" style={{ flex: 1 }}>
                        <div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%`, background: BAR_COLOR[status] }} />
                      </div>
                      <span style={{ fontSize: "0.8rem", fontWeight: 600, minWidth: 42, textAlign: "right", color: status === "pendente" ? "var(--text-muted)" : BAR_COLOR[status] }}>
                        {pct == null ? "—" : `${pct}%`}
                      </span>
                    </div>
                  </td>
                  {mode === "mes" && (
                    <td style={{ whiteSpace: "nowrap" }}>
                      {entryStatus && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }} title={entryStatus === "reprovada" ? (reprovalNote ? `Motivo: ${reprovalNote}` : "Revise a apuração e reenvie") : entryStatus === "aprovada" ? "Fechada — realizado travado" : "Aguardando fechamento do gestor"}>
                          {entryStatus === "aprovada" && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--mh-success)" }}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                          )}
                          <Badge tone={GOAL_ENTRY_STATUS_TONE[entryStatus]}>{GOAL_ENTRY_STATUS[entryStatus]}</Badge>
                        </span>
                      )}
                    </td>
                  )}
                  {hasRv && (
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {mode === "ano" ? (
                        rvPay > 0 ? <span style={{ fontWeight: 700 }}>{fmtBRL(rvPay)}</span> : <span className="soft">—</span>
                      ) : rvShare != null ? (
                        <span style={{ fontWeight: 700, color: BAR_COLOR[status] === "transparent" ? "var(--text-muted)" : BAR_COLOR[status] }} title={`Cota da RV (peso): ${fmtBRL(rvShare)}`}>{fmtBRL(rvPay)}</span>
                      ) : <span className="soft" title="RV configurada em Configurações; ajuste os pesos p/ somar 100%">—</span>}
                    </td>
                  )}
                  {mode === "mes" && (
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <div style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center", justifyContent: "flex-end" }}>
                        {canApurar(g.ownerId) && entryStatus !== "aprovada" && (
                          <button type="button" className="icon-btn" onClick={() => setEntryGoal(g)} title="Registrar o realizado da competência">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                          </button>
                        )}
                        {canClose(g.ownerId) && entryStatus === "aberta" && (
                          <>
                            <ApproveEntryButton goalId={g.id} period={period} />
                            <button type="button" className="icon-btn icon-btn-danger" onClick={() => setReproveTarget({ goalId: g.id, name: g.name })} title="Reprovar (devolver para revisão)">
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                            </button>
                          </>
                        )}
                        {isAdmin && entryStatus === "aprovada" && (
                          <button type="button" className="icon-btn" onClick={() => setReopenTarget({ goalId: g.id, name: g.name })} title="Reabrir meta aprovada (exige senha de adm/owner)">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" /></svg>
                          </button>
                        )}
                        {canEditDef(g.ownerId) && entryStatus !== "aprovada" && <RemoveEntryButton goalId={g.id} period={period} />}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {editGoal && <GoalDialog goal={editGoal} month={month} onClose={() => setEditGoal(null)} />}
      {entryGoal && <EntryDialog goal={entryGoal} month={month} onClose={() => setEntryGoal(null)} />}
      {addOpen && (
        <AddDialog
          period={period}
          monthLabel={monthLabel(month)}
          existing={addableExisting}
          isAdmin={canManageOthers}
          members={members}
          defaultOwner={defaultOwner}
          onClose={() => setAddOpen(false)}
        />
      )}
      {weightsOpen && <WeightsDialog rows={view.rows} period={period} onClose={() => setWeightsOpen(false)} />}
      {reproveTarget && <ReproveDialog goalId={reproveTarget.goalId} period={period} name={reproveTarget.name} onClose={() => setReproveTarget(null)} />}
      {reopenTarget && <ReopenDialog goalId={reopenTarget.goalId} period={period} name={reopenTarget.name} onClose={() => setReopenTarget(null)} />}
      {closeMonthOpen && singleOwner && (
        <CloseMonthDialog ownerId={singleOwner} ownerName={singleOwnerName} count={abertaCount} period={period} monthLabel={monthLabel(month)} onClose={() => setCloseMonthOpen(false)} />
      )}
      {copyPrevOpen && ownerId && (
        <CopyPrevMonthDialog ownerId={ownerId} ownerName={copyOwnerName} count={copyCandidates.length} fromPeriod={prevPeriod} toPeriod={period} fromLabel={monthLabel(prevMonth)} toLabel={monthLabel(month)} onClose={() => setCopyPrevOpen(false)} />
      )}
    </div>
  );
}

const TONE_FG: Record<string, string> = {
  green: "var(--mh-success)", amber: "var(--mh-warning)", red: "var(--mh-danger)", gray: "var(--text)", blue: "var(--mh-info)", purple: "var(--mh-primary-500)", neutral: "var(--text)",
};

/**
 * Card do resumo. Vira botão de filtro quando recebe `onClick`.
 *
 * Os cards de contagem (atingidas, parciais, não atingidas, pendentes) filtram a
 * tabela. Acumulado e RV a pagar não: são totais do período, não um recorte, e
 * clicar neles não teria o que mostrar.
 *
 * O número no card continua sendo o do PERÍODO INTEIRO, não o do filtro. Se ele
 * passasse a contar só o que está filtrado, os outros cards zerariam e não
 * haveria como trocar de filtro sem antes limpar.
 */
function SummaryCard({ label, value, tone, sub, onClick, active }: {
  label: string; value: string; tone: string; sub?: string;
  onClick?: () => void; active?: boolean;
}) {
  const cor = TONE_FG[tone] ?? "var(--text)";
  const conteudo = (
    <>
      <div className="soft" style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
      <div style={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1.05, color: cor }}>{value}</div>
      {sub && <div className="soft" style={{ fontSize: "0.74rem" }}>{sub}</div>}
    </>
  );
  const base: React.CSSProperties = {
    display: "flex", flexDirection: "column", gap: "0.25rem",
    justifyContent: "center", minHeight: 100,
  };

  if (!onClick) return <div className="card card-pad" style={base}>{conteudo}</div>;

  return (
    <button
      type="button"
      className="card card-pad"
      onClick={onClick}
      aria-pressed={!!active}
      title={active ? "Clique para mostrar todas" : `Mostrar só: ${label}`}
      style={{
        ...base,
        textAlign: "left",
        font: "inherit",
        cursor: "pointer",
        borderColor: active ? cor : undefined,
        boxShadow: active ? `inset 0 0 0 1px ${cor}` : undefined,
        transition: "border-color var(--mh-dur-fast) var(--mh-ease)",
      }}
    >
      {conteudo}
      <span className="soft" style={{ fontSize: "0.68rem", fontWeight: 600, color: active ? cor : undefined }}>
        {active ? "Filtrando · clique para limpar" : "Clique para filtrar"}
      </span>
    </button>
  );
}

function RemoveEntryButton({ goalId, period }: { goalId: string; period: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const onClick = async () => {
    if (!(await confirmDialog({ tone: "danger", confirmLabel: "Excluir", message: "Remover esta meta desta competência? (o indicador continua disponível para outros meses)" }))) return;
    start(async () => {
      await deleteGoalEntry({ goal_id: goalId, period });
      router.refresh();
    });
  };
  return (
    <button type="button" className="icon-btn icon-btn-danger" disabled={pending} onClick={onClick} title="Remover a meta desta competência">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
    </button>
  );
}

function ApproveEntryButton({ goalId, period }: { goalId: string; period: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const onClick = async () => {
    start(async () => {
      await approveGoalEntry({ goal_id: goalId, period });
      router.refresh();
    });
  };
  return (
    <button type="button" className="icon-btn" disabled={pending} onClick={onClick} title="Aprovar (fechar) a meta" style={{ color: "var(--mh-success)" }}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
    </button>
  );
}

function CopyPrevMonthDialog({ ownerId, ownerName, count, fromPeriod, toPeriod, fromLabel, toLabel, onClose }: { ownerId: string; ownerName: string | null; count: number; fromPeriod: string; toPeriod: string; fromLabel: string; toLabel: string; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const submit = () => {
    start(async () => {
      const r = await copyPreviousMonthEntries({ owner_id: ownerId, from_period: fromPeriod, to_period: toPeriod });
      if (r?.error) { setError(r.error); return; }
      onClose();
      router.refresh();
    });
  };
  return (
    <Modal title="Reaproveitar metas do mês anterior" onClose={onClose} footer={<>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>Copiar metas</button>
    </>}>
      <p style={{ margin: 0 }}>
        Copiar as metas de <strong>{fromLabel}</strong> para <strong>{toLabel}</strong>{ownerName ? <> de <strong>{ownerName}</strong></> : null}?
      </p>
      <div className="card card-pad" style={{ display: "flex", alignItems: "center", gap: "0.6rem", background: "var(--bg-subtle, rgba(0,0,0,0.02))" }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--primary)", flexShrink: 0 }}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
        <span><strong>{count}</strong> meta{count === 1 ? "" : "s"} {count === 1 ? "será copiada" : "serão copiadas"} com o mesmo alvo, meta parcial e peso — o realizado ficará em branco.</span>
      </div>
      <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>Metas que já existem neste mês não são alteradas.</p>
      {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}

function CloseMonthDialog({ ownerId, ownerName, count, period, monthLabel, onClose }: { ownerId: string; ownerName: string | null; count: number; period: string; monthLabel: string; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const submit = () => {
    start(async () => {
      const r = await approveMonth({ owner_id: ownerId, period });
      if (r?.error) { setError(r.error); return; }
      onClose();
      router.refresh();
    });
  };
  return (
    <Modal title="Fechar mês" onClose={onClose} footer={<>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>Aprovar e fechar</button>
    </>}>
      <p style={{ margin: 0 }}>
        Fechar a competência <strong>{monthLabel}</strong>{ownerName ? <> de <strong>{ownerName}</strong></> : null}?
      </p>
      <div className="card card-pad" style={{ display: "flex", alignItems: "center", gap: "0.6rem", background: "var(--bg-subtle, rgba(0,0,0,0.02))" }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--mh-success)", flexShrink: 0 }}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
        <span><strong>{count}</strong> meta{count === 1 ? "" : "s"} em apuração {count === 1 ? "será aprovada" : "serão aprovadas"} e {count === 1 ? "travada" : "travadas"}.</span>
      </div>
      <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>Depois de aprovado, o realizado não poderá ser alterado — só com reabertura por um adm/owner.</p>
      {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}

function ReproveDialog({ goalId, period, name, onClose }: { goalId: string; period: string; name: string; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const submit = () => {
    if (!note.trim()) { setError("Informe o motivo da reprovação."); return; }
    start(async () => {
      const r = await reproveGoalEntry({ goal_id: goalId, period, note: note.trim() });
      if (r?.error) { setError(r.error); return; }
      onClose();
      router.refresh();
    });
  };
  return (
    <Modal title={`Reprovar · ${name}`} onClose={onClose} footer={<>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>Reprovar</button>
    </>}>
      <div>
        <label className="label">Motivo da reprovação</label>
        <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: valor apurado não bate com o relatório…" />
      </div>
      <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>O colaborador verá o motivo e poderá revisar o realizado.</p>
      {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}

function ReopenDialog({ goalId, period, name, onClose }: { goalId: string; period: string; name: string; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const submit = () => {
    if (!password) { setError("Digite a sua senha."); return; }
    start(async () => {
      const r = await reopenGoalEntry({ goal_id: goalId, period, password });
      if (r?.error) { setError(r.error); return; }
      onClose();
      router.refresh();
    });
  };
  return (
    <Modal title={`Reabrir · ${name}`} onClose={onClose} footer={<>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>Reabrir</button>
    </>}>
      <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>Reabrir destrava o realizado desta meta e volta o status para “Em apuração”. Confirme com a sua senha de adm/owner.</p>
      <div>
        <label className="label">Sua senha</label>
        <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </div>
      {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 1rem", zIndex: 60, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 480, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>
        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>{children}</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>{footer}</div>
      </div>
    </div>
  );
}

const DIRECTION_OPTS = Object.entries(GOAL_DIRECTION) as [Enums<"goal_direction">, string][];

function AddDialog({ period, monthLabel, existing, isAdmin, members, defaultOwner, onClose }: {
  period: string; monthLabel: string; existing: GoalRow[]; isAdmin: boolean; members: Member[]; defaultOwner: string; onClose: () => void;
}) {
  const [sel, setSel] = useState("__new__");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [description, setDescription] = useState("");
  const [direction, setDirection] = useState<Enums<"goal_direction">>("maior_melhor");
  const [partialPct, setPartialPct] = useState("0");
  const [ownerId, setOwnerId] = useState(defaultOwner);
  const [target, setTarget] = useState("");
  const [partial, setPartial] = useState("");
  const [actual, setActual] = useState("");
  const [binValor, setBinValor] = useState<number | null>(null);
  const [weight, setWeight] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const isNew = sel === "__new__";
  // meta de sim/nao: no indicador NOVO vem do seletor; no existente, do proprio
  // indicador, que ja tem o tipo gravado
  const binaria = isNew
    ? isMetaBinaria(direction)
    : isMetaBinaria(existing.find((g) => g.id === sel)?.direction ?? "maior_melhor");

  const submit = () => {
    setError("");
    if (isNew && !name.trim()) { setError("Informe o nome do indicador."); return; }
    // binaria nao pergunta meta: ela e sempre 100 (= OK), fixa
    if (!binaria && (target.trim() === "" || Number.isNaN(Number(target)))) { setError("Informe a meta do período."); return; }
    // se há meta parcial, o % do parcial é obrigatório (> 0)
    if (!binaria && partial.trim() !== "") {
      if (isNew) {
        if (partialPct.trim() === "" || !(Number(partialPct) > 0)) { setError("Como há meta parcial, informe o % do parcial (maior que 0)."); return; }
      } else {
        const selGoal = existing.find((g) => g.id === sel);
        if (!selGoal?.partialPct || !(selGoal.partialPct > 0)) { setError("Este indicador não tem % do parcial definido. Defina em “Editar” antes de usar meta parcial."); return; }
      }
    }
    start(async () => {
      let goalId = sel;
      if (isNew) {
        const res = await createIndividualGoal({
          name, description,
          // sim/nao nao tem unidade de medida: OK/NOK e o proprio resultado
          unit: binaria ? "OK/NOK" : unit,
          direction,
          // num sim/nao nao existe meio-termo, entao nao ha parcial a creditar
          partial_pct: binaria ? null : (partialPct.trim() === "" ? null : Number(partialPct)),
          owner_id: isAdmin ? ownerId || undefined : undefined,
        });
        if ("error" in res) { setError(res.error); return; }
        goalId = res.id;
      }
      const r = await upsertGoalEntry({
        goal_id: goalId,
        period,
        // a coluna e `not null`, entao a binaria grava 100 (= OK) como meta fixa
        target_value: binaria ? BINARIA_OK : Number(target),
        actual_value: binaria ? binValor : (actual.trim() === "" ? null : Number(actual)),
        weight: weight.trim() === "" ? 0 : Number(weight),
        note,
        partial_value: binaria ? null : (partial.trim() === "" ? null : Number(partial)),
      });
      if (r.error) { setError(r.error); return; }
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal
      title={`Adicionar meta · ${monthLabel}`}
      onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>{pending ? "Salvando…" : "Adicionar"}</button>
      </>}
    >
      <div>
        <label className="label">Indicador</label>
        <select className="select" value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="__new__">+ Novo indicador</option>
          {existing.map((g) => <option key={g.id} value={g.id}>{g.name}{isAdmin ? ` · ${g.ownerName}` : ""}</option>)}
        </select>
      </div>

      {isNew && (
        <>
          <div>
            <label className="label">Nome do indicador</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Faturamento, INAD…" />
          </div>
          <div>
            <label className="label">Conceito <span className="soft">(métrica)</span></label>
            <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: binaria ? "1fr" : "1fr 1fr", gap: "0.8rem" }}>
            {!binaria && (
              <div>
                <label className="label">Unidade</label>
                <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="R$, %, un…" />
              </div>
            )}
            <div>
              <label className="label">Tipo de meta</label>
              <select className="select" value={direction} onChange={(e) => setDirection(e.target.value as Enums<"goal_direction">)}>
                {DIRECTION_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          {isAdmin && (
            <div>
              <label className="label">Colaborador (dono) <span className="soft">(vazio = você)</span></label>
              <select className="select" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                <option value="">Você</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          )}
          {!binaria && (
            <div style={{ maxWidth: 220 }}>
              <label className="label">% do parcial</label>
              <input type="number" step="any" min={0} max={100} className="input" value={partialPct} onChange={(e) => setPartialPct(e.target.value)} placeholder="0" />
              <p className="soft" style={{ fontSize: "0.72rem", margin: "0.3rem 0 0" }}>Quanto o parcial credita na nota e paga da RV.</p>
            </div>
          )}
        </>
      )}

      {/* Meta e parcial nao aparecem no sim/nao: a meta e sempre "fez", e nao ha
          meio-termo a informar. Sobram realizado e peso. */}
      <div style={{ display: "grid", gridTemplateColumns: binaria ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: "0.8rem" }}>
        {!binaria && (
          <>
            <div>
              <label className="label">Meta</label>
              <input type="number" step="any" className="input" value={target} onChange={(e) => setTarget(e.target.value)} />
            </div>
            <div>
              <label className="label">Parcial <span className="soft">(opc.)</span></label>
              <input type="number" step="any" className="input" value={partial} onChange={(e) => setPartial(e.target.value)} placeholder="—" />
            </div>
          </>
        )}
        <div>
          <label className="label">Realizado <span className="soft">(opc.)</span></label>
          {binaria
            ? <OkNokInput value={binValor} onChange={setBinValor} />
            : <input type="number" step="any" className="input" value={actual} onChange={(e) => setActual(e.target.value)} placeholder="—" />}
        </div>
        <div>
          <label className="label">Peso (%)</label>
          <input type="number" step="any" min={0} max={100} className="input" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="0" />
        </div>
      </div>
      <div>
        <label className="label">Observação <span className="soft">(opcional)</span></label>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}

function GoalDialog({ goal, month, onClose }: { goal: GoalRow; month: string; onClose: () => void }) {
  const [name, setName] = useState(goal.name);
  const [description, setDescription] = useState(goal.description ?? "");
  const [unit, setUnit] = useState(goal.unit);
  const [direction, setDirection] = useState<Enums<"goal_direction">>(goal.direction);
  const [partialPct, setPartialPct] = useState(goal.partialPct != null ? String(goal.partialPct) : "0");
  // valores por competência
  const [m, setM] = useState(month);
  const [target, setTarget] = useState("");
  const [partial, setPartial] = useState("");
  const [weight, setWeight] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const binaria = isMetaBinaria(direction);
  const monthEntry = goal.entries.find((x) => x.period === periodOf(m)) ?? null;
  useEffect(() => {
    setTarget(monthEntry ? String(monthEntry.target) : "");
    setPartial(monthEntry?.partial != null ? String(monthEntry.partial) : "");
    setWeight(monthEntry ? String(monthEntry.weight) : "");
  }, [monthEntry]);

  const save = () => {
    setError("");
    if (!name.trim()) { setError("Informe o nome do indicador."); return; }
    if (!binaria && target.trim() !== "" && Number.isNaN(Number(target))) { setError("Meta da competência inválida."); return; }
    // se há meta parcial, o % do parcial é obrigatório (> 0)
    if (!binaria && partial.trim() !== "" && (partialPct.trim() === "" || !(Number(partialPct) > 0))) {
      setError("Como há meta parcial, informe o % do parcial (maior que 0).");
      return;
    }
    start(async () => {
      const res = await updateIndividualGoal({
        id: goal.id, name, description,
        unit: binaria ? "OK/NOK" : unit,
        direction,
        partial_pct: binaria ? null : (partialPct.trim() === "" ? null : Number(partialPct)),
      });
      if (res.error) { setError(res.error); return; }
      // grava os valores da competência (preserva o realizado); só se houver meta
      // na binaria nao ha meta a digitar, entao basta existir a competencia
      if (binaria || target.trim() !== "") {
        const e = await upsertGoalEntry({
          goal_id: goal.id,
          period: periodOf(m),
          target_value: binaria ? BINARIA_OK : Number(target),
          actual_value: monthEntry?.actual ?? null,
          weight: weight.trim() === "" ? 0 : Number(weight),
          note: monthEntry?.note ?? "",
          partial_value: binaria ? null : (partial.trim() === "" ? null : Number(partial)),
        });
        if (e.error) { setError(e.error); return; }
      }
      onClose();
      router.refresh();
    });
  };
  const removeIndicator = async () => {
    if (!(await confirmDialog({ tone: "danger", confirmLabel: "Excluir", message: "Excluir este indicador e TODOS os seus registros em todos os meses?" }))) return;
    start(async () => {
      const res = await deleteIndividualGoal(goal.id);
      if (res.error) { setError(res.error); return; }
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal
      title="Editar indicador"
      onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-danger" style={{ marginRight: "auto" }} disabled={pending} onClick={removeIndicator}>Excluir indicador</button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>{pending ? "Salvando…" : "Salvar"}</button>
      </>}
    >
      <div>
        <label className="label">Nome do indicador</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="label">Conceito <span className="soft">(métrica)</span></label>
        <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: binaria ? "1fr" : "1fr 1fr", gap: "0.8rem" }}>
        {!binaria && (
          <div>
            <label className="label">Unidade</label>
            <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="R$, %, un…" />
          </div>
        )}
        <div>
          <label className="label">Tipo de meta</label>
          <select className="select" value={direction} onChange={(e) => setDirection(e.target.value as Enums<"goal_direction">)}>
            {DIRECTION_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      {!binaria && (
        <div style={{ maxWidth: 220 }}>
          <label className="label">% do parcial</label>
          <input type="number" step="any" min={0} max={100} className="input" value={partialPct} onChange={(e) => setPartialPct(e.target.value)} placeholder="0" />
          <p className="soft" style={{ fontSize: "0.72rem", margin: "0.3rem 0 0" }}>Quanto o atingimento parcial credita na nota e paga da RV (ex.: 50%).</p>
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.9rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "0.8rem" }}>
          <strong style={{ fontSize: "0.9rem" }}>Valores da competência</strong>
          <div>
            <label className="label">Competência</label>
            <MonthInput value={m} onChange={setM} style={{ width: 160 }} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: binaria ? "1fr" : "1fr 1fr 1fr", gap: "0.8rem" }}>
          {!binaria && (
            <>
              <div>
                <label className="label">Meta {unit && <span className="soft">({unit})</span>}</label>
                <input type="number" step="any" className="input" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="—" />
              </div>
              <div>
                <label className="label">Meta parcial <span className="soft">(opc.)</span></label>
                <input type="number" step="any" className="input" value={partial} onChange={(e) => setPartial(e.target.value)} placeholder="—" />
              </div>
            </>
          )}
          <div>
            <label className="label">Peso (%)</label>
            <input type="number" step="any" min={0} max={100} className="input" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="0" />
          </div>
        </div>
        <p className="soft" style={{ fontSize: "0.72rem", margin: 0 }}>
          {binaria ? "O peso vale para a competência selecionada. O resultado (OK/NOK) é lançado em “Registrar”." : "Meta, parcial e peso valem para a competência selecionada. O realizado é lançado em “Registrar”."}{" "} {monthEntry ? "" : "Esta meta ainda não está nesta competência — preencha a meta para incluí-la."}
        </p>
      </div>
      {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}

function EntryDialog({ goal, month, onClose }: { goal: GoalRow; month: string; onClose: () => void }) {
  const binaria = isMetaBinaria(goal.direction);
  const entry = goal.entries.find((x) => x.period === periodOf(month)) ?? null;
  const [actual, setActual] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  useEffect(() => {
    setActual(entry?.actual != null ? String(entry.actual) : "");
    setNote(entry?.note ?? "");
  }, [entry]);

  const submit = () => {
    setError("");
    if (!entry) { setError("Esta meta não está cadastrada nesta competência."); return; }
    start(async () => {
      // registra apenas o realizado; meta/parcial/peso são preservados
      const res = await upsertGoalEntry({
        goal_id: goal.id,
        period: periodOf(month),
        target_value: entry.target,
        actual_value: actual.trim() === "" ? null : Number(actual),
        weight: entry.weight,
        note,
        partial_value: entry.partial,
      });
      if (res.error) { setError(res.error); return; }
      onClose();
      router.refresh();
    });
  };

  const readonly = (label: React.ReactNode, value: string) => (
    <div>
      <label className="label">{label}</label>
      <input className="input" value={value} disabled readOnly style={{ background: "var(--surface-2)", color: "var(--text-muted)" }} />
    </div>
  );

  return (
    <Modal
      title={`Registrar · ${goal.name} · ${monthLabel(month)}`}
      onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={pending || !entry} onClick={submit}>{pending ? "Salvando…" : "Salvar"}</button>
      </>}
    >
      {binaria ? (
        <div style={{ maxWidth: 200 }}>{readonly(<>Peso</>, entry ? `${entry.weight}%` : "—")}</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.8rem" }}>
          {readonly(<>Meta {goal.unit && <span className="soft">({goal.unit})</span>}</>, entry ? formatNumber(entry.target) : "—")}
          {readonly(<>Meta parcial</>, entry?.partial != null ? formatNumber(entry.partial) : "—")}
          {readonly(<>Peso</>, entry ? `${entry.weight}%` : "—")}
        </div>
      )}
      <div>
        <label className="label">{binaria ? "Resultado" : <>Realizado {goal.unit && <span className="soft">({goal.unit})</span>}</>}</label>
        {binaria
          ? <OkNokInput value={actual.trim() === "" ? null : Number(actual)} onChange={(v) => setActual(v == null ? "" : String(v))} autoFocus />
          : <input type="number" step="any" className="input" value={actual} onChange={(e) => setActual(e.target.value)} placeholder="—" autoFocus />}
      </div>
      <div>
        <label className="label">Observação <span className="soft">(opcional)</span></label>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
        {GOAL_DIRECTION[goal.direction]} — meta, parcial e peso são definidos em “Editar” / “Distribuir pesos”. Aqui você registra apenas o realizado da competência.
      </p>
      {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}

function WeightsDialog({ rows, period, onClose }: { rows: Row[]; period: string; onClose: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.goal.id, String(r.weight ?? 0)])));
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const total = Math.round(rows.reduce((s, r) => s + (Number(vals[r.goal.id]) || 0), 0));

  const submit = () => {
    setError("");
    if (total !== 100) { setError(`A soma deve ser 100% (atual: ${total}%).`); return; }
    start(async () => {
      const res = await setEntryWeights({ period, weights: rows.map((r) => ({ goal_id: r.goal.id, weight: Number(vals[r.goal.id]) || 0 })) });
      if (res.error) { setError(res.error); return; }
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal
      title="Distribuir pesos do mês"
      onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={pending || total !== 100} onClick={submit}>{pending ? "Salvando…" : "Salvar"}</button>
      </>}
    >
      <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Defina o peso de cada meta desta competência. A soma precisa ser exatamente 100%.</p>
      {rows.map((r) => (
        <div key={r.goal.id} style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: "0.6rem", alignItems: "center" }}>
          <span style={{ fontSize: "0.88rem" }}>{r.goal.name}</span>
          <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
            <input type="number" min={0} max={100} step="any" className="input" value={vals[r.goal.id] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [r.goal.id]: e.target.value }))} />
            <span className="soft" style={{ fontSize: "0.8rem" }}>%</span>
          </div>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--border)", paddingTop: "0.6rem", fontWeight: 700 }}>
        <span>Total</span>
        <span style={{ color: total === 100 ? "var(--mh-success)" : "var(--mh-danger)" }}>{total}%</span>
      </div>
      {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}
