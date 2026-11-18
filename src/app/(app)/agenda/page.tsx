import { loadAgendaData, diarioDeDaUrl } from "@/lib/agenda-data";
import { AgendaManager } from "@/components/AgendaManager";
import { moduleGate } from "@/lib/module-gate";

export default async function AgendaPage({
  searchParams,
}: {
  // `?de=`: de quem é o diário em tela (o seletor "Diário de:" grava aqui)
  searchParams: Promise<{ de?: string | string[] }>;
}) {
  const gate = await moduleGate("agenda_diario");
  if (gate) return gate;

  const { de } = await searchParams;
  const data = await loadAgendaData("diario", diarioDeDaUrl(de));
  return <AgendaManager section="diario" {...data} />;
}
