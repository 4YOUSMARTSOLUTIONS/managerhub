"use client";

import { useActionState } from "react";
import Link from "next/link";
import { pedirRecuperacaoDeSenha } from "@/lib/actions/recuperacao";
import { initialActionState } from "@/lib/actions/types";
import { AuthShell } from "@/components/AuthShell";
import { SubmitButton } from "@/components/ui/SubmitButton";

/**
 * Pedido de recuperação de senha.
 *
 * Aceita e-mail OU CPF, igual ao login: quem entra pelo CPF muitas vezes não faz
 * ideia de qual e-mail está no cadastro dele.
 *
 * A resposta é a MESMA para todos os casos (conta existente, inexistente, sem
 * e-mail, desligada) — é o que impede a tela de virar um verificador de quem
 * trabalha na empresa. O aviso abaixo do campo existe por causa disso: como a
 * tela não pode dizer "você não tem e-mail cadastrado", ela diz para todo mundo,
 * o tempo todo, o que fazer nesse caso.
 */
export default function EsqueciSenhaPage() {
  const [state, action] = useActionState(pedirRecuperacaoDeSenha, initialActionState);

  return (
    <AuthShell
      title="Recuperar senha"
      subtitle="Enviamos um link de redefinição para o e-mail do seu cadastro."
      footer={<Link href="/login">Voltar para a tela de acesso</Link>}
    >
      {state.ok ? (
        <div>
          <p
            role="status"
            style={{
              margin: 0,
              padding: "0.85rem 1rem",
              borderRadius: "var(--mh-radius-sm)",
              background: "var(--mh-success-soft)",
              color: "var(--mh-success)",
              fontSize: "0.875rem",
              lineHeight: 1.55,
            }}
          >
            {state.message}
          </p>
          <p className="soft" style={{ fontSize: "0.8rem", margin: "1rem 0 0", lineHeight: 1.55 }}>
            Não chegou? Confira o spam. Se você não tem e-mail cadastrado, quem
            redefine a sua senha é o RH.
          </p>
        </div>
      ) : (
        <form action={action} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label className="label" htmlFor="identifier">E-mail ou CPF</label>
            <input
              id="identifier"
              name="identifier"
              type="text"
              className="input"
              required
              autoComplete="username"
              autoFocus
              placeholder="seu@email.com ou CPF"
            />
          </div>

          <p
            className="soft"
            style={{
              fontSize: "0.8rem",
              margin: 0,
              lineHeight: 1.55,
              padding: "0.7rem 0.85rem",
              borderRadius: "var(--mh-radius-sm)",
              background: "var(--mh-surface-2)",
            }}
          >
            <strong>Sem e-mail cadastrado, não dá para recuperar a senha por aqui.</strong>{" "}
            Se a mensagem não chegar em alguns minutos, procure o RH: ele redefine
            o seu acesso.
          </p>

          {state.error && (
            <p
              role="alert"
              style={{
                margin: 0,
                padding: "0.6rem 0.8rem",
                borderRadius: "var(--mh-radius-sm)",
                background: "var(--mh-danger-soft)",
                color: "var(--mh-danger)",
                fontSize: "0.85rem",
              }}
            >
              {state.error}
            </p>
          )}

          <SubmitButton className="btn btn-primary btn-block" pendingLabel="Enviando…">
            Enviar link de recuperação
          </SubmitButton>
        </form>
      )}
    </AuthShell>
  );
}
