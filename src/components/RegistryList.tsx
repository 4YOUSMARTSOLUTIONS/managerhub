type Item = { id: string; name: string; meta?: string };
type VoidAction = (formData: FormData) => void | Promise<void>;

export function RegistryList({
  title,
  description,
  items,
  createAction,
  deleteAction,
  extraFields,
  placeholder = "Nome",
  emptyText = "Nenhum item cadastrado.",
  metaLabel = "Detalhe",
}: {
  title: string;
  description?: string;
  items: Item[];
  createAction: VoidAction;
  deleteAction: VoidAction;
  extraFields?: React.ReactNode;
  placeholder?: string;
  emptyText?: string;
  metaLabel?: string;
}) {
  const hasMeta = items.some((i) => i.meta);

  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <div style={{ padding: "0.85rem 1.1rem", borderBottom: "1px solid var(--border)" }}>
        <h2 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>{title} · {items.length}</h2>
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
                <th style={{ textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td style={{ fontWeight: 500 }}>{it.name}</td>
                  {hasMeta && <td className="muted">{it.meta ?? "—"}</td>}
                  <td style={{ textAlign: "right" }}>
                    <form action={deleteAction} style={{ display: "inline" }}>
                      <input type="hidden" name="id" value={it.id} />
                      <button className="btn btn-danger btn-sm" type="submit">Excluir</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="soft" style={{ margin: 0, padding: "0 1.1rem 1.1rem", fontSize: "0.85rem" }}>{emptyText}</p>
      )}
    </div>
  );
}
