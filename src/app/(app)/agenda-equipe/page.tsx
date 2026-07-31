import { loadAgendaData } from "@/lib/agenda-data";
import { AgendaManager } from "@/components/AgendaManager";
import { moduleGate } from "@/lib/module-gate";

export default async function AgendaEquipePage() {
  const gate = await moduleGate("agenda_equipe");
  if (gate) return gate;

  const data = await loadAgendaData();
  return <AgendaManager section="equipe" {...data} />;
}
