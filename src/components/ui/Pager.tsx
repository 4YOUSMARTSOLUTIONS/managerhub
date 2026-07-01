import Link from "next/link";

/** Paginação simples por URL (server component). Mantém outros params via `extra`. */
export function Pager({
  basePath,
  param,
  page,
  pageSize,
  total,
  extra,
}: {
  basePath: string;
  param: string;
  page: number;
  pageSize: number;
  total: number;
  extra?: Record<string, string>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const href = (p: number) => {
    const q = new URLSearchParams(extra);
    q.set(param, String(p));
    return `${basePath}?${q.toString()}`;
  };
  const cell = (p: number, label: string, disabled: boolean) =>
    disabled
      ? <span className="btn btn-ghost btn-sm" style={{ opacity: 0.45, pointerEvents: "none" }}>{label}</span>
      : <Link href={href(p)} className="btn btn-ghost btn-sm">{label}</Link>;

  return (
    <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", justifyContent: "center", margin: "1.25rem 0 0.5rem" }}>
      {cell(page - 1, "← Anterior", page <= 1)}
      <span className="muted" style={{ fontSize: "0.85rem" }}>Página {page} de {totalPages} · {total} no total</span>
      {cell(page + 1, "Próxima →", page >= totalPages)}
    </div>
  );
}
