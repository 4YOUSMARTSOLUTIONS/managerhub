"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "./ConfirmDialog";
import type { ActionState } from "@/lib/actions/types";

/**
 * Botão que confirma e executa uma server action que retorna ActionState,
 * exibindo o erro (em vez de "sucesso" silencioso) e dando refresh no sucesso.
 * Reutilizável para excluir/cancelar (texto ou ícone via children).
 */
export function ConfirmActionButton({
  action,
  fields,
  children,
  className = "btn btn-danger btn-sm",
  buttonTitle,
  title,
  message,
  confirmLabel = "Excluir",
  cancelLabel = "Cancelar",
  tone = "danger",
}: {
  action: (fd: FormData) => Promise<ActionState>;
  fields: Record<string, string>;
  children: React.ReactNode;
  className?: string;
  buttonTitle?: string;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
}) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const run = () => {
    start(async () => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      const res = await action(fd);
      if (res?.error) setErr(res.error);
      else { setOpen(false); setErr(""); router.refresh(); }
    });
  };

  return (
    <>
      <button type="button" className={className} title={buttonTitle} onClick={() => { setErr(""); setOpen(true); }}>
        {children}
      </button>
      <ConfirmDialog
        open={open}
        title={title}
        message={err ? <span style={{ color: "#dc2626" }}>{err}</span> : message}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        tone={tone}
        pending={pending}
        onConfirm={run}
        onClose={() => { setOpen(false); setErr(""); }}
      />
    </>
  );
}
