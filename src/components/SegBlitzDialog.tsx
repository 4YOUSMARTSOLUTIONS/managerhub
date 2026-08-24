"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PeoplePicker, type Person } from "@/components/PeoplePicker";
import { SEG_BLITZ_RESPOSTA, SEG_VEICULO_PROPRIEDADE } from "@/lib/constants";
import { hojeYmd, shortName } from "@/lib/format";
import { segIconeSrc } from "@/lib/avatar";
import { criarBlitz } from "@/lib/actions/seguranca";
import type { Enums } from "@/types/database";

export type BlitzMeioOpt = {
  id: string;
  name: string;
  imagePath: string | null;
  temVeiculo: boolean;
  active: boolean;
};

export type BlitzPerguntaOpt = {
  id: string;
  name: string;
  active: boolean;
  /** vazio = vale para todos os meios */
  meioIds: string[];
};

export type VeiculoSugestao = {
  userId: string;
  meioId: string | null;
  placa: string;
  tipoDescricao: string | null;
  propriedade: Enums<"seg_veiculo_propriedade">;
};

/**
 * O formulário da portaria. A fila anda, então tudo aqui existe para reduzir
 * digitação: escolher o colaborador sugere o veículo da última blitz dele;
 * escolher o meio filtra as perguntas (sem vínculo = vale para todos); e o
 * bloqueio só abre o campo de motivo quando é bloqueio.
 *
 * As respostas começam VAZIAS de propósito: pré-marcar "sim" transformaria a
 * blitz em carimbo. O avaliador toca cada resposta.
 */
export function SegBlitzDialog({
  open, onClose, pessoas, meios, perguntas, motivos, veiculos,
}: {
  open: boolean;
  onClose: () => void;
  pessoas: Person[];
  meios: BlitzMeioOpt[];
  perguntas: BlitzPerguntaOpt[];
  motivos: { id: string; name: string; active: boolean }[];
  /** o veículo mais recente de cada colaborador, para a sugestão */
  veiculos: VeiculoSugestao[];
}) {
  const hoje = hojeYmd();
  const [userId, setUserId] = useState("");
  const [data, setData] = useState(hoje);
  const [meioId, setMeioId] = useState("");
  const [placa, setPlaca] = useState("");
  const [tipo, setTipo] = useState("");
  const [propriedade, setPropriedade] = useState<Enums<"seg_veiculo_propriedade">>("proprio");
  const [respostas, setRespostas] = useState<Record<string, Enums<"seg_blitz_resposta">>>({});
  const [liberado, setLiberado] = useState<boolean | null>(null);
  const [motivoId, setMotivoId] = useState("");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const meiosAtivos = useMemo(() => meios.filter((m) => m.active), [meios]);
  const meio = useMemo(() => meios.find((m) => m.id === meioId) ?? null, [meios, meioId]);

  // a cascata: pergunta sem vínculo vale para todos os meios
  const perguntasDoMeio = useMemo(
    () => perguntas.filter((q) => q.active && (q.meioIds.length === 0 || (!!meioId && q.meioIds.includes(meioId)))),
    [perguntas, meioId],
  );

  const limpar = () => {
    setUserId(""); setData(hoje); setMeioId(""); setPlaca(""); setTipo("");
    setPropriedade("proprio"); setRespostas({}); setLiberado(null);
    setMotivoId(""); setObservacao(""); setErro("");
  };

  /** Escolher o colaborador sugere o veículo da última blitz dele. */
  const escolherPessoa = (ids: string[]) => {
    const id = ids[0] ?? "";
    setUserId(id);
    const v = veiculos.find((x) => x.userId === id);
    if (v) {
      if (v.meioId) setMeioId(v.meioId);
      setPlaca(v.placa);
      setTipo(v.tipoDescricao ?? "");
      setPropriedade(v.propriedade);
    }
  };

  const responder = (perguntaId: string, r: Enums<"seg_blitz_resposta">) =>
    setRespostas((atual) => ({ ...atual, [perguntaId]: r }));

  const salvar = () => {
    setErro("");
    if (!userId) { setErro("Escolha o colaborador."); return; }
    if (!meioId) { setErro("Escolha o meio de transporte."); return; }
    // toda pergunta visível precisa de resposta: pular pergunta é o mesmo
    // que não fazer a blitz
    const semResposta = perguntasDoMeio.filter((q) => !respostas[q.id]);
    if (semResposta.length > 0) {
      setErro(`Responda todas as perguntas (${semResposta.length} em aberto).`);
      return;
    }
    if (liberado === null) { setErro("Informe se o veículo foi liberado ou bloqueado."); return; }
    if (!liberado && !motivoId) { setErro("Bloqueio precisa de um motivo."); return; }

    iniciar(async () => {
      const r = await criarBlitz({
        userId,
        occurredOn: data,
        meioId,
        placa: meio?.temVeiculo ? placa : null,
        veiculoTipo: meio?.temVeiculo ? tipo : null,
        propriedade: meio?.temVeiculo ? propriedade : null,
        liberado,
        motivoBloqueioId: liberado ? null : motivoId,
        observacao,
        respostas: perguntasDoMeio.map((q) => ({ perguntaId: q.id, resposta: respostas[q.id] })),
      });
      if (r.error) { setErro(r.error); return; }
      toast.success(r.message ?? "Blitz registrada.");
      limpar();
      onClose();
      router.refresh();
    });
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)",
        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "5vh 1rem", zIndex: 60, overflowY: "auto",
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 620, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>Blitz de trajeto</h2>
          <button
            type="button" onClick={() => { limpar(); onClose(); }} className="muted" aria-label="Fechar"
            style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "1.15rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.95rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 150px", gap: "0.8rem" }}>
            <div>
              <label className="label">Colaborador <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <PeoplePicker
                people={pessoas} selected={userId ? [userId] : []}
                onChange={escolherPessoa} single placeholder="Buscar colaborador…"
              />
            </div>
            <div>
              <label className="label">Data <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <input className="input" type="date" value={data} max={hoje} onChange={(e) => setData(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="label">Meio de transporte <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
              {meiosAtivos.map((m) => {
                const on = meioId === m.id;
                const src = segIconeSrc(m.imagePath);
                return (
                  <button
                    key={m.id} type="button" aria-pressed={on}
                    onClick={() => { setMeioId(m.id); setRespostas({}); }}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "0.4rem",
                      padding: "0.4rem 0.8rem", cursor: "pointer",
                      background: on ? "var(--mh-primary-soft)" : "var(--surface-2)",
                      border: "1px solid " + (on ? "var(--mh-primary-500)" : "var(--border)"),
                      borderRadius: 999, color: "var(--mh-text-1)",
                      fontSize: "0.82rem", fontWeight: on ? 600 : 500,
                    }}
                  >
                    {src && (
                      // eslint-disable-next-line @next/next/no-img-element -- bucket público, mesmo racional do Avatar
                      <img src={src} alt="" style={{ width: 18, height: 18, borderRadius: 4, objectFit: "cover" }} />
                    )}
                    {m.name}
                  </button>
                );
              })}
            </div>
          </div>

          {meio?.temVeiculo && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))", gap: "0.8rem" }}>
              <div>
                <label className="label">Placa</label>
                <input
                  className="input" value={placa} maxLength={10}
                  placeholder="ABC1D23" style={{ textTransform: "uppercase" }}
                  onChange={(e) => setPlaca(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Tipo de veículo</label>
                <input
                  className="input" value={tipo} placeholder="Honda CG 160"
                  onChange={(e) => setTipo(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Propriedade</label>
                <select
                  className="select" value={propriedade}
                  onChange={(e) => setPropriedade(e.target.value as Enums<"seg_veiculo_propriedade">)}
                >
                  {(Object.keys(SEG_VEICULO_PROPRIEDADE) as Enums<"seg_veiculo_propriedade">[]).map((p) => (
                    <option key={p} value={p}>{SEG_VEICULO_PROPRIEDADE[p]}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {meioId && perguntasDoMeio.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
              <label className="label" style={{ marginBottom: 0 }}>
                Verificação <span style={{ color: "var(--mh-danger)" }}>*</span>
              </label>
              {perguntasDoMeio.map((q) => (
                <div
                  key={q.id}
                  style={{
                    display: "flex", gap: "0.7rem", alignItems: "center", justifyContent: "space-between",
                    background: "var(--surface-2)", borderRadius: "var(--mh-radius-md)", padding: "0.55rem 0.75rem",
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ fontSize: "0.83rem", flex: "1 1 260px" }}>{q.name}</span>
                  <span style={{ display: "inline-flex", gap: "0.3rem" }}>
                    {(["sim", "nao", "na"] as Enums<"seg_blitz_resposta">[]).map((r) => {
                      const on = respostas[q.id] === r;
                      const cor = r === "sim" ? "var(--mh-success)" : r === "nao" ? "var(--mh-danger)" : "var(--mh-text-3)";
                      return (
                        <button
                          key={r} type="button" aria-pressed={on}
                          onClick={() => responder(q.id, r)}
                          style={{
                            padding: "0.25rem 0.65rem", cursor: "pointer", fontSize: "0.76rem",
                            fontWeight: on ? 700 : 500, borderRadius: 999,
                            background: on ? `color-mix(in srgb, ${cor} 14%, transparent)` : "var(--surface-1)",
                            border: "1px solid " + (on ? cor : "var(--border)"),
                            color: on ? cor : "var(--mh-text-2)",
                          }}
                        >
                          {SEG_BLITZ_RESPOSTA[r]}
                        </button>
                      );
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div>
            <label className="label">Decisão <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
              <button
                type="button" aria-pressed={liberado === true}
                onClick={() => { setLiberado(true); setMotivoId(""); }}
                style={{
                  padding: "0.45rem 1rem", cursor: "pointer", borderRadius: 999, fontSize: "0.82rem",
                  fontWeight: liberado === true ? 700 : 500,
                  background: liberado === true ? "color-mix(in srgb, var(--mh-success) 14%, transparent)" : "var(--surface-2)",
                  border: "1px solid " + (liberado === true ? "var(--mh-success)" : "var(--border)"),
                  color: liberado === true ? "var(--mh-success)" : "var(--mh-text-1)",
                }}
              >
                Liberado
              </button>
              <button
                type="button" aria-pressed={liberado === false}
                onClick={() => setLiberado(false)}
                style={{
                  padding: "0.45rem 1rem", cursor: "pointer", borderRadius: 999, fontSize: "0.82rem",
                  fontWeight: liberado === false ? 700 : 500,
                  background: liberado === false ? "color-mix(in srgb, var(--mh-danger) 14%, transparent)" : "var(--surface-2)",
                  border: "1px solid " + (liberado === false ? "var(--mh-danger)" : "var(--border)"),
                  color: liberado === false ? "var(--mh-danger)" : "var(--mh-text-1)",
                }}
              >
                Bloqueado
              </button>
            </div>
          </div>

          {liberado === false && (
            <div>
              <label className="label">Motivo do bloqueio <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <select className="select" value={motivoId} onChange={(e) => setMotivoId(e.target.value)}>
                <option value="">Escolha o motivo</option>
                {motivos.filter((m) => m.active).map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="label">Observação</label>
            <textarea
              className="input" rows={2} value={observacao}
              placeholder="O que vale registrar além das respostas."
              onChange={(e) => setObservacao(e.target.value)}
            />
          </div>

          {userId && (
            <p className="soft" style={{ fontSize: "0.74rem", margin: 0 }}>
              O gestor de {shortName(pessoas.find((p) => p.id === userId)?.name)} é avisado
              automaticamente se a blitz sair não conforme.
            </p>
          )}

          {erro && (
            <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
              {erro}
            </p>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" disabled={pendente} onClick={() => { limpar(); onClose(); }}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={pendente} onClick={salvar}>
            {pendente ? "Registrando…" : "Registrar blitz"}
          </button>
        </div>
      </div>
    </div>
  );
}
