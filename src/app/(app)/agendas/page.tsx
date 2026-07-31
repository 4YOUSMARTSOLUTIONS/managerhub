import { loadAgendaData } from "@/lib/agenda-data";
import { AgendaManager } from "@/components/AgendaManager";
import { moduleGate } from "@/lib/module-gate";

export default async function AgendasPage() {
  const gate = await moduleGate("agendas");
  if (gate) return gate;

  const data = await loadAgendaData();
  return <AgendaManager section="agendas" {...data} />;
}
