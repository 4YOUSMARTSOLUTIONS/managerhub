"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MessageSquare, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { formatDate, hojeYmd, shortName } from "@/lib/format";
import { registrarTratativaBlitz, type BlitzAlerta } from "@/lib/actions/seguranca";

/**
 * As blitzes não conformes da equipe do gestor, e a tratativa de cada uma.
 *
 * O alerta nasce sozinho quando a blitz sai não conforme; este bloco é onde o
 * gestor fecha o ciclo: conversa com a pessoa (justificativa, orientação,
 * diálogo) e registra. Só o gestor alertado registra, porque tratativa
 * preenchida por outro transformaria o indicador em ficção.
 *
 * O bloco só existe quando há alerta: gestor sem pendência não precisa saber
 * que essa parte da tela existe.
 */
export function SegBlitzTratativas({ alertas }: { alertas: BlitzAlerta[] }) {
  const [abrindo, setAbrindo] = useState<BlitzAlerta | null>(null);

  if (alertas.length === 0) return null;

  const pendentes = alertas.filter((a) => !a.tratativa_em).length;

  return (
    <div className="card card-pad" style={{ marginBottom: "1.1rem" }}>
      <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <ShieldAlert size={16} aria-hidden /> Blitzes não conformes na sua equipe
      </h3>
      <p className="soft" style={{ fontSize: "0.76rem", margin: "0.2rem 0 0" }}>
        {pendentes > 0
          ? `${pendentes} sem tratativa registrada. Converse com a pessoa e registre o que combinaram.`
          : "Todas as tratativas foram registradas. Obrigado por fechar o ciclo."}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginTop: "0.9rem" }}>
        {alertas.map((a) => (
          <div
            key={a.id}
            style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "0.7rem 0.8rem", background: "var(--surface-2)" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.6rem", flexWrap: "wrap", alignItems: "flex-start" }}>
              <div style={{ minWidth: 220, flex: "1 1 340px" }}>
                <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontWeight: 700, fontSize: "0.88rem" }}>{shortName(a.colaborador)}</span>
                  <Badge variant="quiet" tone="blue">{a.meio ?? "—"}</Badge>
                  <Badge tone={a.liberado ? "amber" : "red"}>
                    {a.liberado ? "Liberado com desvio" : "Bloqueado"}
                  </Badge>
                  <span className="soft" style={{ fontSize: "0.75rem" }}>{formatDate(a.occurred_on)}</span>
                  {a.tratativa_em
                    ? <Badge tone="green">Tratado em {formatDate(a.tratativa_em)}</Badge>
                    : <Badge tone="amber">Aguardando sua tratativa</Badge>}
                </div>
                {a.motivo && (
                  <p style={{ fontSize: "0.82rem", margin: "0.35rem 0 0" }}>Motivo do bloqueio: {a.motivo}</p>
                )}
                {a.respostas_nao.length > 0 && (
                  <ul className="soft" style={{ fontSize: "0.76rem", margin: "0.35rem 0 0", paddingLeft: "1.1rem" }}>
                    {a.respostas_nao.map((q, i) => <li key={i}>{q}</li>)}
                  </ul>
                )}
                {a.tratativa_resumo && (
                  <p style={{ fontSize: "0.8rem", margin: "0.45rem 0 0", paddingLeft: "0.6rem", borderLeft: "2px solid var(--border)" }}>
                    {a.tratativa_resumo}
                    {a.tratativa_acordo && (
                      <><br /><span className="soft">Combinado: {a.tratativa_acordo}</span></>
                    )}
                  </p>
                )}
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAbrindo(a)}>
                <MessageSquare size={14} aria-hidden /> {a.tratativa_em ? "Editar registro" : "Registrar tratativa"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {abrindo && (
        <TratativaDialog key={abrindo.id} alerta={abrindo} onFechar={() => setAbrindo(null)} />
      )}
    </div>
  );
}

/** Registro da tratativa. Fecha por X ou Cancelar, nunca por clique no fundo. */
function TratativaDialog({ alerta, onFechar }: { alerta: BlitzAlerta; onFechar: () => void }) {
  const [em, setEm] = useState(alerta.tratativa_em ?? hojeYmd());
  const [resumo, setResumo] = useState(alerta.tratativa_resumo ?? "");
  const [acordo, setAcordo] = useState(alerta.tratativa_acordo ?? "");
  const [erro, setErro] = useState("");
  const [salvando, iniciar] = useTransition();
  const router = useRouter();

  const salvar = () => {
    setErro("");
    iniciar(async () => {
      const r = await registrarTratativaBlitz({ alertaId: alerta.id, em, resumo, acordo });
      if (r.error) { setErro(r.error); return; }
      toast.success(r.message ?? "Tratativa registrada.");
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
        padding: "6vh 1rem", zIndex: 70, overflowY: "auto",
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 560, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: 0 }}>Registrar a tratativa</h2>
          <button
            type="button" onClick={onFechar} className="muted" aria-label="Fechar"
            style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "1.15rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.85rem" }}>
          <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
            Blitz de {shortName(alerta.colaborador)} em {formatDate(alerta.occurred_on)}
            {alerta.meio ? `, de ${alerta.meio.toLowerCase()}` : ""}.
          </p>

          <div>
            <label className="label">Data da conversa <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <input className="input" type="date" value={em} max={hojeYmd()} onChange={(e) => setEm(e.target.value)} />
          </div>

          <div>
            <label className="label">O que foi tratado <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <textarea
              className="input" rows={4} value={resumo}
              placeholder="Como foi a conversa: justificativa, orientação ou diálogo, e o que a pessoa apontou."
              onChange={(e) => setResumo(e.target.value)}
            />
          </div>

          <div>
            <label className="label">O que ficou combinado</label>
            <textarea
              className="input" rows={2} value={acordo}
              placeholder="O compromisso assumido, com prazo quando houver."
              onChange={(e) => setAcordo(e.target.value)}
            />
          </div>

          {erro && (
            <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
              {erro}
            </p>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" onClick={onFechar}>Cancelar</button>
          <button
            type="button" className="btn btn-primary"
            disabled={salvando || !em || !resumo.trim()} onClick={salvar}
          >
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
