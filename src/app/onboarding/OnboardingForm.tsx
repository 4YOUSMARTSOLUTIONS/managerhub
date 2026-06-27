"use client";

import { useActionState } from "react";
import { createTenant } from "@/lib/actions/onboarding";
import { initialActionState } from "@/lib/actions/types";
import { AuthShell } from "@/components/AuthShell";
import { SubmitButton } from "@/components/ui/SubmitButton";

export function OnboardingForm() {
  const [state, action] = useActionState(createTenant, initialActionState);

  return (
    <AuthShell
      title="Criar sua empresa"
      subtitle="Esse será o espaço de trabalho do seu time no MANAGERHUB."
    >
      <form action={action} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div>
          <label className="label" htmlFor="name">Nome da empresa</label>
          <input id="name" name="name" type="text" className="input" required autoFocus placeholder="Ex.: Minha Empresa Ltda" />
        </div>
        {state.error && (
          <p style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0 }}>{state.error}</p>
        )}
        <SubmitButton className="btn btn-primary">Criar e continuar</SubmitButton>
      </form>
    </AuthShell>
  );
}
