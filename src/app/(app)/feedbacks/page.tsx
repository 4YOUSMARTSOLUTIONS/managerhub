import { requireContext, getMembers } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { getPlatformIntegrationFlags } from "@/lib/platform-integrations";
import { PageHeader } from "@/components/ui/PageHeader";
import { FeedbacksManager, type FeedbackRow, type SessionRow, type Opt, type CompOpt, type PdiActionRow, type CadenceRule, type MemberOrg } from "@/components/FeedbacksManager";
import { moduleGate } from "@/lib/module-gate";

export default async function FeedbacksPage() {
  const gate = await moduleGate("feedbacks");
  if (gate) return gate;

  const { tenant, user, role } = await requireContext();
  const isAdmin = role === "owner" || role === "admin";
  const supabase = await createClient();

  // subordinados diretos (gestor = quem tem colaboradores abaixo) — computado p/ todos, inclusive admin
  const { data: reports } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("tenant_id", tenant.id)
    .eq("manager_id", user.id);
  const reportIds = (reports ?? []).map((r) => r.user_id);
  const canManage = isAdmin || reportIds.length > 0;
  const reportSet = new Set(reportIds);

  const [membersAll, { data: comps }, { data: fbs }, { data: sess }, { data: cadenceRulesData }, { data: pdiData }, { data: memberOrgData }] = await Promise.all([
    getMembers(tenant.id),
    supabase.from("feedback_competencies").select("id, name, active").eq("tenant_id", tenant.id).order("sort").order("name"),
    supabase
      .from("feedbacks")
      .select(
        "id, subject_user_id, author_id, feedback_date, type, channel, title, situation, behavior, impact, next_steps, notes, visibility, applied_at, acknowledged_at, created_at, author:profiles!feedbacks_author_id_fkey(full_name), subject:profiles!feedbacks_subject_user_id_fkey(full_name), links:feedback_competency_links(competency_id), atts:feedback_attachments(id, path, filename, content_type)",
      )
      .eq("tenant_id", tenant.id)
      .order("feedback_date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("feedback_sessions")
      .select(
        "id, subject_user_id, author_id, session_date, reference_month, title, highlights, development, action_plan, overall, visibility, applied_at, acknowledged_at, author:profiles!feedback_sessions_author_id_fkey(full_name), subject:profiles!feedback_sessions_subject_user_id_fkey(full_name), items:feedback_session_items(feedback_id)",
      )
      .eq("tenant_id", tenant.id)
      .order("session_date", { ascending: false }),
    supabase.from("feedback_cadence_rules").select("department_id, position_id, cadence_days").eq("tenant_id", tenant.id),
    supabase
      .from("pdi_actions")
      .select(
        "id, subject_user_id, created_by, source_feedback_id, title, description, status, due_date, completed_at, created_at, subject:profiles!pdi_actions_subject_user_id_fkey(full_name), author:profiles!pdi_actions_created_by_fkey(full_name), comments:pdi_action_comments(id, author_id, body, created_at, author:profiles!pdi_action_comments_author_id_fkey(full_name))",
      )
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: false }),
    supabase.from("memberships").select("user_id, department_id, position_id").eq("tenant_id", tenant.id),
  ]);

  // IA configurada? chave OpenAI centralizada na plataforma (contas do owner)
  const aiEnabled = (await getPlatformIntegrationFlags()).hasOpenAI;

  const feedbacks: FeedbackRow[] = (fbs ?? []).map((f) => ({
    id: f.id,
    subjectId: f.subject_user_id,
    subjectName: (f.subject as unknown as { full_name: string | null } | null)?.full_name ?? "—",
    authorId: f.author_id,
    authorName: (f.author as unknown as { full_name: string | null } | null)?.full_name ?? "—",
    date: f.feedback_date,
    type: f.type,
    channel: f.channel,
    title: f.title,
    situation: f.situation,
    behavior: f.behavior,
    impact: f.impact,
    nextSteps: f.next_steps,
    notes: f.notes,
    visibility: f.visibility,
    appliedAt: f.applied_at,
    acknowledgedAt: f.acknowledged_at,
    competencyIds: ((f.links as unknown as { competency_id: string }[]) ?? []).map((l) => l.competency_id),
    attachments: ((f.atts as unknown as { id: string; path: string; filename: string; content_type: string | null }[]) ?? []).map((a) => ({
      id: a.id, path: a.path, filename: a.filename, contentType: a.content_type,
    })),
  }));

  const sessions: SessionRow[] = (sess ?? []).map((s) => ({
    id: s.id,
    subjectId: s.subject_user_id,
    subjectName: (s.subject as unknown as { full_name: string | null } | null)?.full_name ?? "—",
    authorId: s.author_id,
    authorName: (s.author as unknown as { full_name: string | null } | null)?.full_name ?? "—",
    date: s.session_date,
    referenceMonth: s.reference_month,
    title: s.title,
    highlights: s.highlights,
    development: s.development,
    actionPlan: s.action_plan,
    overall: s.overall,
    visibility: s.visibility,
    appliedAt: s.applied_at,
    acknowledgedAt: s.acknowledged_at,
    itemFeedbackIds: ((s.items as unknown as { feedback_id: string }[]) ?? []).map((i) => i.feedback_id),
  }));

  const pdiActions: PdiActionRow[] = (pdiData ?? []).map((a) => ({
    id: a.id,
    subjectId: a.subject_user_id,
    subjectName: (a.subject as unknown as { full_name: string | null } | null)?.full_name ?? "—",
    authorId: a.created_by,
    authorName: (a.author as unknown as { full_name: string | null } | null)?.full_name ?? "—",
    sourceFeedbackId: a.source_feedback_id,
    title: a.title,
    description: a.description,
    status: a.status,
    dueDate: a.due_date,
    completedAt: a.completed_at,
    comments: ((a.comments as unknown as { id: string; author_id: string; body: string; created_at: string; author: { full_name: string | null } | null }[]) ?? [])
      .map((c) => ({ id: c.id, authorId: c.author_id, authorName: c.author?.full_name ?? "—", body: c.body, createdAt: c.created_at }))
      .sort((x, y) => x.createdAt.localeCompare(y.createdAt)),
  }));

  const cadenceRules: CadenceRule[] = (cadenceRulesData ?? []).map((r) => ({ deptId: r.department_id, posId: r.position_id, days: r.cadence_days }));
  const memberOrg: MemberOrg = {};
  for (const m of memberOrgData ?? []) memberOrg[m.user_id] = { deptId: m.department_id, posId: m.position_id };

  const allMembers = membersAll
    .map((m) => ({ id: m.profile?.id ?? "", name: m.profile?.full_name ?? m.profile?.email ?? "—" }))
    .filter((m) => m.id)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  // minha equipe = subordinados diretos; allSubjects = todos (para o toggle "Toda a empresa" de admin)
  const teamOptions: Opt[] = allMembers.filter((m) => reportSet.has(m.id));
  const allSubjects: Opt[] = allMembers.filter((m) => m.id !== user.id);
  const competencies: CompOpt[] = (comps ?? []).map((c) => ({ id: c.id, name: c.name, active: c.active }));

  return (
    <div>
      <PageHeader title="Feedbacks" subtitle="Histórico de feedbacks com os colaboradores." />
      <FeedbacksManager
        feedbacks={feedbacks}
        sessions={sessions}
        subjectOptions={teamOptions}
        allSubjects={allSubjects}
        competencies={competencies}
        currentUserId={user.id}
        isAdmin={isAdmin}
        canManage={canManage}
        aiEnabled={aiEnabled}
        pdiActions={pdiActions}
        cadenceRules={cadenceRules}
        memberOrg={memberOrg}
      />
    </div>
  );
}
