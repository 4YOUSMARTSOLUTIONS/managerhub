"use client";

import { useRouter } from "next/navigation";

/** Troca a empresa em foco pela query string, para a página recarregar só a matriz dela. */
export function CompanyPicker({
  companies,
  current,
}: {
  companies: { id: string; name: string }[];
  current: string | null;
}) {
  const router = useRouter();
  if (!companies.length) return null;
  return (
    <div style={{ minWidth: 240 }}>
      <label className="label">Empresa</label>
      <select
        className="input"
        value={current ?? ""}
        onChange={(e) => router.push(`/admin/modulos?empresa=${e.target.value}`)}
      >
        {companies.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </div>
  );
}
