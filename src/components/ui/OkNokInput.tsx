"use client";

import { BINARIA_NOK, BINARIA_OK } from "@/lib/constants";

/**
 * Lançamento de uma meta do tipo "sim ou não".
 *
 * Dois botões em vez de um `select`: lançar o realizado é a ação mais repetida
 * da tela, e assim vira um clique só, sem abrir lista e escolher.
 *
 * Clicar no botão que já está aceso DESMARCA e volta para "pendente". Sem isso
 * não haveria como desfazer um clique errado: num campo de número dá para apagar
 * o texto, num par de botões não existe o equivalente, e a pessoa ficaria presa
 * com um valor que ela mesma não conseguiria tirar.
 *
 * Por baixo grava 100 (OK) ou 0 (NOK) em `actual_value`, que é o mesmo formato
 * de qualquer meta numérica. É o que faz o farol e o acumulado ponderado
 * funcionarem sem nenhum caso especial.
 */
export function OkNokInput({
  value,
  onChange,
  autoFocus,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  autoFocus?: boolean;
}) {
  const botao = (alvo: number, rotulo: string, cor: string, foco: boolean) => {
    const aceso = value === alvo;
    return (
      <button
        type="button"
        autoFocus={foco}
        aria-pressed={aceso}
        onClick={() => onChange(aceso ? null : alvo)}
        className="btn"
        style={{
          flex: 1,
          fontWeight: 700,
          borderColor: aceso ? cor : "var(--mh-border)",
          background: aceso ? `color-mix(in srgb, ${cor} 16%, transparent)` : "transparent",
          color: aceso ? cor : "var(--mh-text-2)",
        }}
      >
        {rotulo}
      </button>
    );
  };

  return (
    <div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        {botao(BINARIA_OK, "OK", "var(--mh-success)", !!autoFocus)}
        {botao(BINARIA_NOK, "NOK", "var(--mh-danger)", false)}
      </div>
      <p className="soft" style={{ fontSize: "0.72rem", margin: "0.35rem 0 0" }}>
        {value == null
          ? "Sem lançamento: a meta fica pendente."
          : "Clique de novo no botão aceso para voltar a pendente."}
      </p>
    </div>
  );
}
