"use client";

import { useActionState } from "react";
import { signIn } from "@/lib/actions/auth";
import { initialActionState } from "@/lib/actions/types";
import { AuthShell } from "@/components/AuthShell";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { PasswordInput } from "@/components/ui/PasswordInput";

export default function LoginPage() {
  const [state, action] = useActionState(signIn, initialActionState);

  return (
    <AuthShell
      title="Entrar"
      subtitle="Acesse o portal de gestão da sua empresa."
    >
      <form action={action} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div>
          <label className="label" htmlFor="identifier">E-mail ou CPF</label>
          <input id="identifier" name="identifier" type="text" className="input" required autoComplete="username" placeholder="seu@email.com ou CPF" />
        </div>
        <div>
          <label className="label" htmlFor="password">Senha</label>
          <PasswordInput />
        </div>
        {state.error && (
          <p style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0 }}>{state.error}</p>
        )}
        <SubmitButton className="btn btn-primary" >Entrar</SubmitButton>
      </form>
    </AuthShell>
  );
}
