import { after, NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { enviarPush } from "@/lib/web-push";
import { obterVapid } from "@/lib/push-servidor";
import { destinoDaNotificacao } from "@/lib/notificacao-destino";
import { APP_URL } from "@/lib/app-url";

/**
 * Envia ao celular as notificações recém-criadas.
 *
 * Quem chama é o banco: o trigger `notifications_push` faz um POST com os ids
 * (pg_net), depois do COMMIT, com o segredo do Vault no cabeçalho. Fica fora
 * do proxy de sessão (ver src/proxy.ts), porque não há usuário nesta chamada.
 *
 * O `push_para_enviar` confere o segredo e marca cada notificação como
 * enviada na mesma tacada: uma chamada repetida não repete o aviso, e uma
 * chamada com id velho (mais de 15 minutos) não manda nada.
 */
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** vários avisos ao mesmo tempo, sem abrir centenas de conexões de uma vez */
const LOTE = 20;

const cortar = (s: string | null, n: number) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s ?? "");

export async function POST(req: NextRequest) {
  const segredo = req.headers.get("x-push-segredo");
  if (!segredo) return NextResponse.json({ error: "não autorizado" }, { status: 401 });

  const corpo = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(corpo?.ids)
    ? corpo.ids.filter((x): x is string => typeof x === "string" && UUID.test(x)).slice(0, 1000)
    : [];
  if (ids.length === 0) return NextResponse.json({ avisos: 0 });

  const admin = createServiceClient();
  const { data: linhas, error } = await admin.rpc("push_para_enviar", { p_segredo: segredo, p_ids: ids });
  if (error) {
    const recusado = error.code === "42501";
    if (!recusado) console.error("[push] push_para_enviar", error.message);
    return NextResponse.json({ error: recusado ? "não autorizado" : "falha" }, { status: recusado ? 401 : 500 });
  }
  if (!linhas?.length) return NextResponse.json({ avisos: 0 });

  // responde já: o banco não precisa esperar cada serviço de push
  after(async () => {
    const vapid = await obterVapid(admin, false);
    if (!vapid) {
      console.error("[push] sem chave VAPID, nada enviado");
      return;
    }
    const ok: string[] = [];
    const expiradas: string[] = [];
    for (let i = 0; i < linhas.length; i += LOTE) {
      await Promise.all(linhas.slice(i, i + LOTE).map(async (l) => {
        const url = destinoDaNotificacao({ type: l.type, demandaId: l.demanda_id, plannerBoardId: l.planner_board_id }) ?? "/dashboard";
        // aparelho parado além do tempo da pessoa (celular compartilhado): a
        // sessão dela venceu e quem está com o celular pode ser outra pessoa.
        // O aviso chega, mas sem dizer do que se trata.
        const conteudo = JSON.stringify(l.sessao_viva
          ? { title: cortar(l.title, 120), body: cortar(l.body, 300), url, tag: l.notification_id }
          : { title: "Manager HUB", body: "Você tem um novo aviso. Entre no app para ver.", url, tag: l.notification_id });
        const r = await enviarPush(
          { endpoint: l.endpoint, p256dh: l.p256dh, auth: l.chave_auth },
          conteudo, vapid, APP_URL, { urgencia: "high" },
        );
        if (r.resultado === "ok") ok.push(l.endpoint);
        else if (r.resultado === "expirada") expiradas.push(l.endpoint);
        else console.warn("[push] falha", r.status, new URL(l.endpoint).hostname);
      }));
    }
    const { error: e2 } = await admin.rpc("push_resultado", { p_segredo: segredo, p_ok: ok, p_expiradas: expiradas });
    if (e2) console.error("[push] push_resultado", e2.message);
  });

  return NextResponse.json({ avisos: linhas.length }, { status: 202 });
}
