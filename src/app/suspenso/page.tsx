import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/actions/auth";
import { AuthShell } from "@/components/AuthShell";

export default async function SuspendedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("memberships")
    .select("is_active, tenants(status)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1);

  const row = data?.[0];
  const userInactive = row?.is_active === false;
  const status = (row?.tenants as { status: string } | null)?.status ?? "suspended";

  // tudo ok de novo -> volta pro sistema
  if (!userInactive && status === "active") redirect("/dashboard");

  const inactiveCompany = status === "inactive";
  const title = userInactive ? "Acesso inativo" : inactiveCompany ? "Empresa desativada" : "Empresa suspensa";
  const subtitle = userInactive
    ? "Seu acesso ao MANAGER HUB está inativo. Fale com o administrador da sua empresa."
    : inactiveCompany
      ? "O acesso da sua empresa ao MANAGER HUB foi desativado."
      : "O acesso da sua empresa ao MANAGER HUB está temporariamente suspenso.";

  return (
    <AuthShell title={title} subtitle={subtitle}>
      <p className="muted" style={{ fontSize: "0.9rem", margin: "0 0 1.25rem" }}>
        Entre em contato com o administrador da plataforma para regularizar o acesso.
      </p>
      <form action={signOut}>
        <button className="btn btn-ghost" type="submit" style={{ width: "100%" }}>
          Sair
        </button>
      </form>
    </AuthShell>
  );
}
