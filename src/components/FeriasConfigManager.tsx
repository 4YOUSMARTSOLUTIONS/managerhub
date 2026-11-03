"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge";
import { setAntecedenciaFerias, setNivelSolicitaFerias } from "@/lib/actions/ferias";

export type AntecedenciaFerias = { colaborador: number; gestor: number; dp: number };

const CAMPOS: { chave: keyof AntecedenciaFerias; rotulo: string; ajuda: string }[] = [
  {
    chave: "colaborador", rotulo: "Colaborador",
    ajuda: "O pedido das próprias férias, a correção de um pedido devolvido e o reagendamento que ele mesmo faz.",
  },
  {
    chave: "gestor", rotulo: "Gestor",
    ajuda: "O lançamento para a equipe, na tela ou pela planilha, e a correção ou o reagendamento do que ele lançou.",
  },
  {
    chave: "dp", rotulo: "Departamento pessoal",
    ajuda: "O lançamento feito por proprietário, administrador ou RH. Deixe 0 para regularizações de última hora.",
  },
];

/**
 * Antecedência mínima, em dias, por quem lança. A regra roda no banco
 * (`ferias_checar_antecedencia`), com o mesmo critério de papel.
 */
function AntecedenciaMinima({ atual, canEdit }: { atual: AntecedenciaFerias; canEdit: boolean }) {
  const [valores, setValores] = useState<Record<keyof AntecedenciaFerias, string>>({
    colaborador: String(atual.colaborador), gestor: String(atual.gestor), dp: String(atual.dp),
  });
  const [salvando, iniciar] = useTransition();
  const router = useRouter();
  const numeros = {
    colaborador: Number(valores.colaborador), gestor: Number(valores.gestor), dp: Number(valores.dp),
  };
  const valido = (Object.keys(valores) as (keyof AntecedenciaFerias)[]).every((k) =>
    valores[k].trim() !== "" && Number.isInteger(numeros[k]) && numeros[k] >= 0 && numeros[k] <= 180);
  const mudou = valido && (Object.keys(numeros) as (keyof AntecedenciaFerias)[]).some((k) => numeros[k] !== atual[k]);

  const salvar = () => {
    iniciar(async () => {
      const r = await setAntecedenciaFerias(numeros);
      if (r.error) { toast.error(r.error); return; }
      toast.success(r.message ?? "Salvo.");
      router.refresh();
    });
  };

  return (
    <div className="card card-pad" style={{ marginBottom: "1rem" }}>
      <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>Antecedência mínima</h3>
      <p className="soft" style={{ fontSize: "0.8rem", margin: "0.25rem 0 0.8rem" }}>
        Quantos dias antes da saída as férias precisam ser pedidas ou lançadas, para o departamento
        pessoal calcular e pagar a tempo. Cada um tem o seu prazo. Use 0 para não exigir antecedência.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {CAMPOS.map((c) => (
          <div
            key={c.chave}
            style={{
              display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap",
              padding: "0.5rem 0.6rem", border: "1px solid var(--border)", borderRadius: 8,
            }}
          >
            <div style={{ flex: "1 1 260px", minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: "0.86rem" }}>{c.rotulo}</div>
              <div className="soft" style={{ fontSize: "0.76rem" }}>{c.ajuda}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <input
                className="input" type="number" min={0} max={180} step={1} value={valores[c.chave]}
                disabled={!canEdit || salvando}
                onChange={(e) => setValores((v) => ({ ...v, [c.chave]: e.target.value }))}
                style={{ width: 90 }}
                aria-label={`Antecedência mínima do ${c.rotulo.toLowerCase()}, em dias`}
              />
              <span className="soft" style={{ fontSize: "0.82rem" }}>dias</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginTop: "0.7rem", flexWrap: "wrap" }}>
        {canEdit && (
          <button type="button" className="btn btn-primary btn-sm" disabled={!mudou || salvando} onClick={salvar}>
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        )}
        {!valido && (
          <span style={{ color: "var(--mh-danger)", fontSize: "0.78rem" }}>
            Informe um número inteiro de 0 a 180 em cada campo.
          </span>
        )}
      </div>
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
  /** antecedência mínima atual, em dias, por quem lança (0 = sem) */
  antecedencia: AntecedenciaFerias;
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
    <AntecedenciaMinima atual={antecedencia} canEdit={canEdit} />
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
