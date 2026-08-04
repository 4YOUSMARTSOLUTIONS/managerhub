"use client";

/**
 * Barra fina de progresso presa ao topo da janela.
 *
 * Existe para responder ao clique NA HORA, quando o resultado ainda vai demorar
 * um pouco. É o oposto de bloquear a tela: o usuário continua podendo marcar o
 * próximo filtro, e só a barra conta que a resposta está a caminho.
 *
 * A animação não representa progresso real (não há como saber) — ela avança
 * depressa até uns 90% e desacelera, que é a convenção que o usuário já conhece
 * de GitHub, Linear e do próprio navegador.
 */
export function TopProgress({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      role="progressbar"
      aria-label="Carregando"
      aria-busy="true"
      style={{
        position: "fixed",
        insetInline: 0,
        top: 0,
        height: 3,
        zIndex: 100,
        pointerEvents: "none", // nunca rouba clique do que está embaixo
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: "100%",
          transformOrigin: "0 50%",
          background: "var(--mh-brand-gradient)",
          animation: "mh-topbar 2.2s cubic-bezier(0.1, 0.6, 0.2, 1) forwards",
        }}
      />
    </div>
  );
}
