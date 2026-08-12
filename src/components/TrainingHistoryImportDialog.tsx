"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PeoplePicker } from "@/components/PeoplePicker";
import { importarHistorico } from "@/lib/actions/trainings";

/**
 * Importa treinamentos que a empresa já fez antes de usar o sistema.
 *
 * É o que evita o módulo nascer mostrando 100% de inadimplência e convocando de
 * novo quem já está treinado. A data é a de quando o treinamento aconteceu, e o
 * vencimento sai dela: um curso anual feito em março continua vencendo em
 * março, mesmo digitado hoje.
 */
export function TrainingHistoryImportDialog({
  trainingId, trainingName, people, onClose,
}: {
  trainingId: string;
  trainingName: string;
  people: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [ids, setIds] = useState<string[]>([]);
  const [data, setData] = useState("");
  const [nota, setNota] = useState("");
  const [instrutor, setInstrutor] = useState("");
  const [erro, setErro] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const hoje = new Date().toISOString().slice(0, 10);

  const importar = () => {
    setErro("");
    if (ids.length === 0) { setErro("Escolha quem participou."); return; }
    if (!data) { setErro("Informe a data em que o treinamento aconteceu."); return; }
    if (data > hoje) { setErro("A data não pode estar no futuro."); return; }

    start(async () => {
      const r = await importarHistorico({
        trainingId,
        userIds: ids,
        completedAt: data,
        score: nota ? Number(nota) : null,
        instructor: instrutor,
      });
      if (r.error) { setErro(r.error); return; }
      toast.success(`${r.importados} ${r.importados === 1 ? "registro importado" : "registros importados"}.`);
      if (r.warning) toast.warning(r.warning);
      router.refresh();
      onClose();
    });
  };

  return (
    <Modal titulo="Importar histórico" subtitulo={trainingName} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
        <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>
          Para registrar o que já foi feito antes do sistema. Entra como concluído na data
          informada, com certificado, e o vencimento é contado a partir dela.
        </p>

        <div>
          <label className="label">Quem participou <span style={{ color: "var(--mh-danger)" }}>*</span></label>
          <PeoplePicker people={people} selected={ids} onChange={setIds} placeholder="Buscar colaborador…" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.8rem" }}>
          <div>
            <label className="label">Data do treinamento <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <input type="date" max={hoje} className="input" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
          <div>
            <label className="label">Nota</label>
            <input type="number" min={0} max={100} className="input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Se houve" />
          </div>
          <div>
            <label className="label">Instrutor</label>
            <input className="input" value={instrutor} onChange={(e) => setInstrutor(e.target.value)} placeholder="Nome ou empresa" />
          </div>
        </div>

        {erro && (
          <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
            {erro}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={importar}>
            {pending ? "Importando…" : `Importar ${ids.length > 0 ? `(${ids.length})` : ""}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Modal({
  titulo, subtitulo, children, onClose, largura = 620,
}: {
  titulo: string; subtitulo?: string; children: React.ReactNode; onClose: () => void; largura?: number;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 70, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: largura, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)", gap: "0.75rem" }}>
          <div>
            <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>{titulo}</h2>
            {subtitulo && <p className="soft" style={{ fontSize: "0.82rem", margin: "0.25rem 0 0" }}>{subtitulo}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>
        <div style={{ padding: "1.25rem" }}>{children}</div>
      </div>
    </div>
  );
}
