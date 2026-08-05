"use client";

import { useMemo } from "react";

/**
 * Escolha do ano por lista, no lugar do campo numérico com setinhas.
 *
 * O `type="number"` obrigava a subir e descer de ano em ano e aceitava qualquer
 * coisa entre 2000 e 2100, inclusive anos em que a empresa nem existia. Ao lado
 * dele, o modo "Mês" abre um calendário. Duas linguagens diferentes para a mesma
 * pergunta na mesma linha.
 *
 * A armadilha de trocar campo livre por lista é o valor que não está na lista:
 * o `select` passa a exibir outra opção sem avisar, e o estado muda sozinho. Por
 * isso duas garantias:
 *
 * - o valor selecionado SEMPRE entra na lista, mesmo fora da janela padrão;
 * - os anos que têm lançamento também entram, então histórico antigo não fica
 *   inalcançável quando a janela deslizar com o tempo.
 */
export function YearSelect({
  value,
  onChange,
  periodos,
  className = "select",
  style,
  title,
}: {
  value: string;
  onChange: (value: string) => void;
  /** competências carregadas na tela (`aaaa-mm-dd` ou `aaaa-mm`): os anos com dado entram na lista */
  periodos?: readonly string[];
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}) {
  const anos = useMemo(() => {
    const valido = (n: number) => Number.isInteger(n) && n >= 1900 && n <= 2999;
    const set = new Set<number>();
    const atual = new Date().getFullYear();
    // janela padrão: o ano que vem (planejamento) e os cinco anteriores
    for (let a = atual + 1; a >= atual - 5; a--) set.add(a);
    for (const p of periodos ?? []) {
      const n = Number(p.slice(0, 4));
      if (valido(n)) set.add(n);
    }
    const selecionado = Number(value);
    if (valido(selecionado)) set.add(selecionado);
    return [...set].sort((a, b) => b - a);
  }, [value, periodos]);

  return (
    <select
      className={className}
      style={{ width: "auto", ...style }}
      title={title}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {anos.map((a) => <option key={a} value={String(a)}>{a}</option>)}
    </select>
  );
}
