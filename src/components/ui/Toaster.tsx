"use client";

import { Toaster as Sonner } from "sonner";
import type { Theme } from "@/lib/theme";

/** Toaster global, pintado com os tokens do design system. */
export function Toaster({ theme }: { theme: Theme }) {
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      closeButton
      toastOptions={{
        style: {
          background: "var(--mh-surface-1)",
          border: "1px solid var(--mh-border)",
          color: "var(--mh-text-1)",
          borderRadius: "var(--mh-radius-md)",
          boxShadow: "var(--mh-shadow-e2)",
          fontFamily: "var(--mh-font-sans)",
        },
      }}
    />
  );
}
