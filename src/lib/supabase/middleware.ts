import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";
import { COOKIE_LIMITE, COOKIE_USO, FOLGA_DO_SERVIDOR_S, horaDoLogin } from "@/lib/sessao";

// `/esqueci-senha` e `/redefinir-senha` entram aqui porque quem chega nelas,
// por definição, não consegue entrar no sistema. `/instalar` é o link que o RH
// manda para a equipe: abre antes do login, a instalação não depende de sessão.
const PUBLIC_PATHS = ["/login", "/auth", "/esqueci-senha", "/redefinir-senha", "/instalar"];

/**
 * Rotas que um usuário AUTENTICADO alcança mesmo com a senha padrão pendente.
 *
 * Lista separada de `PUBLIC_PATHS` de propósito: `/trocar-senha` exige sessão,
 * então não pode virar rota pública. `/suspenso` entra porque obrigar um
 * desligado a definir senha nova para só então descobrir que o acesso está
 * inativo é fluxo absurdo.
 */
const LIVRES_DA_TROCA = ["/trocar-senha", "/suspenso", "/auth", "/redefinir-senha", "/instalar"];

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

  /**
   * Sessão parada além do tempo da pessoa (celular compartilhado; ver
   * src/lib/sessao.ts). O app aberto encerra sozinho; aqui se pega quem
   * reabre o app depois do prazo, antes de qualquer tela carregar dado.
   *
   * O último uso é o maior entre o cookie e a hora do login: um cookie velho de
   * outra sessão no mesmo aparelho não derruba quem acabou de entrar.
   */
  let expirou = false;
  if (autenticado && claims?.claims) {
    const limite = Number(request.cookies.get(COOKIE_LIMITE)?.value ?? "");
    if (Number.isFinite(limite) && limite > 0) {
      const uso = Number(request.cookies.get(COOKIE_USO)?.value ?? "") || 0;
      const ultimo = Math.max(uso, horaDoLogin(claims.claims as Record<string, unknown>));
      if (ultimo > 0 && Date.now() / 1000 - ultimo > limite * 60 + FOLGA_DO_SERVIDOR_S) {
        // limpa os cookies da sessão na resposta (setAll acima) e no request
        await supabase.auth.signOut({ scope: "local" });
        response.cookies.delete(COOKIE_USO);
        expirou = true;
        autenticado = false;
      }
    }
  }

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  // não autenticado tentando acessar área protegida -> login
  if (!autenticado && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    if (!expirou) return NextResponse.redirect(url);
    // sessão vencida: o login explica, e o redirect leva junto a limpeza dos cookies
    url.searchParams.set("motivo", "inatividade");
    const r = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  }

  /**
   * Senha ainda é a que a administração cadastrou: só a tela de troca.
   *
   * A pendência vem DENTRO do token que o getClaims acabou de validar, então
   * este gate não custa ida ao banco nenhuma. A leitura autoritativa (que pega
   * um reset feito por admin há pouco) mora no layout autenticado.
   */
  const trocaPendente =
    (claims?.claims?.app_metadata as { must_change_password?: boolean } | undefined)
      ?.must_change_password === true;

  // autenticado em página de auth -> dashboard, ou a troca quando ela é devida
  if (autenticado && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = trocaPendente ? "/trocar-senha" : "/dashboard";
    return NextResponse.redirect(url);
  }

  /**
   * Só GET, e isso é correção e não estilo: o redirect responde 307, que
   * PRESERVA o método, e o Next despacha server action por id e não por rota.
   * Um POST de action redirecionado para cá chegaria com o cabeçalho da action
   * intacto e rodaria assim mesmo. Quem tranca escrita é a guarda do
   * `actionContext`; aqui se tranca navegação.
   */
  if (
    autenticado && trocaPendente && request.method === "GET"
    && !LIVRES_DA_TROCA.some((p) => pathname.startsWith(p))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/trocar-senha";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
