"use client";

import { useEffect } from "react";

/**
 * Fecha o modal mais ao topo quando o usuário aperta ESC.
 *
 * Em vez de tocar em cada um dos ~24 diálogos, aproveitamos que todos são
 * `position: fixed; inset: 0` e têm um botão de fechar `aria-label="Fechar"`.
 * Ao ESC, achamos o overlay de maior z-index que cobre a tela e clicamos no
 * seu botão de fechar (fallback: um botão "Cancelar"/"Fechar" no rodapé).
 *
 * Faixa de z-index tratada: 40–89. O confirmDialog (z 90) gerencia o próprio ESC.
 */
export function EscToClose() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;

      let top: HTMLElement | null = null;
      let topZ = -1;
      document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.position !== "fixed") return;
        const z = parseInt(cs.zIndex, 10) || 0;
        if (z < 40 || z >= 90) return; // < 40 = topbar/scrim; 90 = confirmDialog (auto)
        const r = el.getBoundingClientRect();
        if (r.width < window.innerWidth * 0.85 || r.height < window.innerHeight * 0.85) return;
        if (z >= topZ) { topZ = z; top = el; }
      });
      if (!top) return;
      const overlay = top as HTMLElement;

      // botão de fechar do modal (× no cabeçalho)
      const closeBtn = overlay.querySelector<HTMLButtonElement>('button[aria-label="Fechar"]');
      if (closeBtn) { closeBtn.click(); return; }

      // fallback: botão "Cancelar"/"Fechar" no rodapé (ex.: ConfirmDialog)
      const btns = Array.from(overlay.querySelectorAll<HTMLButtonElement>("button"));
      const cancel = btns.find((b) => /^(cancelar|fechar)$/i.test((b.textContent || "").trim()));
      cancel?.click();
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return null;
}
