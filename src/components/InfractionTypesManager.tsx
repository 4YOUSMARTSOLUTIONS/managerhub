"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Power, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { ExportButton } from "@/components/ui/ExportButton";
import { confirmDialog } from "@/components/ui/confirm";
import { INFRACTION_SEVERITY, INFRACTION_SEVERITY_TONE } from "@/lib/constants";
import { normalizar } from "@/lib/format";
import {
  deleteInfractionType, saveInfractionType, setInfractionTypeActive,
} from "@/lib/actions/punicoes";
import type { Enums } from "@/types/database";

export type InfracaoRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  severity: Enums<"infraction_severity">;
  active: boolean;
};

type Rascunho = {
  id?: string;
  code: string;
  name: string;
  description: string;
  severity: Enums<"infraction_severity">;
};

const vazio: Rascunho = { code: "", name: "", description: "", severity: "leve" };

/**
 * Catálogo de infrações.
 *
 * O `RegistryList` genérico não serve aqui: ele cria, desativa e exclui, e esta
 * tela precisa EDITAR código, descrição e gravidade. O molde é o
 * `SanctionsManager`, com o formulário em linha acima da lista.
 */
export function InfractionTypesManager({
  rows, canEdit,
}: {
  rows: InfracaoRow[];
  canEdit: boolean;
}) {
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [busca, setBusca] = useState("");
  const [gravidade, setGravidade] = useState("");
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const lista = useMemo(() => {
    const q = normalizar(busca.trim());
    return rows.filter((r) => {
      if (gravidade && r.severity !== gravidade) return false;
      if (!q) return true;
      return [r.code, r.name, r.description].some((v) => v && normalizar(v).includes(q));
    });
  }, [rows, busca, gravidade]);

  const salvar = () => {
    if (!rascunho) return;
    setErro("");
    iniciar(async () => {
      const r = await saveInfractionType({
        id: rascunho.id,
        code: rascunho.code,
        name: rascunho.name,
        description: rascunho.description,
        severity: rascunho.severity,
      });
      if (r.error) { setErro(r.error); return; }
      setRascunho(null);
      router.refresh();
    });
  };

  const excluir = async (i: InfracaoRow) => {
    const ok = await confirmDialog({
      title: "Excluir infração",
      tone: "danger",
      confirmLabel: "Excluir",
      message: `Excluir "${i.code} ${i.name}"? Se ela já foi citada em alguma punição, será apenas desativada, para o registro antigo continuar dizendo o que aconteceu.`,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("id", i.id);
    iniciar(async () => { await deleteInfractionType(fd); router.refresh(); });
  };

  const alternar = (i: InfracaoRow) => {
    const fd = new FormData();
    fd.set("id", i.id);
    fd.set("active", i.active ? "0" : "1");
    iniciar(async () => { await setInfractionTypeActive(fd); router.refresh(); });
  };

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: "0 0 0.2rem" }}>Tipos de infração</h3>
        <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
          As faltas previstas no regulamento da empresa, com o código que o documento cita e a
          gravidade de cada uma. O gestor escolhe a infração no lançamento, e a gravidade vem
          daqui: assim o mesmo fato não é leve para um gestor e grave para outro.
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input" placeholder="Buscar por código, nome ou descrição…"
          value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 320 }}
        />
        <select className="select" value={gravidade} onChange={(e) => setGravidade(e.target.value)} style={{ maxWidth: 160 }}>
          <option value="">Todas as gravidades</option>
          {(Object.keys(INFRACTION_SEVERITY) as Enums<"infraction_severity">[]).map((s) => (
            <option key={s} value={s}>{INFRACTION_SEVERITY[s]}</option>
          ))}
        </select>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginLeft: "auto", flexWrap: "wrap" }}>
          <ExportButton
            filename="tipos-de-infracao.xlsx"
            sheetName="Infrações"
            headers={["Código", "Infração", "Gravidade", "Descrição", "Situação"]}
            rows={lista.map((i) => [
              i.code, i.name, INFRACTION_SEVERITY[i.severity], i.description ?? "",
              i.active ? "Ativa" : "Inativa",
            ])}
          />
          {canEdit && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { setErro(""); setRascunho({ ...vazio }); }}>
              + Nova infração
            </button>
          )}
        </div>
      </div>

      {rascunho && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--mh-radius-lg)", background: "var(--surface-2)", padding: "0.9rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0.8rem" }}>
            <div style={{ maxWidth: 160 }}>
              <label className="label">Código <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <input
                className="input" value={rascunho.code} placeholder="3.2"
                onChange={(e) => setRascunho((r) => (r ? { ...r, code: e.target.value } : r))}
              />
            </div>
            <div style={{ gridColumn: "span 2", minWidth: 0 }}>
              <label className="label">Infração <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <input
                className="input" value={rascunho.name} placeholder="Atraso reiterado"
                onChange={(e) => setRascunho((r) => (r ? { ...r, name: e.target.value } : r))}
              />
            </div>
            <div style={{ maxWidth: 180 }}>
              <label className="label">Gravidade <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <select
                className="select" value={rascunho.severity}
                onChange={(e) => setRascunho((r) => (r ? { ...r, severity: e.target.value as Enums<"infraction_severity"> } : r))}
              >
                {(Object.keys(INFRACTION_SEVERITY) as Enums<"infraction_severity">[]).map((s) => (
                  <option key={s} value={s}>{INFRACTION_SEVERITY[s]}</option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="label">Descrição</label>
              <textarea
                className="input" rows={2} value={rascunho.description}
                placeholder="O texto que sai impresso no documento entregue ao colaborador."
                onChange={(e) => setRascunho((r) => (r ? { ...r, description: e.target.value } : r))}
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.9rem", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={pendente} onClick={salvar}>
              {pendente ? "Salvando…" : "Salvar"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRascunho(null)}>Cancelar</button>
            {erro && <span style={{ color: "var(--mh-danger)", fontSize: "0.8rem" }}>{erro}</span>}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>
          Nenhuma infração cadastrada. Sem elas o gestor não consegue abrir um lançamento de punição.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 90 }}>Código</th>
              <th>Infração</th>
              <th style={{ width: 110 }}>Gravidade</th>
              <th style={{ width: 100 }}>Situação</th>
              {canEdit && <th style={{ textAlign: "right" }}></th>}
            </tr>
          </thead>
          <tbody>
            {lista.map((i) => (
              <tr key={i.id} style={{ opacity: i.active ? 1 : 0.6 }}>
                <td style={{ fontWeight: 600, fontFamily: "var(--font-jetbrains, monospace)" }}>{i.code}</td>
                <td>
                  <span style={{ fontWeight: 600 }}>{i.name}</span>
                  {i.description && (
                    <div className="soft" style={{ fontSize: "0.74rem" }}>{i.description}</div>
                  )}
                </td>
                <td><Badge tone={INFRACTION_SEVERITY_TONE[i.severity]}>{INFRACTION_SEVERITY[i.severity]}</Badge></td>
                <td><Badge tone={i.active ? "green" : "gray"}>{i.active ? "Ativa" : "Inativa"}</Badge></td>
                {canEdit && (
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-flex", gap: "0.3rem" }}>
                      <button
                        type="button" className="icon-btn" title="Editar"
                        onClick={() => {
                          setErro("");
                          setRascunho({
                            id: i.id, code: i.code, name: i.name,
                            description: i.description ?? "", severity: i.severity,
                          });
                        }}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button" className="icon-btn" disabled={pendente}
                        title={i.active ? "Desativar" : "Reativar"} onClick={() => alternar(i)}
                      >
                        {i.active ? <Power size={15} /> : <RotateCcw size={15} />}
                      </button>
                      <button type="button" className="icon-btn icon-btn-danger" title="Excluir" disabled={pendente} onClick={() => excluir(i)}>
                        <Trash2 size={15} />
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
