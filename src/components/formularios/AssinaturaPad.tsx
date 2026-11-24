"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Assinatura com o dedo ou o mouse. Desenha em canvas com Pointer Events (vale
 * para toque, caneta e mouse) e devolve um PNG de fundo branco, para a
 * assinatura sair legível também no tema escuro e na planilha.
 */
export function AssinaturaPad({ onConfirmar, desabilitado, enviando }: {
  onConfirmar: (png: Blob) => void;
  desabilitado?: boolean;
  enviando?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const desenhando = useRef(false);
  const ultimo = useRef<{ x: number; y: number } | null>(null);
  const [vazio, setVazio] = useState(true);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const escala = window.devicePixelRatio || 1;
    const largura = cv.clientWidth;
    const altura = cv.clientHeight;
    cv.width = Math.round(largura * escala);
    cv.height = Math.round(altura * escala);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.scale(escala, escala);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, largura, altura);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
  }, []);

  const ponto = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const limpar = () => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.restore();
    setVazio(true);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
      <canvas
        ref={ref}
        aria-label="Área de assinatura"
        style={{
          width: "100%", maxWidth: 520, height: 170, borderRadius: 8, touchAction: "none",
          border: "1px dashed var(--mh-border-strong)", background: "#fff", cursor: desabilitado ? "not-allowed" : "crosshair",
        }}
        onPointerDown={(e) => {
          if (desabilitado) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          desenhando.current = true;
          ultimo.current = ponto(e);
        }}
        onPointerMove={(e) => {
          if (!desenhando.current || !ultimo.current) return;
          const ctx = e.currentTarget.getContext("2d");
          if (!ctx) return;
          const p = ponto(e);
          ctx.beginPath();
          ctx.moveTo(ultimo.current.x, ultimo.current.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          ultimo.current = p;
          if (vazio) setVazio(false);
        }}
        onPointerUp={() => { desenhando.current = false; ultimo.current = null; }}
        onPointerCancel={() => { desenhando.current = false; ultimo.current = null; }}
      />
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" className="btn btn-ghost btn-sm" disabled={vazio || enviando} onClick={limpar}>Limpar</button>
        <button
          type="button" className="btn btn-primary btn-sm" disabled={vazio || desabilitado || enviando}
          onClick={() => ref.current?.toBlob((b) => { if (b) onConfirmar(b); }, "image/png")}
        >
          {enviando ? "Enviando..." : "Usar esta assinatura"}
        </button>
      </div>
    </div>
  );
}
