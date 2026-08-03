"use client";

import { useEffect, useRef, useState } from "react";
import { ZoomIn } from "lucide-react";
import { AVATAR_SIZE } from "@/lib/avatar";

/** Lado do quadro de recorte na tela. O resultado sai sempre em AVATAR_SIZE. */
const VIEW = 260;

type Carregada = { url: string; img: HTMLImageElement };

/**
 * Enquadramento da foto de perfil: a pessoa arrasta e dá zoom até a imagem ficar
 * como quer dentro do círculo, e o que ela vê é exatamente o que é salvo.
 *
 * Sem isso o recorte era decidido pelo servidor e só aparecia depois de salvar,
 * o que deixava quem estava fora do centro da foto sem saída além de tentar outra.
 */
export function AvatarCropper({
  file,
  onCancel,
  onConfirm,
  saving,
}: {
  file: File;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
  saving: boolean;
}) {
  const [foto, setFoto] = useState<Carregada | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [arrastando, setArrastando] = useState(false);
  const inicio = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const u = URL.createObjectURL(file);
    const el = new Image();
    // tudo dentro do onload: evita setState síncrono dentro do efeito
    el.onload = () => { setFoto({ url: u, img: el }); setZoom(1); setPos({ x: 0, y: 0 }); };
    el.src = u;
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // escala mínima para a foto cobrir o quadro inteiro, sem sobrar buraco
  const base = foto ? Math.max(VIEW / foto.img.naturalWidth, VIEW / foto.img.naturalHeight) : 1;
  const escala = base * zoom;
  const larg = foto ? foto.img.naturalWidth * escala : 0;
  const alt = foto ? foto.img.naturalHeight * escala : 0;

  /** prende a imagem nas bordas: nunca deixa aparecer fundo dentro do círculo */
  const limitar = (x: number, y: number) => ({
    x: Math.min(0, Math.max(VIEW - larg, x)),
    y: Math.min(0, Math.max(VIEW - alt, y)),
  });

  // limita no render, e não num efeito: ao aproximar, o enquadramento se ajusta
  // sozinho sem uma segunda passada de renderização
  const vis = limitar(pos.x, pos.y);

  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    inicio.current = { x: e.clientX, y: e.clientY, ox: vis.x, oy: vis.y };
    setArrastando(true);
  };
  const onMove = (e: React.PointerEvent) => {
    const a = inicio.current;
    if (!a) return;
    setPos(limitar(a.ox + (e.clientX - a.x), a.oy + (e.clientY - a.y)));
  };
  const onUp = () => { inicio.current = null; setArrastando(false); };

  const salvar = () => {
    if (!foto) return;
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // o quadro da tela tem VIEW px e a saída tem AVATAR_SIZE: mesma proporção
    const r = AVATAR_SIZE / VIEW;
    ctx.drawImage(foto.img, vis.x * r, vis.y * r, larg * r, alt * r);
    canvas.toBlob((b) => { if (b) onConfirm(b); }, "image/webp", 0.9);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.7)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 1rem", zIndex: 80, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 360, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: 0 }}>Enquadrar foto</h2>
          <button type="button" onClick={onCancel} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>

        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem", alignItems: "center" }}>
          <div
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            style={{
              width: VIEW, height: VIEW, borderRadius: "999px", overflow: "hidden",
              position: "relative", cursor: arrastando ? "grabbing" : "grab",
              border: "2px solid var(--mh-border)", background: "var(--mh-surface-2)",
              touchAction: "none", userSelect: "none",
            }}
          >
            {foto && (
              // eslint-disable-next-line @next/next/no-img-element -- imagem local em memória, não passa por otimização
              <img
                src={foto.url}
                alt=""
                draggable={false}
                style={{ position: "absolute", left: vis.x, top: vis.y, width: larg, height: alt, maxWidth: "none" }}
              />
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", width: "100%" }}>
            <ZoomIn size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            <input
              type="range" min={1} max={3} step={0.01} value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              aria-label="Aproximar"
              style={{ width: "100%" }}
            />
          </div>
          <span className="soft" style={{ fontSize: "0.76rem", textAlign: "center" }}>
            Arraste a foto e use a barra para aproximar. O círculo mostra como ela vai aparecer.
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={salvar} disabled={!foto || saving}>
            {saving ? "Salvando…" : "Salvar foto"}
          </button>
        </div>
      </div>
    </div>
  );
}
