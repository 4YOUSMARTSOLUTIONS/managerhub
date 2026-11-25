/**
 * Item aberto pela URL (o aviso do sino leva a `/chamados?chamado=<id>`).
 *
 * Ao fechar o painel o parâmetro sai da URL sem ir ao servidor: o
 * `replaceState` nativo é integrado ao roteador do Next (atualiza o
 * `useSearchParams`). Assim, voltar à aba não reabre o item, e clicar de novo
 * no mesmo aviso abre outra vez, porque a URL muda.
 */
export function tirarDaUrl(param: string): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(param)) return;
  url.searchParams.delete(param);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
