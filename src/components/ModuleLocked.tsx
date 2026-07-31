"use client";

import { useActionState } from "react";
import { Lock } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { registerInterest } from "@/lib/actions/modules";
import { initialActionState } from "@/lib/actions/types";

/** Tela de módulo não contratado (vitrine), com registro de interesse. */
export function ModuleLocked({
  moduleKey,
  moduleLabel,
  unitIds,
}: {
  moduleKey: string;
  moduleLabel: string;
  unitIds: string[];
}) {
  const [state, action] = useActionState(registerInterest, initialActionState);

  return (
    <div className="card">
      <EmptyState
        badge="Não contratado"
        icon={<Lock size={24} />}
        title={`${moduleLabel} não faz parte do seu plano`}
        description="Este módulo está disponível e pode ser habilitado para a sua unidade. Registre seu interesse que a nossa equipe entrará em contato."
        action={
          state.ok ? (
            <p className="muted" style={{ margin: 0, fontSize: "0.88rem" }}>
              ✓ Interesse registrado. Obrigado!
            </p>
          ) : (
            <form action={action}>
              <input type="hidden" name="module_key" value={moduleKey} />
              <input type="hidden" name="unit_ids" value={unitIds.join(",")} />
              <SubmitButton pendingLabel="Registrando…">Tenho interesse</SubmitButton>
            </form>
          )
        }
      />
      {state.error && (
        <p style={{ color: "var(--mh-danger)", fontSize: "0.82rem", textAlign: "center", paddingBottom: "1.2rem", margin: 0 }}>
          {state.error}
        </p>
      )}
    </div>
  );
}
