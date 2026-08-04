"use client";

import { useRef } from "react";

/**
 * Campo de mês que abre o calendário ao clicar em QUALQUER ponto.
 *
 * O `<input type="month">` sozinho só abre o seletor quando o clique acerta o
 * ícone minúsculo na ponta direita. Clicar no meio do campo não faz nada, e o
 * usuário conclui que não dá para escolher o mês. `showPicker()` resolve isso.
 *
 * O try/catch não é decoração: `showPicker()` exige gesto do usuário e lança se
 * for chamado fora dele, ou quando o próprio navegador já está abrindo o seletor
 * porque o clique acertou o ícone. Nesses casos o certo é não fazer nada, e não
 * derrubar a tela.
 *
 * Firefox não implementa `type="month"`: o campo vira texto livre no formato
 * aaaa-mm, sem seletor. Nada quebra, mas lá o clique não abre calendário nenhum.
 */
export function MonthInput({
  value,
  onChange,
  className = "input",
  style,
  title,
  id,
  name,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  id?: string;
  name?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  const abrir = () => {
    try {
      ref.current?.showPicker?.();
    } catch {
      /* sem gesto do usuário, ou o navegador já está abrindo: segue sem seletor */
    }
  };

  return (
    <input
      ref={ref}
      id={id}
      name={name}
      type="month"
      className={className}
      style={{ cursor: "pointer", ...style }}
      title={title}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onClick={abrir}
      // teclado: quem chega no campo com Tab também consegue abrir
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          abrir();
        }
      }}
    />
  );
}
