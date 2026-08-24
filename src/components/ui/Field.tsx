/**
 * A ficha de detalhe, em três peças.
 *
 * O repositório tinha seis cópias de `Field()` com tipografias diferentes e
 * grades de campos soltas no fundo do card, sem separação. Estas três peças
 * substituem tudo isso com a anatomia do DESIGN.md:
 *
 *   - `Field`: rótulo pequeno uppercase no tom fraco, valor no tom pleno.
 *     O contraste entre os dois é a hierarquia; vazio vira "—".
 *   - `FieldGrid`: a grade de campos DENTRO de um bloco `surface-2` (modelo
 *     DemandaPanel), para o grupo se separar do resto por superfície, não
 *     por proximidade.
 *   - `DetailSection`: nomeia e separa cada camada da história (Vínculo,
 *     O ocorrido, Registro legal...) com título uppercase e filete no topo.
 */

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const vazio = children === null || children === undefined || children === "";
  return (
    <div style={{ minWidth: 0 }}>
      <div
        className="soft"
        style={{
          fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase",
          letterSpacing: "0.04em", marginBottom: "0.15rem",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "0.88rem", color: "var(--mh-text-1)", overflowWrap: "anywhere" }}>
        {vazio ? "—" : children}
      </div>
    </div>
  );
}

export function FieldGrid({ children, min = 160 }: { children: React.ReactNode; min?: number }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`,
        gap: "0.85rem 1rem",
        background: "var(--surface-2)",
        borderRadius: 9,
        padding: "0.9rem 1rem",
      }}
    >
      {children}
    </div>
  );
}

export function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.85rem" }}>
      <h3
        className="soft"
        style={{
          fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase",
          letterSpacing: "0.05em", margin: "0 0 0.5rem",
        }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}
