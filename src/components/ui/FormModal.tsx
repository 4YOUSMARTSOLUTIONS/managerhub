"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SubmitButton } from "./SubmitButton";
import { initialActionState, type ActionState } from "@/lib/actions/types";

type Action = (
  prevState: ActionState,
  formData: FormData,
) => Promise<ActionState>;

export function FormModal({
  triggerLabel,
  triggerClassName = "btn btn-primary",
  title,
  action,
  submitLabel = "Salvar",
  children,
  width = 520,
}: {
  triggerLabel: React.ReactNode;
  triggerClassName?: string;
  title: string;
  action: Action;
  submitLabel?: string;
  children: React.ReactNode;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, initialActionState);
  const router = useRouter();
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) wasOpen.current = true;
  }, [open]);

  useEffect(() => {
    if (state.ok && wasOpen.current) {
      setOpen(false);
      wasOpen.current = false;
      router.refresh();
    }
  }, [state, router]);

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(17,24,39,0.45)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "5vh 1rem",
            zIndex: 50,
            overflowY: "auto",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{ width: "100%", maxWidth: width, boxShadow: "var(--shadow)" }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "1rem 1.25rem",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>
                {title}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="muted"
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "1.3rem",
                  cursor: "pointer",
                  lineHeight: 1,
                }}
                aria-label="Fechar"
              >
                ×
              </button>
            </div>

            <form action={formAction}>
              <div
                style={{
                  padding: "1.25rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "1rem",
                }}
              >
                {children}
                {state.error && (
                  <p
                    style={{
                      color: "#dc2626",
                      fontSize: "0.85rem",
                      margin: 0,
                      background: "#fef2f2",
                      padding: "0.5rem 0.7rem",
                      borderRadius: 8,
                    }}
                  >
                    {state.error}
                  </p>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "0.6rem",
                  padding: "1rem 1.25rem",
                  borderTop: "1px solid var(--border)",
                }}
              >
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setOpen(false)}
                >
                  Cancelar
                </button>
                <SubmitButton>{submitLabel}</SubmitButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
