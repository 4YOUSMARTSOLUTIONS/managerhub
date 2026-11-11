"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Users } from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { Tabs } from "@/components/ui/Tabs";
import { BlitzAderenciaDetalhe, BlitzFaltamPassar, BlitzRecorrenciaLista } from "./BlitzAderencia";
import { getBlitzAnalise } from "@/lib/actions/seguranca";
import { formatDate } from "@/lib/format";
import { pct, type BlitzAnaliseDados } from "@/lib/blitz-aderencia";

type Modo = "mes" | "ano" | "periodo";

const NOME_MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function fimDoMes(ym: string): string {
  const [a, m] = ym.split("-").map(Number);
  const ultimo = new Date(a, m, 0).getDate();
  return `${ym}-${String(ultimo).padStart(2, "0")}`;
}

function rotulo(modo: Modo, de: string, ate: string): string {
  if (modo === "ano") return de.slice(0, 4);
  if (modo === "mes") return `${NOME_MES[Number(de.slice(5, 7)) - 1]} de ${de.slice(0, 4)}`;
  return `${formatDate(de)} a ${formatDate(ate)}`;
}

/**
 * Análises da blitz (LUIZ, 11/11/2026). Um filtro de período no topo (mês,
 * ano ou datas livres) vale para TUDO: os cartões, sempre no topo, e as
 * subabas de detalhe (aderência e recorrência). As tratativas que o gestor
 * deve entram entre os cartões e o detalhe.
 */
export function BlitzAnalises({
  inicial, unitIds, hoje, anos, podeConfigurar, tratativas,
}: {
  /** o mês corrente, já calculado no servidor */
  inicial: BlitzAnaliseDados;
  /** recorte do seletor de unidade do topo */
  unitIds: string[] | null;
  /** YYYY-MM-DD de hoje (fuso de São Paulo) */
  hoje: string;
  /** anos que o filtro oferece */
  anos: number[];
  /** owner/admin: atalho para o público, em Configurações > Segurança */
  podeConfigurar: boolean;
  tratativas?: React.ReactNode;
}) {
  const [carregando, iniciar] = useTransition();
  const [modo, setModo] = useState<Modo>("mes");
  const [mes, setMes] = useState(inicial.de.slice(0, 7));
  const [ano, setAno] = useState(Number(inicial.de.slice(0, 4)));
  const [de, setDe] = useState(inicial.de);
  const [ate, setAte] = useState(inicial.ate > hoje ? hoje : inicial.ate);
  const [dados, setDados] = useState(inicial);
  const [modoDosDados, setModoDosDados] = useState<Modo>("mes");

  const carregar = (m: Modo, d: string, a: string) => {
    if (!d || !a || a < d) { toast.error("Escolha um período válido."); return; }
    iniciar(async () => {
      const r = await getBlitzAnalise({ de: d, ate: a, unitIds });
      if (r.error || !r.data) { toast.error(r.error ?? "Não foi possível carregar as análises."); return; }
      setDados(r.data);
      setModoDosDados(m);
    });
  };

  const escolherModo = (m: Modo) => {
    setModo(m);
    if (m === "mes") carregar("mes", `${mes}-01`, fimDoMes(mes));
    if (m === "ano") carregar("ano", `${ano}-01-01`, `${ano}-12-31`);
    // período livre: espera o "Aplicar"
  };

  const ind = dados.indicadores;
  const ad = dados.aderencia;
  const conformidade = pct(ind.conformes, ind.total);
  const aderencia = pct(ad.passaram, ad.publico);
  const tratou = pct(ind.alertas.com_tratativa, ind.alertas.enviados);
  const periodo = rotulo(modoDosDados, dados.de, dados.ate);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
      {/* filtro: vale para os cartões e para o detalhe */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", gap: "0.3rem" }} role="group" aria-label="Tipo de período">
          {([["mes", "Mês"], ["ano", "Ano"], ["periodo", "Período"]] as [Modo, string][]).map(([m, r]) => (
            <button key={m} type="button" aria-pressed={modo === m} disabled={carregando}
              className={`btn btn-sm ${modo === m ? "btn-primary" : "btn-ghost"}`} onClick={() => escolherModo(m)}>
              {r}
            </button>
          ))}
        </div>
        {modo === "mes" && (
          <input type="month" className="input" value={mes} max={hoje.slice(0, 7)} aria-label="Mês" style={{ width: "auto" }}
            onChange={(e) => { const v = e.target.value; if (!v) return; setMes(v); carregar("mes", `${v}-01`, fimDoMes(v)); }} />
        )}
        {modo === "ano" && (
          <select className="select" value={ano} aria-label="Ano" style={{ width: "auto" }}
            onChange={(e) => { const v = Number(e.target.value); setAno(v); carregar("ano", `${v}-01-01`, `${v}-12-31`); }}>
            {anos.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        {modo === "periodo" && (
          <>
            <input type="date" className="input" value={de} max={hoje} aria-label="De" style={{ width: "auto" }} onChange={(e) => setDe(e.target.value)} />
            <span className="soft" style={{ fontSize: "0.82rem" }}>até</span>
            <input type="date" className="input" value={ate} max={hoje} aria-label="Até" style={{ width: "auto" }} onChange={(e) => setAte(e.target.value)} />
            <button type="button" className="btn btn-ghost btn-sm" disabled={carregando} onClick={() => carregar("periodo", de, ate)}>Aplicar</button>
          </>
        )}
        <span className="soft" style={{ fontSize: "0.8rem" }}>{carregando ? "Carregando…" : `Mostrando ${periodo}`}</span>
        {podeConfigurar && (
          <Link href="/configuracoes?aba=seguranca&sub=seg-blitz-publico" className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }}>
            <Users size={14} /> Público da blitz
          </Link>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem", opacity: carregando ? 0.6 : 1 }}>
        {/* cartões sempre no topo (LUIZ, 11/11/2026) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))", gap: "0.8rem" }}>
          <StatCard
            label="Conformidade"
            value={conformidade === null ? "—" : `${conformidade}%`}
            tone={conformidade === null ? "blue" : conformidade >= 80 ? "green" : conformidade >= 50 ? "amber" : "red"}
            hint={ind.total ? `${ind.conformes} de ${ind.total} blitz conformes` : "Nenhuma blitz no período"}
          />
          <StatCard
            label="Aderência"
            value={aderencia === null ? "—" : `${aderencia}%`}
            tone={aderencia === null ? "blue" : aderencia >= 90 ? "green" : aderencia >= 70 ? "amber" : "red"}
            hint={`${ad.passaram} de ${ad.publico} do público passaram`}
          />
          <StatCard label="Faltam passar" value={ad.publico - ad.passaram} hint="do público do período" />
          <StatCard label="Liberadas com desvio" value={ind.com_desvio} tone={ind.com_desvio > 0 ? "amber" : "green"} />
          <StatCard label="Bloqueios" value={ind.bloqueios} tone={ind.bloqueios > 0 ? "red" : "green"} />
          <StatCard
            label="Alertas com tratativa"
            value={tratou === null ? "—" : `${tratou}%`}
            tone={tratou === null ? "blue" : tratou >= 80 ? "green" : tratou >= 50 ? "amber" : "red"}
            hint={ind.alertas.enviados ? `${ind.alertas.com_tratativa} de ${ind.alertas.enviados} gestores registraram` : "Nenhum alerta no período"}
          />
        </div>

        {tratativas}

        <Tabs
          variant="sub"
          tabs={[
            { id: "aderencia", label: "Aderência", content: <BlitzAderenciaDetalhe dados={ad} rotuloPeriodo={periodo} /> },
            {
              id: "faltam", label: `Faltam passar (${ad.faltam.length})`,
              content: <BlitzFaltamPassar dados={ad} rotuloPeriodo={periodo} chaveArquivo={`${dados.de}_${dados.ate}`} />,
            },
            {
              id: "recorrencia", label: `Recorrência (${dados.recorrencia.length})`,
              content: <BlitzRecorrenciaLista recorrencia={dados.recorrencia} rotuloPeriodo={periodo} />,
            },
          ]}
        />
      </div>
    </div>
  );
}
