"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Construction, Check } from "lucide-react";
import { setModuleConstruction } from "@/lib/actions/platform-modules";
import { initialActionState } from "@/lib/actions/types";
import type { ModuleKey } from "@/lib/modules";

export function ConstructionToggle({
  moduleKey,
  moduleLabel,
  under: initial,
}: {
  moduleKey: ModuleKey;
  moduleLabel: string;
  under: boolean;
}) {
  const [under, setUnder] = useState(initial);
  const [pending, startTransition] = useTransition();

  const set = (next: boolean) => {
    if (next === under) return;
    setUnder(next);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("modules", moduleKey);
      fd.set("under", String(next));
      const res = await setModuleConstruction(initialActionState, fd);
      if (res.error) {
        setUnder(!next); // desfaz o otimista
        toast.error(res.error);
      } else {
        toast.success(next ? `${moduleLabel}: em construção.` : `${moduleLabel}: liberado.`);
      }
    });
  };

  return (
    <div className="seg">
      <button type="button" disabled={pending} onClick={() => set(false)} aria-pressed={!under}
        className={`seg-btn${!under ? " seg-btn-on seg-on" : ""}`} title="A página funciona normalmente.">
        <Check size={13} />
        Normal
      </button>
      <button type="button" disabled={pending} onClick={() => set(true)} aria-pressed={under}
        className={`seg-btn${under ? " seg-btn-on seg-locked" : ""}`} title="A página mostra só o aviso de em construção.">
        <Construction size={13} />
        Em construção
      </button>
    </div>
  );
}
