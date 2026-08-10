"use client";

import { PRIORITY } from "@/lib/constants";
import type { Enums } from "@/types/database";
import type { Agrupamento, FiltroPlanner } from "@/lib/planner-group";
import type { BoardLabel } from "@/components/planner/TaskDialog";

/**
 * Filtro e agrupamento do quadro, tudo client-side: os cartões já estão na
 * memória, então cada mudança é rearranjo instantâneo, sem ida ao servidor.
 * O estado vive no PlannerManager (não na URL): filtro de quadro é gesto de
 * momento, não endereço que se compartilha.
 */

const AGRUPAMENTOS: { key: Agrupamento; label: string }[] = [
  { key: "coluna", label: "Coluna" },
  { key: "responsavel", label: "Responsável" },
  { key: "prioridade", label: "Prioridade" },
  { key: "progresso", label: "Progresso" },
  { key: "prazo", label: "Prazo" },
];

export function FilterBar({
  filtro, onFiltro, agrupamento, onAgrupamento, pessoas, labels,
}: {
  filtro: FiltroPlanner;
  onFiltro: (f: FiltroPlanner) => void;
  agrupamento: Agrupamento;
  onAgrupamento: (a: Agrupamento) => void;
  /** quem aparece no seletor de responsável (participantes do quadro) */
  pessoas: { id: string; name: string }[];
  labels: BoardLabel[];
}) {
  const ativo =
    !!filtro.texto || !!filtro.assigneeId || !!filtro.prioridade || !!filtro.labelId || !!filtro.prazo;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.9rem" }}>
      <input
        className="input"
        placeholder="Buscar tarefa…"
        value={filtro.texto}
        onChange={(e) => onFiltro({ ...filtro, texto: e.target.value })}
        style={{ width: 200, padding: "0.35rem 0.65rem", fontSize: "0.84rem" }}
      />
      <select className="select" value={filtro.assigneeId} onChange={(e) => onFiltro({ ...filtro, assigneeId: e.target.value })} style={{ width: 170, padding: "0.35rem 0.65rem", fontSize: "0.84rem" }}>
        <option value="">Todos os responsáveis</option>
        {pessoas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <select className="select" value={filtro.prioridade} onChange={(e) => onFiltro({ ...filtro, prioridade: e.target.value as Enums<"priority_level"> | "" })} style={{ width: 150, padding: "0.35rem 0.65rem", fontSize: "0.84rem" }}>
        <option value="">Toda prioridade</option>
        {(Object.keys(PRIORITY) as Enums<"priority_level">[]).map((p) => <option key={p} value={p}>{PRIORITY[p]}</option>)}
      </select>
      {labels.length > 0 && (
        <select className="select" value={filtro.labelId} onChange={(e) => onFiltro({ ...filtro, labelId: e.target.value })} style={{ width: 150, padding: "0.35rem 0.65rem", fontSize: "0.84rem" }}>
          <option value="">Toda etiqueta</option>
          {labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      )}
      <select className="select" value={filtro.prazo} onChange={(e) => onFiltro({ ...filtro, prazo: e.target.value as FiltroPlanner["prazo"] })} style={{ width: 150, padding: "0.35rem 0.65rem", fontSize: "0.84rem" }}>
        <option value="">Todo prazo</option>
        <option value="vencidas">Vencidas</option>
        <option value="semana">Próximos 7 dias</option>
      </select>
      {ativo && (
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => onFiltro({ texto: "", assigneeId: "", prioridade: "", labelId: "", prazo: "" })}>
          Limpar
        </button>
      )}

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.35rem" }}>
        <span className="soft" style={{ fontSize: "0.78rem" }}>Agrupar por</span>
        <select className="select" value={agrupamento} onChange={(e) => onAgrupamento(e.target.value as Agrupamento)} style={{ width: 150, padding: "0.35rem 0.65rem", fontSize: "0.84rem" }}>
          {AGRUPAMENTOS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
        </select>
      </div>
    </div>
  );
}
