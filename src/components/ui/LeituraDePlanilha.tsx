"use client";

import { useCallback, useState } from "react";

/**
 * Aviso de "estou lendo a planilha", para o intervalo entre escolher o arquivo e
 * a tela reagir.
 *
 * Esse intervalo é real e pode passar de alguns segundos: a biblioteca de
 * planilhas tem ~880 KB e só é baixada na PRIMEIRA leitura (ver `xlsx-lazy.ts`),
 * e logo depois vem o `XLSX.read`, que é síncrono e trava a thread. Sem aviso,
 * a pessoa escolhe o arquivo, nada acontece, e ela conclui que travou.
 *
 * O `setTimeout(0)` do hook abaixo não é superstição: sem ele o React agenda o
 * render do aviso, mas a leitura síncrona começa antes de o navegador pintar, e
 * o aviso só apareceria depois de tudo pronto, que é quando ele não serve mais.
 * O respiro de um quadro garante que o aviso apareça ANTES do trabalho pesado.
 */
export function useLeituraDePlanilha() {
  const [lendo, setLendo] = useState(false);

  const ler = useCallback(async (trabalho: () => Promise<void> | void) => {
    setLendo(true);
    await new Promise((r) => setTimeout(r, 0));
    try {
      await trabalho();
    } finally {
      // `finally` e não depois do await: se a leitura estourar, o aviso precisa
      // sair da tela do mesmo jeito, senão fica preso em "lendo" para sempre
      setLendo(false);
    }
  }, []);

  return { lendo, ler };
}

export function AvisoLendoPlanilha({ lendo }: { lendo: boolean }) {
  if (!lendo) return null;
  return (
    <p
      role="status"
      aria-live="polite"
      className="soft"
      style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", margin: "0.5rem 0 0" }}
    >
      {/* classe `.spin` que já existe no globals.css, em vez de um keyframe novo */}
      <span
        aria-hidden
        className="spin"
        style={{
          width: 13, height: 13, flexShrink: 0,
          border: "2px solid var(--mh-border)",
          borderTopColor: "var(--mh-primary-500)",
          borderRadius: "999px",
        }}
      />
      Lendo a planilha…
    </p>
  );
}
