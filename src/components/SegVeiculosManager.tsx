"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Power, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { ExportButton } from "@/components/ui/ExportButton";
import { PeoplePicker, type Person } from "@/components/PeoplePicker";
import { SEG_VEICULO_PROPRIEDADE } from "@/lib/constants";
import { normalizar, shortName } from "@/lib/format";
import { salvarVeiculo, setVeiculoAtivo } from "@/lib/actions/seguranca";
import type { Enums } from "@/types/database";

export type VeiculoRow = {
  id: string;
  userId: string;
  pessoa: string | null;
  meioId: string | null;
  placa: string;
  tipoDescricao: string | null;
  propriedade: Enums<"seg_veiculo_propriedade">;
  active: boolean;
};

type Opcao = { id: string; name: string };

type Rascunho = {
  id?: string;
  userId: string;
  meioId: string;
  placa: string;
  tipoDescricao: string;
  propriedade: Enums<"seg_veiculo_propriedade">;
};

/**
 * O cadastro de veículos dos colaboradores.
 *
 * Ele se alimenta sozinho: toda blitz com placa faz upsert aqui, e a próxima
 * blitz do mesmo colaborador já vem sugerida. Esta tela existe para corrigir e
 * desativar, não para digitar a frota inteira antes de começar.
 */
export function SegVeiculosManager({
  rows, meios, pessoas, canEdit,
}: {
  rows: VeiculoRow[];
  meios: Opcao[];
  pessoas: Person[];
  canEdit: boolean;
}) {
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const nomeMeio = useMemo(() => new Map(meios.map((m) => [m.id, m.name])), [meios]);

  const lista = useMemo(() => {
    const q = normalizar(busca.trim());
    if (!q) return rows;
    return rows.filter((r) =>
      [r.pessoa, r.placa, r.tipoDescricao].some((v) => v && normalizar(v).includes(q)),
    );
  }, [rows, busca]);

  const salvar = () => {
    if (!rascunho) return;
    setErro("");
    iniciar(async () => {
      const r = await salvarVeiculo({
        id: rascunho.id,
        userId: rascunho.userId,
        meioId: rascunho.meioId || null,
        placa: rascunho.placa,
        tipoDescricao: rascunho.tipoDescricao,
        propriedade: rascunho.propriedade,
      });
      if (r.error) { setErro(r.error); return; }
      toast.success(r.message ?? "Veículo salvo.");
      setRascunho(null);
      router.refresh();
    });
  };

  const alternar = (v: VeiculoRow) => {
    iniciar(async () => {
      const r = await setVeiculoAtivo(v.id, !v.active);
      if (r.error) toast.error(r.error);
      router.refresh();
    });
  };

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: "0 0 0.2rem" }}>Veículos</h3>
        <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
          O cadastro se alimenta sozinho: toda blitz com placa entra ou atualiza aqui, e a
          próxima blitz do colaborador já vem sugerida. Use esta tela para corrigir e desativar.
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input" placeholder="Buscar por pessoa, placa ou tipo…" value={busca}
          onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 300 }}
        />
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginLeft: "auto", flexWrap: "wrap" }}>
          <ExportButton
            filename="veiculos.xlsx"
            sheetName="Veículos"
            headers={["Colaborador", "Placa", "Meio", "Tipo", "Propriedade", "Situação"]}
            rows={lista.map((v) => [
              v.pessoa ?? "", v.placa, (v.meioId && nomeMeio.get(v.meioId)) || "",
              v.tipoDescricao ?? "", SEG_VEICULO_PROPRIEDADE[v.propriedade],
              v.active ? "Ativo" : "Inativo",
            ])}
          />
          {canEdit && (
            <button
              type="button" className="btn btn-primary btn-sm"
              onClick={() => { setErro(""); setRascunho({ userId: "", meioId: "", placa: "", tipoDescricao: "", propriedade: "proprio" }); }}
            >
              + Novo veículo
            </button>
          )}
        </div>
      </div>

      {rascunho && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--mh-radius-lg)", background: "var(--surface-2)", padding: "0.9rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
          <div>
            <label className="label">Colaborador <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            {rascunho.id ? (
              <p style={{ margin: 0, fontSize: "0.86rem", fontWeight: 600 }}>
                {shortName(rows.find((r) => r.id === rascunho.id)?.pessoa)}
              </p>
            ) : (
              <PeoplePicker
                people={pessoas} selected={rascunho.userId ? [rascunho.userId] : []}
                onChange={(ids) => setRascunho((r) => (r ? { ...r, userId: ids[0] ?? "" } : r))}
                single placeholder="Buscar colaborador…"
              />
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))", gap: "0.8rem" }}>
            <div>
              <label className="label">Placa <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <input
                className="input" value={rascunho.placa} maxLength={10}
                placeholder="ABC1D23" style={{ textTransform: "uppercase" }}
                onChange={(e) => setRascunho((r) => (r ? { ...r, placa: e.target.value } : r))}
              />
            </div>
            <div>
              <label className="label">Meio</label>
              <select
                className="select" value={rascunho.meioId}
                onChange={(e) => setRascunho((r) => (r ? { ...r, meioId: e.target.value } : r))}
              >
                <option value="">Sem meio</option>
                {meios.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Tipo</label>
              <input
                className="input" value={rascunho.tipoDescricao}
                placeholder="Honda CG 160"
                onChange={(e) => setRascunho((r) => (r ? { ...r, tipoDescricao: e.target.value } : r))}
              />
            </div>
            <div>
              <label className="label">Propriedade</label>
              <select
                className="select" value={rascunho.propriedade}
                onChange={(e) => setRascunho((r) => (r ? { ...r, propriedade: e.target.value as Enums<"seg_veiculo_propriedade"> } : r))}
              >
                {(Object.keys(SEG_VEICULO_PROPRIEDADE) as Enums<"seg_veiculo_propriedade">[]).map((p) => (
                  <option key={p} value={p}>{SEG_VEICULO_PROPRIEDADE[p]}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={pendente} onClick={salvar}>
              {pendente ? "Salvando…" : "Salvar"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRascunho(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.8rem", margin: 0 }}>{erro}</p>}

      {rows.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>
          Nenhum veículo ainda. A primeira blitz com placa cria o primeiro.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Colaborador</th>
              <th style={{ width: 110 }}>Placa</th>
              <th style={{ width: 150 }}>Meio</th>
              <th>Tipo</th>
              <th style={{ width: 120 }}>Propriedade</th>
              <th style={{ width: 100 }}>Situação</th>
              {canEdit && <th style={{ textAlign: "right" }}></th>}
            </tr>
          </thead>
          <tbody>
            {lista.map((v) => (
              <tr key={v.id} style={{ opacity: v.active ? 1 : 0.6 }}>
                <td style={{ fontWeight: 600 }}>{shortName(v.pessoa)}</td>
                <td className="mono" style={{ fontSize: "0.82rem" }}>{v.placa}</td>
                <td className="soft" style={{ fontSize: "0.82rem" }}>{(v.meioId && nomeMeio.get(v.meioId)) || "—"}</td>
                <td className="soft" style={{ fontSize: "0.82rem" }}>{v.tipoDescricao ?? "—"}</td>
                <td className="soft" style={{ fontSize: "0.82rem" }}>{SEG_VEICULO_PROPRIEDADE[v.propriedade]}</td>
                <td><Badge variant="quiet" tone={v.active ? "green" : "gray"}>{v.active ? "Ativo" : "Inativo"}</Badge></td>
                {canEdit && (
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-flex", gap: "0.3rem" }}>
                      <button
                        type="button" className="icon-btn" title="Editar"
                        onClick={() => {
                          setErro("");
                          setRascunho({
                            id: v.id, userId: v.userId, meioId: v.meioId ?? "",
                            placa: v.placa, tipoDescricao: v.tipoDescricao ?? "",
                            propriedade: v.propriedade,
                          });
                        }}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button" className="icon-btn" disabled={pendente}
                        title={v.active ? "Desativar" : "Reativar"} onClick={() => alternar(v)}
                      >
                        {v.active ? <Power size={15} /> : <RotateCcw size={15} />}
                      </button>
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
