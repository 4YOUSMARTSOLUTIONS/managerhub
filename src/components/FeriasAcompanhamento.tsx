"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { ExportButton } from "@/components/ui/ExportButton";
import { FERIAS_STATUS, FERIAS_STATUS_TONE } from "@/lib/constants";
import { formatDate, shortName, somarDias } from "@/lib/format";
import { corDe, coresDosSetores, diasNoPeriodo, useAgendaFerias } from "@/lib/ferias-agenda";
import {
  aplicarFiltros, BarraFiltrosFerias, periodoValido, TODOS_OS_STATUS, type FiltrosFerias,
} from "@/components/FeriasFiltros";

/**
 * Quem está (ou vai estar) de férias num período: as efetivadas, as aprovadas
 * aguardando o DP e as solicitadas aguardando o gestor. Uma linha por período
 * de férias que cruza o intervalo escolhido, com quantos dias caem dentro dele.
 */
export function FeriasAcompanhamento({
  setores, unidades, hoje,
}: {
  setores: { id: string; name: string }[];
  unidades: string[] | null;
  hoje: string;
}) {
  const [filtros, setFiltros] = useState<FiltrosFerias>({
    de: hoje, ate: somarDias(hoje, 29), status: TODOS_OS_STATUS, setor: "", busca: "",
  });
  const invalido = periodoValido(filtros);
  // período inválido não vai ao banco: a busca fica no último período válido
  const [buscado, setBuscado] = useState({ de: filtros.de, ate: filtros.ate });
  const mudar = (f: FiltrosFerias) => {
    setFiltros(f);
    if (!periodoValido(f)) setBuscado({ de: f.de, ate: f.ate });
  };

  const { itens, erro, carregando } = useAgendaFerias(buscado.de, buscado.ate, unidades);
  const cores = useMemo(() => coresDosSetores(setores), [setores]);
  const linhas = useMemo(() => aplicarFiltros(itens, filtros), [itens, filtros]);

  const pessoas = (s?: string) => new Set(linhas.filter((i) => !s || i.status === s).map((i) => i.userId)).size;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem", paddingTop: "0.9rem" }}>
      <BarraFiltrosFerias
        filtros={filtros} onChange={mudar} setores={setores} hoje={hoje}
        atalhos={["hoje", "7d", "30d", "mes", "proximoMes"]}
      />
      {invalido && <p style={{ color: "var(--mh-danger)", fontSize: "0.82rem", margin: 0 }}>{invalido}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.8rem" }}>
        <StatCard label="Pessoas de férias no período" value={carregando ? "…" : pessoas()} tone="blue" />
        <StatCard label="Efetivadas" value={carregando ? "…" : pessoas("efetivada")} tone="green" hint="confirmadas pelo DP" />
        <StatCard label="Aguardando efetivação" value={carregando ? "…" : pessoas("aprovada")} tone="amber" hint="aprovadas pelo gestor" />
        <StatCard label="Aguardando o gestor" value={carregando ? "…" : pessoas("solicitada")} tone="gray" hint="solicitadas" />
      </div>

      {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{erro}</p>}

      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
        <span className="soft" style={{ fontSize: "0.8rem" }}>
          {carregando ? "Carregando…" : `${linhas.length} período(s) de férias entre ${formatDate(buscado.de)} e ${formatDate(buscado.ate)}`}
        </span>
        <div style={{ marginLeft: "auto" }}>
          <ExportButton
            filename={`ferias_no_periodo_${buscado.de}_a_${buscado.ate}.xlsx`}
            sheetName="Férias no período"
            headers={["Colaborador", "Matrícula", "Setor", "Subsetor", "Cargo", "Unidade", "Início", "Término", "Dias", "Dias no período", "Abono", "Situação", "Em dobro", "Origem"]}
            rows={linhas.map((i) => [
              i.nome, i.matricula, i.setor, i.subsetor, i.cargo, i.unidade,
              formatDate(i.inicio), formatDate(i.fim), i.dias, diasNoPeriodo(i, buscado.de, buscado.ate), i.abono,
              FERIAS_STATUS[i.status], i.emDobro ? "Sim" : "Não",
              i.origem === "registro" ? "Registro direto" : "Módulo Férias",
            ])}
          />
        </div>
      </div>

      {!carregando && linhas.length === 0 ? (
        <EmptyState title="Ninguém de férias no período" description="Ajuste o período ou os filtros para ver outras datas." />
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th style={{ width: 90 }}>Matrícula</th>
                <th style={{ width: 160 }}>Setor</th>
                <th style={{ width: 110 }}>Unidade</th>
                <th style={{ width: 100 }}>Início</th>
                <th style={{ width: 100 }}>Término</th>
                <th style={{ width: 64, textAlign: "right" }}>Dias</th>
                <th style={{ width: 96, textAlign: "right" }}>No período</th>
                <th style={{ width: 180 }}>Situação</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((i) => (
                <tr key={i.chave}>
                  <td style={{ fontWeight: 600 }} title={i.nome ?? ""}>{shortName(i.nome)}</td>
                  <td className="tabular muted" style={{ fontSize: "0.82rem" }}>{i.matricula ?? "—"}</td>
                  <td className="muted" style={{ fontSize: "0.82rem" }}>
                    <span aria-hidden style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: corDe(cores, i.setorId), marginRight: 6 }} />
                    {i.setor ?? "Sem setor"}
                  </td>
                  <td className="muted" style={{ fontSize: "0.82rem" }}>{i.unidade ?? "—"}</td>
                  <td>{formatDate(i.inicio)}</td>
                  <td>{formatDate(i.fim)}</td>
                  <td className="tabular" style={{ textAlign: "right" }}>{i.dias}</td>
                  <td className="tabular" style={{ textAlign: "right" }}>{diasNoPeriodo(i, buscado.de, buscado.ate)}</td>
                  <td><Badge tone={FERIAS_STATUS_TONE[i.status]}>{FERIAS_STATUS[i.status]}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
