"use client";

import { useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { criarFormulario } from "@/lib/actions/formularios";

/**
 * Cria um rascunho em branco e abre o editor (como no Google Forms). Quem navega
 * é a action, com `redirect`: aqui só chega resposta quando dá errado.
 */
export function NovoFormularioBotao() {
  const [criando, iniciar] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-primary largo-no-celular"
      disabled={criando}
      onClick={() => iniciar(async () => {
        const r = await criarFormulario();
        if (r?.error) toast.error(r.error);
      })}
    >
      <Plus size={16} /> {criando ? "Criando..." : "Novo formulário"}
    </button>
  );
}
