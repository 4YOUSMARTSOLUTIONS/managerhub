"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui/EmptyState";
import { corrigirResposta, getFilaDeCorrecao, type ParaCorrigir } from "@/lib/actions/training-exams";
import { formatDateTime } from "@/lib/format";

/**
 * Fila de correção das dissertativas.
 *
 * Enquanto a resposta está aqui, a matrícula fica em "aguardando correção" e
 * não conta como pendência do colaborador: a demora é de quem corrige.
 */
export function TrainingGradingQueue() {
  const [fila, setFila] = useState<ParaCorrigir[] | null>(null);

  const recarregar = () => getFilaDeCorrecao().then(setFila);
  useEffect(() => {
    let vivo = true;
    getFilaDeCorrecao().then((r) => { if (vivo) setFila(r); });
    return () => { vivo = false; };
  }, []);

  if (fila === null) {
    return <p className="soft" style={{ fontSize: "0.85rem" }}>Carregando…</p>;
  }

  if (fila.length === 0) {
    return (
      <EmptyState
        title="Nenhuma resposta aguardando correção"
        description="As questões dissertativas enviadas nas avaliações aparecem aqui para você dar a nota."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
      {fila.map((r) => (
        <ItemDeCorrecao key={r.answerId} item={r} onCorrigido={recarregar} />
      ))}
    </div>
  );
}

function ItemDeCorrecao({ item, onCorrigido }: { item: ParaCorrigir; onCorrigido: () => void }) {
  const [nota, setNota] = useState(String(item.weight));
  const [feedback, setFeedback] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const corrigir = () => {
    const valor = Number(nota);
    if (Number.isNaN(valor) || valor < 0 || valor > item.weight) {
      toast.error(`A nota vai de 0 a ${item.weight}.`);
      return;
    }
    start(async () => {
      const r = await corrigirResposta(item.answerId, valor, feedback);
      if (r.error) { toast.error(r.error); return; }
      toast.success("Questão corrigida.");
      onCorrigido();
      router.refresh();
    });
  };

  return (
    <div className="card" style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "0.7rem" }}>
      <div>
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.9rem" }}>{item.userName}</p>
        <p className="soft" style={{ margin: "0.15rem 0 0", fontSize: "0.76rem" }}>
          {item.trainingName}
          {item.submittedAt ? `, enviada em ${formatDateTime(item.submittedAt)}` : ""}
        </p>
      </div>

      <div>
        <p className="soft" style={{ margin: "0 0 0.25rem", fontSize: "0.78rem" }}>{item.statement}</p>
        <div
          style={{
            border: "1px solid var(--border)", borderRadius: 8, padding: "0.7rem",
            fontSize: "0.87rem", whiteSpace: "pre-wrap", lineHeight: 1.5,
          }}
        >
          {item.resposta || <span className="soft">Enviada em branco.</span>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr) auto", gap: "0.6rem", alignItems: "end" }}>
        <div>
          <label className="label">Nota (0 a {item.weight})</label>
          <input
            type="number" min={0} max={item.weight} step={0.5} className="input"
            value={nota} onChange={(e) => setNota(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Comentário</label>
          <input
            className="input" value={feedback} onChange={(e) => setFeedback(e.target.value)}
            placeholder="O que faltou ou o que ficou bom."
          />
        </div>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={corrigir}>
          {pending ? "Salvando…" : "Corrigir"}
        </button>
      </div>
    </div>
  );
}
