import { initials } from "@/lib/format";

export function Avatar({ name }: { name: string | null | undefined }) {
  return (
    <span className="avatar" title={name ?? undefined}>
      {initials(name)}
    </span>
  );
}
