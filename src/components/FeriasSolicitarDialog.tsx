"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { InfoHint } from "@/components/ui/InfoHint";
import { PeoplePicker, type Person } from "@/components/PeoplePicker";
import {
  diasDoPeriodo, inicioMinimo, mensagemAntecedencia, motivoInicioInvalido, permissoesPorPeriodo,
  rotuloAquisitivo, validarConjunto,
  type AquisitivoInfo, type DecimoPedido, type FeriadoCustom, type PeriodoInput,
} from "@/lib/ferias";
import { FERIAS_AQUISITIVO_SITUACAO, FERIAS_AQUISITIVO_TONE } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import {
  getAquisitivosDe, lancarFerias, reagendarFerias, reenviarFerias, solicitarFerias,
} from "@/lib/actions/ferias";

/**
 * O formulário da previsão de férias: até 3 períodos, abono pecuniário e
 * adiantamento do 13º, com as regras CLT recusando ANTES do envio (o banco
 * revalida tudo; aqui é só para o erro chegar sem round-trip).
 *
 * Três modos no mesmo formulário:
 *  - solicitar: o colaborador pede as próprias férias (aquisitivos dele à vista);
 *  - lancar: o gestor programa para alguém da equipe (caminho do operacional);
 *    os aquisitivos da pessoa escolhida são buscados na hora, para o saldo
 *    aparecer e a recusa vir antes do envio;
 *  - reenviar: corrige UMA previsão devolvida.
 *
 * Fecha por X ou Cancelar, nunca por clique no fundo.
 */
export function FeriasSolicitarDialog({
  modo, pessoas, aquisitivos, feriados, hoje, inicial, ehDp = false, usaFolha = false,
  antecedencia = 0, decimos, onFechar,
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
  /** o DP pode lançar férias em dobro (prazo de concessão vencido) */
  ehDp?: boolean;
  /** a empresa importa os aquisitivos da folha */
  usaFolha?: boolean;
  /**
   * Antecedência mínima, em dias, quando é o colaborador quem pede (Configurações
   * > Férias). 0 no lançamento do gestor e do DP. O banco confere de novo.
   */
  antecedencia?: number;
  /** fora do modo lancar: os 13º que a pessoa já pediu (sem a linha em edição) */
  decimos?: DecimoPedido[];
  onFechar: () => void;
}) {
  const [userId, setUserId] = useState<string[]>([]);
  // aquisitivos de quem está sendo lançado (modo lancar)
  const [doAlvo, setDoAlvo] = useState<AquisitivoInfo[] | null>(null);
  const [decimosAlvo, setDecimosAlvo] = useState<DecimoPedido[]>([]);
  const [carregandoAlvo, setCarregandoAlvo] = useState(false);
  const [erroAlvo, setErroAlvo] = useState("");
  const pedido = useRef(0);
  const [dobro, setDobro] = useState(false);
  const [justificativa, setJustificativa] = useState("");
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

  const minimo = inicioMinimo(hoje, antecedencia);

  // o aviso por período aparece embaixo do campo, sem esperar o Salvar
  const avisos = useMemo(() => periodos.map((p) => {
    if (!p.inicio) return null;
    if (p.inicio <= hoje) return "A previsão precisa começar depois de hoje.";
    if (minimo && p.inicio < minimo) return mensagemAntecedencia(hoje, antecedencia);
    return motivoInicioInvalido(p.inicio, feriados);
  }), [periodos, hoje, feriados, minimo, antecedencia]);

  const mudar = (i: number, patch: Partial<PeriodoInput>) =>
    setPeriodos((xs) => xs.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  // no lançamento, o saldo e os 13º são os de quem foi escolhido
  const aqs = modo === "lancar" ? doAlvo : aquisitivos;
  const decs = useMemo(
    () => (modo === "lancar" ? decimosAlvo : decimos ?? []),
    [modo, decimosAlvo, decimos],
  );
  // abono só no primeiro período do aquisitivo; 13º uma vez por ano
  const permissoes = useMemo(() => permissoesPorPeriodo(periodos, aqs, decs), [periodos, aqs, decs]);

  /** Busca no evento de escolha (não num efeito): resposta velha não sobrescreve a nova. */
  const escolherPessoa = (ids: string[]) => {
    setUserId(ids);
    setDoAlvo(null);
    setDecimosAlvo([]);
    setErroAlvo("");
    const n = ++pedido.current;
    if (ids.length === 0) { setCarregandoAlvo(false); return; }
    setCarregandoAlvo(true);
    getAquisitivosDe({ userId: ids[0], hoje }).then((r) => {
      if (n !== pedido.current) return;
      setCarregandoAlvo(false);
      if (r.error !== undefined) { setErroAlvo(r.error); return; }
      setDoAlvo(r.aquisitivos);
      setDecimosAlvo(r.decimos);
    });
  };

  const salvar = () => {
    setErro("");
    if (modo === "lancar" && userId.length === 0) {
      setErro("Escolha o colaborador.");
      return;
    }
    if (modo === "lancar" && dobro && !justificativa.trim()) {
      setErro("Escreva a justificativa das férias em dobro.");
      return;
    }
    // validação client: completa quando temos os aquisitivos, leve quando não
    if (aqs) {
      const r = validarConjunto(periodos, aqs, hoje, feriados, {
        permiteDobro: modo === "lancar" && dobro,
        usaFolha,
        antecedencia,
        decimos: decs,
      });
      if (r.erro) { setErro(r.erro); return; }
    } else {
      for (let i = 0; i < periodos.length; i++) {
        const p = periodos[i];
        if (!p.inicio || !p.fim) { setErro("Informe o início e o término de cada período."); return; }
        if (avisos[i]) { setErro(avisos[i] as string); return; }
        const d = permissoes[i].decimo;
        if (p.decimo && !d.ok) { setErro(d.motivo); return; }
      }
    }

    iniciar(async () => {
      const r = modo === "solicitar"
        ? await solicitarFerias({ periodos, hoje })
        : modo === "lancar"
          ? await lancarFerias({
              userId: userId[0], periodos, hoje,
              justificativaDobro: dobro ? justificativa : undefined,
            })
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
              <PeoplePicker people={pessoas ?? []} selected={userId} onChange={escolherPessoa} single />
              {carregandoAlvo && (
                <p className="soft" style={{ fontSize: "0.78rem", margin: "0.4rem 0 0" }}>Buscando o saldo…</p>
              )}
              {erroAlvo && (
                <p style={{ color: "var(--mh-danger)", fontSize: "0.78rem", margin: "0.4rem 0 0" }}>{erroAlvo}</p>
              )}
              {doAlvo && doAlvo.length === 0 && (
                <p style={{ color: "var(--mh-danger)", fontSize: "0.78rem", margin: "0.4rem 0 0" }}>
                  {usaFolha
                    ? "Os períodos aquisitivos desta pessoa ainda não foram importados: o lançamento será recusado até o departamento pessoal importar."
                    : "A data de admissão desta pessoa não está cadastrada."}
                </p>
              )}
            </div>
          )}

          {minimo && (
            <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>
              Peça com pelo menos {antecedencia} dias de antecedência, para o departamento pessoal
              calcular e pagar a tempo: o primeiro dia possível é <strong>{formatDate(minimo)}</strong>.
            </p>
          )}

          {modo === "reagendar" && inicial && (
            <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>
              Reagendando as férias de {formatDate(inicial.inicio)} a {formatDate(inicial.fim)}.
              Elas continuam valendo até o departamento pessoal verificar e efetivar a troca.
            </p>
          )}

          {aqs && aqs.length > 0 && (
            <div style={{ background: "var(--surface-2)", borderRadius: 9, padding: "0.65rem 0.8rem" }}>
              <div className="soft" style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.4rem" }}>
                Saldo por período aquisitivo
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                {aqs.filter((a) => a.situacao !== "quitada" || a.diasUsados > 0).slice(-4).map((a) => (
                  <div key={a.aqInicio} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.82rem", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, minWidth: 76 }}>{rotuloAquisitivo(a)}</span>
                    <span className="soft">
                      {formatDate(a.aqInicio)} a {formatDate(a.aqFim)}
                      {a.situacao !== "em_curso" && a.situacao !== "quitada" && ` · gozar até ${formatDate(a.concessivoFim)}`}
                    </span>
                    <span style={{ marginLeft: "auto" }} className="tabular">{a.saldo} dia(s)</span>
                    <Badge variant="quiet" tone={FERIAS_AQUISITIVO_TONE[a.situacao] ?? "gray"}>
                      {FERIAS_AQUISITIVO_SITUACAO[a.situacao] ?? a.situacao}
                    </Badge>
                  </div>
                ))}
              </div>
              <p className="soft" style={{ fontSize: "0.74rem", margin: "0.45rem 0 0" }}>
                O saldo mais antigo é usado primeiro, e as férias precisam terminar dentro do prazo
                de concessão. Início permitido de segunda a quinta, fora de feriado e das vésperas
                (art. 134).
              </p>
            </div>
          )}

          {modo === "lancar" && ehDp && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "0.7rem 0.8rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.84rem", cursor: "pointer" }}>
                <input type="checkbox" checked={dobro} onChange={(e) => setDobro(e.target.checked)} />
                Férias em dobro (o gozo termina depois do prazo de concessão)
              </label>
              {dobro && (
                <>
                  <p className="soft" style={{ fontSize: "0.76rem", margin: "0.4rem 0 0.5rem" }}>
                    Só para regularizar um período que já passou do prazo: os dias depois dele são
                    pagos em dobro (art. 137). A justificativa fica registrada na previsão.
                  </p>
                  <label className="label">Justificativa <span style={{ color: "var(--mh-danger)" }}>*</span></label>
                  <textarea
                    className="input" rows={2} value={justificativa}
                    placeholder="Ex.: período vencido durante o afastamento pelo INSS."
                    onChange={(e) => setJustificativa(e.target.value)}
                  />
                </>
              )}
            </div>
          )}

          {periodos.map((p, i) => {
            const permAbono = permissoes[i].abono;
            const permDecimo = permissoes[i].decimo;
            // campo travado só quando está zerado: com valor, fica aberto para
            // a pessoa poder zerar (e o aviso diz por quê)
            const abonoTravado = permAbono?.ok === false && p.abono === 0;
            const decimoTravado = !permDecimo.ok && !p.decimo;
            return (
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
                  <input className="input" type="date" value={p.inicio} min={minimo ?? hoje} onChange={(e) => mudar(i, { inicio: e.target.value })} />
                </div>
                <div>
                  <label className="label">Término <span style={{ color: "var(--mh-danger)" }}>*</span></label>
                  <input className="input" type="date" value={p.fim} min={p.inicio || minimo || hoje} onChange={(e) => mudar(i, { fim: e.target.value })} />
                </div>
                <div>
                  <label className="label" style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                    Abono (dias)
                    <InfoHint label="O que é o abono pecuniário" align="right">
                      <strong>Abono pecuniário</strong>{" "}é a &quot;venda&quot; de parte das férias: você
                      trabalha esses dias e recebe por eles, além do pagamento normal das férias.
                      <br /><br />
                      Vai até um terço do direito (10 dias para quem tem 30) e só pode ser pedido no
                      primeiro período de gozo do período aquisitivo (ou no único, se as férias não
                      forem divididas). Ex.: 20 dias de férias e 10 de abono.
                    </InfoHint>
                  </label>
                  <input
                    className="input" type="number" min={0} max={10} value={p.abono}
                    disabled={abonoTravado}
                    title={abonoTravado && permAbono?.ok === false ? permAbono.motivo : undefined}
                    onChange={(e) => mudar(i, { abono: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })}
                  />
                </div>
              </div>
              <label
                style={{
                  display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", marginTop: "0.5rem",
                  cursor: decimoTravado ? "not-allowed" : "pointer", opacity: decimoTravado ? 0.6 : 1,
                }}
              >
                <input
                  type="checkbox" checked={p.decimo} disabled={decimoTravado}
                  onChange={(e) => mudar(i, { decimo: e.target.checked })}
                />
                Adiantar a 1ª parcela do 13º junto destas férias
              </label>
              {!permDecimo.ok && (
                <p
                  className={p.decimo ? undefined : "soft"}
                  style={{ fontSize: "0.76rem", margin: "0.3rem 0 0", color: p.decimo ? "var(--mh-danger)" : undefined }}
                >
                  {permDecimo.motivo}
                </p>
              )}
              {permAbono?.ok === false && (
                <p
                  className={p.abono > 0 ? undefined : "soft"}
                  style={{ fontSize: "0.76rem", margin: "0.3rem 0 0", color: p.abono > 0 ? "var(--mh-danger)" : undefined }}
                >
                  {permAbono.motivo}{p.abono > 0 ? " Zere o abono deste período." : ""}
                </p>
              )}
              {avisos[i] && (
                <p style={{ color: "var(--mh-danger)", fontSize: "0.78rem", margin: "0.45rem 0 0" }}>{avisos[i]}</p>
              )}
            </div>
            );
          })}

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
                Total do pedido: <strong>{totalDias}</strong> dia(s) (gozo + abono)
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
