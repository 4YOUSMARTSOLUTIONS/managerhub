/*
 * Service worker do MANAGERHUB.
 *
 * Faz UMA coisa: quando a pessoa abre uma tela sem internet, mostra a página
 * "Sem conexão" em vez do erro do navegador. Não guarda tela, dado nem arquivo
 * do sistema em cache, de propósito: o portal é todo dado por pessoa e por
 * empresa, e um cache aqui serviria informação velha (ou de outra sessão) sem
 * ninguém perceber. Tudo continua indo à rede como antes.
 *
 * Mudou este arquivo? Suba a VERSAO: o navegador troca o worker antigo sozinho
 * (skipWaiting + clients.claim) e o activate apaga o cache da versão anterior.
 */
const VERSAO = "mh-offline-v1";
const OFFLINE = "/offline.html";

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
