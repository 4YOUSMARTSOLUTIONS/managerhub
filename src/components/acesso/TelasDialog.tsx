"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DetailModal } from "@/components/ui/DetailModal";
import type { GrupoDeTelas } from "@/lib/acesso-telas";
import type { ActionState } from "@/lib/actions/types";

export type ModoAcesso = "nivel" | "livre" | "lista";

export type OpcaoDeModo = { id: ModoAcesso; rotulo: string; ajuda?: string };

/**
 * Escolha de telas: um modo (seguir o nível, todas, só as marcadas) e, no modo
 * "lista", as caixas por grupo do menu. Serve ao nível e à pessoa.
 *
 * Fecha só por Cancelar ou X (nunca por clique fora), como todo formulário.
 * Vai para o body por portal: aberto de dentro da ficha do colaborador, não
 * pode ficar preso no formulário dela nem atrás da camada dela.
 */
export function TelasDialog({
  titulo,
  subtitulo,
  modos,
  modoInicial,
  telasIniciais,
  opcoes,
  topo,
  podeSalvar = true,
  zIndex,
  onClose,
  onSalvar,
}: {
  titulo: string;
  subtitulo?: React.ReactNode;
  modos: OpcaoDeModo[];
  modoInicial: ModoAcesso;
  telasIniciais: string[];
  opcoes: GrupoDeTelas[];
  /** algo acima dos modos (ex.: a escolha da pessoa) */
  topo?: React.ReactNode;
  podeSalvar?: boolean;
  zIndex?: number;
  onClose: () => void;
  onSalvar: (modo: ModoAcesso, telas: string[]) => Promise<ActionState>;
}) {
  const [modo, setModo] = useState<ModoAcesso>(modoInicial);
  const [marcadas, setMarcadas] = useState<Set<string>>(() => new Set(telasIniciais));
  const [salvando, iniciar] = useTransition();
  const router = useRouter();

  const alternar = (k: string) => setMarcadas((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const alternarGrupo = (g: GrupoDeTelas, ligar: boolean) => setMarcadas((s) => {
    const n = new Set(s);
    for (const t of g.telas) { if (ligar) n.add(t.key); else n.delete(t.key); }
    return n;
  });

  const salvar = () => {
    if (modo === "lista" && marcadas.size === 0) { toast.error("Escolha ao menos uma tela."); return; }
    iniciar(async () => {
      const r = await onSalvar(modo, [...marcadas]);
      if (r.error) { toast.error(r.error); return; }
      toast.success(r.message ?? "Acesso salvo.");
      onClose();
      router.refresh();
    });
  };

  const conteudo = (
    <DetailModal
      open
      onClose={onClose}
      title={titulo}
      width="md"
      zIndex={zIndex}
      footer={
        <>
          <span className="soft" style={{ fontSize: "0.78rem" }}>
            {modo === "lista" ? `${marcadas.size} tela(s) marcada(s)` : ""}
          </span>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={salvando}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={salvar} disabled={salvando || !podeSalvar}>
              {salvando ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </>
      }
    >
      {subtitulo && <p className="muted" style={{ fontSize: "0.85rem", margin: 0, lineHeight: 1.5 }}>{subtitulo}</p>}
      {topo}
      <div role="radiogroup" aria-label="Acesso" style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
        {modos.map((m) => (
          <label key={m.id} style={{ display: "flex", gap: "0.55rem", alignItems: "flex-start", cursor: "pointer", fontSize: "0.875rem" }}>
            <input type="radio" name="modo-acesso" checked={modo === m.id} onChange={() => setModo(m.id)} style={{ marginTop: 3 }} />
            <span>
              <strong>{m.rotulo}</strong>
              {m.ajuda && <span className="soft" style={{ display: "block", fontSize: "0.78rem" }}>{m.ajuda}</span>}
            </span>
          </label>
        ))}
      </div>

      {modo === "lista" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem", borderTop: "1px solid var(--border)", paddingTop: "0.9rem" }}>
          {opcoes.map((g, i) => {
            const todas = g.telas.every((t) => marcadas.has(t.key));
            return (
              <div key={g.grupo ?? `soltas-${i}`}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem" }}>
                  <span style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--mh-text-3)" }}>
                    {g.grupo ?? "Telas"}
                  </span>
                  {g.telas.length > 1 && (
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => alternarGrupo(g, !todas)}>
                      {todas ? "Desmarcar todas" : "Marcar todas"}
                    </button>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "0.3rem 0.8rem" }}>
                  {g.telas.map((t) => (
                    <label key={t.key} style={{ display: "flex", gap: "0.45rem", alignItems: "center", fontSize: "0.85rem", cursor: "pointer" }}>
                      <input type="checkbox" checked={marcadas.has(t.key)} onChange={() => alternar(t.key)} />
                      {t.label}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </DetailModal>
  );

  return typeof document === "undefined" ? null : createPortal(conteudo, document.body);
}
