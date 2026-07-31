"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Eye, EyeOff } from "lucide-react";
import { Section } from "@/components/ui/Section";
import { MODULE_GROUPS, SELLABLE_MODULES, modulesInGroup, type ModuleKey, type ModuleState } from "@/lib/modules";
import { setUnitModules, setTenantModules } from "@/lib/actions/platform-modules";
import { initialActionState } from "@/lib/actions/types";

export type UnitRow = { id: string; name: string };

const ALL_UNITS = "__all__";
/** state[unitId][moduleKey] */
export type Matrix = Record<string, Partial<Record<ModuleKey, ModuleState>>>;

const STATE_META: { key: ModuleState; label: string; hint: string; icon: React.ReactNode }[] = [
  { key: "on", label: "Liberado", hint: "A unidade usa o módulo normalmente.", icon: <Check size={13} /> },
  { key: "locked", label: "Vitrine", hint: "Aparece com cadeado e leva à tela de venda.", icon: <Eye size={13} /> },
  { key: "hidden", label: "Oculto", hint: "A unidade não vê que o módulo existe.", icon: <EyeOff size={13} /> },
];

/** value null = as unidades divergem entre si (nenhum botão fica aceso). */
function StatePicker({
  value,
  onPick,
  disabled,
}: {
  value: ModuleState | null;
  onPick: (s: ModuleState) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      {value === null && <span className="soft" style={{ fontSize: "0.75rem" }}>varia por unidade</span>}
      <div className="seg">
        {STATE_META.map((s) => (
          <button
            key={s.key}
            type="button"
            disabled={disabled}
            onClick={() => onPick(s.key)}
            className={`seg-btn${value === s.key ? ` seg-btn-on seg-${s.key}` : ""}`}
            title={s.hint}
            aria-pressed={value === s.key}
          >
            {s.icon}
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function UnitModulesEditor({
  tenantId,
  units,
  matrix: initial,
}: {
  tenantId: string;
  units: UnitRow[];
  matrix: Matrix;
}) {
  const [matrix, setMatrix] = useState<Matrix>(initial);
  const [pending, startTransition] = useTransition();

  /**
   * O estado local existe só para a atualização otimista. Sempre que o servidor
   * manda uma matriz diferente (troca de empresa, revalidate após salvar), ela é a
   * verdade e precisa vencer: sem isto, `useState` congela a matriz do primeiro
   * render e a tela mostra dados de outra empresa (ou desatualizados) até um F5.
   * Comparo por conteúdo, não por identidade, senão todo payload novo descartaria
   * o otimista à toa.
   */
  const serverSig = JSON.stringify(initial);
  const [syncedSig, setSyncedSig] = useState(serverSig);
  if (serverSig !== syncedSig) {
    setSyncedSig(serverSig);
    setMatrix(initial);
  }
  /** ALL_UNITS = agir na empresa inteira (o normal, já que a venda é por empresa). */
  const [unitId, setUnitId] = useState<string>(ALL_UNITS);
  const allUnits = unitId === ALL_UNITS;

  /** Com "todas", só acende o botão se as unidades concordarem; senão devolve null. */
  const stateOf = (k: ModuleKey): ModuleState | null => {
    if (!allUnits) return matrix[unitId]?.[k] ?? "hidden";
    const states = units.map((u) => matrix[u.id]?.[k] ?? "hidden");
    return states.every((s) => s === states[0]) ? states[0] : null;
  };

  const apply = (keys: ModuleKey[], state: ModuleState) => {
    // otimista: a matriz volta do servidor no revalidate
    setMatrix((m) => {
      const next = { ...m };
      const targets = allUnits ? units.map((u) => u.id) : [unitId];
      for (const u of targets) next[u] = { ...next[u], ...Object.fromEntries(keys.map((k) => [k, state])) };
      return next;
    });

    startTransition(async () => {
      const fd = new FormData();
      fd.set("modules", keys.join(","));
      fd.set("state", state);
      let res;
      if (allUnits) {
        fd.set("tenant_id", tenantId);
        res = await setTenantModules(initialActionState, fd);
      } else {
        fd.set("unit_id", unitId);
        res = await setUnitModules(initialActionState, fd);
      }
      if (res.error) toast.error(res.error);
      else toast.success(res.message ?? "Módulos atualizados.");
    });
  };

  if (!units.length) {
    return <p className="muted">Esta empresa ainda não tem unidades cadastradas.</p>;
  }

  const allKeys = SELLABLE_MODULES.map((m) => m.key);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
      <div style={{ display: "flex", gap: "0.8rem", alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ minWidth: 240 }}>
          <label className="label">Unidade</label>
          <select className="input" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value={ALL_UNITS}>Todas as unidades ({units.length})</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => apply(allKeys, "on")}>
            Liberar todos
          </button>
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => apply(allKeys, "hidden")}>
            Bloquear todos
          </button>
        </div>
      </div>

      {MODULE_GROUPS.map((g) => {
        const mods = modulesInGroup(g.key).filter((m) => !m.core);
        if (!mods.length) return null;
        const keys = mods.map((m) => m.key);
        return (
          <Section key={g.key} title={g.label} action={
            <div style={{ display: "flex", gap: "0.35rem" }}>
              {STATE_META.map((s) => (
                <button key={s.key} type="button" className="btn btn-ghost btn-sm" disabled={pending}
                  onClick={() => apply(keys, s.key)} title={`${s.label}: aplicar no grupo inteiro`}>
                  {s.label}
                </button>
              ))}
            </div>
          }>
            <div className="mod-rows">
              {mods.map((m) => (
                <div key={m.key} className="mod-row">
                  <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{m.label}</span>
                  <StatePicker value={stateOf(m.key)} disabled={pending} onPick={(s) => apply([m.key], s)} />
                </div>
              ))}
            </div>
          </Section>
        );
      })}

      {/* módulos de topo (sem grupo) */}
      {(() => {
        const loose = SELLABLE_MODULES.filter((m) => m.group === null);
        if (!loose.length) return null;
        return (
          <Section title="Módulos avulsos">
            <div className="mod-rows">
              {loose.map((m) => (
                <div key={m.key} className="mod-row">
                  <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{m.label}</span>
                  <StatePicker value={stateOf(m.key)} disabled={pending} onPick={(s) => apply([m.key], s)} />
                </div>
              ))}
            </div>
          </Section>
        );
      })()}
    </div>
  );
}
