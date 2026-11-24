import { notFound } from "next/navigation";
import { moduleGate } from "@/lib/module-gate";
import { requireContext } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { COLUNAS_FORMULARIO, formularioDaLinha, type OpcoesPublico } from "@/lib/formularios";
import { FormularioEditor } from "@/components/formularios/FormularioEditor";

/** Editor: só quem gere o formulário (autor, Proprietário, Administrador). */
export default async function EditarFormularioPage({ params }: { params: Promise<{ id: string }> }) {
  const gate = await moduleGate("formularios");
  if (gate) return gate;
  await requireContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const [{ data: linha }, { data: gere }, { data: opcoes }, { count }] = await Promise.all([
    supabase.from("formularios").select(COLUNAS_FORMULARIO).eq("id", id).maybeSingle(),
    supabase.rpc("formulario_gere", { p_form: id }),
    supabase.rpc("formulario_opcoes_publico"),
    supabase.from("formulario_respostas").select("id", { count: "exact", head: true }).eq("formulario_id", id),
  ]);
  if (!linha || !gere) notFound();

  const f = formularioDaLinha(linha as unknown as Parameters<typeof formularioDaLinha>[0]);
  return (
    <FormularioEditor
      key={f.id}
      inicial={f}
      opcoes={(opcoes as unknown as OpcoesPublico) ?? { niveis: [], cargos: [], unidades: [], pessoas: [] }}
      totalRespostas={count ?? 0}
    />
  );
}
