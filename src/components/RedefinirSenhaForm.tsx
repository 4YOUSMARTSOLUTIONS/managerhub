"use client";

import { useActionState } from "react";
import Link from "next/link";
import { redefinirSenhaComToken } from "@/lib/actions/recuperacao";
import { initialActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { PasswordInput } from "@/components/ui/PasswordInput";

/**
 * A escolha da senha nova, no fim do link de recuperação.
 *
 * O token viaja num campo oculto e só é gasto no ENVIO — nunca ao abrir a
 * página. É o que torna inofensiva a varredura de link que os filtros de e-mail
 * corporativo fazem: eles abrem o endereço, não enviam o formulário.
 *
 * Não há campo de senha atual, e é justamente esse o ponto do fluxo: quem chegou
 * aqui provou posse do e-mail do cadastro, que é a credencial deste caminho.
 */
export function RedefinirSenhaForm({ token }: { token: string }) {
  const [state, action] = useActionState(redefinirSenhaComToken, initialActionState);

  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <input type="hidden" name="token" value={token} />

      <div>
        <label className="label" htmlFor="new_password">Nova senha</label>
        <PasswordInput
          id="new_password"
          name="new_password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="Mínimo 8 caracteres"
        />
        <p className="soft" style={{ fontSize: "0.75rem", margin: "0.35rem 0 0" }}>
          Mínimo de 8 caracteres. Escolha uma senha que só você conheça.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="confirm_password">Confirme a nova senha</label>
        <PasswordInput
          id="confirm_password"
          name="confirm_password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="Repita a senha"
        />
      </div>

      {state.error && (
        <div
          role="alert"
          style={{
            padding: "0.6rem 0.8rem",
            borderRadius: "var(--mh-radius-sm)",
            background: "var(--mh-danger-soft)",
            color: "var(--mh-danger)",
            fontSize: "0.85rem",
          }}
        >
          {state.error}{" "}
          <Link href="/esqueci-senha" style={{ color: "inherit", textDecoration: "underline" }}>
            Pedir um novo link
          </Link>
        </div>
      )}

      <SubmitButton className="btn btn-primary btn-block" pendingLabel="Salvando…">
        Salvar e entrar
      </SubmitButton>
    </form>
  );
}
