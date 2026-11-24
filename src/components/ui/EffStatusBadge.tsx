import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { EFF_STATUS_LABEL, EFF_STATUS_TONE, type EffStatus } from "@/lib/constants";

/**
 * Selo de status efetivo da ação/demanda.
 * Quando está "Aguardando aprovação" e o prazo já venceu, mantém o selo principal
 * e acrescenta um marcador discreto de atraso ao lado (o status de atraso ficaria
 * oculto porque "aguardando" tem precedência no cálculo do status efetivo).
 *
 * `compacto` (tabela): o marcador vira só o relógio, porque a coluna Prazo ao lado
 * já fica vermelha e a segunda pílula empurrava a linha para fora da tela.
 */
export function EffStatusBadge({ eff, overdue = false, compacto = false }: { eff: EffStatus; overdue?: boolean; compacto?: boolean }) {
  const showOverdue = eff === "aguardando" && overdue;
  return (
    <span style={{ display: "inline-flex", gap: "0.3rem", alignItems: "center", whiteSpace: "nowrap" }}>
      <Badge tone={EFF_STATUS_TONE[eff]}>{EFF_STATUS_LABEL[eff]}</Badge>
      {showOverdue && compacto && (
        <span role="img" aria-label="Atrasada" title="O prazo venceu enquanto aguarda aprovação" style={{ display: "inline-flex", color: "var(--mh-danger)" }}>
          <Clock size={13} />
        </span>
      )}
      {showOverdue && !compacto && (
        <span
          className="badge badge-red"
          title="O prazo venceu enquanto aguarda aprovação"
          style={{ fontSize: "0.62rem", padding: "0.05rem 0.35rem", display: "inline-flex", alignItems: "center", gap: "0.2rem" }}
        >
          <Clock size={11} /> Atrasada
        </span>
      )}
    </span>
  );
}
