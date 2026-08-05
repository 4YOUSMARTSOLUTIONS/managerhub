"use client";

import { Filter, X } from "lucide-react";

/**
 * Filtros num painel que abre ABAIXO da barra, ocupando a largura toda.
 *
 * A primeira tentativa foi pôr os filtros dentro do mesmo dropdown do menu de
 * ações. Ficou ruim: um painel estreito empilha os campos numa coluna, e com
 * quatro filtros a pessoa rola dentro de uma caixinha para achar o que quer.
 * Aqui eles aparecem lado a lado, todos de uma vez, e o resto da tela desce.
 *
 * O painel é irmão da barra, não filho do botão: dentro do botão ele herdaria
 * `position: relative` e viraria de novo uma caixa flutuante estreita.
 */
export function BotaoFiltros({
  aberto,
  onToggle,
  contador = 0,
}: {
  aberto: boolean;
  onToggle: () => void;
  /** quantos filtros estão ativos. Sem o selo, filtro fechado vira filtro esquecido. */
  contador?: number;
}) {
  return (
    <button
      type="button"
      className={`btn ${aberto || contador > 0 ? "btn-secondary" : "btn-ghost"}`}
      aria-expanded={aberto}
      onClick={onToggle}
      style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem" }}
    >
      <Filter size={15} />
      Filtros
      {contador > 0 && (
        <span
          aria-label={`${contador} filtro(s) ativo(s)`}
          style={{
            minWidth: 18, height: 18, padding: "0 5px",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            borderRadius: 999, fontSize: "0.7rem", fontWeight: 700, lineHeight: 1,
            background: "var(--mh-primary-500)", color: "#fff",
          }}
        >
          {contador}
        </span>
      )}
    </button>
  );
}

/** Painel dos filtros: grade que se acomoda à largura disponível. */
export function PainelDeFiltros({
  children,
  contador = 0,
  onLimpar,
}: {
  children: React.ReactNode;
  contador?: number;
  onLimpar: () => void;
}) {
  return (
    <div
      className="card"
      style={{
        padding: "0.9rem 1rem",
        marginBottom: "1.1rem",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
        gap: "0.8rem",
        alignItems: "end",
      }}
    >
      {children}
      {contador > 0 && (
        <div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onLimpar}
            style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
          >
            <X size={14} />
            Limpar filtros
          </button>
        </div>
      )}
    </div>
  );
}
