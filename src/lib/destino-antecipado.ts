/**
 * Redirecionamento antecipado da carga fria (LUIZ, 18/11/2026).
 *
 * O `<Suspense>` em volta da página no AppShell (ver o comentário lá) faz o
 * shell sair antes da página. Quando a página chama `redirect()` (módulo
 * escondido, índice de grupo, início de quem não tem o Dashboard), a resposta
 * já foi 200 e o Next só consegue redirecionar pelo navegador: põe no HTML um
 * `<meta id="__next-page-redirect" http-equiv="refresh">`, e enquanto essa tag
 * existe o roteador transforma toda navegação em recarga completa
 * (navigate-reducer). Essa recarga no meio da hidratação, com uma action do
 * shell ainda pendente, é onde o Router do Next quebra com o React #310 e, às
 * vezes, a tela fica em "This page couldn't load" (vercel/next.js#97354).
 *
 * A saída é decidir o destino no LAYOUT autenticado, que roda antes do
 * Suspense: lá o `redirect()` ainda vira um 307 de verdade. O layout não sabe o
 * caminho pedido, então o proxy o repassa em `CABECALHO_CAMINHO`, e SÓ na
 * abertura de página: na troca de tela por dentro o redirect do layout deixava
 * a tela preta quando se vinha de fora do sistema (ver `seguir` no proxy).
 *
 * Isto é atalho, não guarda. As páginas continuam com `moduleGate`,
 * `exigirTelaBase` e `redirectToFirstVisible`, que valem na navegação suave e
 * em qualquer caminho que escape daqui. Por isso as regras abaixo precisam dar
 * o MESMO destino que a página daria: se divergirem, o pior caso é a página
 * redirecionar de novo pelo caminho lento, nunca abrir o que não devia.
 */
import { primeiraTela } from "@/lib/acesso-telas";
import {
  MODULES, modulesInGroup,
  type GroupKey, type ModuleDef, type ModuleKey, type ModuleState,
} from "@/lib/modules";

/**
 * Cabeçalho da requisição em que o proxy repassa o caminho ao layout. O proxy
 * SEMPRE sobrescreve, então o cliente não consegue injetar um valor; e, sendo
 * só atalho, um valor forjado não abriria nada.
 */
export const CABECALHO_CAMINHO = "x-mh-caminho";

/** Índices de grupo com página própria, que mandam para o primeiro submódulo visível. */
export const INDICE_DO_GRUPO: Readonly<Record<string, GroupKey>> = {
  "/seguranca": "g_seguranca",
  "/ferramentas-gestao": "g_ferramentas",
};

/** Primeiro submódulo não escondido do grupo, ou o início. */
export function primeiroVisivel(group: GroupKey, state: Record<ModuleKey, ModuleState>): string {
  return modulesInGroup(group).find((m) => state[m.key] !== "hidden")?.href ?? "/dashboard";
}

/** O módulo dono do caminho: o `href` mais longo que o contém, respeitando os segmentos. */
function moduloDoCaminho(caminho: string): ModuleDef | undefined {
  let dono: ModuleDef | undefined;
  for (const m of MODULES) {
    const contem = caminho === m.href || caminho.startsWith(`${m.href}/`);
    if (contem && (!dono || m.href.length > dono.href.length)) dono = m;
  }
  return dono;
}

/**
 * Para onde a página deste caminho redirecionaria, ou null se ela abre.
 *
 * - índice de grupo: o primeiro submódulo visível (`redirectToFirstVisible`);
 * - módulo escondido: o início (`moduleGate` e `exigirTelaBase`). O Painel ADM
 *   fica de fora: a guarda dele é o `requireSuperAdmin`, não o estado;
 * - o início de quem não vê o Dashboard: a primeira tela liberada
 *   (dashboard/page.tsx), resolvido aqui já no destino final, sem dois saltos.
 */
export function destinoAntecipado(
  caminho: string,
  state: Record<ModuleKey, ModuleState>,
  podeVer: (m: ModuleDef) => boolean,
): string | null {
  let destino: string | null = null;
  const grupo = INDICE_DO_GRUPO[caminho];
  if (grupo) {
    destino = primeiroVisivel(grupo, state);
  } else {
    const dono = moduloDoCaminho(caminho);
    if (dono && dono.key !== "dashboard" && dono.key !== "admin" && state[dono.key] === "hidden") {
      destino = "/dashboard";
    }
  }
  if ((destino ?? caminho) === "/dashboard" && state.dashboard === "hidden") {
    destino = primeiraTela(state, podeVer) ?? destino;
  }
  return destino !== null && destino !== caminho ? destino : null;
}
