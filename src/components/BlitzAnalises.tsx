"use client";

import { useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { StatCard } from "@/components/ui/StatCard";
import { Tabs } from "@/components/ui/Tabs";
import { BlitzAderenciaDetalhe, BlitzColaboradoresLista, BlitzRecorrenciaLista, type FiltroPessoa } from "./BlitzAderencia";
import { BlitzAlertasLista } from "./BlitzAlertasLista";
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
  inicial, unitIds, hoje, anos, vagaDoFiltro, tratativas,
}: {
  /** o mês corrente, já calculado no servidor */
  inicial: BlitzAnaliseDados;
  /** recorte do seletor de unidade do topo */
  unitIds: string[] | null;
  /** YYYY-MM-DD de hoje (fuso de São Paulo) */
  hoje: string;
  /** anos que o filtro oferece */
  anos: number[];
  /** onde desenhar o filtro (a linha das abas, no computador); sem vaga, fica no topo daqui */
  vagaDoFiltro?: HTMLElement | null;
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
  const [subaba, setSubaba] = useState("aderencia");
  // o clique no gráfico de aderência leva para a lista do público, em "Faltam passar" e já filtrada
  // (LUIZ, 11/11/2026); a versão remonta a lista com o filtro novo a cada clique
  const [filtroFaltam, setFiltroFaltam] = useState<FiltroPessoa>({});
  const [versaoFaltam, setVersaoFaltam] = useState(0);
  const topoDasSubabas = useRef<HTMLDivElement>(null);

  const verFaltam = (f: FiltroPessoa) => {
    setFiltroFaltam(f);
    setVersaoFaltam((v) => v + 1);
    setSubaba("colaboradores");
    // a lista é mais curta que o painel: sobe até as subabas para ela não abrir fora da tela
    requestAnimationFrame(() => {
      const el = topoDasSubabas.current;
      if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

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

  // o filtro: vale para os cartões e para o detalhe. No computador ele mora na
  // linha das abas (LUIZ, 11/11/2026); no celular, aqui no topo
  const filtro = (
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
      {(carregando || !vagaDoFiltro) && (
        <span className="soft" style={{ fontSize: "0.8rem" }}>{carregando ? "Carregando…" : `Mostrando ${periodo}`}</span>
      )}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
      {vagaDoFiltro ? createPortal(filtro, vagaDoFiltro) : filtro}

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
          {/* % tratado e sem tratativa em destaque, o total pequeno embaixo (LUIZ, 11/11/2026) */}
          <StatCard
            label="Alertas"
            value={
              <span style={{ display: "inline-flex", alignItems: "flex-start", gap: "0.6rem 1rem", flexWrap: "wrap" }}>
                {([[tratou === null ? "—" : `${tratou}%`, "tratado"], [ind.alertas.enviados - ind.alertas.com_tratativa, "sem tratativa"]] as const).map(([n, r]) => (
                  <span key={r} style={{ display: "inline-flex", flexDirection: "column", gap: "0.3rem" }}>
                    {n}
                    <span className="soft" style={{ fontSize: "0.72rem", fontWeight: 500, letterSpacing: 0, whiteSpace: "nowrap" }}>{r}</span>
                  </span>
                ))}
              </span>
            }
            hint={ind.alertas.enviados ? `${ind.alertas.enviados} ${ind.alertas.enviados === 1 ? "alerta" : "alertas"} no total` : "Nenhum alerta no período"}
          />
        </div>

        {tratativas}

        <div ref={topoDasSubabas} style={{ scrollMarginTop: 72 }}>
        <Tabs
          variant="sub"
          active={subaba}
          onActiveChange={setSubaba}
          tabs={[
            { id: "aderencia", label: "Aderência", content: <BlitzAderenciaDetalhe dados={ad} rotuloPeriodo={periodo} onVerFaltam={verFaltam} /> },
            {
              // quem passou e quem falta numa lista só, com seletor (LUIZ, 11/11/2026);
              // aberta pelo gráfico, já vem em "Faltam passar"
              id: "colaboradores", label: `Colaboradores (${ad.publico})`,
              content: (
                <BlitzColaboradoresLista key={versaoFaltam} dados={ad} rotuloPeriodo={periodo}
                  chaveArquivo={`${dados.de}_${dados.ate}`} filtroInicial={filtroFaltam}
                  situacaoInicial={versaoFaltam > 0 ? "faltam" : "todos"} />
              ),
            },
            {
              id: "recorrencia", label: `Recorrência (${dados.recorrencia.length})`,
              content: <BlitzRecorrenciaLista recorrencia={dados.recorrencia} rotuloPeriodo={periodo} />,
            },
            {
              // a lista dos alertas: quem tratou e quem está devendo (LUIZ, 11/11/2026)
              id: "alertas", label: `Alertas (${(dados.alertas ?? []).length})`,
              content: <BlitzAlertasLista alertas={dados.alertas ?? []} rotuloPeriodo={periodo} chaveArquivo={`${dados.de}_${dados.ate}`} />,
            },
          ]}
        />
        </div>
      </div>
    </div>
  );
}
