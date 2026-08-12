"use client";

import { useActionState } from "react";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { trocarSenhaObrigatoria } from "@/lib/actions/profile";
import { initialActionState } from "@/lib/actions/types";

/**
 * Formulário da troca obrigatória, no molde do bloco de senha do perfil.
 *
 * A senha atual continua sendo pedida: assim a troca passa pela mesma action de
 * sempre, sem abrir no sistema um caminho que altere senha só com o cookie. Não
 * há tratamento de sucesso porque não existe: a action redireciona para o
 * sistema com a sessão já renovada.
 */
export function TrocaObrigatoriaForm() {
  const [state, formAction] = useActionState(trocarSenhaObrigatoria, initialActionState);

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
      <div>
        <label className="label" htmlFor="current_password">Senha atual (a que você usou para entrar)</label>
        <PasswordInput id="current_password" name="current_password" autoComplete="current-password" />
      </div>
      <div>
        <label className="label" htmlFor="new_password">Nova senha</label>
        <PasswordInput id="new_password" name="new_password" autoComplete="new-password" minLength={8} />
        <p className="soft" style={{ fontSize: "0.75rem", margin: "0.35rem 0 0" }}>
          Mínimo de 8 caracteres. Escolha uma senha que só você conheça.
        </p>
      </div>
      <div>
        <label className="label" htmlFor="confirm_password">Repita a nova senha</label>
        <PasswordInput id="confirm_password" name="confirm_password" autoComplete="new-password" minLength={8} />
      </div>
      {state.error && (
        <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
          {state.error}
        </p>
      )}
      <SubmitButton className="btn btn-primary" pendingLabel="Salvando…">
        Salvar e entrar
      </SubmitButton>
    </form>
  );
}
