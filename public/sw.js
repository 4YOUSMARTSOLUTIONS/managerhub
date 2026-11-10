/*
 * Service worker do MANAGERHUB.
 *
 * Duas tarefas:
 *  1. Sem internet, mostra a página "Sem conexão" em vez do erro do navegador.
 *  2. Mostra no aparelho as notificações que o servidor manda (Web Push), com
 *     o app fechado, e abre a tela certa no toque.
 *
 * Não guarda tela, dado nem arquivo do sistema em cache, de propósito: o portal
 * é todo dado por pessoa e por empresa, e um cache aqui serviria informação
 * velha (ou de outra sessão) sem ninguém perceber.
 *
 * Mudou este arquivo? Suba a VERSAO: o navegador troca o worker antigo sozinho
 * (skipWaiting + clients.claim) e o activate apaga o cache da versão anterior.
 */
const VERSAO = "mh-offline-v2";
const OFFLINE = "/offline.html";
const NOME = "Manager HUB";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSAO)
      .then((cache) => cache.add(new Request(OFFLINE, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const nomes = await caches.keys();
      await Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n)));
      // a navegação já sai para a rede enquanto o worker acorda
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // só a abertura de tela; server actions, dados e arquivos passam direto
  if (req.mode !== "navigate" || req.method !== "GET") return;

  event.respondWith(
    (async () => {
      try {
        const adiantada = await event.preloadResponse;
        if (adiantada) return adiantada;
        return await fetch(req);
      } catch {
        const offline = await caches.match(OFFLINE);
        return offline || Response.error();
      }
    })(),
  );
});

/** Só caminho do próprio portal: um link de fora nunca sai de uma notificação. */
function destino(url) {
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//") ? url : "/dashboard";
}

// o servidor manda { title, body, url, tag } (ver src/app/api/push/route.ts)
self.addEventListener("push", (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
    dados = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(dados.title || NOME, {
      body: dados.body || "",
      icon: "/icons/icon-192.png",
      // ícone pequeno da barra do Android: só a silhueta, em branco
      badge: "/icons/badge-96.png",
      tag: dados.tag,
      lang: "pt-BR",
      data: { url: destino(dados.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const alvo = new URL(destino(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil(
    (async () => {
      // app já aberto: traz para a frente e leva à tela; senão, abre
      const janelas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const aberta = janelas.find((c) => new URL(c.url).origin === self.location.origin);
      if (aberta) {
        await aberta.focus();
        try {
          await aberta.navigate(alvo);
          return;
        } catch {
          // janela fora do controle deste worker: abre uma nova
        }
      }
      await self.clients.openWindow(alvo);
    })(),
  );
});
