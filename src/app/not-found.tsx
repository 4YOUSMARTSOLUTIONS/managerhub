import Link from "next/link";
import { Compass } from "lucide-react";
import { BrandLogo, BrandWordmark } from "@/components/BrandLogo";

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1.5rem",
        padding: "2rem",
        background: "var(--mh-bg)",
        color: "var(--mh-text-1)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
        <BrandLogo size={34} radius={9} />
        <BrandWordmark />
      </div>

      <div
        aria-hidden
        style={{
          width: 64,
          height: 64,
          borderRadius: "var(--mh-radius-lg)",
          display: "grid",
          placeItems: "center",
          color: "var(--mh-primary-500)",
          background: "var(--mh-primary-soft)",
          border: "1px solid color-mix(in srgb, var(--mh-primary-500) 22%, transparent)",
        }}
      >
        <Compass size={28} />
      </div>

      <div style={{ textAlign: "center" }}>
        <div
          className="mono"
          style={{ fontSize: "2.4rem", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1 }}
        >
          404
        </div>
        <p style={{ fontWeight: 700, margin: "0.7rem 0 0.3rem" }}>Página não encontrada</p>
        <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
          O endereço acessado não existe ou foi movido.
        </p>
      </div>

      <Link href="/dashboard" className="btn btn-primary">
        Voltar ao Dashboard
      </Link>
    </div>
  );
}
