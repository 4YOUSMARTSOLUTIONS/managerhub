"use client";

import Link from "next/link";
import { NavPending } from "@/components/ui/NavPending";

/**
 * Abas de topo que são NAVEGAÇÃO (`?aba=...`), e não troca local de conteúdo.
 *
 * A primitiva `Tabs` recebe o conteúdo de todas as abas de uma vez: bom quando
 * elas são leves, porque trocar é instantâneo. Em Configurações isso custava
 * 55 consultas e 2,6 MB a cada visita para mostrar uma aba só (LUIZ,
 * 18/11/2026). Aqui cada aba é um link, o servidor monta só a aberta, e a
 * volta a uma aba recém-vista sai do cache do navegador (staleTimes).
 *
 * Mesmo padrão do Painel ADM (`AdminTabs`): a barra do topo (NavPending) é o
 * retorno do clique enquanto a aba nova chega; a anterior fica de pé até lá.
 */
export function AbasPorLink({
  abas,
  ativa,
  children,
}: {
  abas: { id: string; label: string }[];
  ativa: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="tabbar">
        {abas.map((t) => {
          const atual = t.id === ativa;
          return (
            <Link
              key={t.id}
              href={`?aba=${t.id}`}
              scroll={false}
              className={`tab${atual ? " tab-active" : ""}`}
              aria-current={atual ? "page" : undefined}
            >
              {t.label}
              <NavPending barraNoTopo />
            </Link>
          );
        })}
      </div>
      <div>{children}</div>
    </div>
  );
}
