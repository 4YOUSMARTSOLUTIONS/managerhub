import { loadAgendaData } from "@/lib/agenda-data";
import { AgendaManager } from "@/components/AgendaManager";
import { moduleGate } from "@/lib/module-gate";

export default async function AgendaPage() {
  const gate = await moduleGate("agenda_diario");
  if (gate) return gate;

  const data = await loadAgendaData();
  return <AgendaManager section="diario" {...data} />;
}
