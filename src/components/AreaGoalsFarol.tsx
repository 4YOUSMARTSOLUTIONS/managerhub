"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { MonthInput } from "@/components/ui/MonthInput";
import { YearSelect } from "@/components/ui/YearSelect";
import { EmptyState } from "@/components/ui/EmptyState";
import { SearchSelect } from "@/components/SearchSelect";
import { ImportAreaGoalsDialog } from "@/components/ImportAreaGoalsDialog";
import { Dropdown } from "@/components/ui/Dropdown";
import { BotaoFiltros, PainelDeFiltros } from "@/components/ui/Filtros";
import { ImportAreaEntriesDialog } from "@/components/ImportAreaEntriesDialog";
import { ExportButton } from "@/components/ui/ExportButton";
import { IconImport } from "@/components/ui/ImpExpIcons";
import {
  createAreaGoal, updateAreaGoal, deleteAreaGoal, upsertAreaEntry,
} from "@/lib/actions/area-goals";
import { GOAL_DIRECTION, AREA_GOAL_KIND, CONSOLIDATION_LABEL, isMetaBinaria } from "@/lib/constants";
import { farolAttainment, type FarolStatus } from "@/lib/goals-farol";
import { shortName } from "@/lib/format";
import type { Enums } from "@/types/database";
import { confirmDialog } from "@/components/ui/confirm";

export type AreaEntryLite = { unitId: string | null; period: string; target: number | null; actual: number | null; numerator: number | null; denominator: number | null };
export type AreaGoalRow = {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  kind: Enums<"area_goal_kind">;
  direction: Enums<"goal_direction">;
  consolidation: Enums<"area_consolidation">;
  departmentId: string | null;
  departmentName: string | null;
  subdepartmentId: string | null;
  subdepartmentName: string | null;
  unitId: string | null; // null = todas as unidades (Grupo)
  unitName: string | null;
  parentId: string | null; // IC pai (hierarquia)
  ownerId: string | null;
  ownerName: string | null;
  entries: AreaEntryLite[];
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
const monthLabel = (month: string) => { const [y, m] = month.split("-"); return `${m}/${y}`; };
const GROUP = "__grupo__";
const BAR_COLOR: Record<FarolStatus, string> = { atingida: "var(--mh-success)", parcial: "var(--mh-warning)", nao_atingida: "var(--mh-danger)", pendente: "transparent" };
const VAL_COLOR: Record<FarolStatus, string> = { atingida: "var(--mh-success)", parcial: "var(--mh-warning)", nao_atingida: "var(--mh-danger)", pendente: "var(--text-muted)" };

// trunca em 2 casas (nunca arredonda; o epsilon corrige o erro de float da multiplicação)
function trunc2(v: number): number {
  const s = v < 0 ? -1 : 1;
  return (s * Math.floor(Math.abs(v) * 100 + 1e-9)) / 100;
}
// formata o valor com a unidade de medida — sempre 2 casas decimais, truncadas
const nf2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fmtValue(v: number | null, unit: string): string {
  if (v == null) return "—";
  const t = trunc2(v);
  const u = (unit ?? "").trim();
  const low = u.toLowerCase();
  if (low.includes("r$")) return "R$ " + nf2.format(t);
  if (u === "%") return nf2.format(t) + "%";
  return nf2.format(t) + (u ? ` ${u}` : "");
}

type Resolved = { target: number | null; actual: number | null; computed: boolean };

// Acumulador unificado: agrega um conjunto de lançamentos (já filtrados por
// período/unidade) segundo o tipo de cálculo do indicador. Vale tanto para o
// consolidado entre unidades (Grupo) quanto para o acumulado anual.
function accumulate(consolidation: Enums<"area_consolidation">, unit: string, entries: AreaEntryLite[]): Resolved {
  if (entries.length === 0) return { target: null, actual: null, computed: false };
  const nn = (xs: (number | null)[]) => xs.filter((v): v is number => v != null);
  const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);

  if (consolidation === "razao") {
    // razão: Σnumerador ÷ Σdenominador (nunca média dos %); meta % é constante
    const nums = nn(entries.map((e) => e.numerator));
    const dens = nn(entries.map((e) => e.denominator));
    const den = sum(dens);
    const target = nn(entries.map((e) => e.target))[0] ?? null;
    if (dens.length === 0 || den === 0) return { target, actual: null, computed: true };
    const scale = unit.trim() === "%" ? 100 : 1;
    return { target, actual: (sum(nums) / den) * scale, computed: true };
  }

  const targets = nn(entries.map((e) => e.target));
  const actuals = nn(entries.map((e) => e.actual));
  if (consolidation === "media") {
    const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : null);
    return { target: avg(targets), actual: avg(actuals), computed: true };
  }
  // soma (e manual, ao acumular os lançamentos mensais do Grupo no ano)
  return {
    target: targets.length ? sum(targets) : null,
    actual: actuals.length ? sum(actuals) : null,
    computed: true,
  };
}

// chave que agrupa indicadores do mesmo KPI (mesmo nome + cálculo + medida)
const kpiKey = (g: AreaGoalRow) => `${g.name.trim().toLowerCase()}|${g.consolidation}|${g.unit.trim().toLowerCase()}`;

export function AreaGoalsFarol({
  goals, departments, subdepartments, units, members, isAdmin, currentUserId, scopedUnitId = null,
}: {
  goals: AreaGoalRow[];
  departments: Opt[];
  subdepartments: SubOpt[];
  units: Opt[];
  members: Member[];
  isAdmin: boolean;
  currentUserId: string;
  scopedUnitId?: string | null; // unidade do filtro global (trava o seletor)
}) {
  const [deptId, setDeptId] = useState("");
  const [subId, setSubId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [mode, setMode] = useState<"mes" | "ano">("mes");
  const [month, setMonth] = useState(mesAnterior());
  const [year, setYear] = useState(nowYear());
  // anos que têm lançamento: entram na lista do seletor de ano
  const periodosCarregados = useMemo(() => goals.flatMap((g) => g.entries.map((e) => e.period)), [goals]);
  // a unidade é escolhida no filtro global do cabeçalho da página; "Todas" = Grupo consolidado
  const unitSel = scopedUnitId ?? GROUP;
  const [editGoal, setEditGoal] = useState<AreaGoalRow | null>(null);
  const [entryGoal, setEntryGoal] = useState<AreaGoalRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = (name: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });

  const subOpts = useMemo(
    () => (deptId ? subdepartments.filter((s) => s.departmentId === deptId) : subdepartments),
    [subdepartments, deptId],
  );
  const ownerOpts = useMemo(() => {
    const seen = new Map<string, string>();
    for (const g of goals) if (g.ownerId && !seen.has(g.ownerId)) seen.set(g.ownerId, g.ownerName ?? "—");
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [goals]);

  // filtra por setor/subsetor/responsável e por unidade: indicador de unidade específica só
  // aparece na sua unidade (e no Grupo); indicador "todas" (unitId nulo) aparece sempre.
  //
  // A META DE QUE VOCÊ É O RESPONSÁVEL NUNCA SOME, seja qual for a unidade.
  //
  // Área de apoio centralizada é o caso comum, não a exceção: o Financeiro fica
  // na Matriz e responde pelas metas das duas unidades. Quem está vinculado a uma
  // unidade só fica travado nela no seletor do topo, e sem esta linha a meta da
  // outra unidade simplesmente não existia na tela — nem desabilitada, ausente.
  //
  // Não é um furo: a policy `area_goal_entries_write` já autoriza o `owner_id` da
  // meta a gravar, sem olhar unidade. A tela é que escondia o que o banco
  // liberava. E o escopo de unidade continua valendo em todo o resto do sistema.
  const filtered = useMemo(
    () => goals.filter((g) =>
      (!deptId || g.departmentId === deptId) &&
      (!subId || g.subdepartmentId === subId) &&
      (!ownerId || g.ownerId === ownerId) &&
      (unitSel === GROUP || g.unitId === null || g.unitId === unitSel || g.ownerId === currentUserId)),
    [goals, deptId, subId, ownerId, unitSel, currentUserId],
  );

  const goalById = useMemo(() => new Map(goals.map((g) => [g.id, g])), [goals]);
  const parentNameOf = (g: AreaGoalRow) => (g.parentId ? goalById.get(g.parentId)?.name ?? null : null);

  const rows = useMemo(() => {
    const inPeriod = (p: string) => (mode === "ano" ? p.startsWith(`${year}-`) : p === periodOf(month));
    if (unitSel === GROUP) {
      // agrupa por KPI e consolida os resultados entre as unidades pelo cálculo do KPI
      const groups = new Map<string, AreaGoalRow[]>();
      for (const g of filtered) {
        const arr = groups.get(kpiKey(g)) ?? [];
        arr.push(g);
        groups.set(kpiKey(g), arr);
      }
      return [...groups.values()].map((members) => {
        const rep = members[0];
        const entries = members.flatMap((g) => g.entries).filter((x) => inPeriod(x.period));
        const { target, actual } = accumulate(rep.consolidation, rep.unit, entries);
        const { pct, status } = farolAttainment(rep.direction, target ?? 0, actual);
        // no consolidado a linha representa um GRUPO de metas, então pai e filho
        // só podem se achar pelo nome: o `parentId` do representante aponta para
        // uma meta específica, que pode não ser a representante do grupo pai
        return { goal: rep, members, isGroup: members.length > 1, chave: rep.name, chavePai: parentNameOf(rep), target, actual, pct, status, computed: true };
      });
    }
    // unidade específica: cada indicador com o seu próprio valor
    return filtered.map((g) => {
      const entries = g.entries.filter((x) => inPeriod(x.period));
      const { target, actual, computed } = accumulate(g.consolidation, g.unit, entries);
      const { pct, status } = farolAttainment(g.direction, target ?? 0, actual);
      // unidade específica: liga pai e filho pelo ID, que é exato.
      //
      // Ligar por nome aqui daria árvore errada: as 21 metas existem com o MESMO
      // NOME nas duas unidades ("OBZ Total" da Matriz e da Filial), e desde que a
      // lista passou a poder conter as duas, o nome deixou de identificar a linha.
      return { goal: g, members: [g], isGroup: false, chave: g.id, chavePai: g.parentId, target, actual, pct, status, computed };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, mode, month, year, unitSel, goalById]);

  type DisplayRow = (typeof rows)[number];
  // monta a árvore de IC pai/filho pela `chave` da linha e achata respeitando os recolhidos
  const tree = useMemo(() => {
    const porChave = new Map<string, DisplayRow>();
    for (const r of rows) if (!porChave.has(r.chave)) porChave.set(r.chave, r);
    const childrenOf = new Map<string, DisplayRow[]>();
    const roots: DisplayRow[] = [];
    for (const r of rows) {
      const pai = r.chavePai;
      if (pai && porChave.has(pai) && pai !== r.chave) {
        const arr = childrenOf.get(pai) ?? [];
        arr.push(r);
        childrenOf.set(pai, arr);
      } else {
        roots.push(r);
      }
    }
    const out: { row: DisplayRow; depth: number; hasChildren: boolean }[] = [];
    const walk = (r: DisplayRow, depth: number) => {
      const kids = childrenOf.get(r.chave) ?? [];
      out.push({ row: r, depth, hasChildren: kids.length > 0 });
      if (kids.length && !collapsed.has(r.chave)) for (const k of kids) walk(k, depth + 1);
    };
    for (const r of roots) walk(r, 0);
    return out;
  }, [rows, collapsed]);

  const stats = useMemo(() => {
    const counts: Record<FarolStatus, number> = { atingida: 0, parcial: 0, nao_atingida: 0, pendente: 0 };
    for (const r of rows) counts[r.status] += 1;
    const accum = rows.length ? Math.round((counts.atingida / rows.length) * 100) : null;
    return { counts, accum };
  }, [rows]);

  const unitName = unitSel === GROUP ? "Grupo (consolidado)" : units.find((u) => u.id === unitSel)?.name ?? "—";
  const canEnter = (g: AreaGoalRow) => isAdmin || g.ownerId === currentUserId;
  const grouped = unitSel === GROUP;

  // selo do botao de filtros: filtro fechado nao pode virar filtro esquecido
  const filtrosAtivos = [deptId, subId, ownerId].filter(Boolean).length;
  // os dois diálogos de planilha viram itens de menu, entao o menu precisa
  // comandar a abertura deles
  const [importGoalsOpen, setImportGoalsOpen] = useState(false);
  const [importEntriesOpen, setImportEntriesOpen] = useState(false);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);

  return (
    <div>
      {/* UMA barra só, tudo à esquerda: Período (o contexto), o que recorta e o
          que faz, nessa ordem. Filtro e ação em pontas opostas da tela obrigava
          o olho a atravessar de um lado ao outro. */}
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
        <BotaoFiltros aberto={filtrosAbertos} onToggle={() => setFiltrosAbertos((v) => !v)} contador={filtrosAtivos} />
        {isAdmin && (
          // O que a pessoa OLHA fica à esquerda; o que ela FAZ, à direita. O
          // painel do menu alinha pela direita para não vazar da tela.
          <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
            {/* Quatro botões de planilha viraram um menu. Os diálogos em si são
                renderizados FORA daqui: dentro do painel, fechar o menu
                desmontaria o diálogo que ele acabou de abrir.

                Importar e Exportar são o MESMO botão com o ícone virado: as duas
                importações eram item de menu (texto puro) e as exportações vinham
                do `ExportButton`, que traz o próprio estilo. Quatro linhas
                fazendo a mesma classe de coisa, duas de cada jeito. */}
            <Dropdown rotulo="Planilhas" alinharDireita largura={280}>
              {(fechar) => (
                <>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setImportGoalsOpen(true); fechar(); }}>
                    <IconImport /> Importar indicadores
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setImportEntriesOpen(true); fechar(); }}>
                    <IconImport /> Importar resultados
                  </button>
                  <div style={{ borderTop: "1px solid var(--border)", margin: "0.15rem 0" }} />
                  <ExportButton
                    label="Exportar indicadores"
                    filename="metas_area_indicadores.xlsx"
                    sheetName="Indicadores"
                    headers={["Indicador", "Unidade", "Setor", "Subsetor", "Un. medida", "Conceito", "Tipo", "IC pai", "Direção", "Cálculo", "Responsável"]}
                    rows={goals.map((g) => [g.name, g.unitName ?? "Todas as unidades", g.departmentName ?? "", g.subdepartmentName ?? "", g.unit, g.description ?? "", AREA_GOAL_KIND[g.kind], g.parentId ? (goalById.get(g.parentId)?.name ?? "") : "", GOAL_DIRECTION[g.direction], CONSOLIDATION_LABEL[g.consolidation], g.ownerName ?? ""])}
                  />
                  <ExportButton
                    label="Exportar resultados"
                    filename="metas_area_lancamentos.xlsx"
                    sheetName="Lançamentos"
                    headers={["Indicador", "Unidade", "Setor", "Competência", "Meta", "Realizado", "Numerador", "Denominador"]}
                    rows={goals.flatMap((g) => g.entries.map((e) => { const [y, m] = e.period.split("-"); return [g.name, (e.unitId ? units.find((u) => u.id === e.unitId)?.name : null) ?? g.unitName ?? "Todas as unidades", g.departmentName ?? "", `${m}/${y}`, e.target ?? "", e.actual ?? "", e.numerator ?? "", e.denominator ?? ""]; }))}
                  />
                </>
              )}
            </Dropdown>
            <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>+ Novo indicador</button>
          </div>
        )}
      </div>

      {filtrosAbertos && (
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
            <label className="label">Responsável</label>
            <select className="select" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Todos</option>
              {ownerOpts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        </PainelDeFiltros>
      )}

      {/* Controlados por estado e fora do menu, para sobreviverem ao fechamento dele */}
      {isAdmin && (
        <>
          <ImportAreaGoalsDialog
            hideTrigger
            open={importGoalsOpen}
            onClose={() => setImportGoalsOpen(false)}
            departments={departments}
            subdepartments={subdepartments}
            units={units}
            members={members}
            existing={goals.map((g) => ({ name: g.name, departmentId: g.departmentId, unitId: g.unitId }))}
          />
          <ImportAreaEntriesDialog
            hideTrigger
            open={importEntriesOpen}
            onClose={() => setImportEntriesOpen(false)}
            departments={departments}
            units={units}
            goals={goals.map((g) => ({ name: g.name, departmentId: g.departmentId, unitId: g.unitId, consolidation: g.consolidation }))}
          />
        </>
      )}

      {rows.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "1rem", marginBottom: "1.2rem" }}>
          <SummaryCard label={`Acumulado · ${mode === "ano" ? `Ano ${year}` : monthLabel(month)}`} value={stats.accum == null ? "—" : `${stats.accum}%`} tone={stats.accum === 100 ? "green" : "neutral"} sub={`${stats.counts.atingida}/${rows.length} indicadores · ${unitName}`} />
          <SummaryCard label="Atingidos" value={String(stats.counts.atingida)} tone="green" />
          <SummaryCard label="Não atingidos" value={String(stats.counts.nao_atingida)} tone="red" />
          <SummaryCard label="Pendentes" value={String(stats.counts.pendente)} tone="gray" />
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState title="Nenhum indicador" description={isAdmin ? "Use “+ Novo indicador” para cadastrar os indicadores da área." : "Nenhum indicador cadastrado para o filtro atual."} />
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table area-goals-table metas-table">
            <thead>
              <tr>
                <th>KPI</th>
                <th>Un. medida</th>
                <th>Conceito</th>
                <th>Responsável</th>
                <th style={{ textAlign: "center" }}>IC/IV</th>
                <th className="col-meta" style={{ textAlign: "right" }}>Meta</th>
                <th className="col-real" style={{ textAlign: "right" }}>Realizado</th>
                <th>Atingimento</th>
                {grouped && <th>Tipo de cálculo</th>}
                {/* a coluna de Ações existe SEMPRE. No consolidado ela vem com o
                    botão desabilitado e o motivo no title: some-la fazia o usuário
                    concluir que não tinha permissão, quando na verdade faltava
                    escolher a unidade */}
                <th style={{ textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {tree.map(({ row: { goal: g, chave, target, actual, pct, status }, depth, hasChildren }) => {
                const isCollapsed = collapsed.has(chave);
                return (
                <tr key={g.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, paddingLeft: depth * 16 }}>
                      {hasChildren ? (
                        <button type="button" onClick={() => toggleCollapse(chave)} title={isCollapsed ? "Expandir" : "Recolher"} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", width: 16, padding: 0, fontSize: "0.7rem", lineHeight: 1 }}>{isCollapsed ? "▸" : "▾"}</button>
                      ) : <span style={{ display: "inline-block", width: 16 }} />}
                      {isAdmin && !grouped ? (
                        <button type="button" onClick={() => setEditGoal(g)} title="Editar indicador" style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 600, color: "var(--text)", cursor: "pointer", textAlign: "left" }}>{g.name}</button>
                      ) : <span style={{ fontWeight: 600 }}>{g.name}</span>}
                      {hasChildren && isCollapsed && <span className="soft" style={{ fontSize: "0.68rem", marginLeft: 4 }}>+{(rows.filter((r) => r.chavePai === chave).length)}</span>}
                      {!grouped && g.unitId === null && <span className="soft" style={{ fontSize: "0.7rem", marginLeft: 6 }}>Todas</span>}
                      {/* meta de OUTRA unidade, que só está aqui porque você é o
                          responsável: sem dizer de qual, ela se mistura às da
                          unidade selecionada e vira número trocado */}
                      {!grouped && g.unitId !== null && g.unitId !== unitSel && (
                        <span style={{ marginLeft: 6 }} title={`Indicador da unidade ${g.unitName ?? ""}, sob sua responsabilidade`}>
                          <Badge tone="blue">{g.unitName ?? "Outra unidade"}</Badge>
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{g.unit || <span className="soft">—</span>}</td>
                  <td className="muted" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={g.description ?? ""}>
                    {g.description || <span className="soft">—</span>}
                  </td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }} title={g.ownerName ?? ""}>
                    {g.ownerName ? shortName(g.ownerName) : <span className="soft">—</span>}
                  </td>
                  <td style={{ textAlign: "center" }}><Badge tone={g.kind === "ic" ? "blue" : "purple"}>{AREA_GOAL_KIND[g.kind]}</Badge></td>
                  <td className="col-meta" style={{ textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fmtValue(target, g.unit)}</td>
                  <td className="col-real" style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: VAL_COLOR[status] }}>{fmtValue(actual, g.unit)}</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", width: 130 }}>
                      <div className="progress-track" style={{ flex: 1 }}><div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%`, background: BAR_COLOR[status] }} /></div>
                      <span style={{ fontSize: "0.74rem", fontWeight: 600, minWidth: 38, textAlign: "right", color: status === "pendente" ? "var(--text-muted)" : BAR_COLOR[status] }}>{pct == null ? "—" : `${pct}%`}</span>
                    </div>
                  </td>
                  {grouped && <td className="muted" style={{ whiteSpace: "nowrap", fontSize: "0.72rem" }} title="Consolidado entre as unidades pelo cálculo do KPI">{CONSOLIDATION_LABEL[g.consolidation]}</td>}
                  {grouped ? (
                    // Consolidado: a linha é a soma/média de várias unidades, então
                    // não existe UM registro para gravar. O botão fica visível e
                    // desabilitado, dizendo o que fazer, em vez de sumir.
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {canEnter(g) && (
                        <button
                          type="button"
                          className="icon-btn"
                          disabled
                          title="Escolha uma unidade no seletor do topo para lançar o resultado. Aqui a linha é o consolidado de várias unidades."
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                        </button>
                      )}
                    </td>
                  ) : (
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <div style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center", justifyContent: "flex-end" }}>
                        {isAdmin && (
                          <button type="button" className="icon-btn" title="Editar indicador (nome, setor, unidade, cálculo…)" onClick={() => setEditGoal(g)}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>
                          </button>
                        )}
                        {canEnter(g) && (
                          <button type="button" className="icon-btn" title="Registrar resultado" onClick={() => setEntryGoal(g)}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                          </button>
                        )}
                        {isAdmin && <DeleteGoalButton id={g.id} />}
                      </div>
                    </td>
                  )}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {addOpen && <GoalDialog mode="new" goals={goals} departments={departments} subdepartments={subdepartments} units={units} members={members} onClose={() => setAddOpen(false)} />}
      {editGoal && <GoalDialog mode="edit" goal={editGoal} goals={goals} departments={departments} subdepartments={subdepartments} units={units} members={members} onClose={() => setEditGoal(null)} />}
      {entryGoal && <EntryDialog goal={entryGoal} units={units} month={month} unitSel={unitSel} onClose={() => setEntryGoal(null)} />}
    </div>
  );
}

const TONE_FG: Record<string, string> = { green: "var(--mh-success)", red: "var(--mh-danger)", gray: "var(--text)", neutral: "var(--text)" };
function SummaryCard({ label, value, tone, sub }: { label: string; value: string; tone: string; sub?: string }) {
  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "0.25rem", justifyContent: "center", minHeight: 100 }}>
      <div className="soft" style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
      <div style={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1.05, color: TONE_FG[tone] ?? "var(--text)" }}>{value}</div>
      {sub && <div className="soft" style={{ fontSize: "0.74rem" }}>{sub}</div>}
    </div>
  );
}

function DeleteGoalButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const onClick = async () => {
    if (!(await confirmDialog({ tone: "danger", confirmLabel: "Excluir", message: "Excluir este indicador e todos os seus registros?" }))) return;
    start(async () => { await deleteAreaGoal(id); router.refresh(); });
  };
  return (
    <button type="button" className="icon-btn icon-btn-danger" disabled={pending} title="Excluir indicador" onClick={onClick}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
    </button>
  );
}

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 1rem", zIndex: 60, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 500, boxShadow: "var(--mh-shadow-e3)" }}>
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

const KIND_OPTS = Object.entries(AREA_GOAL_KIND) as [Enums<"area_goal_kind">, string][];
const DIR_OPTS = Object.entries(GOAL_DIRECTION) as [Enums<"goal_direction">, string][];
const CONS_OPTS = Object.entries(CONSOLIDATION_LABEL) as [Enums<"area_consolidation">, string][];

function GoalDialog({ mode, goal, bulkGoals, goals, departments, subdepartments, units, members, onClose }: { mode: "new" | "edit"; goal?: AreaGoalRow; bulkGoals?: AreaGoalRow[]; goals: AreaGoalRow[]; departments: Opt[]; subdepartments: SubOpt[]; units: Opt[]; members: Member[]; onClose: () => void }) {
  const isBulk = !!bulkGoals && bulkGoals.length > 0;
  const [name, setName] = useState(goal?.name ?? "");
  const [description, setDescription] = useState(goal?.description ?? "");
  const [unit, setUnit] = useState(goal?.unit ?? "");
  const [departmentId, setDepartmentId] = useState(goal?.departmentId ?? "");
  const [subdepartmentId, setSubdepartmentId] = useState(goal?.subdepartmentId ?? "");
  // unidade organizacional: "" = ainda não escolhida; "all" = todas as unidades
  const [orgUnitId, setOrgUnitId] = useState(mode === "edit" ? (goal?.unitId ?? "all") : "");
  const [kind, setKind] = useState<Enums<"area_goal_kind">>(goal?.kind ?? "ic");
  const [direction, setDirection] = useState<Enums<"goal_direction">>(goal?.direction ?? "maior_melhor");
  const [consolidation, setConsolidation] = useState<Enums<"area_consolidation">>(goal?.consolidation ?? "soma");
  const binaria = isMetaBinaria(direction);
  const [ownerId, setOwnerId] = useState(goal?.ownerId ?? "");
  // IC pai — não-lote: id do IC (mesma unidade); lote: nome do IC (resolvido por unidade ao salvar)
  const parentInit = isBulk
    ? (goals.find((x) => x.id === bulkGoals![0]?.parentId)?.name ?? "")
    : (goal?.parentId ?? "");
  const [parentSel, setParentSel] = useState(parentInit);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const subOpts = useMemo(
    () => (departmentId ? subdepartments.filter((s) => s.departmentId === departmentId) : []),
    [subdepartments, departmentId],
  );

  // opções de IC pai: não-lote → ICs da mesma unidade (por id); lote → nomes de ICs
  const orgUnit = isBulk ? undefined : (orgUnitId === "all" ? null : orgUnitId);
  const parentByIdOpts = useMemo(
    () => goals.filter((x) => x.kind === "ic" && x.id !== goal?.id && x.unitId === orgUnit),
    [goals, goal?.id, orgUnit],
  );
  const parentByNameOpts = useMemo(
    () => [...new Set(goals.filter((x) => x.kind === "ic").map((x) => x.name))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [goals],
  );

  const submit = () => {
    setError("");
    // todos os campos são obrigatórios (IC pai é opcional)
    if (!name.trim()) { setError("Informe o indicador."); return; }
    if (!isBulk && !orgUnitId) { setError("Informe a unidade do indicador."); return; }
    if (!departmentId) { setError("Informe o setor."); return; }
    if (!subdepartmentId) { setError("Informe o subsetor."); return; }
    // sim/não não tem unidade de medida: OK/NOK é o próprio resultado
    if (!binaria && !unit.trim()) { setError("Informe a unidade de medida."); return; }
    if (!ownerId) { setError("Informe o responsável."); return; }
    const shared = {
      department_id: departmentId || null, subdepartment_id: subdepartmentId || null,
      name, description: description || null,
      unit: binaria ? "OK/NOK" : unit,
      kind, direction,
      // Entre unidades, somar 100+0+100 daria 200, que não quer dizer nada. A
      // MÉDIA dá 67%, que é a leitura certa: duas de três unidades fizeram.
      consolidation: binaria ? "media" : consolidation,
      owner_id: ownerId || null,
    };
    const nrm = (s: string) => s.trim().toLowerCase();
    start(async () => {
      if (isBulk) {
        // aplica os mesmos atributos a todas as unidades do KPI; o IC pai é resolvido por unidade (pelo nome)
        for (const g of bulkGoals!) {
          const parent_id = parentSel ? goals.find((x) => x.kind === "ic" && x.unitId === g.unitId && nrm(x.name) === nrm(parentSel))?.id ?? null : null;
          const res = await updateAreaGoal({ id: g.id, ...shared, unit_id: g.unitId, parent_id });
          if (res.error) { setError(res.error); return; }
        }
      } else {
        const payload = { ...shared, unit_id: orgUnitId === "all" ? null : orgUnitId, parent_id: parentSel || null };
        const res = mode === "edit" && goal ? await updateAreaGoal({ id: goal.id, ...payload }) : await createAreaGoal(payload);
        if (res.error) { setError(res.error); return; }
      }
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal title={isBulk ? `Editar KPI · ${bulkGoals!.length} unidade(s)` : mode === "edit" ? "Editar indicador" : "Novo indicador"} onClose={onClose} footer={<>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>{pending ? "Salvando…" : "Salvar"}</button>
    </>}>
      {isBulk ? (
        <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
          As alterações abaixo serão aplicadas a <strong>todas as unidades</strong> deste KPI ({bulkGoals!.map((g) => g.unitName ?? "Todas").join(", ")}).
        </p>
      ) : (
        <div>
          <label className="label">Unidade</label>
          <select className="select" value={orgUnitId} onChange={(e) => setOrgUnitId(e.target.value)}>
            <option value="">Selecione…</option>
            <option value="all">Todas as unidades</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "0.8rem" }}>
        <div>
          <label className="label">Indicador</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Faturamento, INAD…" />
        </div>
        <div style={{ width: 130 }}>
          <label className="label">Un. medida</label>
          <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="R$, %…" />
        </div>
      </div>
      <div>
        <label className="label">Conceito <span className="soft">(métrica)</span></label>
        <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Como o indicador é medido / o que ele significa" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
        <div>
          <label className="label">Área</label>
          <select className="select" value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setSubdepartmentId(""); }}>
            <option value="">—</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Subsetor</label>
          <select className="select" value={subdepartmentId} onChange={(e) => setSubdepartmentId(e.target.value)} disabled={!departmentId}>
            <option value="">{departmentId ? "—" : "Escolha a área"}</option>
            {subOpts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.8rem" }}>
        <div>
          <label className="label">IC/IV</label>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as Enums<"area_goal_kind">)}>
            {KIND_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Direção</label>
          <select className="select" value={direction} onChange={(e) => setDirection(e.target.value as Enums<"goal_direction">)}>
            {DIR_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Tipo de cálculo</label>
          <select className="select" value={consolidation} onChange={(e) => setConsolidation(e.target.value as Enums<"area_consolidation">)}>
            {CONS_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      <p className="soft" style={{ fontSize: "0.75rem", margin: 0 }}>
        Define como o indicador consolida entre unidades e acumula no ano: <strong>Soma</strong> (ex.: faturamento),
        <strong> Média</strong> (média simples), <strong>Razão</strong> (Σnº ÷ Σtotal — ex.: SLA = chamados no prazo ÷ total)
        ou <strong>Manual</strong> (você lança o consolidado do Grupo).
      </p>
      <div>
        <label className="label">IC pai <span className="soft">(opcional — a qual IC este indicador pertence)</span></label>
        <select className="select" value={parentSel} onChange={(e) => setParentSel(e.target.value)}>
          <option value="">— Nenhum (indicador de topo)</option>
          {isBulk
            ? parentByNameOpts.filter((nm) => nm !== name).map((nm) => <option key={nm} value={nm}>{nm}</option>)
            : parentByIdOpts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {!isBulk && !orgUnitId && <p className="soft" style={{ fontSize: "0.72rem", margin: "0.3rem 0 0" }}>Escolha a unidade para listar os ICs disponíveis.</p>}
      </div>
      <div>
        <label className="label">Responsável <span className="soft">(busque pelo nome)</span></label>
        <SearchSelect options={members} value={ownerId} onChange={setOwnerId} placeholder="Buscar responsável…" emptyHint="Nenhum colaborador" />
      </div>
      {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}

function EntryDialog({ goal, units, month, unitSel, onClose }: { goal: AreaGoalRow; units: Opt[]; month: string; unitSel: string; onClose: () => void }) {
  const groupAllowed = goal.consolidation === "manual";
  const isRatio = goal.consolidation === "razao";
  // Indicador de unidade específica: lançamentos travados naquela unidade, e a
  // opção sai da PRÓPRIA META, não da lista de unidades de quem está olhando.
  //
  // Sem isso, o responsável por uma meta de outra unidade abria o diálogo com o
  // select vazio: `units` é o escopo dele, que não contém a unidade da meta. O
  // select já vem `disabled` neste caso, então aqui é só o rótulo do que vai ser
  // gravado.
  const unitOpts = goal.unitId ? [{ id: goal.unitId, name: goal.unitName ?? "Unidade" }] : units;
  const initialUnit = goal.unitId
    ? goal.unitId
    : unitSel === GROUP ? (groupAllowed ? GROUP : units[0]?.id ?? "") : unitSel;
  const [u, setU] = useState(initialUnit);
  const [m, setM] = useState(month);
  const [target, setTarget] = useState("");
  const [actual, setActual] = useState("");
  const [numr, setNumr] = useState("");
  const [den, setDen] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  useEffect(() => {
    const unitId = u === GROUP ? null : u;
    const e = goal.entries.find((x) => x.unitId === unitId && x.period === periodOf(m)) ?? null;
    setTarget(e?.target != null ? String(e.target) : "");
    setActual(e?.actual != null ? String(e.actual) : "");
    setNumr(e?.numerator != null ? String(e.numerator) : "");
    setDen(e?.denominator != null ? String(e.denominator) : "");
  }, [u, m, goal]);

  const submit = () => {
    setError("");
    if (!u) { setError("Selecione a unidade."); return; }
    if (isRatio) {
      if (target.trim() === "" && numr.trim() === "" && den.trim() === "") { setError("Informe a meta e/ou o numerador e o total."); return; }
    } else if (target.trim() === "" && actual.trim() === "") {
      setError("Informe a meta e/ou o realizado.");
      return;
    }
    start(async () => {
      // razão: guarda numerador/denominador e calcula o realizado (nº ÷ total)
      const numV = numr.trim() === "" ? null : Number(numr);
      const denV = den.trim() === "" ? null : Number(den);
      const scale = goal.unit.trim() === "%" ? 100 : 1;
      const computedActual = isRatio
        ? (denV != null && denV !== 0 && numV != null ? (numV / denV) * scale : null)
        : (actual.trim() === "" ? null : Number(actual));
      const res = await upsertAreaEntry({
        area_goal_id: goal.id,
        unit_id: u === GROUP ? null : u,
        period: periodOf(m),
        target_value: target.trim() === "" ? null : Number(target),
        actual_value: computedActual,
        numerator_value: isRatio ? numV : null,
        denominator_value: isRatio ? denV : null,
      });
      if (res.error) { setError(res.error); return; }
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal title={`Registrar · ${goal.name}`} onClose={onClose} footer={<>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>{pending ? "Salvando…" : "Salvar"}</button>
    </>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
        <div>
          <label className="label">Unidade</label>
          <select className="select" value={u} onChange={(e) => setU(e.target.value)} disabled={!!goal.unitId}>
            {unitOpts.map((un) => <option key={un.id} value={un.id}>{un.name}</option>)}
            {groupAllowed && !goal.unitId && <option value={GROUP}>Grupo (consolidado)</option>}
          </select>
        </div>
        <div>
          <label className="label">Competência</label>
          <MonthInput value={m} onChange={setM} />
        </div>
      </div>
      {isRatio ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.8rem" }}>
            <div>
              <label className="label">Meta {goal.unit && <span className="soft">({goal.unit})</span>}</label>
              <input type="number" step="any" className="input" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="—" />
            </div>
            <div>
              <label className="label">Numerador <span className="soft">(nº)</span></label>
              <input type="number" step="any" className="input" value={numr} onChange={(e) => setNumr(e.target.value)} placeholder="Ex.: no prazo" />
            </div>
            <div>
              <label className="label">Denominador <span className="soft">(total)</span></label>
              <input type="number" step="any" className="input" value={den} onChange={(e) => setDen(e.target.value)} placeholder="Ex.: total" />
            </div>
          </div>
          <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
            Realizado = numerador ÷ total{goal.unit.trim() === "%" ? " (em %)" : ""}
            {numr.trim() !== "" && den.trim() !== "" && Number(den) !== 0 && (
              <> — <strong>{fmtValue((Number(numr) / Number(den)) * (goal.unit.trim() === "%" ? 100 : 1), goal.unit)}</strong></>
            )}. O acumulado (ano/Grupo) soma numeradores e totais antes de dividir.
          </p>
        </>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
            <div>
              <label className="label">Meta {goal.unit && <span className="soft">({goal.unit})</span>}</label>
              <input type="number" step="any" className="input" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="—" />
            </div>
            <div>
              <label className="label">Realizado <span className="soft">(opc.)</span></label>
              <input type="number" step="any" className="input" value={actual} onChange={(e) => setActual(e.target.value)} placeholder="—" />
            </div>
          </div>
          <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>{GOAL_DIRECTION[goal.direction]} — o farol compara o realizado com a meta.</p>
        </>
      )}
      {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
    </Modal>
  );
}
