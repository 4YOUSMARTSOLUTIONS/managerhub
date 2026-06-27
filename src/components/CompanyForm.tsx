"use client";

import { useActionState, useEffect, useState } from "react";
import { updateCompany } from "@/lib/actions/users";
import { initialActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/ui/SubmitButton";

export function CompanyForm({
  name,
  canEdit,
}: {
  name: string;
  canEdit: boolean;
}) {
  const [state, action] = useActionState(updateCompany, initialActionState);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (state.ok) {
      setSaved(true);
      const t = setTimeout(() => setSaved(false), 2500);
      return () => clearTimeout(t);
    }
  }, [state]);

  return (
    <form action={action} style={{ display: "flex", gap: "0.7rem", alignItems: "flex-end", flexWrap: "wrap" }}>
      <div style={{ width: 320, maxWidth: "100%" }}>
        <label className="label">Nome da empresa</label>
        <input name="name" className="input" defaultValue={name} required disabled={!canEdit} />
      </div>
      {canEdit ? (
        <>
          <SubmitButton>Salvar</SubmitButton>
          {saved && <span className="badge badge-green" style={{ marginBottom: 6 }}>Salvo</span>}
          {state.error && <span className="badge badge-red" style={{ marginBottom: 6 }}>{state.error}</span>}
        </>
      ) : (
        <span className="soft" style={{ fontSize: "0.8rem", marginBottom: 8 }}>
          Apenas o proprietário pode editar os dados da empresa.
        </span>
      )}
    </form>
  );
}
