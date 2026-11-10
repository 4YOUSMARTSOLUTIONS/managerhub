"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CloudOff, TriangleAlert } from "lucide-react";
import { confirmDialog } from "@/components/ui/confirm";
import { formatDate } from "@/lib/format";
import {
  enviarBlitzGuardadas, removerBlitzGuardada, useBlitzGuardadas, type ResultadoDoEnvio,
} from "@/lib/blitz-fila";

const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

function avisarEnviadas(r: ResultadoDoEnvio) {
  if (r.enviadas > 0) {
    toast.success(
      r.enviadas === 1
        ? "A blitz guardada no aparelho foi enviada."
        : `${r.enviadas} blitz guardadas no aparelho foram enviadas.`,
    );
  }
}

/**
 * Envia sozinho o que ficou guardado sem sinal. Montado no layout, para a
 * blitz sair mesmo que o avaliador vá para outra tela: tenta ao abrir o app,
 * quando a rede volta, quando o app volta para a frente e a cada 30 segundos
 * enquanto houver alguma esperando. Não desenha nada.
 */
export function EnvioDasBlitzGuardadas({ dono, tenantId }: { dono: string; tenantId: string }) {
  const router = useRouter();
  const guardadas = useBlitzGuardadas(dono, tenantId);
  const esperando = guardadas.some((x) => !x.erro);

  useEffect(() => {
    let vivo = true;
    const tentar = async (incluirRecusadas = false) => {
      if (navigator.onLine === false) return;
      const r = await enviarBlitzGuardadas(dono, tenantId, { incluirRecusadas });
      if (!vivo) return;
      avisarEnviadas(r);
      if (r.enviadas > 0) router.refresh();
    };
    // ao abrir: inclusive as recusadas (a sessão pode ter vencido na tentativa anterior)
    void tentar(true);
    const aoVoltarARede = () => { void tentar(); };
    const aoVoltarParaAFrente = () => { if (document.visibilityState === "visible") void tentar(); };
    window.addEventListener("online", aoVoltarARede);
    document.addEventListener("visibilitychange", aoVoltarParaAFrente);
    return () => {
      vivo = false;
      window.removeEventListener("online", aoVoltarARede);
      document.removeEventListener("visibilitychange", aoVoltarParaAFrente);
    };
  }, [dono, tenantId, router]);

  useEffect(() => {
    if (!esperando) return;
    const id = window.setInterval(async () => {
      if (navigator.onLine === false) return;
      const r = await enviarBlitzGuardadas(dono, tenantId);
      avisarEnviadas(r);
      if (r.enviadas > 0) router.refresh();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [esperando, dono, tenantId, router]);

  return null;
}

/**
 * O aviso na tela da blitz: o que está guardado no aparelho esperando sinal,
 * e o que o servidor recusou (com o motivo), até alguém descartar.
 */
export function AvisoBlitzGuardadas({ dono, tenantId }: { dono: string; tenantId: string }) {
  const router = useRouter();
  const guardadas = useBlitzGuardadas(dono, tenantId);
  const [enviando, setEnviando] = useState(false);
  const esperando = guardadas.filter((x) => !x.erro);
  const recusadas = guardadas.filter((x) => x.erro);
  if (guardadas.length === 0) return null;

  const enviarAgora = async () => {
    if (navigator.onLine === false) {
      toast.error("Ainda sem conexão. A blitz continua guardada e sai sozinha quando o sinal voltar.");
      return;
    }
    setEnviando(true);
    try {
      const r = await enviarBlitzGuardadas(dono, tenantId, { incluirRecusadas: true });
      avisarEnviadas(r);
      if (r.enviadas > 0) router.refresh();
      if (r.semConexao) toast.error("Não deu para enviar agora. A blitz continua guardada e o app tenta de novo sozinho.");
      else if (r.recusadas > 0) toast.error(plural(r.recusadas, "Uma blitz foi recusada. Veja o motivo no aviso.", "Algumas blitz foram recusadas. Veja os motivos no aviso."));
    } finally {
      setEnviando(false);
    }
  };

  const descartar = async (clientId: string, nome: string) => {
    const ok = await confirmDialog({
      title: "Descartar blitz",
      message: `A blitz de ${nome} não foi registrada no sistema. Descartar apaga ela deste aparelho, sem volta.`,
      confirmLabel: "Descartar",
      tone: "danger",
    });
    if (ok) removerBlitzGuardada(clientId);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {esperando.length > 0 && (
        <div
          role="status"
          style={{
            display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap",
            background: "var(--mh-warning-soft)", border: "1px solid var(--mh-warning)",
            borderRadius: "var(--mh-radius-md)", padding: "0.65rem 0.8rem",
          }}
        >
          <CloudOff size={18} style={{ color: "var(--mh-warning)", flexShrink: 0 }} aria-hidden />
          <div style={{ flex: "1 1 220px", fontSize: "0.85rem" }}>
            <strong>
              {esperando.length} blitz {plural(esperando.length, "guardada", "guardadas")} neste aparelho
            </strong>
, aguardando conexão para enviar. Não precisa registrar de novo.
            <div className="soft" style={{ fontSize: "0.76rem", marginTop: "0.2rem" }}>
              {esperando.map((x) => x.nome).join(", ")}
            </div>
          </div>
          <button type="button" className="btn btn-sm btn-primary" disabled={enviando} onClick={enviarAgora}>
            {enviando ? "Enviando…" : "Enviar agora"}
          </button>
        </div>
      )}
      {recusadas.map((x) => (
        <div
          key={x.clientId}
          role="alert"
          style={{
            display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap",
            background: "var(--mh-danger-soft)", border: "1px solid var(--mh-danger)",
            borderRadius: "var(--mh-radius-md)", padding: "0.65rem 0.8rem",
          }}
        >
          <TriangleAlert size={18} style={{ color: "var(--mh-danger)", flexShrink: 0 }} aria-hidden />
          <div style={{ flex: "1 1 220px", fontSize: "0.85rem" }}>
            <strong>Blitz de {x.nome} ({formatDate(x.input.occurredOn)}) não foi registrada.</strong>
            <div className="soft" style={{ fontSize: "0.78rem", marginTop: "0.2rem" }}>Motivo: {x.erro}</div>
          </div>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <button type="button" className="btn btn-sm btn-ghost" disabled={enviando} onClick={enviarAgora}>
              Tentar de novo
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => descartar(x.clientId, x.nome)}>
              Descartar
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
