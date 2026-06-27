import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Enums, Tables } from "@/types/database";

export type ActiveContext = {
  user: { id: string; email: string | undefined };
  tenant: Tables<"tenants">;
  role: Enums<"member_role">;
};

/**
 * Garante usuário autenticado + tenant ativo.
 * Redireciona para /login se não autenticado e /onboarding se sem empresa.
 * Usa a primeira membership como tenant ativo (MVP).
 */
export async function requireContext(): Promise<ActiveContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, tenant_id, is_active, tenants(*)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1);

  const membership = memberships?.[0];
  if (!membership || !membership.tenants) redirect("/onboarding");

  if (membership.is_active === false) redirect("/suspenso");

  const tenant = membership.tenants as Tables<"tenants">;
  if (tenant.status !== "active") redirect("/suspenso");

  return {
    user: { id: user.id, email: user.email },
    tenant,
    role: membership.role,
  };
}

export async function getMembers(tenantId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("memberships")
    .select("role, user_id, profiles(id, full_name, email)")
    .eq("tenant_id", tenantId);
  return (data ?? []).map((m) => ({
    role: m.role,
    profile: m.profiles as Tables<"profiles"> | null,
  }));
}
