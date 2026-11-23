import { after, NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { dispatchSeriesInvite } from "@/lib/invites";

/**
 * Envia os convites de quem entrou ou saiu sozinho de uma reunião ligada a um
 * nível de hierarquia.
 *
 * Quem chama é o banco, a cada 10 minutos e só se houver fila
 * (`reunioes_disparar_convites`), com o segredo do Vault no cabeçalho. Fica fora
 * do proxy de sessão (ver src/proxy.ts), porque não há usuário nesta chamada.
 * O que falhar continua na fila e é tentado de novo, até cinco vezes.
 */
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const segredo = req.headers.get("x-push-segredo");
  if (!segredo) return NextResponse.json({ error: "não autorizado" }, { status: 401 });

  const admin = createServiceClient();
  const { data: linhas, error } = await admin.rpc("reuniao_convites_pegar", { p_segredo: segredo });
  if (error) {
    const recusado = error.code === "42501";
    if (!recusado) console.error("[reunioes-convites] pegar", error.message);
    return NextResponse.json({ error: recusado ? "não autorizado" : "falha" }, { status: recusado ? 401 : 500 });
  }
  if (!linhas?.length) return NextResponse.json({ convites: 0 });

  const grupos = new Map<string, { serie: string; metodo: "REQUEST" | "CANCEL"; pessoas: string[] }>();
  for (const l of linhas) {
    const metodo = l.o_metodo === "CANCEL" ? "CANCEL" : "REQUEST";
    const chave = `${l.o_series}:${metodo}`;
    const g = grupos.get(chave) ?? { serie: l.o_series, metodo, pessoas: [] };
    g.pessoas.push(l.o_user);
    grupos.set(chave, g);
  }

  // responde já: o banco não precisa esperar o envio dos e-mails
  after(async () => {
    for (const g of grupos.values()) {
      const r = await dispatchSeriesInvite(g.serie, g.metodo, g.pessoas);
      if (r === "failed") continue;
      const { error: e2 } = await admin.rpc("reuniao_convites_concluir", {
        p_segredo: segredo, p_series: g.serie, p_users: g.pessoas, p_metodo: g.metodo,
      });
      if (e2) console.error("[reunioes-convites] concluir", e2.message);
    }
  });

  return NextResponse.json({ convites: linhas.length }, { status: 202 });
}
