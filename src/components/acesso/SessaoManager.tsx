"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { definirTempoDoNivel, definirTempoPadrao } from "@/lib/actions/acesso-telas";
import { OPCOES_DE_TEMPO, rotuloDoTempo } from "@/lib/sessao";

export type NivelDeSessao = { id: string; nome: string; ativos: number; minutos: number | null };

/**
 * Tempo sem uso que encerra a sessão, por nível, com o padrão da empresa
 * (8 horas quando nunca foi definido). Pedido do LUIZ para celular
 * compartilhado entre motoristas: o Operacional começa com 30 minutos.
 */
export function SessaoManager({ padrao, niveis, canEdit }: {
  /** null = sem limite */
  padrao: number | null;
  niveis: NivelDeSessao[];
  canEdit: boolean;
}) {
  const [salvando, iniciar] = useTransition();
  const router = useRouter();

  const salvar = (fazer: () => Promise<{ error?: string; message?: string }>) => iniciar(async () => {
    const r = await fazer();
    if (r.error) { toast.error(r.error); return; }
    toast.success(r.message ?? "Tempo salvo.");
    router.refresh();
  });

  const opcoes = OPCOES_DE_TEMPO.map((m) => <option key={m} value={m}>{rotuloDoTempo(m)}</option>);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>Encerrar a sessão sem uso</div>
        <p className="soft" style={{ fontSize: "0.8rem", margin: "0.15rem 0 0", lineHeight: 1.5, maxWidth: 820 }}>
          Depois desse tempo sem tocar no sistema, a pessoa precisa entrar de novo. Um minuto antes aparece um
          aviso para continuar. Vale para todos, inclusive Proprietário, Administrador e RH, e protege o celular
          usado por mais de uma pessoa.
        </p>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", fontSize: "0.875rem" }}>
        <label htmlFor="sessao-padrao" style={{ fontWeight: 600 }}>Padrão da empresa</label>
        {canEdit ? (
          <select
            id="sessao-padrao" className="select" style={{ width: "auto" }} disabled={salvando}
            value={padrao === null ? "" : String(padrao)}
            onChange={(e) => salvar(() => definirTempoPadrao(e.target.value ? Number(e.target.value) : null))}
          >
            {opcoes}
            <option value="">Sem limite</option>
          </select>
        ) : (
          <span>{rotuloDoTempo(padrao)}</span>
        )}
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Nível</th>
              <th style={{ width: 110 }}>Pessoas ativas</th>
              <th style={{ width: 260 }}>Encerrar depois de</th>
            </tr>
          </thead>
          <tbody>
            {niveis.map((n) => (
              <tr key={n.id}>
                <td style={{ fontWeight: 600 }}>{n.nome}</td>
                <td className="tabular">{n.ativos}</td>
                <td>
                  {canEdit ? (
                    <select
                      className="select" aria-label={`Tempo sem uso do nível ${n.nome}`} disabled={salvando}
                      value={n.minutos === null ? "" : String(n.minutos)}
                      onChange={(e) => salvar(() => definirTempoDoNivel(n.id, e.target.value ? Number(e.target.value) : null))}
                    >
                      <option value="">Padrão da empresa ({rotuloDoTempo(padrao)})</option>
                      {opcoes}
                    </select>
                  ) : (
                    <span className={n.minutos === null ? "soft" : undefined} style={{ fontSize: "0.85rem" }}>
                      {n.minutos === null ? `Padrão da empresa (${rotuloDoTempo(padrao)})` : rotuloDoTempo(n.minutos)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
