"use client";

import { useActionState, useEffect, useState } from "react";
import { setResendSettings } from "@/lib/actions/ai";
import { initialActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/ui/SubmitButton";

export function ResendSettingsForm({ hasKey, canEdit }: { hasKey: boolean; canEdit: boolean }) {
  const [state, action] = useActionState(setResendSettings, initialActionState);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    if (state.ok) {
      setSaved(state.message ?? "Salvo");
      const t = setTimeout(() => setSaved(""), 2500);
      return () => clearTimeout(t);
    }
  }, [state]);

  if (!canEdit) {
    return (
      <div className="soft" style={{ fontSize: "0.85rem" }}>
        {hasKey ? "✓ Chave do Resend configurada. " : "Envio de convites por e-mail não configurado. "}
        Apenas o proprietário pode configurar a chave do Resend.
      </div>
    );
  }

  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: "0.8rem", maxWidth: 460 }}>
      <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>
        Usada para enviar convites de reunião (.ics) por e-mail ao agendar salas. A chave fica guardada de forma
        isolada e nunca é exibida novamente — só é usada no servidor. Os convites são enviados por
        <strong> noreply@4yousmartsolutions.com.br</strong>.
      </p>

      <div>
        <label className="label">
          Chave da API Resend{" "}
          <span className={`badge ${hasKey ? "badge-green" : "badge-gray"}`} style={{ marginLeft: 6 }}>
            {hasKey ? "✓ Configurada" : "Não configurada"}
          </span>
        </label>
        <input
          name="resend_api_key"
          type="password"
          className="input"
          placeholder={hasKey ? "•••••••• (deixe em branco para manter)" : "re_…"}
          autoComplete="off"
        />
      </div>

      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <SubmitButton>Salvar</SubmitButton>
        {hasKey && (
          <button type="submit" name="clear" value="1" className="btn btn-ghost" formNoValidate>
            Remover chave
          </button>
        )}
        {saved && <span className="badge badge-green">{saved}</span>}
        {state.error && <span className="badge badge-red">{state.error}</span>}
      </div>
    </form>
  );
}
