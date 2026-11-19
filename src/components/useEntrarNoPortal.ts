"use client";

import { useEffect } from "react";

/**
 * Entrar no portal vindo de FORA dele (login, troca obrigatória de senha,
 * redefinição pelo link de recuperação) é sempre carga completa da página.
 *
 * Por quê (LUIZ, 19/11/2026: um motorista caiu na tela de erro no primeiro
 * acesso pelo PC, e o reload resolveu): o `redirect("/dashboard")` da action é
 * navegação interna do Next. Quem não vê o Dashboard (o Operacional) é desviado
 * para a primeira tela dentro dessa navegação, e vindo de fora do grupo (app)
 * esse desvio deixa o portal sem o shell (tela preta, f2105df) ou na tela de
 * erro. Na carga completa, o desvio acontece no layout antes de qualquer tela
 * montar (destino-antecipado.ts, 307), que é o caminho que sempre funcionou.
 *
 * A action devolve `destino` em vez de redirecionar; este gancho faz a entrada.
 */
export function useEntrarNoPortal(destino: string | undefined) {
  useEffect(() => {
    if (destino) window.location.replace(destino);
  }, [destino]);
}
