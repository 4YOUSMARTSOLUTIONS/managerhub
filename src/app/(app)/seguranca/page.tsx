import { redirectToFirstVisible } from "@/lib/module-gate";

/** Segurança virou um grupo no menu: cada assunto tem tela própria. */
export default async function SegurancaPage() {
  await redirectToFirstVisible("g_seguranca");
}
