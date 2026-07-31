import { redirectToFirstVisible } from "@/lib/module-gate";

/** Índice do grupo: manda para o primeiro submódulo que a unidade enxerga. */
export default async function FerramentasGestaoIndex() {
  await redirectToFirstVisible("g_ferramentas");
}
