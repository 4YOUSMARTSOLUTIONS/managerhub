import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Table = keyof Database["public"]["Tables"];
type Ref = { table: Table; col: string };

/**
 * true se o item de catálogo já está em uso em alguma das tabelas informadas.
 * Usado para decidir entre excluir de vez (nunca usado) ou apenas desativar
 * (preservando o histórico).
 */
export async function isCatalogInUse(
  supabase: SupabaseClient<Database>,
  id: string,
  refs: Ref[],
): Promise<boolean> {
  for (const r of refs) {
    const { count } = await supabase
      .from(r.table)
      .select("*", { count: "exact", head: true })
      .eq(r.col as never, id as never);
    if ((count ?? 0) > 0) return true;
  }
  return false;
}

/** lê o flag "active" enviado por um <form> ("1"/"true" = ativar). */
export function wantsActive(fd: FormData): boolean {
  const v = String(fd.get("active") ?? "");
  return v === "1" || v === "true";
}
