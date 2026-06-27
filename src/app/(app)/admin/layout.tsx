import { requireSuperAdmin } from "@/lib/platform";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSuperAdmin();
  return <>{children}</>;
}
