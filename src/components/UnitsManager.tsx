"use client";

import { useActionState } from "react";
import { FormModal } from "@/components/ui/FormModal";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { createUnit, updateUnit, deleteUnit } from "@/lib/actions/registry";
import { initialActionState } from "@/lib/actions/types";
import { formatCnpj } from "@/lib/cnpj";
import { UNIT_KIND } from "@/lib/constants";

export type UnitRow = {
  id: string;
  name: string;
  kind: "matriz" | "filial";
  cnpj: string | null;
};

const ICON = {
  edit: "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z|m15 5 4 4",
  trash: "M3 6h18|M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6|M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2|M10 11v6|M14 11v6",
};

function Ico({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {d.split("|").map((p, i) => <path key={i} d={p.trim()} />)}
    </svg>
  );
}

export function UnitsManager({
  units,
  unitLimit,
}: {
  units: UnitRow[];
  unitLimit: number | null;
}) {
  const [createState, createAction] = useActionState(createUnit, initialActionState);
  const atLimit = unitLimit !== null && units.length >= unitLimit;

  return (
    <div className="card">
      <div style={{ padding: "0.85rem 1.1rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>
            Unidades
            {unitLimit !== null ? (
              <span style={{ marginLeft: "0.4rem" }}>
                <span style={{ color: atLimit ? "#dc2626" : "inherit" }}>{units.length}</span>
                <span className="soft"> / {unitLimit}</span>
              </span>
            ) : (
              <span className="soft" style={{ fontWeight: 400 }}> · {units.length}</span>
            )}
          </h2>
          <p className="muted" style={{ margin: "0.2rem 0 0", fontSize: "0.82rem" }}>
            Matriz e filiais. Cada unidade tem seu próprio CNPJ.
          </p>
        </div>
        {atLimit && (
          <span className="badge badge-red">Limite atingido</span>
        )}
      </div>

      {!atLimit ? (
        <div style={{ padding: "0.9rem 1.1rem", borderBottom: units.length > 0 ? "1px solid var(--border)" : undefined }}>
          <form action={createAction} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <input name="name" className="input" placeholder="Nome da unidade" required style={{ flex: "1 1 160px", maxWidth: 220 }} />
            <select name="kind" className="select" defaultValue="filial" style={{ width: "auto" }}>
              <option value="matriz">Matriz</option>
              <option value="filial">Filial</option>
            </select>
            <input
              name="cnpj"
              className="input"
              placeholder="CNPJ (opcional)"
              autoCapitalize="characters"
              style={{ flex: "1 1 180px", maxWidth: 220, textTransform: "uppercase" }}
            />
            <button className="btn btn-primary btn-sm" type="submit">Adicionar</button>
          </form>
          {createState.error && (
            <p style={{ color: "#dc2626", fontSize: "0.82rem", margin: "0.5rem 0 0" }}>{createState.error}</p>
          )}
        </div>
      ) : (
        <div style={{ padding: "0.9rem 1.1rem", borderBottom: units.length > 0 ? "1px solid var(--border)" : undefined }}>
          <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
            Seu plano permite até <strong>{unitLimit}</strong> unidade{unitLimit !== 1 ? "s" : ""}.
            Entre em contato com o suporte para fazer upgrade.
          </p>
        </div>
      )}

      {units.length > 0 ? (
        <div style={{ maxHeight: 380, overflowY: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Tipo</th>
                <th>CNPJ</th>
                <th style={{ textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 500 }}>{u.name}</td>
                  <td>
                    <Badge tone={u.kind === "matriz" ? "purple" : "blue"}>{UNIT_KIND[u.kind]}</Badge>
                  </td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>
                    {u.cnpj ? formatCnpj(u.cnpj) : <span className="soft">—</span>}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: "0.3rem", justifyContent: "flex-end" }}>
                      <FormModal
                        triggerLabel={<Ico d={ICON.edit} />}
                        triggerClassName="icon-btn"
                        title={`Editar unidade · ${u.name}`}
                        action={updateUnit}
                        submitLabel="Salvar"
                        width={420}
                      >
                        <input type="hidden" name="id" value={u.id} />
                        <div>
                          <label className="label">Nome</label>
                          <input name="name" className="input" defaultValue={u.name} required />
                        </div>
                        <div>
                          <label className="label">Tipo</label>
                          <select name="kind" className="select" defaultValue={u.kind}>
                            <option value="matriz">Matriz</option>
                            <option value="filial">Filial</option>
                          </select>
                        </div>
                        <div>
                          <label className="label">CNPJ (opcional)</label>
                          <input
                            name="cnpj"
                            className="input"
                            defaultValue={u.cnpj ? formatCnpj(u.cnpj) : ""}
                            placeholder="00.000.000/0000-00"
                            autoCapitalize="characters"
                            style={{ textTransform: "uppercase" }}
                          />
                          <p className="soft" style={{ fontSize: "0.78rem", margin: "0.25rem 0 0" }}>
                            Deixe em branco para remover o CNPJ desta unidade.
                          </p>
                        </div>
                      </FormModal>
                      <form action={deleteUnit} style={{ display: "inline-flex" }}>
                        <input type="hidden" name="id" value={u.id} />
                        <button className="icon-btn icon-btn-danger" type="submit" title="Excluir">
                          <Ico d={ICON.trash} />
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="Nenhuma unidade" description="Cadastre a primeira unidade acima." />
      )}
    </div>
  );
}
