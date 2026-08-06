import { requireContext, getMembers } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pager } from "@/components/ui/Pager";
import { AuditLogViewer, type AuditRow, type AuditFilters } from "@/components/AuditLogViewer";

const PAGE_SIZE = 50;

type SP = { p?: string; q?: string; acao?: string; tipo?: string; autor?: string };

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { tenant, role } = await requireContext();
  // Só o proprietário por enquanto. O log é da empresa inteira e mostra o de→para
  // de toda alteração, inclusive salário, CPF e remuneração variável de quem o
  // leitor não gerencia. Admin e gestor saem daqui até a tela ter recorte próprio.
  // Super admin de plataforma chega como "owner" pelo requireContext.
  const canView = role === "owner";

  if (!canView) {
    return (
      <div>
        <PageHeader title="Logs do sistema" />
        <EmptyState title="Acesso restrito" description="Apenas o proprietário da empresa pode ver os logs do sistema." />
      </div>
    );
  }

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.p) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const filters: AuditFilters = {
    q: (sp.q ?? "").trim(),
    acao: sp.acao ?? "",
    tipo: sp.tipo ?? "",
    autor: sp.autor ?? "",
  };

  const supabase = await createClient();

  // Filtros e paginação no BANCO. Antes a tela trazia os 300 eventos mais recentes
  // e filtrava na memória: além de nunca alcançar o histórico (são 60 mil), o
  // filtro mentia — "Removeu" mostrava só as remoções dentro daqueles 300.
  let consulta = supabase
    .from("audit_logs")
    .select("id, created_at, actor_id, action, entity_type, entity_id, entity_label, changes", { count: "exact" })
    .eq("tenant_id", tenant.id);

  if (filters.acao) consulta = consulta.eq("action", filters.acao);
  if (filters.tipo) consulta = consulta.eq("entity_type", filters.tipo);
  if (filters.autor) consulta = consulta.eq("actor_id", filters.autor);
  // a busca livre é pelo rótulo do registro; o usuário tem filtro próprio, exato
  if (filters.q) consulta = consulta.ilike("entity_label", `%${filters.q}%`);

  const [{ data: logs, count }, members] = await Promise.all([
    consulta.order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1),
    getMembers(tenant.id),
  ]);

  const nameOf = new Map<string, string>();
  for (const m of members) if (m.profile?.id) nameOf.set(m.profile.id, m.profile.full_name ?? m.profile.email ?? "—");

  // resolve autores que não estão entre os membros (ex.: super admin)
  const missing = [...new Set((logs ?? []).map((l) => l.actor_id).filter((id): id is string => !!id && !nameOf.has(id)))];
  if (missing.length) {
    const { data: profs } = await supabase.from("profiles").select("id, full_name, email").in("id", missing);
    for (const p of profs ?? []) nameOf.set(p.id, p.full_name ?? p.email ?? "—");
  }

  const rows: AuditRow[] = (logs ?? []).map((l) => ({
    id: l.id,
    createdAt: l.created_at,
    actorName: l.actor_id ? nameOf.get(l.actor_id) ?? null : null,
    action: l.action,
    entityType: l.entity_type,
    entityLabel: l.entity_label,
    entityId: l.entity_id,
    changes: (l.changes as Record<string, unknown> | null) ?? null,
  }));

  const autores = members
    .filter((m) => m.profile?.id)
    .map((m) => ({ id: m.profile!.id, name: m.profile!.full_name ?? m.profile!.email ?? "—" }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const total = count ?? 0;
  const paginaVazia = rows.length === 0;

  // preserva os filtros ao trocar de página
  const qs = new URLSearchParams();
  if (filters.q) qs.set("q", filters.q);
  if (filters.acao) qs.set("acao", filters.acao);
  if (filters.tipo) qs.set("tipo", filters.tipo);
  if (filters.autor) qs.set("autor", filters.autor);

  return (
    <div>
      <PageHeader title="Logs do sistema" subtitle="Registro de todas as alterações feitas no sistema: quem, o quê, quando e onde." />
      <AuditLogViewer rows={rows} filters={filters} autores={autores} total={total} />
      {!paginaVazia && (
        <Pager basePath="/auditoria" param="p" page={page} pageSize={PAGE_SIZE} total={total} extra={qs} />
      )}
    </div>
  );
}
