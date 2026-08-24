"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge";
import { setNivelSolicitaFerias } from "@/lib/actions/ferias";

/**
 * Quem solicita as próprias férias, por nível de hierarquia.
 *
 * Nível marcado como "programado pelo gestor" não vê o botão de solicitar no
 * módulo Férias: a previsão dele é lançada pelo gestor (o caso do operacional).
 * A lista chega ordenada por `rank`, que é a ordem real da hierarquia.
 */
export function FeriasConfigManager({
  niveis, bloqueados, canEdit,
}: {
  niveis: { id: string; name: string; active: boolean }[];
  bloqueados: string[];
  canEdit: boolean;
}) {
  const [bloq, setBloq] = useState(new Set(bloqueados));
  const [salvando, iniciar] = useTransition();
  const router = useRouter();

  const alternar = (id: string, solicita: boolean) => {
    // otimista: o toggle responde na hora e o servidor confirma
    setBloq((s) => {
      const n = new Set(s);
      if (solicita) n.delete(id); else n.add(id);
      return n;
    });
    iniciar(async () => {
      const r = await setNivelSolicitaFerias({ hierarchyLevelId: id, solicita });
      if (r.error) {
        toast.error(r.error);
        setBloq((s) => {
          const n = new Set(s);
          if (solicita) n.add(id); else n.delete(id);
          return n;
        });
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="card card-pad" style={{ marginBottom: "1rem" }}>
      <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>Quem solicita as próprias férias</h3>
      <p className="soft" style={{ fontSize: "0.8rem", margin: "0.25rem 0 0.8rem" }}>
        Nível marcado como &quot;programado pelo gestor&quot; não solicita pelo sistema: o gestor
        lança a previsão por ele no módulo Férias.
      </p>
      {niveis.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>
          Nenhum nível de hierarquia cadastrado. Crie os níveis na aba Hierarquia; sem
          marcação, todo colaborador pode solicitar.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          {niveis.map((n) => {
            const bloqueado = bloq.has(n.id);
            return (
              <div
                key={n.id}
                style={{
                  display: "flex", alignItems: "center", gap: "0.6rem",
                  padding: "0.45rem 0.6rem", border: "1px solid var(--border)", borderRadius: 8,
                }}
              >
                <span style={{ fontWeight: 600, fontSize: "0.86rem" }}>{n.name}</span>
                {!n.active && <Badge variant="quiet" tone="gray">Inativo</Badge>}
                <span style={{ marginLeft: "auto" }}>
                  {bloqueado
                    ? <Badge variant="quiet" tone="amber">Programado pelo gestor</Badge>
                    : <Badge variant="quiet" tone="green">Solicita as próprias</Badge>}
                </span>
                {canEdit && (
                  <button
                    type="button" className="btn btn-ghost btn-sm" disabled={salvando}
                    onClick={() => alternar(n.id, bloqueado)}
                  >
                    {bloqueado ? "Permitir solicitar" : "Passar ao gestor"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
