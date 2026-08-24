"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Link2 } from "lucide-react";
import { setItemDoPrograma, type AlvoDoPrograma } from "@/lib/actions/seguranca";

export type ItemDoPrograma = {
  id: string;
  rotulo: string;
  pilar: string | null;
  secao: string | null;
  bloco: string;
};

/**
 * A que item do Programa de Excelência as ações de segurança se amarram.
 *
 * São dois, vizinhos no mesmo bloco: relato vai para o 1.2 (Relatos de
 * Incidentes, Atos e Condições Inseguras) e acidente para o 1.1 (Notificação,
 * Investigação e Tratativa de Acidentes). Mandar os dois para o mesmo item
 * sujaria a pontuação dos dois.
 *
 * O item "1.2 Relatos de Incidentes, Atos e Condições Inseguras" cobra registro
 * digital de atos e condições inseguras COM ações corretivas e preventivas
 * definidas e a gestão dessas ações evidenciada. Amarrando a ação ao item, a
 * evidência da auditoria se monta sozinha, em vez de alguém garimpar depois
 * quais ações de /acoes eram de segurança.
 *
 * O id não pode morar no código: o catálogo do Programa é de cada empresa. O
 * sistema chuta na instalação (procura o item de relatos dentro do pilar
 * Segurança) e aqui o administrador confirma ou troca.
 */
export function SegProgramaVinculo({
  itens, atual, canEdit, alvo = "relato",
}: {
  itens: ItemDoPrograma[];
  atual: string | null;
  canEdit: boolean;
  alvo?: AlvoDoPrograma;
}) {
  const [valor, setValor] = useState(atual ?? "");
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const escolhido = useMemo(() => itens.find((i) => i.id === valor) ?? null, [itens, valor]);
  const mudou = (atual ?? "") !== valor;

  const salvar = () => {
    iniciar(async () => {
      const r = await setItemDoPrograma(valor || null, alvo);
      if (r.error) { toast.error(r.error); return; }
      toast.success(r.message ?? "Vínculo salvo.");
      router.refresh();
    });
  };

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: "0 0 0.2rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <Link2 size={16} /> Ações de {alvo === "acidente" ? "acidente" : "relato"}
        </h3>
        <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
          As ações de tratamento abertas a partir de um {alvo === "acidente" ? "acidente" : "relato"} nascem
          amarradas a este item. É o que transforma o módulo em evidência de auditoria, sem
          ninguém precisar garimpar em Ações depois qual delas era de segurança.
        </p>
      </div>

      {itens.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>
          Nenhum item cadastrado no Programa de Excelência. Cadastre em Configurações, aba
          Programa de Excelência, e volte aqui.
        </p>
      ) : (
        <>
          <div>
            <label className="label">Item do Programa</label>
            <select
              className="select" value={valor} disabled={!canEdit}
              onChange={(e) => setValor(e.target.value)}
            >
              <option value="">Sem vínculo, a ação nasce solta</option>
              {itens.map((i) => (
                <option key={i.id} value={i.id}>{i.rotulo}</option>
              ))}
            </select>
            {escolhido && (
              <p className="soft" style={{ fontSize: "0.75rem", margin: "0.35rem 0 0" }}>
                {[escolhido.pilar, escolhido.secao, escolhido.bloco].filter(Boolean).join(" › ")}
              </p>
            )}
          </div>

          {canEdit && (
            <div style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
              <button type="button" className="btn btn-primary btn-sm" disabled={pendente || !mudou} onClick={salvar}>
                {pendente ? "Salvando…" : "Salvar vínculo"}
              </button>
              {mudou && <span className="soft" style={{ fontSize: "0.78rem" }}>Há alterações não salvas.</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
