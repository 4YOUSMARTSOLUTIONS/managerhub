"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { PeoplePicker, type Person } from "@/components/PeoplePicker";
import {
  diasDoPeriodo, motivoInicioInvalido, rotuloAquisitivo, validarConjunto,
  type AquisitivoInfo, type FeriadoCustom, type PeriodoInput,
} from "@/lib/ferias";
import { FERIAS_AQUISITIVO_SITUACAO, FERIAS_AQUISITIVO_TONE } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { lancarFerias, reagendarFerias, reenviarFerias, solicitarFerias } from "@/lib/actions/ferias";

/**
 * O formulário da previsão de férias: até 3 períodos, abono pecuniário e
 * adiantamento do 13º, com as regras CLT recusando ANTES do envio (o banco
 * revalida tudo; aqui é só para o erro chegar sem round-trip).
 *
 * Três modos no mesmo formulário:
 *  - solicitar: o colaborador pede as próprias férias (aquisitivos dele à vista);
 *  - lancar: o gestor programa para alguém da equipe (caminho do operacional);
 *  - reenviar: corrige UMA previsão devolvida.
 *
 * Fecha por X ou Cancelar, nunca por clique no fundo.
 */
export function FeriasSolicitarDialog({
  modo, pessoas, aquisitivos, feriados, hoje, inicial, onFechar,
}: {
  modo: "solicitar" | "lancar" | "reenviar" | "reagendar";
  /** só no modo lancar: quem o usuário pode programar */
  pessoas?: Person[];
  /** aquisitivos de quem vai tirar férias; null = sem validação de saldo no cliente */
  aquisitivos: AquisitivoInfo[] | null;
  feriados: FeriadoCustom[];
  hoje: string;
  /** nos modos reenviar e reagendar: a linha de origem */
  inicial?: { id: string; inicio: string; fim: string; abono: number; decimo: boolean };
  onFechar: () => void;
}) {
  const [userId, setUserId] = useState<string[]>([]);
  const [periodos, setPeriodos] = useState<PeriodoInput[]>([
    inicial
      ? { inicio: inicial.inicio, fim: inicial.fim, abono: inicial.abono, decimo: inicial.decimo }
      : { inicio: "", fim: "", abono: 0, decimo: false },
  ]);
  const [erro, setErro] = useState("");
  const [salvando, iniciar] = useTransition();
  const router = useRouter();

  const titulo = modo === "solicitar" ? "Solicitar férias"
    : modo === "lancar" ? "Lançar férias para a equipe"
    : modo === "reagendar" ? "Reagendar férias" : "Corrigir e reenviar";

  const totalDias = periodos.reduce(
    (s, p) => s + (p.inicio && p.fim && p.fim >= p.inicio ? diasDoPeriodo(p.inicio, p.fim) + p.abono : 0), 0);

  // o aviso por período aparece embaixo do campo, sem esperar o Salvar
  const avisos = useMemo(() => periodos.map((p) => {
    if (!p.inicio) return null;
    if (p.inicio <= hoje) return "A previsão precisa começar depois de hoje.";
    return motivoInicioInvalido(p.inicio, feriados);
  }), [periodos, hoje, feriados]);

  const mudar = (i: number, patch: Partial<PeriodoInput>) =>
    setPeriodos((xs) => xs.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const salvar = () => {
    setErro("");
    if (modo === "lancar" && userId.length === 0) {
      setErro("Escolha o colaborador.");
      return;
    }
    // validação client: completa quando temos os aquisitivos, leve quando não
    if (aquisitivos) {
      const r = validarConjunto(periodos, aquisitivos, hoje, feriados);
      if (r.erro) { setErro(r.erro); return; }
    } else {
      for (let i = 0; i < periodos.length; i++) {
        const p = periodos[i];
        if (!p.inicio || !p.fim) { setErro("Informe o início e o término de cada período."); return; }
        if (avisos[i]) { setErro(avisos[i] as string); return; }
      }
    }

    iniciar(async () => {
      const r = modo === "solicitar"
        ? await solicitarFerias({ periodos, hoje })
        : modo === "lancar"
          ? await lancarFerias({ userId: userId[0], periodos, hoje })
          : modo === "reagendar"
            ? await reagendarFerias({
                id: inicial!.id, inicio: periodos[0].inicio, fim: periodos[0].fim,
                abono: periodos[0].abono, decimo: periodos[0].decimo, hoje,
              })
            : await reenviarFerias({
                id: inicial!.id, inicio: periodos[0].inicio, fim: periodos[0].fim,
                abono: periodos[0].abono, decimo: periodos[0].decimo, hoje,
              });
      if (r.error) { setErro(r.error); return; }
      toast.success(r.message ?? "Salvo.");
      onFechar();
      router.refresh();
    });
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)",
        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "5vh 1rem", zIndex: 60, overflowY: "auto",
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 640, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: 0 }}>{titulo}</h2>
          <button
            type="button" onClick={onFechar} className="muted" aria-label="Fechar"
            style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "1.15rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          {modo === "lancar" && (
            <div>
              <label className="label">Colaborador <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <PeoplePicker people={pessoas ?? []} selected={userId} onChange={setUserId} single />
            </div>
          )}

          {modo === "reagendar" && inicial && (
            <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>
              Reagendando as férias de {formatDate(inicial.inicio)} a {formatDate(inicial.fim)}.
              Elas continuam valendo até o departamento pessoal verificar e efetivar a troca.
            </p>
          )}

          {aquisitivos && aquisitivos.length > 0 && (
            <div style={{ background: "var(--surface-2)", borderRadius: 9, padding: "0.65rem 0.8rem" }}>
              <div className="soft" style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.4rem" }}>
                Saldo por período aquisitivo
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                {aquisitivos.filter((a) => a.situacao !== "quitada" || a.diasUsados > 0).slice(-4).map((a) => (
                  <div key={a.aqInicio} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.82rem" }}>
                    <span style={{ fontWeight: 600, minWidth: 76 }}>{rotuloAquisitivo(a)}</span>
                    <span className="soft">{formatDate(a.aqInicio)} a {formatDate(a.aqFim)}</span>
                    <span style={{ marginLeft: "auto" }} className="tabular">{a.saldo} dia(s)</span>
                    <Badge variant="quiet" tone={FERIAS_AQUISITIVO_TONE[a.situacao] ?? "gray"}>
                      {FERIAS_AQUISITIVO_SITUACAO[a.situacao] ?? a.situacao}
                    </Badge>
                  </div>
                ))}
              </div>
              <p className="soft" style={{ fontSize: "0.74rem", margin: "0.45rem 0 0" }}>
                O saldo mais antigo é usado primeiro. Início permitido de segunda a quinta, fora
                de feriado e das vésperas (art. 134).
              </p>
            </div>
          )}

          {periodos.map((p, i) => (
            <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "0.7rem 0.8rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <span style={{ fontSize: "0.8rem", fontWeight: 700 }}>
                  Período {i + 1}
                  {p.inicio && p.fim && p.fim >= p.inicio && (
                    <span className="soft" style={{ fontWeight: 400 }}> · {diasDoPeriodo(p.inicio, p.fim)} dia(s)</span>
                  )}
                </span>
                {periodos.length > 1 && (
                  <button
                    type="button" className="btn btn-ghost btn-sm"
                    onClick={() => setPeriodos((xs) => xs.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={13} aria-hidden /> Remover
                  </button>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 110px", gap: "0.6rem" }}>
                <div>
                  <label className="label">Início <span style={{ color: "var(--mh-danger)" }}>*</span></label>
                  <input className="input" type="date" value={p.inicio} min={hoje} onChange={(e) => mudar(i, { inicio: e.target.value })} />
                </div>
                <div>
                  <label className="label">Término <span style={{ color: "var(--mh-danger)" }}>*</span></label>
                  <input className="input" type="date" value={p.fim} min={p.inicio || hoje} onChange={(e) => mudar(i, { fim: e.target.value })} />
                </div>
                <div>
                  <label className="label">Abono (dias)</label>
                  <input
                    className="input" type="number" min={0} max={10} value={p.abono}
                    onChange={(e) => mudar(i, { abono: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })}
                  />
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", marginTop: "0.5rem", cursor: "pointer" }}>
                <input type="checkbox" checked={p.decimo} onChange={(e) => mudar(i, { decimo: e.target.checked })} />
                Adiantar a 1ª parcela do 13º junto destas férias
              </label>
              {avisos[i] && (
                <p style={{ color: "var(--mh-danger)", fontSize: "0.78rem", margin: "0.45rem 0 0" }}>{avisos[i]}</p>
              )}
            </div>
          ))}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
            {(modo === "solicitar" || modo === "lancar") && periodos.length < 3 ? (
              <button
                type="button" className="btn btn-ghost btn-sm"
                onClick={() => setPeriodos((xs) => [...xs, { inicio: "", fim: "", abono: 0, decimo: false }])}
              >
                <Plus size={14} aria-hidden /> Adicionar período (até 3)
              </button>
            ) : <span />}
            {totalDias > 0 && (
              <span className="soft" style={{ fontSize: "0.8rem" }}>
                Total do pedido: <strong>{totalDias}</strong> de 30 dias (gozo + abono)
              </span>
            )}
          </div>

          {erro && (
            <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
              {erro}
            </p>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" onClick={onFechar}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={salvando} onClick={salvar}>
            {salvando ? "Enviando…" : modo === "lancar" ? "Lançar previsão" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}
