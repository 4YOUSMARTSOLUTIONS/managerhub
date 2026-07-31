import { loadAgendaData } from "@/lib/agenda-data";
import { AgendaManager } from "@/components/AgendaManager";
import { moduleGate } from "@/lib/module-gate";

export default async function AgendaHistoricoPage() {
  const gate = await moduleGate("agenda_historico");
  if (gate) return gate;

  const data = await loadAgendaData();
  return <AgendaManager section="historico" {...data} />;
}
