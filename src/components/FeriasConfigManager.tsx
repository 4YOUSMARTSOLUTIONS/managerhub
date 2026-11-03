"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge";
import { setAntecedenciaFerias, setNivelSolicitaFerias } from "@/lib/actions/ferias";

/**
 * Antecedência mínima do pedido do colaborador. Vale para o pedido dele, para a
 * correção de um pedido que voltou e para o reagendamento que ele mesmo faz; o
 * lançamento do gestor e do DP não passa por ela.
 */
function AntecedenciaMinima({ dias, canEdit }: { dias: number; canEdit: boolean }) {
  const [valor, setValor] = useState(String(dias));
  const [salvando, iniciar] = useTransition();
  const router = useRouter();
  const numero = Number(valor);
  const valido = valor.trim() !== "" && Number.isInteger(numero) && numero >= 0 && numero <= 180;
  const mudou = valido && numero !== dias;

  const salvar = () => {
    iniciar(async () => {
      const r = await setAntecedenciaFerias({ dias: numero });
      if (r.error) { toast.error(r.error); return; }
      toast.success(r.message ?? "Salvo.");
      router.refresh();
    });
  };

  return (
    <div className="card card-pad" style={{ marginBottom: "1rem" }}>
      <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>Antecedência mínima para solicitar</h3>
      <p className="soft" style={{ fontSize: "0.8rem", margin: "0.25rem 0 0.8rem" }}>
        Quantos dias antes da saída o colaborador precisa pedir as próprias férias, para o
        departamento pessoal calcular e pagar a tempo. Vale também quando ele corrige um pedido
        devolvido ou reagenda as próprias férias. O lançamento do gestor e do DP não tem esse
        limite. Use 0 para não exigir antecedência.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <input
          className="input" type="number" min={0} max={180} step={1} value={valor}
          disabled={!canEdit || salvando}
          onChange={(e) => setValor(e.target.value)}
          style={{ width: 110 }}
          aria-label="Antecedência mínima em dias"
        />
        <span className="soft" style={{ fontSize: "0.85rem" }}>dias antes do início das férias</span>
        {canEdit && (
          <button type="button" className="btn btn-primary btn-sm" disabled={!mudou || salvando} onClick={salvar}>
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        )}
      </div>
      {!valido && (
        <p style={{ color: "var(--mh-danger)", fontSize: "0.78rem", margin: "0.4rem 0 0" }}>
          Informe um número inteiro de 0 a 180.
        </p>
      )}
    </div>
  );
}

/**
 * Quem solicita as próprias férias, por nível de hierarquia.
 *
 * Nível marcado como "programado pelo gestor" não vê o botão de solicitar no
 * módulo Férias: a previsão dele é lançada pelo gestor (o caso do operacional).
 * A lista chega ordenada por `rank`, que é a ordem real da hierarquia.
 */
export function FeriasConfigManager({
  niveis, bloqueados, antecedencia, canEdit,
}: {
  niveis: { id: string; name: string; active: boolean }[];
  bloqueados: string[];
  /** antecedência mínima atual, em dias (0 = sem) */
  antecedencia: number;
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
    <>
    <AntecedenciaMinima dias={antecedencia} canEdit={canEdit} />
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
    </>
  );
}
