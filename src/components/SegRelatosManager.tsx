"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatCard } from "@/components/ui/StatCard";
import type { Person } from "@/components/PeoplePicker";
import {
  SEG_NATUREZA, SEG_NATUREZA_TONE, SEG_RELATO_STATUS, SEG_RELATO_STATUS_TONE,
} from "@/lib/constants";
import { normalizar } from "@/lib/format";
import { SegRelatoDialog, type AreaOpt, type LocalOpt, type TipoOpt } from "@/components/SegRelatoDialog";
import type { Enums } from "@/types/database";

export type EnvolvidoRow = {
  userId: string;
  nome: string | null;
  setor: string | null;
  subsetor: string | null;
  funcao: string | null;
  gestor: string | null;
  unidade: string | null;
};

export type RelatoRow = {
  id: string;
  occurredOn: string;
  tipoId: string;
  natureza: Enums<"seg_relato_natureza">;
  localId: string | null;
  areaId: string | null;
  unitId: string | null;
  descricao: string;
  status: Enums<"seg_relato_status">;
  notaTriagem: string | null;
  triadoEm: string | null;
  triadoPor: string | null;
  /** só chega preenchido para quem pode tratar; para os demais é sempre null */
  relator: string | null;
  souAutor: boolean;
  criadoEm: string;
  envolvidos: EnvolvidoRow[];
};

function dataBr(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/**
 * A tela de relatos, nas duas caras que ela tem.
 *
 * Para o colaborador comum a RLS já entregou só os relatos dele, então a lista
 * é "o que eu apontei e no que deu". Para a equipe de segurança a mesma lista
 * vem completa e ganha filtros, contadores e o nome de quem relatou.
 */
export function SegRelatosManager({
  rows, ehSeguranca, pessoas, tipos, locais, areas, unidades,
}: {
  rows: RelatoRow[];
  ehSeguranca: boolean;
  pessoas: Person[];
  tipos: TipoOpt[];
  locais: LocalOpt[];
  areas: AreaOpt[];
  unidades: { id: string; name: string }[];
}) {
  const [novo, setNovo] = useState(false);
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("");
  const [tipo, setTipo] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);

  const nomeTipo = useMemo(() => new Map(tipos.map((t) => [t.id, t.name])), [tipos]);
  const nomeLocal = useMemo(() => new Map(locais.map((l) => [l.id, l.name])), [locais]);
  const nomeArea = useMemo(() => new Map(areas.map((a) => [a.id, a.name])), [areas]);
  const nomeUnidade = useMemo(() => new Map(unidades.map((u) => [u.id, u.name])), [unidades]);

  const lista = useMemo(() => {
    const q = normalizar(busca.trim());
    return rows.filter((r) => {
      if (status && r.status !== status) return false;
      if (tipo && r.tipoId !== tipo) return false;
      if (!q) return true;
      const campos = [
        r.descricao, nomeTipo.get(r.tipoId), r.localId ? nomeLocal.get(r.localId) : null,
        r.areaId ? nomeArea.get(r.areaId) : null, ...r.envolvidos.map((e) => e.nome),
      ];
      return campos.some((v) => v && normalizar(v).includes(q));
    });
  }, [rows, busca, status, tipo, nomeTipo, nomeLocal, nomeArea]);

  const detalhe = aberto ? rows.find((r) => r.id === aberto) ?? null : null;

  const contagem = useMemo(() => ({
    aguardando: rows.filter((r) => r.status === "aberto").length,
    tratativa: rows.filter((r) => r.status === "triado").length,
    tratados: rows.filter((r) => r.status === "tratado").length,
    positivos: rows.filter((r) => r.natureza === "positivo").length,
  }), [rows]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
      {ehSeguranca && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.8rem" }}>
          <StatCard label="Aguardando triagem" value={contagem.aguardando} tone="amber" />
          <StatCard label="Em tratativa" value={contagem.tratativa} tone="blue" />
          <StatCard label="Tratados" value={contagem.tratados} tone="green" />
          <StatCard label="Comportamento seguro" value={contagem.positivos} tone="purple" hint="Relatos positivos, fora da pirâmide" />
        </div>
      )}

      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input" placeholder="Buscar por descrição, tipo, local ou pessoa…"
          value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 340 }}
        />
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 190 }}>
          <option value="">Todos os status</option>
          {(Object.keys(SEG_RELATO_STATUS) as Enums<"seg_relato_status">[]).map((s) => (
            <option key={s} value={s}>{SEG_RELATO_STATUS[s]}</option>
          ))}
        </select>
        <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">Todos os tipos</option>
          {tipos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button type="button" className="btn btn-primary" style={{ marginLeft: "auto" }} onClick={() => setNovo(true)}>
          <Plus size={15} /> Novo relato
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={ehSeguranca ? "Nenhum relato ainda" : "Você ainda não relatou nada"}
          description={
            ehSeguranca
              ? "Assim que a operação começar a relatar, a fila aparece aqui para triagem."
              : "Viu um risco, um quase acidente ou alguém agindo com segurança? Registre. É o que evita o acidente lá na frente."
          }
        />
      ) : lista.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>Nenhum relato com esses filtros.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 100 }}>Data</th>
              <th>Tipo</th>
              <th>Onde</th>
              <th>Envolvidos</th>
              {ehSeguranca && <th style={{ width: 170 }}>Relator</th>}
              <th style={{ width: 150 }}>Situação</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((r) => (
              <tr
                key={r.id} onClick={() => setAberto(r.id)}
                style={{ cursor: "pointer" }}
                title="Abrir o relato"
              >
                <td>{dataBr(r.occurredOn)}</td>
                <td>
                  <span style={{ fontWeight: 600 }}>{nomeTipo.get(r.tipoId) ?? "—"}</span>
                  <div style={{ marginTop: "0.15rem" }}>
                    <Badge tone={SEG_NATUREZA_TONE[r.natureza]}>{SEG_NATUREZA[r.natureza]}</Badge>
                  </div>
                </td>
                <td className="muted" style={{ fontSize: "0.82rem" }}>
                  {[r.localId ? nomeLocal.get(r.localId) : null, r.areaId ? nomeArea.get(r.areaId) : null]
                    .filter(Boolean).join(" · ") || "Não informado"}
                </td>
                <td className="muted" style={{ fontSize: "0.82rem" }}>
                  {r.envolvidos.length === 0
                    ? "Sem pessoa citada"
                    : r.envolvidos.map((e) => e.nome ?? "—").join(", ")}
                </td>
                {ehSeguranca && (
                  <td className="muted" style={{ fontSize: "0.82rem" }}>{r.relator ?? "—"}</td>
                )}
                <td><Badge tone={SEG_RELATO_STATUS_TONE[r.status]}>{SEG_RELATO_STATUS[r.status]}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {detalhe && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)",
            backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            padding: "5vh 1rem", zIndex: 50, overflowY: "auto",
          }}
        >
          <div className="card" style={{ width: "100%", maxWidth: 620, boxShadow: "var(--mh-shadow-e3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
              <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>
                {nomeTipo.get(detalhe.tipoId) ?? "Relato"} · {dataBr(detalhe.occurredOn)}
              </h2>
              <button
                type="button" onClick={() => setAberto(null)} className="muted" aria-label="Fechar"
                style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            <div style={{ padding: "1.15rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                <Badge tone={SEG_NATUREZA_TONE[detalhe.natureza]}>{SEG_NATUREZA[detalhe.natureza]}</Badge>
                <Badge tone={SEG_RELATO_STATUS_TONE[detalhe.status]}>{SEG_RELATO_STATUS[detalhe.status]}</Badge>
              </div>

              <p style={{ margin: 0, fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>{detalhe.descricao}</p>

              <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.7rem", margin: 0, fontSize: "0.82rem" }}>
                <div>
                  <dt className="soft">Local</dt>
                  <dd style={{ margin: 0 }}>{(detalhe.localId && nomeLocal.get(detalhe.localId)) || "Não informado"}</dd>
                </div>
                <div>
                  <dt className="soft">Área</dt>
                  <dd style={{ margin: 0 }}>{(detalhe.areaId && nomeArea.get(detalhe.areaId)) || "Não informada"}</dd>
                </div>
                <div>
                  <dt className="soft">Unidade</dt>
                  <dd style={{ margin: 0 }}>{(detalhe.unitId && nomeUnidade.get(detalhe.unitId)) || "Não informada"}</dd>
                </div>
                {ehSeguranca && (
                  <div>
                    <dt className="soft">Relator</dt>
                    <dd style={{ margin: 0 }}>{detalhe.relator ?? "—"}</dd>
                  </div>
                )}
              </dl>

              <div>
                <h3 style={{ fontSize: "0.85rem", fontWeight: 700, margin: "0 0 0.4rem" }}>Envolvidos</h3>
                {detalhe.envolvidos.length === 0 ? (
                  <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Nenhuma pessoa citada.</p>
                ) : (
                  <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                    {detalhe.envolvidos.map((e) => (
                      <li key={e.userId} style={{ background: "var(--surface-2)", borderRadius: "var(--mh-radius-md)", padding: "0.5rem 0.7rem" }}>
                        <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{e.nome ?? "—"}</div>
                        <div className="soft" style={{ fontSize: "0.75rem" }}>
                          {[e.setor, e.subsetor, e.funcao].filter(Boolean).join(" · ") || "Sem setor cadastrado"}
                          {e.gestor ? ` · gestor: ${e.gestor}` : ""}
                          {e.unidade ? ` · ${e.unidade}` : ""}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {/* o carimbo é do dia do relato, e é isso que a estatística usa */}
                <p className="soft" style={{ fontSize: "0.72rem", margin: "0.45rem 0 0" }}>
                  Setor, função e gestor são os do dia do relato.
                </p>
              </div>

              {detalhe.notaTriagem && (
                <div>
                  <h3 style={{ fontSize: "0.85rem", fontWeight: 700, margin: "0 0 0.3rem" }}>Triagem</h3>
                  <p style={{ margin: 0, fontSize: "0.84rem", whiteSpace: "pre-wrap" }}>{detalhe.notaTriagem}</p>
                  {detalhe.triadoPor && (
                    <p className="soft" style={{ fontSize: "0.74rem", margin: "0.3rem 0 0" }}>
                      Por {detalhe.triadoPor}
                      {detalhe.triadoEm ? ` em ${dataBr(detalhe.triadoEm)}` : ""}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
              <button type="button" className="btn btn-ghost" onClick={() => setAberto(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      <SegRelatoDialog
        open={novo} onClose={() => setNovo(false)}
        pessoas={pessoas} tipos={tipos} locais={locais} areas={areas} unidades={unidades}
      />
    </div>
  );
}
