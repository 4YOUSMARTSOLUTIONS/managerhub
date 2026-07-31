"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="card" style={{ marginTop: "2rem" }}>
      <EmptyState
        icon={<TriangleAlert size={24} />}
        title="Algo deu errado"
        description="Não foi possível carregar esta página. Tente novamente — se persistir, avise o suporte."
        action={
          <button type="button" className="btn btn-primary" onClick={reset}>
            Tentar novamente
          </button>
        }
      />
    </div>
  );
}
