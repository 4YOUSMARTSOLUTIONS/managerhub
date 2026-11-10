/**
 * Chaves VAPID do Web Push, do lado do servidor. Sem "use server": isto não
 * pode virar endpoint, devolve a chave privada.
 *
 * O par é gerado UMA vez, no primeiro uso, e vai direto para o Vault do banco
 * (`push_vapid_definir`): a chave privada nunca passa por arquivo, variável de
 * ambiente ou mão de ninguém. Trocar o par desliga todos os aparelhos inscritos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { gerarChavesVapid, type Vapid } from "@/lib/web-push";

let emMemoria: Vapid | null = null;

export async function obterVapid(admin: SupabaseClient<Database>, criarSeFaltar: boolean): Promise<Vapid | null> {
  if (emMemoria) return emMemoria;
  const { data, error } = await admin.rpc("push_vapid");
  if (error) throw new Error(`push_vapid: ${error.message}`);
  const linha = data?.[0];
  if (linha?.publica && linha.privada) {
    emMemoria = { publica: linha.publica, privada: linha.privada };
    return emMemoria;
  }
  if (!criarSeFaltar) return null;

  const novo = gerarChavesVapid();
  const { data: valendo, error: e2 } = await admin.rpc("push_vapid_definir", { p_publica: novo.publica, p_privada: novo.privada });
  if (e2) throw new Error(`push_vapid_definir: ${e2.message}`);
  // outro servidor pode ter gerado antes: vale o que ficou no banco
  if (valendo !== novo.publica) {
    emMemoria = null;
    return obterVapid(admin, false);
  }
  emMemoria = novo;
  return novo;
}
