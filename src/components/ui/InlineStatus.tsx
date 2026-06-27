"use client";

type Option = { value: string; label: string };
type VoidAction = (formData: FormData) => void | Promise<void>;

export function InlineStatus({
  id,
  value,
  options,
  action,
  name = "status",
}: {
  id: string;
  value: string;
  options: Option[];
  action: VoidAction;
  name?: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <select
        name={name}
        defaultValue={value}
        className="select"
        style={{ padding: "0.3rem 0.5rem", fontSize: "0.8rem", width: "auto" }}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </form>
  );
}
