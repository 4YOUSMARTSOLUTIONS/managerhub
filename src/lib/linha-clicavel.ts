import type React from "react";

// Linha de tabela que abre o detalhe ao clicar em qualquer ponto dela (LUIZ,
// 27/11/2026: em Ações e Chamados o tratamento só abria pelo "..."). A linha
// tem botões próprios (número, comentários, menu, de acordo, avaliação) que
// fazem outra coisa, então o clique da linha se afasta deles.
const INTERATIVO = "button, a, input, select, textarea, label, summary, [role='button'], [role='menu'], [role='menuitem']";

/**
 * Para o `onClick` da `<tr>`: `onClick={(e) => aoClicarNaLinha(e, () => abrir(x))}`.
 * Abre só quando o clique foi na própria linha, fora de qualquer controle.
 * Ignora:
 *  - o que sai de um controle da linha (o botão já faz a parte dele);
 *  - o que vem de um portal (menu e modal aberto pela linha): o React propaga o
 *    evento pela árvore de componentes, mas no DOM ele não está dentro da linha;
 *  - quem estava selecionando texto para copiar (a descrição, o número).
 */
export function aoClicarNaLinha(e: React.MouseEvent<HTMLElement>, abrir: () => void): void {
  const alvo = e.target as HTMLElement | null;
  if (!alvo || !e.currentTarget.contains(alvo)) return;
  const controle = alvo.closest(INTERATIVO);
  if (controle && e.currentTarget.contains(controle)) return;
  if ((window.getSelection()?.toString() ?? "").trim() !== "") return;
  abrir();
}
