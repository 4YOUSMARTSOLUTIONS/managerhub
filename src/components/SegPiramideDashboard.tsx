"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { SEG_ACIDENTE_CLASS_LONGO } from "@/lib/constants";
import type { Enums } from "@/types/database";

export type PainelSeguranca = {
  ano: number;
  piramide: { desvios: number; incidentes: number; atendimento: number; lti: number; sif: number };
  relatos: {
    total: number; validos: number; positivos: number;
    aguardando: number; improcedentes: number; duplicados: number;
    triados: number; com_causa: number;
  };
  acidentes: {
    total: number; abertos: number; dias_perdidos: number;
    por_classe: Partial<Record<Enums<"seg_acidente_class">, number>>;
  };
  mensal: { mes: number; desvios: number; incidentes: number; positivos: number; acidentes: number }[];
  por_local: { nome: string; relatos: number; acidentes: number }[];
  por_area: { nome: string; relatos: number; acidentes: number }[];
  por_tipo: { nome: string; total: number }[];
  por_causa: { nome: string; relatos: number; acidentes: number }[];
  restrito?: {
    taxa_tratamento: number | null;
    por_setor: { nome: string; relatos: number; acidentes: number }[];
    por_gestor: { nome: string; relatos: number; acidentes: number }[];
    causa_por_area: { area: string; causa: string; total: number }[];
  };
};

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

/**
 * As cinco camadas, da base ao topo.
 *
 * A cor não é decoração: ela é a escala de severidade que a pirâmide clássica
 * usa, e é o que permite ler o desenho sem ler os rótulos. Todas são tokens do
 * sistema, então o painel acompanha o tema claro e o escuro.
 */
const CAMADAS = [
  { chave: "sif", titulo: "Lesão grave ou fatalidade", ajuda: "SIF", cor: "var(--mh-danger)" },
  { chave: "lti", titulo: "Acidente com afastamento", ajuda: "LTI", cor: "var(--mh-warning)" },
  { chave: "atendimento", titulo: "Acidente sem afastamento", ajuda: "FAI, MTI e MDI", cor: "var(--mh-success)" },
  { chave: "incidentes", titulo: "Incidentes", ajuda: "Quase acidente, sem lesão", cor: "var(--mh-info)" },
  { chave: "desvios", titulo: "Desvios relatados", ajuda: "Ato e condição insegura", cor: "var(--mh-primary-500)" },
] as const;

/**
 * A pirâmide em SVG. Sem biblioteca: são cinco trapézios e cinco números.
 *
 * O `maxWidth` não é enfeite: um SVG com largura 100% escala TUDO junto, texto
 * incluído, e num monitor largo a pirâmide vira um pôster de duas dobras de
 * rolagem. Com o teto ela para de crescer e o desenho inteiro cabe na tela.
 */
function Piramide({ dados }: { dados: PainelSeguranca["piramide"] }) {
  const L = 5;
  const alturaCamada = 44;
  const vao = 3;
  const cx = 145;
  // topo com meia largura ZERO: a camada de cima é um triângulo, e é ela que
  // dá a ponta. Com qualquer valor aqui a pirâmide fica decapitada.
  const meioTopo = 0;
  const passo = 26;
  const altura = L * alturaCamada + 16;

  return (
    <svg
      viewBox={`0 0 500 ${altura}`}
      role="img"
      aria-label="Pirâmide de Heinrich do período"
      style={{ width: "100%", maxWidth: 500, height: "auto", display: "block", margin: "0 auto" }}
    >
      {CAMADAS.map((c, i) => {
        const yTop = 8 + i * alturaCamada;
        const yBot = yTop + alturaCamada - vao;
        const halfTop = meioTopo + i * passo;
        const halfBot = meioTopo + (i + 1) * passo - (vao * passo) / alturaCamada;
        const valor = dados[c.chave];
        const meioY = yTop + (alturaCamada - vao) / 2;
        // na ponta o meio da camada é estreito demais para o número: ele desce
        // para onde o triângulo já abriu
        const numeroY = i === 0 ? yTop + (alturaCamada - vao) * 0.78 : meioY + 5;

        return (
          <g key={c.chave}>
            <polygon
              points={
                halfTop === 0
                  // a camada do topo é triângulo, e é ela que faz a pirâmide
                  // ter ponta
                  ? `${cx},${yTop} ${cx + halfBot},${yBot} ${cx - halfBot},${yBot}`
                  : `${cx - halfTop},${yTop} ${cx + halfTop},${yTop} ${cx + halfBot},${yBot} ${cx - halfBot},${yBot}`
              }
              fill={c.cor}
            />
            {/* o número vai dentro da faixa: as cinco cores são saturadas, então
                branco tem contraste nos dois temas */}
            <text
              x={cx} y={numeroY} textAnchor="middle"
              fontSize={valor > 999 ? 13 : 15} fontWeight={700} fill="#fff"
            >
              {valor}
            </text>
            <text x={cx + halfBot + 12} y={meioY - 1} fontSize={11} fontWeight={600} fill="var(--mh-text-1)">
              {c.titulo}
            </text>
            <text x={cx + halfBot + 12} y={meioY + 12} fontSize={9} fill="var(--mh-text-3)">
              {c.ajuda}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Barras horizontais simples, no mesmo desenho do painel de chamados. */
function Barras({
  titulo, dados, vazio,
}: {
  titulo: string;
  dados: { nome: string; relatos: number; acidentes: number }[];
  vazio: string;
}) {
  const lista = dados.slice(0, 8);
  const max = Math.max(1, ...lista.map((d) => d.relatos + d.acidentes));

  return (
    <div className="card card-pad">
      <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 0.8rem" }}>{titulo}</h3>
      {lista.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>{vazio}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {lista.map((d) => {
            const total = d.relatos + d.acidentes;
            return (
              <div key={d.nome}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", marginBottom: "0.2rem" }}>
                  <span>{d.nome}</span>
                  <span className="soft">
                    {d.relatos} relato{d.relatos === 1 ? "" : "s"}
                    {d.acidentes > 0 ? ` · ${d.acidentes} acidente${d.acidentes === 1 ? "" : "s"}` : ""}
                  </span>
                </div>
                <div className="progress-track" style={{ display: "flex", overflow: "hidden" }}>
                  <div
                    className="progress-fill"
                    style={{ width: `${(d.relatos / max) * 100}%`, background: "var(--mh-primary-500)" }}
                  />
                  <div
                    className="progress-fill"
                    style={{ width: `${(d.acidentes / max) * 100}%`, background: "var(--mh-danger)" }}
                  />
                </div>
                <span className="soft" style={{ fontSize: "0.7rem" }}>{total} no total</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SegPiramideDashboard({
  painel, ano, alertas,
}: {
  painel: PainelSeguranca | null;
  ano: number;
  /** alertas ao gestor no ano e quantos viraram conversa; `visivel` false para
   *  quem não trata segurança */
  alertas: { enviados: number; comConversa: number; visivel: boolean };
}) {
  const router = useRouter();
  const params = useSearchParams();

  // O ano viaja na URL, para o painel de um exercício poder ser colado numa
  // reunião. A UNIDADE não: ela é do seletor do topo, e só de lá.
  const trocarAno = (valor: string) => {
    const p = new URLSearchParams(params.toString());
    if (valor) p.set("ano", valor);
    else p.delete("ano");
    router.push(`/seguranca/piramide?${p.toString()}`);
  };

  const anos = useMemo(() => {
    const atual = new Date().getFullYear();
    return [atual + 1, atual, atual - 1, atual - 2];
  }, []);

  const maxMes = useMemo(() => {
    if (!painel) return 1;
    return Math.max(
      1,
      ...painel.mensal.map((m) => m.desvios + m.incidentes + m.positivos),
      ...painel.mensal.map((m) => m.acidentes),
    );
  }, [painel]);

  if (!painel) {
    return (
      <EmptyState
        title="Sem dados para montar o painel"
        description="Assim que houver relatos ou acidentes no período escolhido, a pirâmide aparece aqui."
      />
    );
  }

  const totalPiramide =
    painel.piramide.desvios + painel.piramide.incidentes +
    painel.piramide.atendimento + painel.piramide.lti + painel.piramide.sif;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
        <select className="select" value={ano} onChange={(e) => trocarAno(e.target.value)} style={{ maxWidth: 130 }}>
          {anos.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0.8rem" }}>
        <StatCard label="Relatos no ano" value={painel.relatos.validos} hint={`${painel.relatos.aguardando} aguardando triagem`} />
        <StatCard label="Comportamento seguro" value={painel.relatos.positivos} tone="green" hint="Reconhecimento, fora da pirâmide" />
        <StatCard label="Acidentes" value={painel.acidentes.total} tone={painel.acidentes.total > 0 ? "red" : "green"} hint={`${painel.acidentes.abertos} em apuração`} />
        <StatCard label="Dias perdidos" value={painel.acidentes.dias_perdidos} tone="red" />
        {painel.restrito && (
          <StatCard
            label="Com causa apontada"
            value={
              painel.relatos.triados === 0
                ? "—"
                : `${Math.round((painel.relatos.com_causa / painel.relatos.triados) * 100)}%`
            }
            tone={
              painel.relatos.triados === 0 ? "gray"
                : painel.relatos.com_causa / painel.relatos.triados >= 0.8 ? "green"
                  : "amber"
            }
            hint="Dos relatos já analisados"
          />
        )}
        {painel.restrito && (
          <StatCard
            label="Relatos tratados"
            value={painel.restrito.taxa_tratamento != null ? `${painel.restrito.taxa_tratamento}%` : "—"}
            tone={
              painel.restrito.taxa_tratamento == null ? "gray"
                : painel.restrito.taxa_tratamento >= 80 ? "green"
                  : painel.restrito.taxa_tratamento >= 50 ? "amber" : "red"
            }
            hint="Improcedentes e duplicados fora da conta"
          />
        )}
        {alertas.visivel && alertas.enviados > 0 && (
          <StatCard
            label="Alertas com conversa"
            value={`${Math.round((alertas.comConversa / alertas.enviados) * 100)}%`}
            tone={
              alertas.comConversa / alertas.enviados >= 0.8 ? "green"
                : alertas.comConversa / alertas.enviados >= 0.5 ? "amber" : "red"
            }
            hint={`${alertas.comConversa} de ${alertas.enviados} gestores registraram`}
          />
        )}
      </div>

      {/* Pirâmide e série mensal lado a lado: a pirâmide é estreita por
          natureza, e sozinha numa faixa inteira deixava meia tela vazia. Em
          telas menores o auto-fit empilha as duas. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))",
          gap: "1rem",
          alignItems: "stretch",
        }}
      >
        <div className="card card-pad">
          <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>Pirâmide de Heinrich · {ano}</h3>
          <p className="soft" style={{ fontSize: "0.76rem", margin: "0.2rem 0 0" }}>
            {totalPiramide === 0
              ? "Nada registrado no período."
              : "Base larga é sinal bom: a operação está apontando o risco antes do acidente."}
          </p>
          <div style={{ marginTop: "0.7rem", overflowX: "auto" }}>
            <div style={{ minWidth: 300 }}>
              <Piramide dados={painel.piramide} />
            </div>
          </div>
        </div>

        <div className="card card-pad">
          <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>Mês a mês</h3>
          <p className="soft" style={{ fontSize: "0.76rem", margin: "0.2rem 0 0" }}>
            Relatos e acidentes ao longo de {ano}.
          </p>
          <div style={{ display: "flex", gap: "0.3rem", alignItems: "flex-end", overflowX: "auto", paddingBottom: "0.3rem", marginTop: "0.7rem" }}>
            {painel.mensal.map((m) => {
              const relatos = m.desvios + m.incidentes + m.positivos;
              const alturaRel = (relatos / maxMes) * 110;
              const alturaAci = (m.acidentes / maxMes) * 110;
              return (
                <div key={m.mes} style={{ flex: "1 1 0", minWidth: 26, textAlign: "center" }}>
                  <div style={{ display: "flex", gap: 2, alignItems: "flex-end", justifyContent: "center", height: 118 }}>
                    <div
                      title={`${relatos} relato(s)`}
                      style={{ width: 10, height: Math.max(relatos ? 3 : 0, alturaRel), background: "var(--mh-primary-500)", borderRadius: "3px 3px 0 0" }}
                    />
                    <div
                      title={`${m.acidentes} acidente(s)`}
                      style={{ width: 10, height: Math.max(m.acidentes ? 3 : 0, alturaAci), background: "var(--mh-danger)", borderRadius: "3px 3px 0 0" }}
                    />
                  </div>
                  <span className="soft" style={{ fontSize: "0.66rem" }}>{MESES[m.mes - 1]}</span>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem", fontSize: "0.74rem" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: "var(--mh-primary-500)" }} /> Relatos
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: "var(--mh-danger)" }} /> Acidentes
            </span>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1rem" }}>
        <Barras titulo="Por local" dados={painel.por_local} vazio="Nenhum local informado no período." />
        <Barras titulo="Por área" dados={painel.por_area} vazio="Nenhuma área informada no período." />
        <Barras
          titulo="Por causa-raiz"
          dados={painel.por_causa}
          vazio="Nenhuma causa apontada ainda. A equipe escolhe a causa na triagem."
        />
        {painel.restrito && (
          <>
            <Barras titulo="Por setor" dados={painel.restrito.por_setor} vazio="Nenhum envolvido com setor cadastrado." />
            <Barras titulo="Por gestor" dados={painel.restrito.por_gestor} vazio="Nenhum envolvido com gestor cadastrado." />
          </>
        )}

        {painel.restrito && painel.restrito.causa_por_area.length > 0 && (
          <div className="card card-pad">
            <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 0.3rem" }}>Causa por área</h3>
            <p className="soft" style={{ fontSize: "0.76rem", margin: "0 0 0.6rem" }}>
              O cruzamento que vira conversa com a liderança: o que mais causa desvio em cada área.
            </p>
            <table className="table">
              <thead>
                <tr><th>Área</th><th>Causa</th><th style={{ textAlign: "right", width: 60 }}>Total</th></tr>
              </thead>
              <tbody>
                {painel.restrito.causa_por_area.slice(0, 12).map((c) => (
                  <tr key={`${c.area}-${c.causa}`}>
                    <td>{c.area}</td>
                    <td className="muted" style={{ fontSize: "0.83rem" }}>{c.causa}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{c.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="card card-pad">
          <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 0.8rem" }}>Tipos de relato</h3>
          {painel.por_tipo.length === 0 ? (
            <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Nenhum relato no período.</p>
          ) : (
            <table className="table">
              <tbody>
                {painel.por_tipo.map((t) => (
                  <tr key={t.nome}>
                    <td>{t.nome}</td>
                    <td style={{ textAlign: "right", fontWeight: 600, width: 70 }}>{t.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card card-pad">
          <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 0.8rem" }}>Acidentes por classificação</h3>
          {painel.acidentes.total === 0 ? (
            <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Nenhum acidente no período. Que continue assim.</p>
          ) : (
            <table className="table">
              <tbody>
                {(Object.keys(SEG_ACIDENTE_CLASS_LONGO) as Enums<"seg_acidente_class">[])
                  .filter((c) => (painel.acidentes.por_classe[c] ?? 0) > 0)
                  .map((c) => (
                    <tr key={c}>
                      <td>{SEG_ACIDENTE_CLASS_LONGO[c]}</td>
                      <td style={{ textAlign: "right", fontWeight: 600, width: 70 }}>{painel.acidentes.por_classe[c]}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {(painel.relatos.improcedentes > 0 || painel.relatos.duplicados > 0) && (
        <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
          Fora da conta no período: {painel.relatos.improcedentes} relato(s) improcedente(s) e{" "}
          {painel.relatos.duplicados} duplicado(s). Eles ficam no histórico, mas não contam como desvio.
        </p>
      )}
    </div>
  );
}
