import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./OnboardingForm";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // se já tem empresa, vai direto pro dashboard
  const { data: memberships } = await supabase
    .from("memberships")
    .select("tenant_id")
    .limit(1);
  if (memberships && memberships.length > 0) redirect("/dashboard");

  return <OnboardingForm />;
}
