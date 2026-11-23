"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { Filter } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { MultiSelect } from "@/components/ui/MultiSelect";
import { AdicionarFiltro, PeriodoPilula, Pilula } from "@/components/ui/FiltrosPilula";
import { PRIORITY } from "@/lib/constants";
import {
  FILTROS_VAZIOS, OPCOES_ANEXOS, OPCOES_AVALIACAO, OPCOES_CUMPRIMENTO, OPCOES_ORIGEM, STATUS_CHAMADO_LABEL,
  contarFiltros, filtrosPadrao, opcoesDosChamados, type FiltrosChamado, type StatusChamado,
} from "@/lib/chamados-filtros";
import type { TicketRow } from "@/components/TicketsManager";

type Contexto = {
  filtros: FiltrosChamado;
  aplicar: (patch: Partial<FiltrosChamado>) => void;
  limpar: () => void;
  pagina: number;
  setPagina: (p: number) => void;
  painelAberto: boolean;
  setPainelAberto: (v: boolean) => void;
  adicionados: Set<CampoKey>;
  setAdicionados: (s: Set<CampoKey>) => void;
};

const Ctx = createContext<Contexto | null>(null);

/**
 * Guarda os filtros FORA da aba: o componente de abas desmonta o conteúdo ao trocar,
 * e ir ao Dashboard e voltar não pode devolver a lista ao padrão. Ao sair da tela
 * de Chamados ele some junto, e a próxima entrada abre no padrão de novo.
 */
export function FiltrosChamadosProvider({ children }: { children: React.ReactNode }) {
  const [filtros, setFiltros] = useState<FiltrosChamado>(filtrosPadrao);
  const [pagina, setPagina] = useState(1);
  const [painelAberto, setPainelAberto] = useState(true);
  const [adicionados, setAdicionados] = useState<Set<CampoKey>>(new Set());

  const valor = useMemo<Contexto>(() => ({
    filtros,
    aplicar: (patch) => { setFiltros((f) => ({ ...f, ...patch })); setPagina(1); },
    limpar: () => { setFiltros(FILTROS_VAZIOS); setAdicionados(new Set()); setPagina(1); },
    pagina, setPagina, painelAberto, setPainelAberto, adicionados, setAdicionados,
  }), [filtros, pagina, painelAberto, adicionados]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useFiltrosChamados() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useFiltrosChamados fora de FiltrosChamadosProvider");
  return c;
}

const CAMPOS = [
  { key: "status", label: "Status" },
  { key: "setor", label: "Setor" },
  { key: "categoria", label: "Categoria" },
  { key: "prioridade", label: "Prioridade" },
  { key: "solicitante", label: "Solicitante" },
  { key: "responsavel", label: "Responsável" },
  { key: "aberto", label: "Aberto em" },
  { key: "prazo", label: "Prazo" },
  { key: "conclusao", label: "Conclusão" },
  { key: "cumprimento", label: "Cumprimento do prazo" },
  { key: "avaliacao", label: "Avaliação" },
  { key: "anexos", label: "Anexos" },
  { key: "origem", label: "Origem" },
] as const;
type CampoKey = (typeof CAMPOS)[number]["key"];

const PERIODOS = {
  aberto: { de: "abertoDe", ate: "abertoAte", label: "Aberto em" },
  prazo: { de: "prazoDe", ate: "prazoAte", label: "Prazo" },
  conclusao: { de: "conclusaoDe", ate: "conclusaoAte", label: "Conclusão" },
} as const;
const ehPeriodo = (k: CampoKey): k is keyof typeof PERIODOS => k in PERIODOS;

const OPCOES_STATUS = (Object.keys(STATUS_CHAMADO_LABEL) as StatusChamado[])
  .map((s) => ({ value: s, label: STATUS_CHAMADO_LABEL[s] }));
const OPCOES_PRIORIDADE = (Object.keys(PRIORITY) as (keyof typeof PRIORITY)[])
  .map((p) => ({ value: p, label: PRIORITY[p] }));

/** "Limpar filtros" e o botão que abre o painel, no cabeçalho da lista */
export function BotoesFiltroChamados() {
  const { filtros, limpar, painelAberto, setPainelAberto } = useFiltrosChamados();
  const qtd = contarFiltros(filtros);
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
      {/* "Filtros" vem primeiro: ao lado do título, ele não muda de lugar quando o "Limpar" some */}
      <button
        type="button"
        className={`btn btn-sm ${painelAberto || qtd > 0 ? "btn-primary" : "btn-ghost"}`}
        onClick={() => setPainelAberto(!painelAberto)}
        style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
      >
        <Filter size={15} />
        Filtros
        {qtd > 0 && <Badge tone="blue">{qtd}</Badge>}
      </button>
      {qtd > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={limpar}>Limpar filtros</button>}
    </div>
  );
}

/** A busca fica sempre à vista; os demais filtros só aparecem quando estão em uso, como em Ações. */
export function PainelFiltrosChamados({ tickets, comPrioridade }: { tickets: TicketRow[]; comPrioridade: boolean }) {
  const { filtros: f, aplicar, painelAberto, adicionados, setAdicionados } = useFiltrosChamados();
  const opcoes = useMemo(() => opcoesDosChamados(tickets, f.setor), [tickets, f.setor]);

  if (!painelAberto) return null;

  const campos = CAMPOS.filter((c) => comPrioridade || c.key !== "prioridade");
  const temValor = (k: CampoKey) => {
    if (ehPeriodo(k)) return !!f[PERIODOS[k].de] || !!f[PERIODOS[k].ate];
    return f[k].length > 0;
  };
  const visiveis = campos.map((c) => c.key).filter((k) => temValor(k) || adicionados.has(k));

  const remover = (k: CampoKey) => {
    const s = new Set(adicionados);
    s.delete(k);
    setAdicionados(s);
    if (ehPeriodo(k)) aplicar({ [PERIODOS[k].de]: "", [PERIODOS[k].ate]: "" });
    else aplicar({ [k]: [] });
  };

  const trocarSetor = (setor: string[]) => {
    // categoria de um setor que saiu da escolha deixaria a lista vazia sem motivo à vista
    const validas = new Set(opcoesDosChamados(tickets, setor).categorias.map((c) => c.value));
    aplicar({ setor, categoria: f.categoria.filter((c) => validas.has(c)) });
  };

  const campo = (k: CampoKey) => {
    if (ehPeriodo(k)) {
      const p = PERIODOS[k];
      return (
        <PeriodoPilula
          label={p.label}
          from={f[p.de]}
          to={f[p.ate]}
          onChange={(x) => aplicar({
            ...(x.from !== undefined ? { [p.de]: x.from } : {}),
            ...(x.to !== undefined ? { [p.ate]: x.to } : {}),
          })}
        />
      );
    }
    switch (k) {
      case "status": return <MultiSelect inline label="Status" options={OPCOES_STATUS} selected={f.status} onChange={(v) => aplicar({ status: v })} />;
      case "setor": return <MultiSelect inline label="Setor" options={opcoes.setores} selected={f.setor} onChange={trocarSetor} />;
      case "categoria": return <MultiSelect inline searchable allLabel="Todas" label="Categoria" options={opcoes.categorias} selected={f.categoria} onChange={(v) => aplicar({ categoria: v })} />;
      case "prioridade": return <MultiSelect inline allLabel="Todas" label="Prioridade" options={OPCOES_PRIORIDADE} selected={f.prioridade} onChange={(v) => aplicar({ prioridade: v })} />;
      case "solicitante": return <MultiSelect inline searchable label="Solicitante" options={opcoes.solicitantes} selected={f.solicitante} onChange={(v) => aplicar({ solicitante: v })} />;
      case "responsavel": return <MultiSelect inline searchable label="Responsável" options={opcoes.responsaveis} selected={f.responsavel} onChange={(v) => aplicar({ responsavel: v })} />;
      case "cumprimento": return <MultiSelect inline label="Cumprimento do prazo" options={OPCOES_CUMPRIMENTO} selected={f.cumprimento} onChange={(v) => aplicar({ cumprimento: v })} />;
      case "avaliacao": return <MultiSelect inline allLabel="Todas" label="Avaliação" options={OPCOES_AVALIACAO} selected={f.avaliacao} onChange={(v) => aplicar({ avaliacao: v })} />;
      case "anexos": return <MultiSelect inline label="Anexos" options={OPCOES_ANEXOS} selected={f.anexos} onChange={(v) => aplicar({ anexos: v })} />;
      case "origem": return <MultiSelect inline allLabel="Todas" label="Origem" options={OPCOES_ORIGEM} selected={f.origem} onChange={(v) => aplicar({ origem: v })} />;
    }
  };

  return (
    <div style={{ padding: "0.85rem 1.25rem", borderBottom: "1px solid var(--mh-border)", background: "var(--mh-surface-2)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.45rem" }}>
        <input
          className="input"
          value={f.q}
          onChange={(e) => aplicar({ q: e.target.value })}
          placeholder="#número ou título…"
          style={{ width: 240, padding: "0.3rem 0.6rem", fontSize: "0.8rem" }}
        />
        {visiveis.map((k) => <Pilula key={k} onRemove={() => remover(k)}>{campo(k)}</Pilula>)}
        <AdicionarFiltro
          disponiveis={campos.filter((c) => !visiveis.includes(c.key)).map((c) => ({ key: c.key, label: c.label }))}
          onAdd={(k) => setAdicionados(new Set(adicionados).add(k))}
        />
      </div>
    </div>
  );
}
