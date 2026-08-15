"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { PeoplePicker, type Person } from "@/components/PeoplePicker";
import { setSegEquipe } from "@/lib/actions/seguranca";

/**
 * A equipe de segurança do trabalho.
 *
 * É uma lista de pessoas, não um papel do sistema: o técnico de segurança
 * costuma ser um colaborador comum, e inventar um papel novo mexeria na
 * hierarquia inteira por causa de duas telas.
 *
 * Quem está aqui tria relato, enxerga QUEM RELATOU e cadastra acidente. Por
 * isso a tela avisa: é acesso a dado sensível, não uma etiqueta.
 */
export function SegEquipeManager({
  people, selectedIds, canEdit,
}: {
  people: Person[];
  selectedIds: string[];
  canEdit: boolean;
}) {
  const [escolhidos, setEscolhidos] = useState<string[]>(selectedIds);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const mudou =
    escolhidos.length !== selectedIds.length ||
    escolhidos.some((id) => !selectedIds.includes(id));

  const salvar = () => {
    iniciar(async () => {
      const r = await setSegEquipe({ user_ids: escolhidos });
      if (r.error) { toast.error(r.error); return; }
      toast.success("Equipe de segurança atualizada.");
      router.refresh();
    });
  };

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: "0 0 0.2rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <ShieldCheck size={16} /> Equipe de segurança
        </h3>
        <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
          Quem tria os relatos, alerta os gestores e cadastra acidentes. Proprietário e
          administrador já têm esse alcance por padrão e não precisam ser incluídos.
        </p>
        <p className="soft" style={{ fontSize: "0.8rem", margin: "0.4rem 0 0" }}>
          Atenção: quem entra aqui passa a ver o nome de quem fez cada relato. Para todo o
          resto da empresa, inclusive os gestores, o relator continua invisível.
        </p>
      </div>

      {people.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>Nenhum colaborador ativo.</p>
      ) : canEdit ? (
        <>
          <PeoplePicker
            people={people}
            selected={escolhidos}
            onChange={setEscolhidos}
            placeholder="Buscar colaborador para incluir na equipe…"
          />
          <div style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
            <button
              type="button" className="btn btn-primary btn-sm"
              disabled={pendente || !mudou} onClick={salvar}
            >
              {pendente ? "Salvando…" : "Salvar equipe"}
            </button>
            {mudou && <span className="soft" style={{ fontSize: "0.78rem" }}>Há alterações não salvas.</span>}
          </div>
        </>
      ) : (
        <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>
          {selectedIds.length === 0
            ? "Nenhum colaborador na equipe de segurança."
            : people.filter((p) => selectedIds.includes(p.id)).map((p) => p.name).join(", ")}
        </p>
      )}
    </div>
  );
}
