"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Ban, CalendarPlus, Check, Pencil, Plane, Send, Trash2, Undo2,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { DetailModal } from "@/components/ui/DetailModal";
import { DetailSection, Field, FieldGrid } from "@/components/ui/Field";
import { Tabs, type Tab } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { ExportButton } from "@/components/ui/ExportButton";
import { StatCard } from "@/components/ui/StatCard";
import { confirmDialog } from "@/components/ui/confirm";
import type { Person } from "@/components/PeoplePicker";
import { FeriasSolicitarDialog } from "@/components/FeriasSolicitarDialog";
import { FeriasTimeline, type TimelineLinha } from "@/components/FeriasTimeline";
import { formatDate, formatDateTime, normalizar, shortName, somarDias } from "@/lib/format";
import {
  FERIAS_AQUISITIVO_SITUACAO, FERIAS_AQUISITIVO_TONE, FERIAS_STATUS, FERIAS_STATUS_TONE,
} from "@/lib/constants";
import { rotuloAquisitivo, type AquisitivoInfo, type FeriadoCustom } from "@/lib/ferias";
import {
  cancelarFerias, decidirFerias, efetivarFerias, excluirFerias, getContextoEfetivacao,
  type ContextoEfetivacao,
} from "@/lib/actions/ferias";
import type { Enums } from "@/types/database";

/** o retorno de `ferias_painel` (o escopo já vem recortado pela alçada) */
export type FeriasPainel = {
  agora: { userId: string; nome: string | null; setor: string | null; inicio: string; fim: string }[];
  proximas: { userId: string; nome: string | null; inicio: string; fim: string; origem: "efetivada" | "prevista" }[];
  timeline: TimelineLinha[];
  saldos: {
    userId: string; nome: string | null; setor: string | null; saldo: number;
    situacao: string | null; aquisitivoInicio: string | null; aquisitivoFim: string | null;
    gozarAte: string | null;
  }[];
  janelaInicio: string;
  janelaFim: string;
};

export type FeriasRow = {
  id: string;
  status: Enums<"ferias_status">;
  userId: string;
  startDate: string;
  endDate: string;
  dias: number;
  abonoDias: number;
  decimo: boolean;
  aquisitivoInicio: string;
  aquisitivoFim: string;
  reagendadaDe: string | null;
  fullName: string | null;
  employeeCode: string | null;
  departmentName: string | null;
  subdepartmentName: string | null;
  positionName: string | null;
  managerName: string | null;
  unitName: string | null;
  hierarchyName: string | null;
  createdBy: string;
  createdByName: string | null;
  lancadaPeloGestor: boolean;
  decidedAt: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  efetivadaAt: string | null;
  efetivadaByName: string | null;
  efetivacaoNote: string | null;
  cancelledAt: string | null;
  cancelNote: string | null;
  createdAt: string;
};

/**
 * A tela de férias, com as caras que o papel pede:
 *  - todo mundo vê "Minhas férias" (saldo por aquisitivo + as próprias previsões);
 *  - gestor ganha a fila de aprovação e o lançamento para a equipe (o caminho
 *    obrigatório do operacional);
 *  - o DP ganha a fila de efetivação, que é onde a previsão vira ausência real.
 *
 * O recorte de LINHAS já vem pronto da RLS (`pode_ver_ferias`); aqui só se
 * decide quais abas e botões existem.
 */
export function FeriasManager({
  rows, meuId, ehDp, ehOwner, ehGestor, podeSolicitar, avisoSolicitar,
  pessoasLancar, meusAquisitivos, feriados, hoje, painel,
}: {
  rows: FeriasRow[];
  meuId: string;
  ehDp: boolean;
  ehOwner: boolean;
  /** lidera equipe de fato (papel + subordinados) */
  ehGestor: boolean;
  podeSolicitar: boolean;
  /** por que o botão Solicitar não aparece (nível bloqueado, sem admissão) */
  avisoSolicitar: string | null;
  pessoasLancar: Person[];
  meusAquisitivos: AquisitivoInfo[];
  feriados: FeriadoCustom[];
  hoje: string;
  painel: FeriasPainel | null;
}) {
  const [dialogo, setDialogo] = useState<"solicitar" | "lancar" | null>(null);
  const [reenvio, setReenvio] = useState<FeriasRow | null>(null);
  const [reagendando, setReagendando] = useState<FeriasRow | null>(null);
  const [detalhe, setDetalhe] = useState<FeriasRow | null>(null);
  const [efetivando, setEfetivando] = useState<FeriasRow | null>(null);
  const [nota, setNota] = useState<{ row: FeriasRow; acao: "devolver" | "cancelar" } | null>(null);
  const router = useRouter();

  const minhas = useMemo(() => rows.filter((r) => r.userId === meuId), [rows, meuId]);
  const fila = useMemo(
    () => rows.filter((r) => r.status === "solicitada" && r.userId !== meuId),
    [rows, meuId]);
  const filaDp = useMemo(
    () => [...rows.filter((r) => r.status === "aprovada")].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [rows]);

  // o painel traz o FATO (employee_absences, inclusive o histórico pré-módulo);
  // sem ele, cai para as linhas do processo
  const emGozoQtd = painel
    ? painel.agora.length
    : rows.filter((r) => r.status === "efetivada" && r.startDate <= hoje && r.endDate >= hoje).length;
  const proximasQtd = painel
    ? painel.proximas.length
    : rows.filter((r) =>
        (r.status === "efetivada" || r.status === "aprovada") && r.startDate > hoje && r.startDate <= somarDias(hoje, 60)).length;
  const aVencerQtd = painel ? painel.saldos.filter((s) => s.situacao === "a_vencer").length : 0;
  const vencidasQtd = painel ? painel.saldos.filter((s) => s.situacao === "vencida").length : 0;

  const podeGerir = ehGestor || ehDp;

  const abas: Tab[] = [
    { id: "minhas", label: "Minhas férias", content: (
      <MinhasFerias
        minhas={minhas} aquisitivos={meusAquisitivos} avisoSolicitar={avisoSolicitar}
        podeSolicitar={podeSolicitar} onSolicitar={() => setDialogo("solicitar")}
        onReenviar={setReenvio} onDetalhe={setDetalhe} onCancelar={(r) => setNota({ row: r, acao: "cancelar" })}
        onReagendar={setReagendando}
        hoje={hoje}
      />
    ) },
  ];
  if (podeGerir) {
    abas.push({ id: "fila", label: `Aprovações${fila.length ? ` (${fila.length})` : ""}`, content: (
      <FilaGestor fila={fila} onDetalhe={setDetalhe} onDevolver={(r) => setNota({ row: r, acao: "devolver" })} />
    ) });
  }
  if (ehDp) {
    abas.push({ id: "efetivacao", label: `Efetivação${filaDp.length ? ` (${filaDp.length})` : ""}`, content: (
      <FilaDp fila={filaDp} onDetalhe={setDetalhe} onEfetivar={setEfetivando}
        onDevolver={(r) => setNota({ row: r, acao: "devolver" })} />
    ) });
  }
  if (podeGerir) {
    abas.push({ id: "todas", label: "Todas as previsões", content: (
      <TabelaGeral rows={rows} onDetalhe={setDetalhe} />
    ) });
  }
  if (podeGerir && painel) {
    abas.push({ id: "visao", label: "Visão geral", content: (
      <VisaoGeral painel={painel} hoje={hoje} />
    ) });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", flexWrap: "wrap", marginTop: "-3.2rem", marginBottom: "0.4rem" }}>
        {podeSolicitar && (
          <button type="button" className="btn btn-ghost" onClick={() => setDialogo("solicitar")}>
            <Plane size={15} aria-hidden /> Solicitar férias
          </button>
        )}
        {podeGerir && pessoasLancar.length > 0 && (
          <button type="button" className="btn btn-primary" onClick={() => setDialogo("lancar")}>
            <CalendarPlus size={15} aria-hidden /> Lançar férias
          </button>
        )}
      </div>

      {podeGerir && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.8rem" }}>
          <StatCard label="De férias agora" value={emGozoQtd} tone="green"
            hint={painel?.agora.slice(0, 3).map((r) => shortName(r.nome)).join(", ") || "ninguém em gozo hoje"} />
          <StatCard label="Próximas saídas (60 dias)" value={proximasQtd} tone="blue" />
          <StatCard label="Aguardando o gestor" value={rows.filter((r) => r.status === "solicitada").length}
            tone={fila.length > 0 ? "amber" : "gray"} />
          <StatCard label="Aguardando efetivação" value={filaDp.length} tone={filaDp.length > 0 ? "amber" : "gray"}
            hint={ehDp ? "o DP confirma o cálculo na folha" : undefined} />
          {painel && (
            <StatCard label="A vencer (90 dias)" value={aVencerQtd} tone={aVencerQtd > 0 ? "amber" : "gray"}
              hint="período concessivo terminando" />
          )}
          {painel && (
            <StatCard label="Vencidas" value={vencidasQtd} tone={vencidasQtd > 0 ? "red" : "green"}
              hint={vencidasQtd > 0 ? "concessão em dobro (art. 137)" : "nenhum estouro"} />
          )}
        </div>
      )}

      <Tabs tabs={abas} />

      {dialogo && (
        <FeriasSolicitarDialog
          modo={dialogo}
          pessoas={pessoasLancar}
          aquisitivos={dialogo === "solicitar" ? meusAquisitivos : null}
          feriados={feriados}
          hoje={hoje}
          onFechar={() => setDialogo(null)}
        />
      )}
      {reenvio && (
        <FeriasSolicitarDialog
          modo="reenviar"
          aquisitivos={reenvio.userId === meuId ? meusAquisitivos : null}
          feriados={feriados}
          hoje={hoje}
          inicial={{
            id: reenvio.id, inicio: reenvio.startDate, fim: reenvio.endDate,
            abono: reenvio.abonoDias, decimo: reenvio.decimo,
          }}
          onFechar={() => setReenvio(null)}
        />
      )}
      {reagendando && (
        <FeriasSolicitarDialog
          modo="reagendar"
          aquisitivos={null}
          feriados={feriados}
          hoje={hoje}
          inicial={{
            id: reagendando.id, inicio: reagendando.startDate, fim: reagendando.endDate,
            abono: reagendando.abonoDias, decimo: reagendando.decimo,
          }}
          onFechar={() => setReagendando(null)}
        />
      )}
      {detalhe && (
        <DetalheFerias
          row={detalhe} meuId={meuId} ehDp={ehDp} ehOwner={ehOwner}
          onFechar={() => setDetalhe(null)}
          onReenviar={(r) => { setDetalhe(null); setReenvio(r); }}
          onReagendar={(r) => { setDetalhe(null); setReagendando(r); }}
          onEfetivar={(r) => { setDetalhe(null); setEfetivando(r); }}
          onDevolver={(r) => { setDetalhe(null); setNota({ row: r, acao: "devolver" }); }}
          onCancelar={(r) => { setDetalhe(null); setNota({ row: r, acao: "cancelar" }); }}
        />
      )}
      {efetivando && (
        <EfetivarDialog row={efetivando} onFechar={() => setEfetivando(null)}
          onDevolver={(r) => { setEfetivando(null); setNota({ row: r, acao: "devolver" }); }} />
      )}
      {nota && (
        <NotaDialog
          titulo={nota.acao === "devolver" ? "Devolver a previsão" : "Cancelar a previsão"}
          descricao={nota.acao === "devolver"
            ? `A previsão de ${shortName(nota.row.fullName)} volta para correção de quem abriu.`
            : `As férias de ${shortName(nota.row.fullName)} de ${formatDate(nota.row.startDate)} a ${formatDate(nota.row.endDate)} serão canceladas.`}
          rotuloConfirmar={nota.acao === "devolver" ? "Devolver" : "Cancelar previsão"}
          onConfirmar={async (texto) => {
            const r = nota.acao === "devolver"
              ? await decidirFerias({ id: nota.row.id, aprovar: false, nota: texto })
              : await cancelarFerias({ id: nota.row.id, nota: texto });
            if (r.error) return r.error;
            toast.success(r.message ?? "Feito.");
            setNota(null);
            router.refresh();
            return null;
          }}
          onFechar={() => setNota(null)}
        />
      )}
    </div>
  );
}

// ============================================================================
// Minhas férias
// ============================================================================

function MinhasFerias({
  minhas, aquisitivos, podeSolicitar, avisoSolicitar, onSolicitar, onReenviar, onDetalhe, onCancelar, onReagendar, hoje,
}: {
  minhas: FeriasRow[];
  aquisitivos: AquisitivoInfo[];
  podeSolicitar: boolean;
  avisoSolicitar: string | null;
  onSolicitar: () => void;
  onReenviar: (r: FeriasRow) => void;
  onDetalhe: (r: FeriasRow) => void;
  onCancelar: (r: FeriasRow) => void;
  onReagendar: (r: FeriasRow) => void;
  hoje: string;
}) {
  const relevantes = aquisitivos.filter((a) => a.situacao !== "quitada" || a.diasUsados > 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", paddingTop: "0.9rem" }}>
      {avisoSolicitar && (
        <div className="card card-pad" style={{ fontSize: "0.85rem" }}>
          {avisoSolicitar}
        </div>
      )}

      {relevantes.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "0.8rem" }}>
          {relevantes.slice(-4).map((a) => (
            <div key={a.aqInicio} className="card card-pad">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>Aquisitivo {rotuloAquisitivo(a)}</span>
                <Badge tone={FERIAS_AQUISITIVO_TONE[a.situacao] ?? "gray"}>
                  {FERIAS_AQUISITIVO_SITUACAO[a.situacao] ?? a.situacao}
                </Badge>
              </div>
              <p className="soft" style={{ fontSize: "0.76rem", margin: "0.25rem 0 0.6rem" }}>
                {formatDate(a.aqInicio)} a {formatDate(a.aqFim)} · gozar até {formatDate(a.concessivoFim)}
              </p>
              <div style={{ fontSize: "1.35rem", fontWeight: 700 }} className="tabular">
                {a.saldo} <span className="soft" style={{ fontSize: "0.8rem", fontWeight: 400 }}>dia(s) de saldo</span>
              </div>
              {(a.diasUsados > 0 || a.abonoUsado > 0) && (
                <p className="soft" style={{ fontSize: "0.76rem", margin: "0.3rem 0 0" }}>
                  {a.diasUsados - a.abonoUsado} em gozo previsto{a.abonoUsado > 0 ? `, ${a.abonoUsado} de abono` : ""}, em {a.qtdPeriodos} período(s)
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {minhas.length === 0 ? (
        <EmptyState
          title="Nenhuma previsão de férias"
          description={podeSolicitar
            ? "Solicite as suas férias: o pedido vai ao seu gestor e depois ao departamento pessoal."
            : "Quando houver uma previsão para você, ela aparece aqui com o andamento."}
          action={podeSolicitar ? (
            <button type="button" className="btn btn-primary" onClick={onSolicitar}>
              <Plane size={15} aria-hidden /> Solicitar férias
            </button>
          ) : undefined}
        />
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Período</th>
                <th style={{ width: 70, textAlign: "right" }}>Dias</th>
                <th style={{ width: 80, textAlign: "right" }}>Abono</th>
                <th style={{ width: 120 }}>Aquisitivo</th>
                <th style={{ width: 170 }}>Situação</th>
                <th style={{ width: 210, textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {minhas.map((r) => (
                <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => onDetalhe(r)}>
                  <td style={{ fontWeight: 600 }}>
                    {formatDate(r.startDate)} a {formatDate(r.endDate)}
                    {r.status === "efetivada" && r.startDate <= hoje && r.endDate >= hoje && (
                      <span className="soft" style={{ fontWeight: 400 }}> · em gozo</span>
                    )}
                  </td>
                  <td className="tabular" style={{ textAlign: "right" }}>{r.dias}</td>
                  <td className="tabular" style={{ textAlign: "right" }}>{r.abonoDias || "—"}</td>
                  <td className="muted" style={{ fontSize: "0.82rem" }}>{r.aquisitivoInicio.slice(0, 4)}/{r.aquisitivoFim.slice(0, 4)}</td>
                  <td>
                    <Badge tone={FERIAS_STATUS_TONE[r.status]}>{FERIAS_STATUS[r.status]}</Badge>
                  </td>
                  <td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "inline-flex", gap: "0.35rem" }}>
                      {r.status === "reprovada" && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onReenviar(r)}>
                          <Pencil size={13} aria-hidden /> Corrigir
                        </button>
                      )}
                      {(r.status === "solicitada" || r.status === "reprovada") && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onCancelar(r)}>
                          <Ban size={13} aria-hidden /> Cancelar
                        </button>
                      )}
                      {r.status === "efetivada" && r.startDate > hoje && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onReagendar(r)}>
                          <CalendarPlus size={13} aria-hidden /> Reagendar
                        </button>
                      )}
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDetalhe(r)}>Detalhe</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Fila do gestor
// ============================================================================

function FilaGestor({
  fila, onDetalhe, onDevolver,
}: {
  fila: FeriasRow[];
  onDetalhe: (r: FeriasRow) => void;
  onDevolver: (r: FeriasRow) => void;
}) {
  const [decidindo, iniciar] = useTransition();
  const router = useRouter();

  const aprovar = async (r: FeriasRow) => {
    if (!(await confirmDialog({
      title: "Aprovar a previsão",
      message: `${shortName(r.fullName)}: ${formatDate(r.startDate)} a ${formatDate(r.endDate)} (${r.dias} dias${r.abonoDias ? ` + ${r.abonoDias} de abono` : ""}). A previsão segue para a efetivação do departamento pessoal.`,
      confirmLabel: "Aprovar",
    }))) return;
    iniciar(async () => {
      const res = await decidirFerias({ id: r.id, aprovar: true });
      if (res.error) { toast.error(res.error); return; }
      toast.success("Previsão aprovada.");
      router.refresh();
    });
  };

  if (fila.length === 0) {
    return (
      <div style={{ paddingTop: "0.9rem" }}>
        <EmptyState title="Nada aguardando você" description="As solicitações da sua equipe aparecem aqui para aprovar ou devolver." />
      </div>
    );
  }

  return (
    <div className="card" style={{ overflowX: "auto", marginTop: "0.9rem" }}>
      <table className="table">
        <thead>
          <tr>
            <th>Colaborador</th>
            <th style={{ width: 150 }}>Setor</th>
            <th style={{ width: 190 }}>Período</th>
            <th style={{ width: 70, textAlign: "right" }}>Dias</th>
            <th style={{ width: 80, textAlign: "right" }}>Abono</th>
            <th style={{ width: 250, textAlign: "right" }}>Decisão</th>
          </tr>
        </thead>
        <tbody>
          {fila.map((r) => (
            <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => onDetalhe(r)}>
              <td style={{ fontWeight: 600 }}>{shortName(r.fullName)}</td>
              <td className="muted" style={{ fontSize: "0.82rem" }}>{r.departmentName ?? "—"}</td>
              <td>{formatDate(r.startDate)} a {formatDate(r.endDate)}</td>
              <td className="tabular" style={{ textAlign: "right" }}>{r.dias}</td>
              <td className="tabular" style={{ textAlign: "right" }}>{r.abonoDias || "—"}</td>
              <td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: "inline-flex", gap: "0.35rem" }}>
                  <button type="button" className="btn btn-primary btn-sm" disabled={decidindo} onClick={() => aprovar(r)}>
                    <Check size={13} aria-hidden /> Aprovar
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDevolver(r)}>
                    <Undo2 size={13} aria-hidden /> Devolver
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Fila do DP
// ============================================================================

function FilaDp({
  fila, onDetalhe, onEfetivar, onDevolver,
}: {
  fila: FeriasRow[];
  onDetalhe: (r: FeriasRow) => void;
  onEfetivar: (r: FeriasRow) => void;
  onDevolver: (r: FeriasRow) => void;
}) {
  if (fila.length === 0) {
    return (
      <div style={{ paddingTop: "0.9rem" }}>
        <EmptyState title="Nada para efetivar" description="Previsões aprovadas pelo gestor chegam aqui para o cálculo e a efetivação na folha." />
      </div>
    );
  }
  return (
    <div className="card" style={{ overflowX: "auto", marginTop: "0.9rem" }}>
      <table className="table">
        <thead>
          <tr>
            <th>Colaborador</th>
            <th style={{ width: 150 }}>Setor</th>
            <th style={{ width: 190 }}>Período</th>
            <th style={{ width: 70, textAlign: "right" }}>Dias</th>
            <th style={{ width: 110 }}>Origem</th>
            <th style={{ width: 230, textAlign: "right" }}>Efetivação</th>
          </tr>
        </thead>
        <tbody>
          {fila.map((r) => (
            <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => onDetalhe(r)}>
              <td style={{ fontWeight: 600 }}>{shortName(r.fullName)}</td>
              <td className="muted" style={{ fontSize: "0.82rem" }}>{r.departmentName ?? "—"}</td>
              <td>{formatDate(r.startDate)} a {formatDate(r.endDate)}</td>
              <td className="tabular" style={{ textAlign: "right" }}>{r.dias}</td>
              <td>
                {r.reagendadaDe
                  ? <Badge variant="quiet" tone="amber">Reagendamento</Badge>
                  : r.lancadaPeloGestor
                    ? <Badge variant="quiet" tone="blue">Pelo gestor</Badge>
                    : <Badge variant="quiet" tone="gray">Solicitada</Badge>}
              </td>
              <td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: "inline-flex", gap: "0.35rem" }}>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => onEfetivar(r)}>
                    <Send size={13} aria-hidden /> Efetivar
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDevolver(r)}>
                    <Undo2 size={13} aria-hidden /> Devolver
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Tabela geral
// ============================================================================

function TabelaGeral({ rows, onDetalhe }: { rows: FeriasRow[]; onDetalhe: (r: FeriasRow) => void }) {
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("");

  const filtradas = useMemo(() => rows.filter((r) => {
    if (status && r.status !== status) return false;
    if (busca) {
      const q = normalizar(busca);
      const alvo = normalizar(`${r.fullName ?? ""} ${r.departmentName ?? ""} ${r.unitName ?? ""} ${r.employeeCode ?? ""}`);
      if (!alvo.includes(q)) return false;
    }
    return true;
  }), [rows, busca, status]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem", paddingTop: "0.9rem" }}>
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input" placeholder="Buscar por pessoa, matrícula, setor ou unidade…"
          value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 320 }}
        />
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 210 }}>
          <option value="">Todas as situações</option>
          {Object.entries(FERIAS_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="soft" style={{ fontSize: "0.8rem" }}>{filtradas.length} previsão(ões)</span>
        <div style={{ marginLeft: "auto" }}>
          <ExportButton
            filename="ferias"
            sheetName="Férias"
            headers={["Colaborador", "Matrícula", "Setor", "Unidade", "Início", "Término", "Dias", "Abono", "Aquisitivo", "Situação", "Aberta por"]}
            rows={filtradas.map((r) => [
              r.fullName, r.employeeCode, r.departmentName, r.unitName,
              formatDate(r.startDate), formatDate(r.endDate), r.dias, r.abonoDias,
              `${r.aquisitivoInicio.slice(0, 4)}/${r.aquisitivoFim.slice(0, 4)}`,
              FERIAS_STATUS[r.status], r.createdByName,
            ])}
          />
        </div>
      </div>

      {filtradas.length === 0 ? (
        <EmptyState title="Nada por aqui" description="Nenhuma previsão de férias com esses filtros." />
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th style={{ width: 140 }}>Setor</th>
                <th style={{ width: 110 }}>Unidade</th>
                <th style={{ width: 180 }}>Período</th>
                <th style={{ width: 64, textAlign: "right" }}>Dias</th>
                <th style={{ width: 105 }}>Aquisitivo</th>
                <th style={{ width: 165 }}>Situação</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((r) => (
                <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => onDetalhe(r)}>
                  <td style={{ fontWeight: 600 }}>{shortName(r.fullName)}</td>
                  <td className="muted" style={{ fontSize: "0.82rem" }}>{r.departmentName ?? "—"}</td>
                  <td className="muted" style={{ fontSize: "0.82rem" }}>{r.unitName ?? "—"}</td>
                  <td>{formatDate(r.startDate)} a {formatDate(r.endDate)}</td>
                  <td className="tabular" style={{ textAlign: "right" }}>{r.dias}</td>
                  <td className="muted" style={{ fontSize: "0.82rem" }}>{r.aquisitivoInicio.slice(0, 4)}/{r.aquisitivoFim.slice(0, 4)}</td>
                  <td><Badge tone={FERIAS_STATUS_TONE[r.status]}>{FERIAS_STATUS[r.status]}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Detalhe
// ============================================================================

function DetalheFerias({
  row, meuId, ehDp, ehOwner, onFechar, onReenviar, onReagendar, onEfetivar, onDevolver, onCancelar,
}: {
  row: FeriasRow;
  meuId: string;
  ehDp: boolean;
  ehOwner: boolean;
  onFechar: () => void;
  onReenviar: (r: FeriasRow) => void;
  onReagendar: (r: FeriasRow) => void;
  onEfetivar: (r: FeriasRow) => void;
  onDevolver: (r: FeriasRow) => void;
  onCancelar: (r: FeriasRow) => void;
}) {
  const [excluindo, iniciar] = useTransition();
  const router = useRouter();

  const excluir = async () => {
    if (!(await confirmDialog({
      title: "Excluir o registro",
      message: "A exclusão apaga o registro do trâmite. O caminho normal é cancelar, que mantém o histórico. Excluir mesmo assim?",
      confirmLabel: "Excluir",
      tone: "danger",
    }))) return;
    iniciar(async () => {
      const r = await excluirFerias(row.id);
      if (r.error) { toast.error(r.error); return; }
      toast.success(r.message ?? "Excluído.");
      onFechar();
      router.refresh();
    });
  };

  const podeCancelar =
    (row.status === "solicitada" && (row.createdBy === meuId || ehDp))
    || (row.status === "reprovada" && (row.createdBy === meuId || ehDp))
    || (row.status === "aprovada" && ehDp)
    || (row.status === "efetivada" && ehOwner);

  return (
    <DetailModal
      open
      onClose={onFechar}
      title={shortName(row.fullName)}
      width="lg"
      badges={
        <>
          <Badge tone={FERIAS_STATUS_TONE[row.status]}>{FERIAS_STATUS[row.status]}</Badge>
          {row.reagendadaDe && <Badge variant="quiet" tone="amber">Reagendamento</Badge>}
          {row.lancadaPeloGestor && <Badge variant="quiet" tone="blue">Lançada pelo gestor</Badge>}
          {row.decimo && <Badge variant="quiet" tone="gray">Adianta o 13º</Badge>}
        </>
      }
      footer={
        <>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            {ehOwner && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={excluindo} onClick={excluir}>
                <Trash2 size={13} aria-hidden /> Excluir
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            {row.status === "reprovada" && row.createdBy === meuId && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onReenviar(row)}>
                <Pencil size={13} aria-hidden /> Corrigir e reenviar
              </button>
            )}
            {row.status === "efetivada" && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onReagendar(row)}>
                <CalendarPlus size={13} aria-hidden /> Reagendar
              </button>
            )}
            {podeCancelar && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onCancelar(row)}>
                <Ban size={13} aria-hidden /> Cancelar
              </button>
            )}
            {row.status === "aprovada" && ehDp && (
              <>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDevolver(row)}>
                  <Undo2 size={13} aria-hidden /> Devolver
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => onEfetivar(row)}>
                  <Send size={13} aria-hidden /> Efetivar
                </button>
              </>
            )}
          </div>
        </>
      }
    >
      <FieldGrid>
        <Field label="Colaborador">{row.fullName}</Field>
        <Field label="Matrícula">{row.employeeCode}</Field>
        <Field label="Setor">{row.departmentName}</Field>
        <Field label="Subsetor">{row.subdepartmentName}</Field>
        <Field label="Função">{row.positionName}</Field>
        <Field label="Hierarquia">{row.hierarchyName}</Field>
        <Field label="Gestor">{row.managerName ? shortName(row.managerName) : null}</Field>
        <Field label="Unidade">{row.unitName}</Field>
      </FieldGrid>

      <DetailSection title="O período">
        <FieldGrid min={140}>
          <Field label="Início">{formatDate(row.startDate)}</Field>
          <Field label="Término">{formatDate(row.endDate)}</Field>
          <Field label="Dias de gozo">{String(row.dias)}</Field>
          <Field label="Abono pecuniário">{row.abonoDias ? `${row.abonoDias} dia(s)` : "Não"}</Field>
          <Field label="Aquisitivo">{`${formatDate(row.aquisitivoInicio)} a ${formatDate(row.aquisitivoFim)}`}</Field>
        </FieldGrid>
      </DetailSection>

      <DetailSection title="O trâmite">
        <FieldGrid min={180}>
          <Field label="Aberta por">{row.createdByName ? shortName(row.createdByName) : null}</Field>
          <Field label="Aberta em">{formatDateTime(row.createdAt)}</Field>
          {row.decidedAt && (
            <Field label={row.status === "reprovada" ? "Devolvida por" : "Aprovada por"}>
              {`${row.decidedByName ? shortName(row.decidedByName) : "—"} em ${formatDateTime(row.decidedAt)}`}
            </Field>
          )}
          {row.efetivadaAt && (
            <Field label="Efetivada por">{`${row.efetivadaByName ? shortName(row.efetivadaByName) : "—"} em ${formatDateTime(row.efetivadaAt)}`}</Field>
          )}
          {row.cancelledAt && <Field label="Cancelada em">{formatDateTime(row.cancelledAt)}</Field>}
        </FieldGrid>
        {row.decisionNote && (
          <p style={{ fontSize: "0.84rem", margin: "0.6rem 0 0", paddingLeft: "0.6rem", borderLeft: "2px solid var(--border)" }}>
            {row.decisionNote}
          </p>
        )}
        {row.efetivacaoNote && (
          <p className="soft" style={{ fontSize: "0.8rem", margin: "0.5rem 0 0" }}>Efetivação: {row.efetivacaoNote}</p>
        )}
        {row.cancelNote && (
          <p className="soft" style={{ fontSize: "0.8rem", margin: "0.5rem 0 0" }}>Cancelamento: {row.cancelNote}</p>
        )}
      </DetailSection>
    </DetailModal>
  );
}

// ============================================================================
// Efetivação (DP)
// ============================================================================

function EfetivarDialog({
  row, onFechar, onDevolver,
}: {
  row: FeriasRow;
  onFechar: () => void;
  onDevolver: (r: FeriasRow) => void;
}) {
  const [ctx, setCtx] = useState<ContextoEfetivacao | null | "carregando">("carregando");
  const [descontaRv, setDescontaRv] = useState(true);
  const [obs, setObs] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, iniciar] = useTransition();
  const router = useRouter();

  // o informativo chega por RPC (o RH não lê employee_absences direto)
  useEffect(() => {
    getContextoEfetivacao(row.id).then((c) => setCtx(c));
  }, [row.id]);

  const efetivar = () => {
    setErro("");
    iniciar(async () => {
      const r = await efetivarFerias({ id: row.id, descontaRv, nota: obs });
      if (r.error) { setErro(r.error); return; }
      toast.success("Férias efetivadas.");
      onFechar();
      router.refresh();
    });
  };

  const c = ctx === "carregando" ? null : ctx;

  return (
    <DetailModal
      open
      onClose={onFechar}
      title={`Efetivar: ${shortName(row.fullName)}`}
      width="md"
      badges={
        <>
          <Badge tone="amber">{FERIAS_STATUS.aprovada}</Badge>
          {row.reagendadaDe && <Badge variant="quiet" tone="amber">Reagendamento</Badge>}
          {row.decimo && <Badge variant="quiet" tone="gray">Adianta o 13º</Badge>}
        </>
      }
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDevolver(row)}>
            <Undo2 size={13} aria-hidden /> Devolver
          </button>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <button type="button" className="btn btn-ghost" onClick={onFechar}>Cancelar</button>
            <button type="button" className="btn btn-primary" disabled={salvando} onClick={efetivar}>
              {salvando ? "Efetivando…" : "Confirmar efetivação"}
            </button>
          </div>
        </>
      }
    >
      <FieldGrid min={140}>
        <Field label="Período">{`${formatDate(row.startDate)} a ${formatDate(row.endDate)}`}</Field>
        <Field label="Dias de gozo">{String(row.dias)}</Field>
        <Field label="Abono">{row.abonoDias ? `${row.abonoDias} dia(s)` : "Não"}</Field>
        <Field label="Aquisitivo">{`${row.aquisitivoInicio.slice(0, 4)}/${row.aquisitivoFim.slice(0, 4)}`}</Field>
        {c && <Field label="Saldo do aquisitivo">{`${c.saldo ?? "—"} dia(s)`}</Field>}
        {c?.concessivoFim && <Field label="Gozar até">{formatDate(c.concessivoFim)}</Field>}
      </FieldGrid>

      <DetailSection title="Informativo do art. 130 (faltas injustificadas)">
        {c == null ? (
          <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Carregando…</p>
        ) : (
          <>
            <FieldGrid min={160}>
              <Field label="Faltas no aquisitivo">{`${c.faltasDias} dia(s) em ${c.faltasQtd} registro(s)`}</Field>
              <Field label="Direito pela tabela">{`${c.direitoArt130} dias`}</Field>
            </FieldGrid>
            <p className="soft" style={{ fontSize: "0.76rem", margin: "0.5rem 0 0" }}>
              Só informação para o cálculo da folha: o sistema não reduz o saldo sozinho.
              {c.direitoArt130 < 30 ? " Atenção: pelas faltas registradas, o direito seria menor que 30 dias." : ""}
            </p>
            {c.irmas.length > 0 && (
              <p className="soft" style={{ fontSize: "0.76rem", margin: "0.4rem 0 0" }}>
                Outros períodos do mesmo aquisitivo: {c.irmas.map((i) => `${formatDate(i.inicio)} a ${formatDate(i.fim)} (${FERIAS_STATUS[i.status as Enums<"ferias_status">] ?? i.status})`).join("; ")}.
              </p>
            )}
          </>
        )}
      </DetailSection>

      <DetailSection title="Efetivação">
        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.84rem", cursor: "pointer" }}>
          <input type="checkbox" checked={descontaRv} onChange={(e) => setDescontaRv(e.target.checked)} />
          Os dias contam na proporcionalidade da remuneração variável
        </label>
        <div style={{ marginTop: "0.6rem" }}>
          <label className="label">Observação da efetivação</label>
          <textarea
            className="input" rows={2} value={obs}
            placeholder="Ex.: calculada na folha de setembro."
            onChange={(e) => setObs(e.target.value)}
          />
        </div>
        {erro && (
          <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: "0.6rem 0 0", background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
            {erro}
          </p>
        )}
      </DetailSection>
    </DetailModal>
  );
}

// ============================================================================
// Visão geral (gestor e DP)
// ============================================================================

function VisaoGeral({ painel, hoje }: { painel: FeriasPainel; hoje: string }) {
  const comPendencia = painel.saldos.filter((s) => s.situacao === "vencida" || s.situacao === "a_vencer");
  const [mostrarTodos, setMostrarTodos] = useState(false);
  const listaSaldos = mostrarTodos ? painel.saldos : comPendencia;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", paddingTop: "0.9rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "0.8rem" }}>
        <div className="card card-pad">
          <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 0.6rem" }}>De férias agora</h3>
          {painel.agora.length === 0 ? (
            <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Ninguém em gozo hoje.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {painel.agora.map((a) => (
                <div key={`${a.userId}${a.inicio}`} style={{ display: "flex", gap: "0.5rem", alignItems: "baseline", fontSize: "0.84rem" }}>
                  <span style={{ fontWeight: 600 }}>{shortName(a.nome)}</span>
                  <span className="soft" style={{ fontSize: "0.76rem" }}>{a.setor ?? ""}</span>
                  <span className="soft" style={{ marginLeft: "auto", fontSize: "0.78rem" }}>volta {formatDate(somarDias(a.fim, 1))}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card card-pad">
          <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 0.6rem" }}>Próximas saídas (60 dias)</h3>
          {painel.proximas.length === 0 ? (
            <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Nenhuma saída marcada para os próximos 60 dias.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {painel.proximas.slice(0, 8).map((p) => (
                <div key={`${p.userId}${p.inicio}`} style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.84rem" }}>
                  <span style={{ fontWeight: 600 }}>{shortName(p.nome)}</span>
                  <Badge variant="quiet" tone={p.origem === "efetivada" ? "green" : "blue"}>
                    {p.origem === "efetivada" ? "Efetivada" : "Prevista"}
                  </Badge>
                  <span className="soft" style={{ marginLeft: "auto", fontSize: "0.78rem" }}>
                    {formatDate(p.inicio)} a {formatDate(p.fim)}
                  </span>
                </div>
              ))}
              {painel.proximas.length > 8 && (
                <p className="soft" style={{ fontSize: "0.76rem", margin: "0.2rem 0 0" }}>
                  e mais {painel.proximas.length - 8} na linha do tempo abaixo.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <FeriasTimeline
        linhas={painel.timeline}
        janelaInicio={painel.janelaInicio}
        janelaFim={painel.janelaFim}
        hoje={hoje}
      />

      <div className="card card-pad">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem" }}>
          <div>
            <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: 0 }}>Saldos e prazos de concessão</h3>
            <p className="soft" style={{ fontSize: "0.76rem", margin: "0.2rem 0 0" }}>
              O próximo período aquisitivo a programar de cada colaborador. Vencida = a
              concessão passou do prazo e agora é em dobro (art. 137).
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMostrarTodos((v) => !v)}>
            {mostrarTodos ? "Ver só as pendências" : `Ver todos (${painel.saldos.length})`}
          </button>
        </div>
        {listaSaldos.length === 0 ? (
          <p className="soft" style={{ fontSize: "0.82rem", margin: "0.7rem 0 0" }}>
            Nenhum período a vencer ou vencido. Tudo em dia.
          </p>
        ) : (
          <div style={{ overflowX: "auto", marginTop: "0.7rem" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Colaborador</th>
                  <th style={{ width: 150 }}>Setor</th>
                  <th style={{ width: 120 }}>Aquisitivo</th>
                  <th style={{ width: 80, textAlign: "right" }}>Saldo</th>
                  <th style={{ width: 120 }}>Gozar até</th>
                  <th style={{ width: 130 }}>Situação</th>
                </tr>
              </thead>
              <tbody>
                {listaSaldos.slice(0, 60).map((s) => (
                  <tr key={s.userId}>
                    <td style={{ fontWeight: 600 }}>{shortName(s.nome)}</td>
                    <td className="muted" style={{ fontSize: "0.82rem" }}>{s.setor ?? "—"}</td>
                    <td className="muted" style={{ fontSize: "0.82rem" }}>
                      {s.aquisitivoInicio ? `${s.aquisitivoInicio.slice(0, 4)}/${s.aquisitivoFim?.slice(0, 4)}` : "—"}
                    </td>
                    <td className="tabular" style={{ textAlign: "right" }}>{s.saldo}</td>
                    <td className="muted" style={{ fontSize: "0.82rem" }}>{s.gozarAte ? formatDate(s.gozarAte) : "—"}</td>
                    <td>
                      {s.situacao ? (
                        <Badge tone={FERIAS_AQUISITIVO_TONE[s.situacao] ?? "gray"}>
                          {FERIAS_AQUISITIVO_SITUACAO[s.situacao] ?? s.situacao}
                        </Badge>
                      ) : (
                        <Badge variant="quiet" tone="green">Em dia</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {listaSaldos.length > 60 && (
              <p className="soft" style={{ fontSize: "0.76rem", margin: "0.5rem 0 0" }}>
                Mostrando 60 de {listaSaldos.length}. Use a exportação de Todas as previsões para a lista completa.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Nota (devolver / cancelar)
// ============================================================================

function NotaDialog({
  titulo, descricao, rotuloConfirmar, onConfirmar, onFechar,
}: {
  titulo: string;
  descricao: string;
  rotuloConfirmar: string;
  /** devolve a mensagem de erro, ou null se deu certo */
  onConfirmar: (nota: string) => Promise<string | null>;
  onFechar: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, iniciar] = useTransition();

  const confirmar = () => {
    setErro("");
    if (!texto.trim()) { setErro("Informe o motivo."); return; }
    iniciar(async () => {
      const e = await onConfirmar(texto.trim());
      if (e) setErro(e);
    });
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)",
        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "8vh 1rem", zIndex: 70, overflowY: "auto",
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 480, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: 0 }}>{titulo}</h2>
          <button
            type="button" onClick={onFechar} className="muted" aria-label="Fechar"
            style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>
        <div style={{ padding: "1.15rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.7rem" }}>
          <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>{descricao}</p>
          <div>
            <label className="label">Motivo <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <textarea className="input" rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} />
          </div>
          {erro && (
            <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
              {erro}
            </p>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" onClick={onFechar}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={salvando} onClick={confirmar}>
            {salvando ? "Salvando…" : rotuloConfirmar}
          </button>
        </div>
      </div>
    </div>
  );
}
