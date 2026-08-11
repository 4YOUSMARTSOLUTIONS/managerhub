"use client";

import { useEffect, useState } from "react";
import { getMovementHistory, type MovementHistoryItem } from "@/lib/actions/employees";
import { formatDate } from "@/lib/format";
import { USER_TYPE } from "@/lib/constants";

const perfilLabel = (p: string) =>
  p === "owner" ? "Proprietário" : USER_TYPE[p as keyof typeof USER_TYPE] ?? p;

/** valor de célula com destaque quando mudou em relação à vigência anterior */
function Cel({ mudou, children }: { mudou: boolean; children: React.ReactNode }) {
  return (
    <td className="muted" style={mudou ? { color: "var(--text)", fontWeight: 600 } : undefined}>
      {children ?? "—"}
    </td>
  );
}

/**
 * Linha do tempo de movimentações do vínculo, uma linha por vigência.
 *
 * O que MUDOU em relação à vigência anterior aparece em destaque, para a tabela
 * contar a história sem obrigar ninguém a comparar célula por célula. A vigência
 * `backfill` é o retrato do cadastro quando o histórico passou a ser registrado,
 * não uma movimentação.
 */
export function MovementTimeline({ userId }: { userId: string }) {
  const [items, setItems] = useState<MovementHistoryItem[] | null>(null);

  useEffect(() => {
    let vivo = true;
    getMovementHistory(userId).then((r) => { if (vivo) setItems(r); });
    return () => { vivo = false; };
  }, [userId]);

  if (items === null) return <div className="soft" style={{ fontSize: "0.85rem" }}>Carregando…</div>;
  if (items.length === 0) {
    return <div className="soft" style={{ fontSize: "0.85rem" }}>Sem histórico disponível.</div>;
  }
  if (items.length === 1) {
    return (
      <div className="soft" style={{ fontSize: "0.85rem" }}>
        Sem movimentações desde {formatDate(items[0].effective_from.slice(0, 10))}.
      </div>
    );
  }

  // lista vem da mais recente para a mais antiga: a "anterior" de i é i+1
  const anterior = (i: number): MovementHistoryItem | null => items[i + 1] ?? null;
  const dif = (i: number, pega: (x: MovementHistoryItem) => string | null) => {
    const a = anterior(i);
    return a !== null && pega(a) !== pega(items[i]);
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="table">
        <thead>
          <tr>
            <th>Período</th>
            <th>Setor</th>
            <th>Subsetor</th>
            <th>Função</th>
            <th>Hierarquia</th>
            <th>Gestor</th>
            <th>Unidades</th>
            <th>Matrícula</th>
            <th>Perfil</th>
            <th>Situação</th>
          </tr>
        </thead>
        <tbody>
          {items.map((h, i) => (
            <tr key={`${h.effective_from}-${i}`}>
              <td className="muted" style={{ whiteSpace: "nowrap" }}>
                {formatDate(h.effective_from.slice(0, 10))}
                {" a "}
                {h.effective_to ? formatDate(h.effective_to.slice(0, 10)) : "atual"}
                {h.source === "backfill" && (
                  <div className="soft" style={{ fontSize: "0.72rem" }}>Cadastro inicial</div>
                )}
              </td>
              <Cel mudou={dif(i, (x) => x.setor)}>{h.setor}</Cel>
              <Cel mudou={dif(i, (x) => x.subsetor)}>{h.subsetor}</Cel>
              <Cel mudou={dif(i, (x) => (x.funcao ?? "") + "|" + (x.nivel ?? ""))}>
                {h.funcao}{h.nivel ? ` · ${h.nivel}` : ""}
              </Cel>
              <Cel mudou={dif(i, (x) => x.hierarquia)}>{h.hierarquia}</Cel>
              <Cel mudou={dif(i, (x) => x.gestor)}>{h.gestor}</Cel>
              <Cel mudou={dif(i, (x) => x.unidades.join(", "))}>
                {h.unidades.length > 0 ? h.unidades.join(", ") : null}
              </Cel>
              <Cel mudou={dif(i, (x) => x.employee_code)}>{h.employee_code}</Cel>
              <Cel mudou={dif(i, (x) => x.perfil)}>{perfilLabel(h.perfil)}</Cel>
              <Cel mudou={dif(i, (x) => String(x.is_active) + (x.dismissed_at ?? ""))}>
                {h.is_active ? "Ativo" : `Inativo${h.dismissed_at ? ` desde ${formatDate(h.dismissed_at)}` : ""}`}
              </Cel>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
