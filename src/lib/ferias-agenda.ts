"use client";

/**
 * Base comum do calendário, do acompanhamento e da programação de férias:
 * o formato de `ferias_agenda`, a cor de cada setor e o hook que busca um
 * período sob demanda.
 */

import { useEffect, useState } from "react";
import { getAgendaFerias } from "@/lib/actions/ferias";

export type StatusAgenda = "solicitada" | "aprovada" | "efetivada";

export type AgendaItem = {
  chave: string;
  userId: string;
  nome: string | null;
  matricula: string | null;
  ativo: boolean;
  setorId: string | null;
  setor: string | null;
  subsetor: string | null;
  cargo: string | null;
  unidade: string | null;
  status: StatusAgenda;
  /** "modulo" (passou pelo fluxo) ou "registro" (registro direto/histórico) */
  origem: "modulo" | "registro";
  inicio: string;
  fim: string;
  dias: number;
  abono: number;
  emDobro: boolean;
  reagendamento: boolean;
};

export const STATUS_AGENDA: StatusAgenda[] = ["efetivada", "aprovada", "solicitada"];

/** rótulo curto para filtros e legendas (o da tabela vem de FERIAS_STATUS) */
export const STATUS_AGENDA_CURTO: Record<StatusAgenda, string> = {
  efetivada: "Efetivadas",
  aprovada: "Aprovadas",
  solicitada: "Solicitadas",
};

export const COR_SEM_SETOR = "var(--mh-text-3)";

/**
 * Cor de cada setor: a posição dele no cadastro em ordem alfabética, e não na
 * lista do mês. Assim um filtro, ou um mês com menos setores, nunca troca a cor
 * de quem continua na tela. Passou de oito setores, o resto fica cinza.
 */
export function coresDosSetores(setores: { id: string; name: string }[]): Map<string, string> {
  const ordem = [...setores].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return new Map(ordem.map((s, i) => [s.id, i < 8 ? `var(--mh-cat-${i + 1})` : COR_SEM_SETOR]));
}

export const corDe = (cores: Map<string, string>, setorId: string | null) =>
  (setorId && cores.get(setorId)) || COR_SEM_SETOR;

/** dias do item que caem dentro de [de, ate] */
export function diasNoPeriodo(i: { inicio: string; fim: string }, de: string, ate: string): number {
  const a = i.inicio > de ? i.inicio : de;
  const b = i.fim < ate ? i.fim : ate;
  if (b < a) return 0;
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000) + 1;
}

/**
 * Busca as férias de um período. O estado guarda a chave do pedido: enquanto a
 * resposta da chave atual não chega, `carregando` é verdadeiro, e uma resposta
 * velha (de um mês que a pessoa já deixou para trás) nunca aparece na tela.
 */
export function useAgendaFerias(inicio: string, fim: string, unidades: string[] | null) {
  const chave = `${inicio}|${fim}|${(unidades ?? []).join(",")}|${unidades ? 1 : 0}`;
  const [estado, setEstado] = useState<{ chave: string; itens: AgendaItem[]; erro: string } | null>(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let vivo = true;
    const [de, ate, uns, temFiltro] = chave.split("|");
    getAgendaFerias({ inicio: de, fim: ate, unidades: temFiltro === "1" ? uns.split(",").filter(Boolean) : null })
      .then((r) => {
        if (!vivo) return;
        setEstado(r.error !== undefined
          ? { chave, itens: [], erro: r.error }
          : { chave, itens: r.itens, erro: "" });
      });
    return () => { vivo = false; };
  }, [chave, versao]);

  const atual = estado?.chave === chave ? estado : null;
  return {
    itens: atual?.itens ?? [],
    erro: atual?.erro ?? "",
    carregando: !atual,
    recarregar: () => setVersao((v) => v + 1),
  };
}
