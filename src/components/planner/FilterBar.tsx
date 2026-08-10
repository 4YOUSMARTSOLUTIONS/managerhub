"use client";

import { PainelDeFiltros } from "@/components/ui/Filtros";
import { PRIORITY } from "@/lib/constants";
import type { Enums } from "@/types/database";
import type { Agrupamento, FiltroPlanner } from "@/lib/planner-group";
import type { BoardLabel } from "@/components/planner/TaskDialog";

/**
 * O painel de filtros do Planner, no padrão da casa (`PainelDeFiltros`): abre
 * ABAIXO da barra, campos lado a lado, e some sem deixar rastro. A barra fica
 * com dois botões (Ações e Filtros) em vez de uma fileira de selects; o selo
 * de contagem no botão é o que impede o filtro fechado de virar filtro
 * esquecido.
 *
 * "Agrupar por" e o recorte do gestor ("Quadros de") moram aqui também: são
 * ajustes de visão, não gestos de todo clique.
 */

const AGRUPAMENTOS: { key: Agrupamento; label: string }[] = [
  { key: "coluna", label: "Coluna" },
  { key: "responsavel", label: "Responsável" },
  { key: "prioridade", label: "Prioridade" },
  { key: "progresso", label: "Progresso" },
  { key: "prazo", label: "Prazo" },
];

export function contarFiltros(filtro: FiltroPlanner, equipe: string): number {
  return (
    (filtro.texto ? 1 : 0) + (filtro.assigneeId ? 1 : 0) + (filtro.prioridade ? 1 : 0) +
    (filtro.labelId ? 1 : 0) + (filtro.prazo ? 1 : 0) + (equipe ? 1 : 0)
  );
}

export function PainelFiltrosPlanner({
  filtro, onFiltro, agrupamento, onAgrupamento, pessoas, labels,
  teamOptions, equipe, onEquipe, currentUserId, mostraAgrupamento,
}: {
  filtro: FiltroPlanner;
  onFiltro: (f: FiltroPlanner) => void;
  agrupamento: Agrupamento;
  onAgrupamento: (a: Agrupamento) => void;
  /** quem aparece no seletor de responsável (participantes do quadro) */
  pessoas: { id: string; name: string }[];
  labels: BoardLabel[];
  /** subordinados do gestor; vazio esconde o recorte de equipe */
  teamOptions: { id: string; name: string }[];
  equipe: string;
  onEquipe: (id: string) => void;
  currentUserId: string;
  /** o agrupamento só faz sentido na visão Quadro */
  mostraAgrupamento: boolean;
}) {
  const contador = contarFiltros(filtro, equipe !== "" && equipe !== currentUserId ? equipe : "");
  return (
    <PainelDeFiltros
      contador={contador}
      onLimpar={() => {
        onFiltro({ texto: "", assigneeId: "", prioridade: "", labelId: "", prazo: "" });
        // limpar volta ao padrão da tela (Meus quadros), não a "todos"
        if (equipe !== currentUserId) onEquipe(currentUserId);
      }}
    >
      <div>
        <label className="label">Buscar</label>
        <input className="input" placeholder="Título da tarefa…" value={filtro.texto}
          onChange={(e) => onFiltro({ ...filtro, texto: e.target.value })} />
      </div>
      <div>
        <label className="label">Responsável</label>
        <select className="select" value={filtro.assigneeId} onChange={(e) => onFiltro({ ...filtro, assigneeId: e.target.value })}>
          <option value="">Todos</option>
          {pessoas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Prioridade</label>
        <select className="select" value={filtro.prioridade} onChange={(e) => onFiltro({ ...filtro, prioridade: e.target.value as Enums<"priority_level"> | "" })}>
          <option value="">Todas</option>
          {(Object.keys(PRIORITY) as Enums<"priority_level">[]).map((p) => <option key={p} value={p}>{PRIORITY[p]}</option>)}
        </select>
      </div>
      {labels.length > 0 ? (
        <div>
          <label className="label">Etiqueta</label>
          <select className="select" value={filtro.labelId} onChange={(e) => onFiltro({ ...filtro, labelId: e.target.value })}>
            <option value="">Todas</option>
            {labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      ) : null}
      <div>
        <label className="label">Prazo</label>
        <select className="select" value={filtro.prazo} onChange={(e) => onFiltro({ ...filtro, prazo: e.target.value as FiltroPlanner["prazo"] })}>
          <option value="">Todos</option>
          <option value="vencidas">Vencidas</option>
          <option value="semana">Próximos 7 dias</option>
        </select>
      </div>
      {teamOptions.length > 0 ? (
        <div>
          <label className="label">Quadros de</label>
          {/* o padrão da tela é "Meus quadros"; "Todos que vejo" é escolha
              explícita e viaja como ?equipe=todos */}
          <select className="select" value={equipe === "" ? "todos" : equipe}
            onChange={(e) => onEquipe(e.target.value === "todos" ? "" : e.target.value)}>
            <option value={currentUserId}>Meus quadros</option>
            <option value="todos">Todos que vejo</option>
            {teamOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      ) : null}
      {mostraAgrupamento ? (
        <div>
          <label className="label">Agrupar por</label>
          <select className="select" value={agrupamento} onChange={(e) => onAgrupamento(e.target.value as Agrupamento)}>
            {AGRUPAMENTOS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </div>
      ) : null}
    </PainelDeFiltros>
  );
}
