import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

const PUBLIC_PATHS = ["/login", "/auth"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  /**
   * getClaims, não getUser: este código roda em TODA requisição, incluindo os
   * payloads de navegação e cada server action. O getUser é uma chamada de rede ao
   * servidor de autenticação, sempre. Como o projeto assina o JWT com ES256 e publica
   * o JWKS, o getClaims valida a assinatura localmente (WebCrypto), com o JWKS em
   * cache, e ainda renova a sessão se o token estiver perto de expirar.
   *
   * Contrapartida aceita: bloquear ou excluir um usuário só faz efeito quando o token
   * dele expira, em vez de no ato.
   */
  const { data: claims } = await supabase.auth.getClaims();
  let autenticado = Boolean(claims?.claims?.sub);

  // Rede de segurança: só confere no servidor quando a validação local NÃO reconheceu
  // a sessão. Sem cookie nenhum isso é instantâneo (não há token para validar); com
  // cookie, é o caso raro em que um erro de validação deslogaria o usuário à toa.
  if (!autenticado) {
    const { data: { user: doServidor } } = await supabase.auth.getUser();
    autenticado = Boolean(doServidor);
  }

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  // não autenticado tentando acessar área protegida -> login
  if (!autenticado && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  // autenticado em página de auth -> dashboard
  if (autenticado && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}
