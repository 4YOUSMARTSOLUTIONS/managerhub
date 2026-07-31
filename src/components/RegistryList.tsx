import { Power, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { ConfirmActionButton } from "@/components/ui/ConfirmActionButton";
import type { ActionState } from "@/lib/actions/types";

type Item = { id: string; name: string; meta?: string; active?: boolean; canDelete?: boolean };
type VoidAction = (formData: FormData) => void | Promise<void>;
type DeleteAction = (formData: FormData) => Promise<ActionState | void>;

export function RegistryList({
  title,
  description,
  items,
  createAction,
  deleteAction,
  toggleAction,
  extraFields,
  headerAction,
  placeholder = "Nome",
  emptyText = "Nenhum item cadastrado.",
  metaLabel = "Detalhe",
}: {
  title: string;
  description?: string;
  items: Item[];
  createAction: VoidAction;
  deleteAction: DeleteAction;
  /** quando fornecido: mostra status Ativo/Inativo + botão Desativar/Reativar */
  toggleAction?: VoidAction;
  extraFields?: React.ReactNode;
  /** ação no canto direito do cabeçalho (ex.: importar em lote) */
  headerAction?: React.ReactNode;
  placeholder?: string;
  emptyText?: string;
  metaLabel?: string;
}) {
  const hasMeta = items.some((i) => i.meta);
  const hasStatus = !!toggleAction;

  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <div style={{ padding: "0.85rem 1.1rem", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
          <h2 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>{title} · {items.length}</h2>
          {headerAction && <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>{headerAction}</div>}
        </div>
        {description && <p className="muted" style={{ margin: "0.2rem 0 0", fontSize: "0.82rem" }}>{description}</p>}
      </div>

      <div style={{ padding: "0.9rem 1.1rem" }}>
        <form action={createAction} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <input name="name" className="input" placeholder={placeholder} required style={{ flex: "1 1 220px", maxWidth: 380 }} />
          {extraFields}
          <button className="btn btn-primary btn-sm" type="submit">Adicionar</button>
        </form>
      </div>

      {items.length > 0 ? (
        <div style={{ maxHeight: 380, overflowY: "auto", borderTop: "1px solid var(--border)" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th>
                {hasMeta && <th>{metaLabel}</th>}
                {hasStatus && <th>Status</th>}
                <th style={{ textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const inactive = hasStatus && it.active === false;
                const canDelete = it.canDelete !== false;
                return (
                  <tr key={it.id} style={inactive ? { opacity: 0.55 } : undefined}>
                    <td style={{ fontWeight: 500 }}>{it.name}</td>
                    {hasMeta && <td className="muted">{it.meta ?? "—"}</td>}
                    {hasStatus && (
                      <td>
                        <Badge tone={inactive ? "gray" : "green"}>{inactive ? "Inativo" : "Ativo"}</Badge>
                      </td>
                    )}
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <div style={{ display: "inline-flex", gap: "0.3rem", justifyContent: "flex-end" }}>
                        {hasStatus && toggleAction && (
                          <form action={toggleAction} style={{ display: "inline-flex" }}>
                            <input type="hidden" name="id" value={it.id} />
                            <input type="hidden" name="active" value={inactive ? "1" : "0"} />
                            <button className="icon-btn" type="submit" title={inactive ? "Reativar" : "Desativar"} aria-label={inactive ? "Reativar" : "Desativar"}>
                              {inactive ? <RotateCcw size={16} /> : <Power size={16} />}
                            </button>
                          </form>
                        )}
                        {canDelete && (
                          <ConfirmActionButton
                            action={deleteAction}
                            fields={{ id: it.id }}
                            className="icon-btn icon-btn-danger"
                            buttonTitle="Excluir"
                            title="Excluir item"
                            message={<>Excluir <strong>{it.name}</strong>? Esta ação não pode ser desfeita.</>}
                          >
                            <Trash2 size={16} />
                          </ConfirmActionButton>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="soft" style={{ margin: 0, padding: "0 1.1rem 1.1rem", fontSize: "0.85rem" }}>{emptyText}</p>
      )}
    </div>
  );
}
