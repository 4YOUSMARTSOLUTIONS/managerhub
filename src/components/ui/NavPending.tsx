"use client";

import { useLinkStatus } from "next/link";
import { createPortal } from "react-dom";
import { TopProgress } from "./TopProgress";

/**
 * Resposta imediata ao clique num item do menu.
 *
 * Sem isto, o intervalo entre clicar e a tela trocar é silêncio: o item clicado
 * não muda, o item antigo continua aceso, e a pessoa clica de novo achando que
 * não pegou. O `loading.tsx` só entra quando o servidor já começou a responder,
 * tarde demais para ser o primeiro sinal.
 *
 * `useLinkStatus` precisa rodar DENTRO de um `<Link>` (é daí que ele lê o estado
 * pendente da navegação), por isso o componente é um filho do link e não um
 * observador global de rota. Ele devolve duas coisas: a listra no próprio item,
 * que diz PARA ONDE está indo, e a barra do topo, que diz que algo está em curso.
 *
 * A barra vai para `document.body` por portal: `position: fixed` se ancora no
 * ancestral que tiver `transform`, e a barra lateral usa translate no modo
 * celular, o que grudaria a barra dentro do menu em vez do topo da janela.
 */
/**
 * Um sinal por navegação, nunca dois.
 *
 * No menu, a listra no próprio item já diz para onde está indo, e é o melhor
 * sinal possível: fica exatamente onde o olho está, no item recém-clicado.
 * Somar a barra do topo ali era redundância pura, duas coisas piscando pela
 * mesma navegação.
 *
 * A barra existe só onde a listra é impossível: paginação e abas do Painel ADM
 * não são `position: relative` e não têm onde desenhá-la. Nesses casos ela é o
 * único retorno, e tirá-la deixaria o clique mudo.
 */
export function NavPending({ barraNoTopo = false }: { barraNoTopo?: boolean }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;

  if (barraNoTopo) {
    // portal para o body: `position: fixed` se ancora no ancestral que tiver
    // `transform`, e a barra lateral usa translate no modo celular
    return typeof document !== "undefined"
      ? createPortal(<TopProgress active />, document.body)
      : null;
  }

  return <span className="nav-pending" aria-hidden />;
}
