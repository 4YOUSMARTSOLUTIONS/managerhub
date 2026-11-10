import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

/**
 * Fora do proxy: estáticos e as três peças do aplicativo instalável. O
 * manifesto e o service worker são buscados pelo navegador sem sessão; passando
 * por aqui, viravam redirect para /login e a instalação falhava. A página
 * offline é guardada pelo worker na instalação, e com o redirect ele guardaria
 * a tela de login no lugar dela. `/api/push` é chamada pelo banco, sem sessão,
 * e se autentica pelo segredo do Vault.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js$|manifest\\.webmanifest$|offline\\.html$|api/push$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
