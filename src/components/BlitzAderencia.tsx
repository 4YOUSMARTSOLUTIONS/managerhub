"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Users } from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { Tabs } from "@/components/ui/Tabs";
import { ExportButton } from "@/components/ui/ExportButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { getBlitzAderencia } from "@/lib/actions/seguranca";
import { formatDate, normalizar, shortName } from "@/lib/format";
import { pct, type AderenciaGrupo, type BlitzAderencia } from "@/lib/blitz-aderencia";

const NOME_MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const rotuloMes = (ym: string) => { const [a, m] = ym.split("-").map(Number); return `${NOME_MES[m - 1]} de ${a}`; };

/** Grupos do pior para o melhor: quem precisa de atenção aparece primeiro. */
function TabelaGrupos({ grupos, rotulo }: { grupos: AderenciaGrupo[]; rotulo: string }) {
  const lista = [...grupos].sort((a, b) =>
    (pct(a.passaram, a.publico) ?? 0) - (pct(b.passaram, b.publico) ?? 0) || a.nome.localeCompare(b.nome, "pt-BR"));
  if (lista.length === 0) return <p className="soft" style={{ fontSize: "0.82rem", margin: "0.6rem 0" }}>Sem público neste mês.</p>;
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
 * Aderência à blitz no mês (LUIZ, 11/11/2026): do público, quem passou pelo
 * menos uma vez. Quebra por setor, gestor, unidade e função, e a lista de
 * quem falta, que é o que a portaria usa no dia a dia. O Gestor recebe só a
 * própria cadeia (a RPC recorta).
 */
export function BlitzAderencia({
  inicial, unitIds, mesAtual, podeConfigurar,
}: {
  inicial: BlitzAderencia;
  unitIds: string[] | null;
  /** YYYY-MM de hoje: o máximo do seletor */
  mesAtual: string;
  /** owner/admin: o atalho para o público, que mora em Configurações > Segurança */
  podeConfigurar: boolean;
}) {
  const [carregando, iniciar] = useTransition();
  const [mes, setMes] = useState(inicial.mes);
  const [dados, setDados] = useState(inicial);
  const [busca, setBusca] = useState("");

  const carregar = (m: string) => {
    setMes(m);
    iniciar(async () => {
      const r = await getBlitzAderencia({ mes: m, unitIds });
      if (r.error || !r.data) { toast.error(r.error ?? "Não foi possível calcular a aderência."); return; }
      setDados(r.data);
    });
  };

  const termo = normalizar(busca.trim());
  const faltam = useMemo(() => dados.faltam.filter((f) => !termo || normalizar(
    [f.nome, f.matricula, f.funcao, f.setor, f.gestor, f.unidade].filter(Boolean).join(" "),
  ).includes(termo)), [dados.faltam, termo]);

  const p = pct(dados.passaram, dados.publico);
  const foraTotal = dados.fora.por_funcao + dados.fora.por_excecao + dados.fora.ausentes;

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "1rem", opacity: carregando ? 0.6 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}>
        <div>
          <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>Aderência à blitz</h3>
          <p className="soft" style={{ fontSize: "0.78rem", margin: "0.15rem 0 0" }}>
            Do público do mês, quem passou pela blitz pelo menos uma vez. Setor, gestor e função são os de hoje.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="month" className="input" value={mes} max={mesAtual} aria-label="Mês da aderência"
            onChange={(e) => { if (e.target.value) carregar(e.target.value); }} style={{ width: "auto" }}
          />
          {podeConfigurar && (
            <Link href="/configuracoes?aba=seguranca&sub=seg-blitz-publico" className="btn btn-ghost btn-sm">
              <Users size={14} /> Público da blitz
            </Link>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))", gap: "0.8rem" }}>
        <StatCard
          label={`Aderência em ${rotuloMes(dados.mes)}`}
          value={p === null ? "—" : `${p}%`}
          tone={p === null ? "blue" : p >= 90 ? "green" : p >= 70 ? "amber" : "red"}
          hint={`${dados.passaram} de ${dados.publico} passaram`}
        />
        <StatCard label="Faltam passar" value={dados.publico - dados.passaram} />
        <StatCard
          label="Fora da conta"
          value={foraTotal}
          hint={`${dados.fora.por_funcao} por função, ${dados.fora.por_excecao} por exceção, ${dados.fora.ausentes} ausentes o mês todo`}
        />
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
            Faltam passar em {rotuloMes(dados.mes)} ({dados.faltam.length})
          </h4>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <input className="input" placeholder="Buscar nome, matrícula, setor ou gestor…" value={busca}
              onChange={(e) => setBusca(e.target.value)} style={{ width: 260, maxWidth: "100%" }} />
            <ExportButton
              filename={`blitz-faltam-${dados.mes}.xlsx`}
              sheetName="Faltam passar"
              headers={["Matrícula", "Colaborador", "Função", "Setor", "Gestor", "Unidade", "Última blitz"]}
              rows={faltam.map((f) => [f.matricula ?? "", f.nome ?? "", f.funcao ?? "", f.setor ?? "", f.gestor ?? "", f.unidade ?? "", f.ultima ? formatDate(f.ultima) : ""])}
            />
          </div>
        </div>
        {dados.faltam.length === 0 ? (
          <EmptyState title="Ninguém faltando" description="Todo o público do mês já passou pela blitz." />
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
