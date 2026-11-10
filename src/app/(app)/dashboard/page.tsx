import { redirect } from "next/navigation";
import { requireContext } from "@/lib/tenant";
import { getModuleAccess } from "@/lib/module-access";
import { primeiraTela } from "@/lib/acesso-telas";
import { permitidoPeloPapel } from "@/lib/modules";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function DashboardPage() {
  const [ctx, { state }] = await Promise.all([requireContext(), getModuleAccess()]);
  const { tenant } = ctx;

  /**
   * Acesso restrito sem o Dashboard (ex.: Operacional só com Férias): o início
   * vira a primeira tela liberada. Todo caminho que manda para /dashboard (login,
   * logo do menu, tela bloqueada, ícone do app) passa por aqui.
   */
  if (state.dashboard === "hidden") {
    const destino = primeiraTela(state, (m) => permitidoPeloPapel(m, { role: ctx.role, isHr: ctx.isHr, isSuperAdmin: ctx.isSuperAdmin }));
    if (destino) redirect(destino);
    return (
      <div className="card">
        <EmptyState
          title="Nenhuma tela liberada"
          description="O seu acesso ainda não tem telas liberadas. Procure o RH ou a administração da empresa."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={`Visão geral de ${tenant.name}`} />

      <div className="card">
        <EmptyState
          badge="Em breve"
          title="Painel em construção"
          description="Os indicadores e visuais do dashboard serão adicionados aqui."
        />
      </div>
    </div>
  );
}
