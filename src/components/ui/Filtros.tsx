"use client";

import React from "react";
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

/**
 * Painel dos filtros: os campos ficam lado a lado, do tamanho de um campo, e
 * param onde acabam.
 *
 * A primeira versão usava uma grade de colunas iguais (`1fr`), e com três
 * filtros cada um esticava até um terço da tela. Campo de escolher setor com
 * meio metro de largura não fica melhor, fica só maior. Aqui cada um tem largura
 * de campo e o que sobra continua sobrando, à direita.
 *
 * O envelope de largura fica AQUI, e não em cada chamador: assim as telas
 * continuam passando `<div><label/><select/></div>` e todos os painéis do
 * sistema saem do mesmo tamanho.
 */
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
        padding: "0.75rem 0.9rem",
        marginBottom: "1.1rem",
        // o cartão termina onde os filtros terminam: uma faixa vazia atravessando
        // a tela para segurar três campinhos é o que estava pesando na vista
        width: "fit-content",
        maxWidth: "100%",
        display: "flex",
        flexWrap: "wrap",
        gap: "0.75rem",
        alignItems: "flex-end",
      }}
    >
      {React.Children.map(children, (filho) =>
        // sem encolher: com `flex-shrink`, o `fit-content` do cartão media pelo
        // tamanho mínimo dos campos e quebrava a linha antes da hora
        filho == null ? null : <div style={{ flex: "0 0 210px", maxWidth: "100%" }}>{filho}</div>,
      )}
      {contador > 0 && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onLimpar}
          style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
        >
          <X size={14} />
          Limpar filtros
        </button>
      )}
    </div>
  );
}
