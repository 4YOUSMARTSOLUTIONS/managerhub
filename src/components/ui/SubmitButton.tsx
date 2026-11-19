"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

export function SubmitButton({
  children,
  className = "btn btn-primary",
  pendingLabel = "Salvando…",
  travado = false,
}: {
  children: React.ReactNode;
  className?: string;
  pendingLabel?: string;
  /** continua "carregando" depois da action, enquanto a página seguinte abre */
  travado?: boolean;
}) {
  const { pending } = useFormStatus();
  const ocupado = pending || travado;
  return (
    <button type="submit" className={className} disabled={ocupado}>
      {ocupado && <Loader2 size={15} className="spin" aria-hidden />}
      {ocupado ? pendingLabel : children}
    </button>
  );
}
