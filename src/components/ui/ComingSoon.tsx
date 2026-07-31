import { EmptyState } from "@/components/ui/EmptyState";

/** Placeholder padronizado para módulos ainda não desenvolvidos. */
export function ComingSoon({
  icon,
  description = "Este módulo está sendo desenvolvido e ficará disponível em breve.",
}: {
  icon?: React.ReactNode;
  description?: string;
}) {
  return (
    <div className="card">
      <EmptyState badge="Em breve" icon={icon} title="Módulo em construção" description={description} />
    </div>
  );
}
