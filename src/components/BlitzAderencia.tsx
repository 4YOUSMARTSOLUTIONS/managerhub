"use client";

import { useMemo, useState } from "react";
import { Tabs } from "@/components/ui/Tabs";
import { ExportButton } from "@/components/ui/ExportButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDate, normalizar, shortName } from "@/lib/format";
import { pct, type AderenciaDados, type AderenciaGrupo } from "@/lib/blitz-aderencia";

/** Grupos do pior para o melhor: quem precisa de atenção aparece primeiro. */
function TabelaGrupos({ grupos, rotulo }: { grupos: AderenciaGrupo[]; rotulo: string }) {
  const lista = [...grupos].sort((a, b) =>
    (pct(a.passaram, a.publico) ?? 0) - (pct(b.passaram, b.publico) ?? 0) || a.nome.localeCompare(b.nome, "pt-BR"));
  if (lista.length === 0) return <p className="soft" style={{ fontSize: "0.82rem", margin: "0.6rem 0" }}>Sem público neste período.</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="table">
        <thead>
          <tr>
            <th>{rotulo}</th>
            <th style={{ textAlign: "right", width: 80 }}>Público</th>
            <th style={{ textAlign: "right", width: 80 }}>Passaram</th>
            <th className="so-desktop" style={{ textAlign: "right", width: 80 }}>Faltam</th>
            <th style={{ width: 170 }}>Aderência</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((g) => {
            const p = pct(g.passaram, g.publico) ?? 0;
            return (
              <tr key={g.nome}>
                <td style={{ fontWeight: 600 }}>{g.nome}</td>
                <td className="muted" style={{ textAlign: "right" }}>{g.publico}</td>
                <td className="muted" style={{ textAlign: "right" }}>{g.passaram}</td>
                <td className="muted so-desktop" style={{ textAlign: "right" }}>{g.publico - g.passaram}</td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <div style={{ flex: 1, height: 6, borderRadius: 99, background: "var(--surface-2)", overflow: "hidden" }}>
                      <div style={{ width: `${p}%`, height: "100%", background: "var(--mh-primary-500)" }} />
                    </div>
                    <span style={{ fontSize: "0.82rem", fontWeight: 600, minWidth: 36, textAlign: "right" }}>{p}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * O detalhe da aderência no período escolhido no topo das Análises: quebra por
 * setor, gestor, unidade e função, e a lista de quem falta, que é o que a
 * portaria usa no dia a dia. Os números grandes ficam nos cartões do topo.
 */
export function BlitzAderenciaDetalhe({ dados, rotuloPeriodo, chaveArquivo }: {
  dados: AderenciaDados;
  /** "novembro de 2026", "2026", "01/11/2026 a 11/11/2026" */
  rotuloPeriodo: string;
  /** pedaço do nome do arquivo exportado (ex.: 2026-11) */
  chaveArquivo: string;
}) {
  const [busca, setBusca] = useState("");
  const termo = normalizar(busca.trim());
  const faltam = useMemo(() => dados.faltam.filter((f) => !termo || normalizar(
    [f.nome, f.matricula, f.funcao, f.setor, f.gestor, f.unidade].filter(Boolean).join(" "),
  ).includes(termo)), [dados.faltam, termo]);

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>Aderência à blitz em {rotuloPeriodo}</h3>
        <p className="soft" style={{ fontSize: "0.78rem", margin: "0.15rem 0 0" }}>
          Do público, quem passou pela blitz pelo menos uma vez no período. Setor, gestor e função são os de hoje.
          Fora da conta: {dados.fora.por_funcao} por função, {dados.fora.por_excecao} por exceção
          e {dados.fora.ausentes} ausentes o período todo.
        </p>
      </div>

      <Tabs
        variant="sub"
        tabs={[
          { id: "setor", label: "Por setor", content: <TabelaGrupos grupos={dados.por_setor} rotulo="Setor" /> },
          { id: "gestor", label: "Por gestor", content: <TabelaGrupos grupos={dados.por_gestor} rotulo="Gestor" /> },
          { id: "unidade", label: "Por unidade", content: <TabelaGrupos grupos={dados.por_unidade} rotulo="Unidade" /> },
          { id: "funcao", label: "Por função", content: <TabelaGrupos grupos={dados.por_funcao} rotulo="Função" /> },
        ]}
      />

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
          <h4 style={{ fontSize: "0.88rem", fontWeight: 700, margin: 0 }}>
            Faltam passar ({dados.faltam.length})
          </h4>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <input className="input" placeholder="Buscar nome, matrícula, setor ou gestor…" value={busca}
              onChange={(e) => setBusca(e.target.value)} style={{ width: 260, maxWidth: "100%" }} />
            <ExportButton
              filename={`blitz-faltam-${chaveArquivo}.xlsx`}
              sheetName="Faltam passar"
              headers={["Matrícula", "Colaborador", "Função", "Setor", "Gestor", "Unidade", "Última blitz"]}
              rows={faltam.map((f) => [f.matricula ?? "", f.nome ?? "", f.funcao ?? "", f.setor ?? "", f.gestor ?? "", f.unidade ?? "", f.ultima ? formatDate(f.ultima) : ""])}
            />
          </div>
        </div>
        {dados.faltam.length === 0 ? (
          <EmptyState title="Ninguém faltando" description="Todo o público do período já passou pela blitz." />
        ) : (
          <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
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
                {faltam.map((f) => (
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
    </div>
  );
}
