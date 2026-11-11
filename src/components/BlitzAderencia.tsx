"use client";

import { useMemo, useState } from "react";
import { ExportButton } from "@/components/ui/ExportButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDate, normalizar, shortName } from "@/lib/format";
import { pct, type AderenciaDados, type AderenciaFalta, type AderenciaGrupo } from "@/lib/blitz-aderencia";

/** Da maior aderência para a menor (LUIZ, 11/11/2026); empate vai pelo nome. */
function ordenar(grupos: AderenciaGrupo[]) {
  return [...grupos].sort((a, b) =>
    (pct(b.passaram, b.publico) ?? 0) - (pct(a.passaram, a.publico) ?? 0) || a.nome.localeCompare(b.nome, "pt-BR"));
}

/**
 * Barras horizontais de uma série só (aderência %): cor da marca, sem legenda
 * (o título da seção nomeia), valor na ponta da barra e o detalhe no hover.
 * A tabela ao lado é a leitura exata dos mesmos números.
 */
function GraficoGrupos({ grupos, rotulo }: { grupos: AderenciaGrupo[]; rotulo: string }) {
  const [sobre, setSobre] = useState<string | null>(null);
  const lista = ordenar(grupos);
  if (lista.length === 0) return <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Sem público neste período.</p>;
  return (
    <div role="img" aria-label={`Aderência por ${rotulo.toLowerCase()}, da maior para a menor`} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {lista.map((g) => {
        const p = pct(g.passaram, g.publico) ?? 0;
        const ativo = sobre === g.nome;
        return (
          <div
            key={g.nome}
            onMouseEnter={() => setSobre(g.nome)}
            onMouseLeave={() => setSobre(null)}
            style={{ position: "relative", display: "grid", gridTemplateColumns: "minmax(80px, 34%) 1fr 42px", alignItems: "center", gap: "0.5rem", padding: "3px 0" }}
          >
            <span className="soft" title={g.nome} style={{ fontSize: "0.76rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.nome}</span>
            <div style={{ height: 14, borderLeft: "1px solid var(--border)" }}>
              <div style={{
                width: `${p}%`, minWidth: p > 0 ? 3 : 0, height: "100%", borderRadius: "0 4px 4px 0",
                background: ativo ? "var(--mh-primary-600)" : "var(--mh-primary-500)",
              }} />
            </div>
            <span style={{ fontSize: "0.78rem", fontWeight: 600, textAlign: "right" }}>{p}%</span>
            {ativo && (
              <div role="tooltip" style={{
                position: "absolute", left: "34%", bottom: "100%", zIndex: 5, pointerEvents: "none",
                background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8,
                padding: "0.35rem 0.6rem", fontSize: "0.76rem", boxShadow: "var(--mh-shadow-e2)", whiteSpace: "nowrap",
              }}>
                <strong>{g.nome}</strong>: {g.passaram} de {g.publico} passaram ({p}%), faltam {g.publico - g.passaram}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TabelaGrupos({ grupos, rotulo }: { grupos: AderenciaGrupo[]; rotulo: string }) {
  const lista = ordenar(grupos);
  if (lista.length === 0) return null;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="table">
        <thead>
          <tr>
            <th>{rotulo}</th>
            <th style={{ textAlign: "right", width: 70 }}>Público</th>
            <th style={{ textAlign: "right", width: 75 }}>Passaram</th>
            <th style={{ textAlign: "right", width: 60 }}>Faltam</th>
            <th style={{ textAlign: "right", width: 80 }}>Aderência</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((g) => (
            <tr key={g.nome}>
              <td style={{ fontWeight: 600 }}>{g.nome}</td>
              <td className="muted" style={{ textAlign: "right" }}>{g.publico}</td>
              <td className="muted" style={{ textAlign: "right" }}>{g.passaram}</td>
              <td className="muted" style={{ textAlign: "right" }}>{g.publico - g.passaram}</td>
              <td style={{ textAlign: "right", fontWeight: 600 }}>{pct(g.passaram, g.publico) ?? 0}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A aderência do período escolhido no topo das Análises: por setor, por
 * gestor e por unidade, as três à vista ao mesmo tempo (LUIZ, 11/11/2026),
 * cada uma com gráfico e tabela. Quem falta tem subaba própria.
 */
export function BlitzAderenciaDetalhe({ dados, rotuloPeriodo }: {
  dados: AderenciaDados;
  /** "novembro de 2026", "2026", "01/11/2026 a 11/11/2026" */
  rotuloPeriodo: string;
}) {
  const visoes: { titulo: string; rotulo: string; grupos: AderenciaGrupo[] }[] = [
    { titulo: "Por setor", rotulo: "Setor", grupos: dados.por_setor },
    { titulo: "Por gestor", rotulo: "Gestor", grupos: dados.por_gestor },
    { titulo: "Por unidade", rotulo: "Unidade", grupos: dados.por_unidade },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>Aderência à blitz em {rotuloPeriodo}</h3>
        <p className="soft" style={{ fontSize: "0.78rem", margin: "0.15rem 0 0" }}>
          Do público, quem passou pela blitz pelo menos uma vez no período. Setor, gestor e unidade são os de hoje.
          Fora da conta: {dados.fora.por_funcao} por função, {dados.fora.por_excecao} por exceção
          e {dados.fora.ausentes} ausentes o período todo.
        </p>
      </div>
      {visoes.map((v) => (
        <section key={v.titulo} className="card card-pad">
          <h4 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 0.75rem" }}>{v.titulo}</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", gap: "1.25rem", alignItems: "start" }}>
            <GraficoGrupos grupos={v.grupos} rotulo={v.rotulo} />
            <TabelaGrupos grupos={v.grupos} rotulo={v.rotulo} />
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * Quem do público ainda não passou no período: a lista que a portaria usa no
 * dia a dia, com busca e exportação.
 */
export function BlitzFaltamPassar({ faltam, rotuloPeriodo, chaveArquivo }: {
  faltam: AderenciaFalta[];
  rotuloPeriodo: string;
  /** pedaço do nome do arquivo exportado (ex.: 2026-11-01_2026-11-30) */
  chaveArquivo: string;
}) {
  const [busca, setBusca] = useState("");
  const termo = normalizar(busca.trim());
  const lista = useMemo(() => faltam.filter((f) => !termo || normalizar(
    [f.nome, f.matricula, f.funcao, f.setor, f.gestor, f.unidade].filter(Boolean).join(" "),
  ).includes(termo)), [faltam, termo]);

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <div>
          <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>Faltam passar em {rotuloPeriodo}</h3>
          <p className="soft" style={{ fontSize: "0.78rem", margin: "0.15rem 0 0" }}>
            Do público, quem ainda não passou pela blitz no período ({faltam.length}).
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <input className="input" placeholder="Buscar nome, matrícula, setor ou gestor…" value={busca}
            onChange={(e) => setBusca(e.target.value)} style={{ width: 260, maxWidth: "100%" }} />
          <ExportButton
            filename={`blitz-faltam-${chaveArquivo}.xlsx`}
            sheetName="Faltam passar"
            headers={["Matrícula", "Colaborador", "Função", "Setor", "Gestor", "Unidade", "Última blitz"]}
            rows={lista.map((f) => [f.matricula ?? "", f.nome ?? "", f.funcao ?? "", f.setor ?? "", f.gestor ?? "", f.unidade ?? "", f.ultima ? formatDate(f.ultima) : ""])}
          />
        </div>
      </div>
      {faltam.length === 0 ? (
        <EmptyState title="Ninguém faltando" description="Todo o público do período já passou pela blitz." />
      ) : (
        <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th className="so-desktop">Função</th>
                <th>Setor</th>
                <th className="so-desktop">Gestor</th>
                <th className="so-desktop">Unidade</th>
                <th className="so-desktop" style={{ width: 110 }}>Última blitz</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((f) => (
                <tr key={f.user_id}>
                  <td style={{ fontWeight: 600 }}>
                    {shortName(f.nome)}
                    {f.matricula && <span className="soft" style={{ fontWeight: 400, fontSize: "0.76rem" }}> · {f.matricula}</span>}
                  </td>
                  <td className="so-desktop muted" style={{ fontSize: "0.82rem" }}>{f.funcao ?? "—"}</td>
                  <td className="muted" style={{ fontSize: "0.82rem" }}>{f.setor ?? "—"}</td>
                  <td className="so-desktop muted" style={{ fontSize: "0.82rem" }}>{shortName(f.gestor) || "—"}</td>
                  <td className="so-desktop muted" style={{ fontSize: "0.82rem" }}>{f.unidade ?? "—"}</td>
                  <td className="so-desktop muted" style={{ fontSize: "0.82rem" }}>{f.ultima ? formatDate(f.ultima) : "Nunca"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
