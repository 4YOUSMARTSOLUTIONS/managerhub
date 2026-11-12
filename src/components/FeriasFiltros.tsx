"use client";

import { useMemo } from "react";
import { CalendarDays, Check, Search } from "lucide-react";
import { Dropdown } from "@/components/ui/Dropdown";
import { formatDate, normalizar, somarDias } from "@/lib/format";
import {
  estiloDaSituacao, STATUS_AGENDA, STATUS_AGENDA_CURTO, type AgendaItem, type StatusAgenda,
} from "@/lib/ferias-agenda";

export type FiltrosFerias = {
  de: string;
  ate: string;
  status: Record<StatusAgenda, boolean>;
  setor: string;
  busca: string;
};

export const TODOS_OS_STATUS: Record<StatusAgenda, boolean> = { efetivada: true, aprovada: true, solicitada: true };

const fimDoMes = (ymd: string) => {
  const [y, m] = ymd.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
};
const inicioDoMes = (ymd: string) => `${ymd.slice(0, 7)}-01`;
const proximoMes = (ymd: string) => {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
};

/** o que os filtros deixam passar (o período já veio recortado da busca) */
export function aplicarFiltros(itens: AgendaItem[], f: FiltrosFerias): AgendaItem[] {
  const q = normalizar(f.busca.trim());
  return itens.filter((i) =>
    f.status[i.status]
    && (!f.setor || (f.setor === "__sem__" ? !i.setorId : i.setorId === f.setor))
    && (!q || normalizar(`${i.nome ?? ""} ${i.matricula ?? ""} ${i.setor ?? ""} ${i.cargo ?? ""}`).includes(q)));
}

export function periodoValido(f: FiltrosFerias): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.de) || !/^\d{4}-\d{2}-\d{2}$/.test(f.ate)) return "Informe as duas datas do período.";
  if (f.ate < f.de) return "A data final é anterior à inicial.";
  if (Date.parse(f.ate) - Date.parse(f.de) > 800 * 86_400_000) return "Escolha um período de até dois anos.";
  return null;
}

/**
 * As três situações de férias como botões de ligar e desligar, com a amostra do
 * traço que o calendário usa e quantas há de cada uma. Substitui as caixas de
 * seleção soltas (LUIZ, 09/11/2026): é ao mesmo tempo filtro e legenda.
 * Usado no Calendário e na Programação.
 *
 * `porCor` (LUIZ, 12/11/2026) pinta cada situação com a cor dela, a mesma das
 * etiquetas de situação das tabelas: efetivada verde, aprovada laranja,
 * solicitada azul. Fica de fora no Calendário, onde a cor das barras é a do
 * setor e a situação se lê pelo preenchimento.
 */
const COR_DA_SITUACAO: Record<StatusAgenda, string> = {
  efetivada: "var(--mh-success)",
  aprovada: "var(--mh-warning)",
  solicitada: "var(--mh-info)",
};

export function FiltroDeSituacoes({
  ligadas, onMudar, contagem, porCor = false,
}: {
  ligadas: Record<StatusAgenda, boolean>;
  onMudar: (s: Record<StatusAgenda, boolean>) => void;
  /** quantos períodos de cada situação passam pelos outros filtros (omitido = sem número) */
  contagem?: Record<StatusAgenda, number>;
  /** cada situação na sua cor (sem barras de setor por perto) */
  porCor?: boolean;
}) {
  return (
    <div role="group" aria-label="Situações mostradas" style={{ display: "inline-flex", gap: "0.35rem", flexWrap: "wrap" }}>
      {STATUS_AGENDA.map((s) => {
        const ligado = ligadas[s];
        return (
          <button
            key={s}
            type="button"
            aria-pressed={ligado}
            title={ligado ? "Clique para esconder" : "Clique para mostrar"}
            onClick={() => onMudar({ ...ligadas, [s]: !ligado })}
            style={{
              display: "inline-flex", alignItems: "center", gap: "0.45rem",
              padding: "0.32rem 0.75rem", borderRadius: "var(--mh-radius-full)",
              border: `1px solid ${ligado ? "var(--mh-border-strong)" : "var(--mh-border)"}`,
              background: ligado ? "var(--mh-surface-2)" : "transparent",
              color: ligado ? "var(--mh-text-1)" : "var(--mh-text-3)",
              fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              transition: "background var(--mh-dur-fast) var(--mh-ease), color var(--mh-dur-fast) var(--mh-ease)",
            }}
          >
            <span aria-hidden style={{
              display: "inline-block", width: 18, height: 11, borderRadius: 3,
              // com cor própria a situação já se distingue: o quadrinho vai cheio
              ...(porCor
                ? { background: `color-mix(in srgb, ${COR_DA_SITUACAO[s]} 75%, transparent)`, border: `1px solid ${COR_DA_SITUACAO[s]}` }
                : estiloDaSituacao(s, "var(--mh-primary-500)")),
              opacity: ligado ? 1 : 0.35,
            }} />
            {STATUS_AGENDA_CURTO[s]}
            {contagem && (
              <span className="tabular" style={{ fontWeight: 700, color: ligado ? "var(--mh-text-2)" : "var(--mh-text-3)" }}>
                {contagem[s]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

type Atalho = "hoje" | "7d" | "30d" | "mes" | "proximoMes" | "12m" | "ano";

/**
 * A barra de filtros do acompanhamento e da programação, numa linha só:
 * período (um botão que abre os atalhos e o período personalizado), busca,
 * setor e as situações.
 *
 * Antes eram duas datas, cinco botões de atalho e três caixas de seleção soltos
 * em duas linhas (LUIZ, 09/11/2026). O período agora diz o que está valendo no
 * próprio botão, e o resto da linha fica para o que muda com mais frequência.
 */
export function BarraFiltrosFerias({
  filtros, onChange, setores, hoje, atalhos, itens,
}: {
  filtros: FiltrosFerias;
  onChange: (f: FiltrosFerias) => void;
  setores: { id: string; name: string }[];
  hoje: string;
  /** quais atalhos de período mostrar */
  atalhos: Atalho[];
  /** o que veio do período: para contar cada situação nos botões */
  itens?: AgendaItem[];
}) {
  const set = (patch: Partial<FiltrosFerias>) => onChange({ ...filtros, ...patch });
  const ano = hoje.slice(0, 4);
  const opcoes: Record<Atalho, { rotulo: string; de: string; ate: string }> = {
    hoje: { rotulo: "Hoje", de: hoje, ate: hoje },
    "7d": { rotulo: "Próximos 7 dias", de: hoje, ate: somarDias(hoje, 6) },
    "30d": { rotulo: "Próximos 30 dias", de: hoje, ate: somarDias(hoje, 29) },
    mes: { rotulo: "Este mês", de: inicioDoMes(hoje), ate: fimDoMes(hoje) },
    proximoMes: { rotulo: "Próximo mês", de: proximoMes(hoje), ate: fimDoMes(proximoMes(hoje)) },
    "12m": { rotulo: "Próximos 12 meses", de: hoje, ate: somarDias(hoje, 364) },
    ano: { rotulo: `Ano de ${ano}`, de: `${ano}-01-01`, ate: `${ano}-12-31` },
  };
  const atalhoAtivo = atalhos.find((a) => opcoes[a].de === filtros.de && opcoes[a].ate === filtros.ate);
  const datas = filtros.de === filtros.ate
    ? formatDate(filtros.de)
    : `${formatDate(filtros.de)} a ${formatDate(filtros.ate)}`;
  const rotulo = `${atalhoAtivo ? opcoes[atalhoAtivo].rotulo : "Personalizado"} · ${datas}`;

  // a contagem de cada situação respeita busca e setor, não o próprio liga/desliga
  const contagem = useMemo(() => {
    if (!itens) return undefined;
    const conta: Record<StatusAgenda, number> = { efetivada: 0, aprovada: 0, solicitada: 0 };
    for (const i of aplicarFiltros(itens, { ...filtros, status: TODOS_OS_STATUS })) conta[i.status] += 1;
    return conta;
  }, [itens, filtros]);

  return (
    <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
      <Dropdown rotulo={rotulo} icone={<CalendarDays size={15} aria-hidden />} largura={300} titulo="Período">
        {(fechar) => (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.1rem" }}>
              {atalhos.map((a) => {
                const o = opcoes[a];
                const ativo = a === atalhoAtivo;
                return (
                  <button
                    key={a}
                    type="button"
                    onClick={() => { set({ de: o.de, ate: o.ate }); fechar(); }}
                    style={{
                      display: "flex", alignItems: "center", gap: "0.5rem", width: "100%",
                      padding: "0.45rem 0.6rem", borderRadius: "var(--mh-radius-sm)",
                      border: "none", font: "inherit", fontSize: "0.85rem", textAlign: "left", cursor: "pointer",
                      background: ativo ? "var(--mh-primary-soft)" : "none",
                      color: ativo ? "var(--mh-primary-500)" : "var(--mh-text-1)",
                      fontWeight: ativo ? 600 : 400,
                    }}
                  >
                    <span style={{ flex: 1 }}>{o.rotulo}</span>
                    <span className="soft" style={{ fontSize: "0.74rem", fontWeight: 400 }}>
                      {o.de === o.ate ? formatDate(o.de).slice(0, 5) : `${formatDate(o.de).slice(0, 5)} a ${formatDate(o.ate).slice(0, 5)}`}
                    </span>
                    <Check size={14} aria-hidden style={{ visibility: ativo ? "visible" : "hidden" }} />
                  </button>
                );
              })}
            </div>
            <div style={{ borderTop: "1px solid var(--mh-border)", paddingTop: "0.65rem", display: "flex", flexDirection: "column", gap: "0.45rem" }}>
              <span style={{ fontSize: "0.78rem", fontWeight: 700 }}>
                Período personalizado{!atalhoAtivo && <span className="soft" style={{ fontWeight: 400 }}> (em uso)</span>}
              </span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.45rem" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "0.74rem" }} className="soft">
                  De
                  <input className="input" type="date" value={filtros.de}
                    onChange={(e) => set({ de: e.target.value })} style={{ fontSize: "0.82rem" }} />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "0.74rem" }} className="soft">
                  Até
                  <input className="input" type="date" value={filtros.ate}
                    onChange={(e) => set({ ate: e.target.value })} style={{ fontSize: "0.82rem" }} />
                </label>
              </div>
            </div>
          </>
        )}
      </Dropdown>

      <div style={{ position: "relative", flex: "1 1 240px", maxWidth: 340 }}>
        <Search size={14} aria-hidden style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--mh-text-3)" }} />
        <input className="input" placeholder="Buscar por nome, matrícula, setor ou cargo" value={filtros.busca}
          aria-label="Buscar" onChange={(e) => set({ busca: e.target.value })}
          style={{ width: "100%", paddingLeft: "2rem", fontSize: "0.82rem" }} />
      </div>
      <select className="input" value={filtros.setor} onChange={(e) => set({ setor: e.target.value })}
        aria-label="Setor" style={{ width: 200, fontSize: "0.82rem" }}>
        <option value="">Todos os setores</option>
        {[...setores].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        <option value="__sem__">Sem setor</option>
      </select>

      <div style={{ marginLeft: "auto" }}>
        <FiltroDeSituacoes ligadas={filtros.status} onMudar={(status) => set({ status })} contagem={contagem} porCor />
      </div>
    </div>
  );
}
