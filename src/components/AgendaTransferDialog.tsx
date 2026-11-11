"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DetailModal } from "@/components/ui/DetailModal";
import { SearchSelect } from "./SearchSelect";
import { transferirAgenda } from "@/lib/actions/agenda";
import { periodoAtual } from "@/lib/agenda-responsavel";
import { formatDate, shortName } from "@/lib/format";
import type { AgendaFull } from "@/lib/agenda-types";

type Opt = { id: string; name: string };

/** Véspera de uma data YYYY-MM-DD, sem passar por fuso. */
function vespera(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d - 1, 12);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/**
 * Passa a agenda para quem assumiu a função, a partir de uma data (LUIZ,
 * 11/11/2026). A data vale de hoje para trás: a troca de função costuma ser
 * registrada depois que aconteceu. Até a véspera, dias, execuções e aderência
 * continuam com quem saiu; dali em diante são de quem entrou.
 *
 * Montado com `key` da agenda, então o estado nasce limpo a cada abertura.
 */
export function AgendaTransferDialog({
  agenda, onClose, people, hoje, ativaPorPessoa,
}: {
  agenda: AgendaFull;
  onClose: () => void;
  people: Opt[];
  /** YYYY-MM-DD de hoje: o máximo da data */
  hoje: string;
  /** a agenda de rotina ativa de cada pessoa: quem já tem uma não recebe outra */
  ativaPorPessoa: Record<string, { id: string; name: string }>;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [novoId, setNovoId] = useState("");
  const [data, setData] = useState(hoje);
  const [erro, setErro] = useState("");

  const atual = periodoAtual(agenda);
  const desde = atual?.de ?? agenda.createdDate;
  const nomeAtual = shortName(agenda.responsibleName);
  const opcoes = people.filter((p) => p.id !== agenda.responsibleId);
  const nomeNovo = shortName(people.find((p) => p.id === novoId)?.name);
  const outraAtiva = novoId ? ativaPorPessoa[novoId] : undefined;
  const conflito = outraAtiva && outraAtiva.id !== agenda.id
    ? `${nomeNovo} já tem a agenda ativa "${outraAtiva.name}". Cada pessoa tem uma agenda de rotina ativa só: inative a agenda dessa pessoa antes ou escolha outra.`
    : null;
  const dataValida = !!data && data >= desde && data <= hoje;

  const transferir = () => {
    setErro("");
    if (!novoId) { setErro("Escolha o novo responsável."); return; }
    if (conflito) { setErro(conflito); return; }
    if (!dataValida) { setErro(`Escolha uma data entre ${formatDate(desde)} e hoje.`); return; }
    iniciar(async () => {
      const r = await transferirAgenda({ agendaId: agenda.id, novoId, data });
      if (r.error) { setErro(r.error); return; }
      toast.success(`Agenda transferida para ${nomeNovo}.`);
      onClose();
      router.refresh();
    });
  };

  return (
    <DetailModal
      open
      onClose={() => { if (!pendente) onClose(); }}
      title="Transferir agenda"
      width="sm"
      footer={
        <>
          <span />
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="btn btn-ghost" disabled={pendente} onClick={onClose}>Cancelar</button>
            <button type="button" className="btn btn-primary" disabled={pendente || !!conflito} onClick={transferir}>
              {pendente ? "Transferindo…" : "Transferir"}
            </button>
          </div>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
        <div style={{ fontSize: "0.86rem" }}>
          <div style={{ fontWeight: 700 }}>{agenda.name}</div>
          <div className="soft" style={{ fontSize: "0.8rem" }}>
            Responsável atual: {nomeAtual}, desde {formatDate(desde)}
          </div>
        </div>

        <div>
          <label className="label">Novo responsável</label>
          <SearchSelect options={opcoes} value={novoId} onChange={(v) => { setNovoId(v); setErro(""); }} placeholder="Buscar pessoa…" />
          {conflito && (
            <p role="alert" style={{ color: "var(--mh-danger)", fontSize: "0.8rem", margin: "0.4rem 0 0", background: "var(--mh-danger-soft)", padding: "0.45rem 0.65rem", borderRadius: 8 }}>
              {conflito}
            </p>
          )}
        </div>

        <div>
          <label className="label" htmlFor="transferir-data">A partir de</label>
          <input
            id="transferir-data" type="date" className="input" value={data} min={desde} max={hoje}
            onChange={(e) => { setData(e.target.value); setErro(""); }} style={{ width: "auto" }}
          />
        </div>

        {novoId && dataValida && !conflito && (
          <div style={{ fontSize: "0.82rem", lineHeight: 1.5, background: "var(--surface-2)", borderRadius: 8, padding: "0.6rem 0.75rem" }}>
            {data === desde ? (
              <>A data é a mesma em que {nomeAtual} assumiu: o período inteiro passa para <strong>{nomeNovo}</strong>.</>
            ) : (
              <>
                Até {formatDate(vespera(data))}, a agenda, as execuções e a aderência continuam com <strong>{nomeAtual}</strong>.
                A partir de {formatDate(data)}, passam para <strong>{nomeNovo}</strong>.
              </>
            )}
            {data < hoje && (
              <div className="soft" style={{ marginTop: "0.35rem" }}>
                Execuções já marcadas a partir dessa data passam a contar para {nomeNovo}.
              </div>
            )}
          </div>
        )}

        {erro && (
          <p role="alert" style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
            {erro}
          </p>
        )}
      </div>
    </DetailModal>
  );
}
