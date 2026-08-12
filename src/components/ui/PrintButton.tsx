"use client";

import { Printer } from "lucide-react";

/**
 * Chama a impressão do navegador.
 *
 * Existe como componente próprio por um motivo simples: `window.print()` é
 * cliente, e a página do documento é servidora (ela lê o CPF por RPC). Sem isto,
 * a página inteira viraria client component só por causa de um botão.
 */
export function PrintButton({ label = "Imprimir" }: { label?: string }) {
  return (
    <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>
      <Printer size={15} /> {label}
    </button>
  );
}
