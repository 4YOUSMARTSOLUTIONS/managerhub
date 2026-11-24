"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { criarFormulario } from "@/lib/actions/formularios";

/** Cria um rascunho em branco e abre o editor (como no Google Forms). */
export function NovoFormularioBotao() {
  const router = useRouter();
  const [criando, iniciar] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-primary largo-no-celular"
      disabled={criando}
      onClick={() => iniciar(async () => {
        const r = await criarFormulario();
        if (r.error || !r.id) { toast.error(r.error ?? "Não foi possível criar o formulário."); return; }
        router.push(`/formularios/${r.id}/editar`);
      })}
    >
      <Plus size={16} /> {criando ? "Criando..." : "Novo formulário"}
    </button>
  );
}
