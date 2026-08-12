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
  /**
   * O cliente entra sem o genérico DE PROPÓSITO.
   *
   * `r.table` é a união de TODAS as tabelas de `public`, e o TypeScript
   * instancia o retorno de `.from()` para cada uma delas antes de resolver a
   * chamada. Com o schema atual isso estoura o limite de profundidade
   * (TS2589) e derruba a compilação inteira por causa de um helper de três
   * linhas. O tipo que importa continua valendo: `Ref.table` só aceita nome de
   * tabela que existe.
   */
  const cliente = supabase as SupabaseClient;
  for (const r of refs) {
    const { count } = await cliente
      .from(r.table)
      .select("*", { count: "exact", head: true })
      .eq(r.col, id);
    if ((count ?? 0) > 0) return true;
  }
  return false;
}

/** lê o flag "active" enviado por um <form> ("1"/"true" = ativar). */
export function wantsActive(fd: FormData): boolean {
  const v = String(fd.get("active") ?? "");
  return v === "1" || v === "true";
}
