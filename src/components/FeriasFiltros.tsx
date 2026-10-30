"use client";

import { normalizar, somarDias } from "@/lib/format";
import { STATUS_AGENDA, STATUS_AGENDA_CURTO, type AgendaItem, type StatusAgenda } from "@/lib/ferias-agenda";

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
 * A barra de filtros do acompanhamento e da programação: período (com
 * atalhos), situação, setor e busca. Uma linha só, acima da tabela.
 */
export function BarraFiltrosFerias({
  filtros, onChange, setores, hoje, atalhos,
}: {
  filtros: FiltrosFerias;
  onChange: (f: FiltrosFerias) => void;
  setores: { id: string; name: string }[];
  hoje: string;
  /** quais atalhos de período mostrar */
  atalhos: ("hoje" | "7d" | "30d" | "mes" | "proximoMes" | "12m" | "ano")[];
}) {
  const set = (patch: Partial<FiltrosFerias>) => onChange({ ...filtros, ...patch });
  const ano = hoje.slice(0, 4);
  const opcoes: Record<string, { rotulo: string; de: string; ate: string }> = {
    hoje: { rotulo: "Hoje", de: hoje, ate: hoje },
    "7d": { rotulo: "Próximos 7 dias", de: hoje, ate: somarDias(hoje, 6) },
    "30d": { rotulo: "Próximos 30 dias", de: hoje, ate: somarDias(hoje, 29) },
    mes: { rotulo: "Este mês", de: inicioDoMes(hoje), ate: fimDoMes(hoje) },
    proximoMes: { rotulo: "Próximo mês", de: proximoMes(hoje), ate: fimDoMes(proximoMes(hoje)) },
    "12m": { rotulo: "Próximos 12 meses", de: hoje, ate: somarDias(hoje, 364) },
    ano: { rotulo: `Ano de ${ano}`, de: `${ano}-01-01`, ate: `${ano}-12-31` },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <label className="soft" style={{ fontSize: "0.8rem" }} htmlFor="ferias-de">De</label>
        <input id="ferias-de" className="input" type="date" value={filtros.de}
          onChange={(e) => set({ de: e.target.value })} style={{ maxWidth: 160, fontSize: "0.82rem" }} />
        <label className="soft" style={{ fontSize: "0.8rem" }} htmlFor="ferias-ate">até</label>
        <input id="ferias-ate" className="input" type="date" value={filtros.ate}
          onChange={(e) => set({ ate: e.target.value })} style={{ maxWidth: 160, fontSize: "0.82rem" }} />
        {atalhos.map((a) => {
          const o = opcoes[a];
          const ativo = filtros.de === o.de && filtros.ate === o.ate;
          return (
            <button key={a} type="button" className={`btn btn-sm ${ativo ? "btn-primary" : "btn-ghost"}`}
              onClick={() => set({ de: o.de, ate: o.ate })}>
              {o.rotulo}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <input className="input" placeholder="Buscar por nome, matrícula, setor ou cargo…" value={filtros.busca}
          onChange={(e) => set({ busca: e.target.value })} style={{ maxWidth: 320, fontSize: "0.82rem" }} />
        <select className="input" value={filtros.setor} onChange={(e) => set({ setor: e.target.value })}
          style={{ maxWidth: 200, fontSize: "0.82rem" }}>
          <option value="">Todos os setores</option>
          {[...setores].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value="__sem__">Sem setor</option>
        </select>
        {STATUS_AGENDA.map((s) => (
          <label key={s} style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.8rem", cursor: "pointer" }}>
            <input type="checkbox" checked={filtros.status[s]}
              onChange={(e) => set({ status: { ...filtros.status, [s]: e.target.checked } })} />
            {STATUS_AGENDA_CURTO[s]}
          </label>
        ))}
      </div>
    </div>
  );
}
