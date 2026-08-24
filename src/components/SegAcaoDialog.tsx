"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PeoplePicker, type Person } from "@/components/PeoplePicker";
import { PRIORITY } from "@/lib/constants";
import { hojeYmd, somarDias } from "@/lib/format";
import { criarAcaoDoAcidente, criarAcaoDoRelato } from "@/lib/actions/seguranca";
import type { Enums } from "@/types/database";

/**
 * A ação de tratamento, do relato ou do acidente.
 *
 * Não é um formulário de ação completo de propósito. A ação nasce pelo mesmo
 * `create_action` do resto do sistema e cai em /acoes com prazo e cobrança como
 * qualquer outra; o que a segurança precisa decidir aqui é curto: o que fazer,
 * quem faz e até quando. Pilar, item e demanda múltipla são edição posterior,
 * na tela de Ações, se o caso pedir.
 *
 * O responsável já vem sugerido como o GESTOR DA ÉPOCA do envolvido, que é
 * quem tem alçada para conversar e corrigir.
 *
 * O `alvo` decide a que o vínculo é feito e a que item do Programa a ação
 * nasce amarrada: relato vai para o 1.2, acidente para o 1.1.
 */
export function SegAcaoDialog({
  open, onClose, alvo, problema, sugestaoResponsaveis, pessoas,
  unitId, departmentId, subdepartmentId, itemPrograma,
}: {
  open: boolean;
  onClose: () => void;
  alvo: { tipo: "relato" | "acidente"; id: string };
  problema: string;
  sugestaoResponsaveis: string[];
  pessoas: Person[];
  unitId: string | null;
  departmentId: string | null;
  subdepartmentId: string | null;
  /** o item do Programa configurado; null quando a empresa não usa */
  itemPrograma: { item: string; bloco: string; secao: string | null; pilar: string | null } | null;
}) {
  const [descricao, setDescricao] = useState("");
  const [responsaveis, setResponsaveis] = useState<string[]>(sugestaoResponsaveis);
  // uma semana é o padrão porque tratamento de segurança não espera o mês virar
  const [prazo, setPrazo] = useState(() => somarDias(hojeYmd(), 7));
  const [prioridade, setPrioridade] = useState<Enums<"priority_level">>("high");
  const [vincular, setVincular] = useState(true);
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const fechar = () => { setErro(""); onClose(); };

  const salvar = () => {
    setErro("");
    iniciar(async () => {
      const comum = {
        descricao, responsaveis, prazo, prioridade,
        problema, unitId, departmentId, subdepartmentId,
        vincularPrograma: vincular,
      };
      const r = alvo.tipo === "acidente"
        ? await criarAcaoDoAcidente({ acidenteId: alvo.id, ...comum })
        : await criarAcaoDoRelato({ relatoId: alvo.id, ...comum });
      if (r.error) { setErro(r.error); return; }
      if (r.warning) toast.warning(r.warning);
      else toast.success(r.message ?? "Ação criada.");
      setDescricao("");
      onClose();
      router.refresh();
    });
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)",
        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "6vh 1rem", zIndex: 60, overflowY: "auto",
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 540, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>Ação de tratamento</h2>
          <button
            type="button" onClick={fechar} className="muted" aria-label="Fechar"
            style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "1.15rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          <div style={{ background: "var(--surface-2)", borderRadius: "var(--mh-radius-md)", padding: "0.6rem 0.8rem" }}>
            <div className="soft" style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Relato</div>
            <p style={{ margin: "0.2rem 0 0", fontSize: "0.82rem" }}>{problema}</p>
          </div>

          <div>
            <label className="label">O que deve ser feito <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <textarea
              className="input" rows={3} value={descricao}
              placeholder="Ex.: revisar a sinalização da área de descarga e reforçar a regra na conversa diária."
              onChange={(e) => setDescricao(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Responsáveis <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <PeoplePicker
              people={pessoas} selected={responsaveis} onChange={setResponsaveis}
              placeholder="Buscar responsável…"
            />
            {sugestaoResponsaveis.length > 0 && (
              <p className="soft" style={{ fontSize: "0.73rem", margin: "0.3rem 0 0" }}>
                Sugerido: o gestor do envolvido na data do relato.
              </p>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.8rem" }}>
            <div>
              <label className="label">Prazo <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <input className="input" type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
            </div>
            <div>
              <label className="label">Prioridade</label>
              <select
                className="select" value={prioridade}
                onChange={(e) => setPrioridade(e.target.value as Enums<"priority_level">)}
              >
                {(Object.keys(PRIORITY) as Enums<"priority_level">[]).map((p) => (
                  <option key={p} value={p}>{PRIORITY[p]}</option>
                ))}
              </select>
            </div>
          </div>

          {/* O item 1.2 do pilar Segurança cobra registro de relatos COM ações
              corretivas e preventivas evidenciadas. Nascendo amarrada, a ação
              vira evidência sozinha, sem ninguém garimpar /acoes depois. */}
          {itemPrograma && (
            <label
              style={{
                display: "flex", gap: "0.55rem", alignItems: "flex-start", cursor: "pointer",
                background: "var(--surface-2)", borderRadius: "var(--mh-radius-md)", padding: "0.6rem 0.8rem",
              }}
            >
              <input
                type="checkbox" checked={vincular} style={{ marginTop: 3 }}
                onChange={(e) => setVincular(e.target.checked)}
              />
              <span style={{ fontSize: "0.8rem" }}>
                Vincular ao Programa de Excelência
                <span className="soft" style={{ display: "block", fontSize: "0.75rem" }}>
                  {[itemPrograma.pilar, itemPrograma.secao, itemPrograma.bloco].filter(Boolean).join(" › ")}
                  {" › "}{itemPrograma.item}
                </span>
              </span>
            </label>
          )}

          <p className="soft" style={{ fontSize: "0.75rem", margin: 0 }}>
            A ação aparece em Ações para o responsável, sem qualquer referência a quem relatou.
          </p>

          {erro && (
            <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
              {erro}
            </p>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" disabled={pendente} onClick={fechar}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={pendente} onClick={salvar}>
            {pendente ? "Criando…" : "Criar ação"}
          </button>
        </div>
      </div>
    </div>
  );
}
