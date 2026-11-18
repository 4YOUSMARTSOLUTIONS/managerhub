import { createClient } from "@/lib/supabase/server";
import { requireContext } from "@/lib/tenant";
import { getModuleAccess } from "@/lib/module-access";
import { MODULE_BY_KEY, permitidoPeloPapel, type ModuleKey } from "@/lib/modules";
import { BUCKET_CONHECIMENTO } from "@/lib/conhecimento";

/**
 * Quem vê cada artigo (LUIZ, 18/11/2026): quem tem acesso ao módulo dele.
 *
 * "Ter acesso" é o mesmo que o menu decide: a unidade contratou (estado "on",
 * fora de obra), o papel permite e o nível não tirou a tela. Artigo sem módulo
 * é geral e vale para todos. O dono da plataforma vê tudo, rascunhos inclusive,
 * porque é ele quem escreve.
 */
export async function quemVeArtigo(): Promise<(modulo: string | null) => boolean> {
  const [{ role, isHr, isSuperAdmin }, { state, construction }] = await Promise.all([
    requireContext(),
    getModuleAccess(),
  ]);
  return (modulo) => {
    if (isSuperAdmin) return true;
    if (!modulo) return true;
    const m = MODULE_BY_KEY[modulo as ModuleKey];
    if (!m) return false;
    return state[m.key] === "on" && !construction.has(m.key) && permitidoPeloPapel(m, { role, isHr, isSuperAdmin });
  };
}

/** Links assinados das imagens citadas (1 h; recarregar a página renova). */
export async function assinarImagens(arquivos: string[]): Promise<Record<string, string>> {
  if (!arquivos.length) return {};
  const supabase = await createClient();
  const { data } = await supabase.storage.from(BUCKET_CONHECIMENTO).createSignedUrls(arquivos, 3600);
  const mapa: Record<string, string> = {};
  for (const d of data ?? []) {
    if (d.path && d.signedUrl) mapa[d.path] = d.signedUrl;
  }
  return mapa;
}
