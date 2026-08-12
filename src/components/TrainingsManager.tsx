"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileCheck, GraduationCap, History, Layers, Lock, Pencil, PlayCircle, Trash2, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatCard } from "@/components/ui/StatCard";
import { Tabs, type Tab } from "@/components/ui/Tabs";
import { confirmDialog } from "@/components/ui/confirm";
import { PeoplePicker } from "@/components/PeoplePicker";
import { TrainingDialog } from "@/components/TrainingDialog";
import { TrainingSessionsManager, type SessionRow } from "@/components/TrainingSessionsManager";
import { TrainingMaterialsDialog } from "@/components/TrainingMaterialsDialog";
import { TrainingExamDialog } from "@/components/TrainingExamDialog";
import { TrainingGradingQueue } from "@/components/TrainingGradingQueue";
import { TrainingHistoryImportDialog } from "@/components/TrainingHistoryImportDialog";
import { TrainingsDashboard } from "@/components/TrainingsDashboard";
import { TrainingPathsPanel, type TrilhaRow } from "@/components/TrainingPathsPanel";
import { TrainingPathCards } from "@/components/TrainingPathCards";
import { deleteTraining, enrollPeople, getTrainingForEdit, type TrainingForEdit } from "@/lib/actions/trainings";
import {
  effTrainingStatus, effComBloqueio, TRAINING_STATUS_LABEL, TRAINING_STATUS_TONE,
  cargaHoraria, periodicidadeLabel, DELIVERY_LABEL,
  contaComoEmDia, contaComoPendente,
  type EffTrainingStatus,
} from "@/lib/training-schedule";
import { formatDate, normalizar } from "@/lib/format";
import type { Enums } from "@/types/database";

export type Opt = { id: string; name: string };
export type SubOpt = { id: string; name: string; departmentId: string };
/** Pessoa com a lotação junto: o formulário precisa saber quem está em qual escopo. */
export type PersonOpt = Opt & {
  positionId: string | null;
  deptId: string | null;
  subId: string | null;
  unitIds: string[];
};

export type TrainingRow = {
  id: string;
  name: string;
  description: string | null;
  code: string | null;
  workloadMinutes: number;
  delivery: Enums<"training_delivery">;
  validadeMeses: number | null;
  antecipacaoDias: number;
  prazoDias: number | null;
  /** vazio em qualquer um destes = vale para todos daquele tipo */
  unitNames: string[];
  deptNames: string[];
  subNames: string[];
  pilarNames: string[];
  active: boolean;
  ownerNames: string[];
  ruleCount: number;
  mandatory: boolean;
};

export type MyEnrollmentRow = {
  id: string;
  trainingId: string;
  trainingName: string;
  workloadMinutes: number;
  delivery: Enums<"training_delivery">;
  antecipacaoDias: number;
  status: Enums<"training_enrollment_status">;
  mandatory: boolean;
  dueAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  score: number | null;
  cycleNo: number;
  /** de qual trilha esta matrícula veio; null = curso avulso */
  pathId: string | null;
  /** passo de trilha cujo anterior obrigatório ainda não foi concluído */
  bloqueada: boolean;
};

export type EnrollmentRow = {
  id: string;
  trainingId: string;
  trainingName: string;
  antecipacaoDias: number;
  userId: string;
  userName: string;
  deptId: string | null;
  status: Enums<"training_enrollment_status">;
  mandatory: boolean;
  dueAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  score: number | null;
  /** de qual trilha esta matrícula veio; null = curso avulso */
  pathId: string | null;
};

const eff = (e: { status: Enums<"training_enrollment_status">; dueAt: string | null; expiresAt: string | null; antecipacaoDias: number }) =>
  effTrainingStatus({ status: e.status, dueAt: e.dueAt, expiresAt: e.expiresAt, antecipacaoDias: e.antecipacaoDias });

function StatusBadge({ s }: { s: EffTrainingStatus }) {
  return <Badge tone={TRAINING_STATUS_TONE[s]}>{TRAINING_STATUS_LABEL[s]}</Badge>;
}

export function TrainingsManager({
  trainings, myEnrollments, enrollments, podeCadastrar, currentUserId,
  people, departments, subdepartments, positions, pilares, units, sessions, rooms, paths,
}: {
  trainings: TrainingRow[];
  myEnrollments: MyEnrollmentRow[];
  enrollments: EnrollmentRow[];
  podeCadastrar: boolean;
  currentUserId: string;
  people: PersonOpt[];
  departments: Opt[];
  subdepartments: SubOpt[];
  positions: Opt[];
  pilares: Opt[];
  units: Opt[];
  sessions: SessionRow[];
  rooms: Opt[];
  paths: TrilhaRow[];
}) {
  const [editing, setEditing] = useState<TrainingForEdit | null>(null);
  const [criando, setCriando] = useState(false);
  const [matricular, setMatricular] = useState<TrainingRow | null>(null);
  const [conteudo, setConteudo] = useState<TrainingRow | null>(null);
  const [prova, setProva] = useState<TrainingRow | null>(null);
  const [legado, setLegado] = useState<TrainingRow | null>(null);

  const tabs: Tab[] = [
    {
      id: "meus",
      label: `Meus treinamentos${myEnrollments.length ? ` · ${myEnrollments.length}` : ""}`,
      content: <MeusTreinamentos rows={myEnrollments} paths={paths} />,
    },
    {
      id: "catalogo",
      label: `Catálogo · ${trainings.length}`,
      content: (
        <Catalogo
          rows={trainings}
          podeCadastrar={podeCadastrar}
          onNovo={() => setCriando(true)}
          onEditar={async (id) => {
            const t = await getTrainingForEdit(id);
            if (t) setEditing(t);
          }}
          onMatricular={setMatricular}
          onConteudo={setConteudo}
          onProva={setProva}
          onLegado={setLegado}
        />
      ),
    },
    {
      id: "trilhas",
      label: `Trilhas${paths.length ? ` · ${paths.length}` : ""}`,
      content: (
        <TrainingPathsPanel
          rows={paths}
          trainings={trainings}
          people={people}
          departments={departments}
          subdepartments={subdepartments}
          positions={positions}
          units={units}
          podeCadastrar={podeCadastrar}
        />
      ),
    },
    {
      id: "turmas",
      label: `Turmas${sessions.length ? ` · ${sessions.length}` : ""}`,
      content: (
        <TrainingSessionsManager
          sessions={sessions}
          // turma só existe para quem tem quem conduza: auto instrucional fica de fora
          trainings={trainings
            .filter((t) => t.active && t.delivery !== "auto_instrucional")
            .map((t) => ({ id: t.id, name: t.name, workloadMinutes: t.workloadMinutes }))}
          people={people}
          units={units}
          rooms={rooms}
          podeCriar={podeCadastrar}
        />
      ),
    },
    {
      id: "painel",
      label: "Painel",
      content: <TrainingsDashboard enrollments={enrollments} trainings={trainings} departments={departments} paths={paths} />,
    },
    {
      id: "acompanhamento",
      label: "Acompanhamento",
      content: <Acompanhamento rows={enrollments} departments={departments} currentUserId={currentUserId} />,
    },
    {
      id: "correcoes",
      label: "Correções",
      content: <TrainingGradingQueue />,
    },
  ];

  return (
    <>
      <Tabs tabs={tabs} initialId="meus" />

      {(criando || editing) && (
        <TrainingDialog
          training={editing}
          people={people}
          departments={departments}
          subdepartments={subdepartments}
          positions={positions}
          pilares={pilares}
          units={units}
          onClose={() => { setCriando(false); setEditing(null); }}
        />
      )}

      {matricular && (
        <MatricularDialog training={matricular} people={people} onClose={() => setMatricular(null)} />
      )}

      {conteudo && (
        <TrainingMaterialsDialog
          trainingId={conteudo.id}
          trainingName={conteudo.name}
          onClose={() => setConteudo(null)}
        />
      )}

      {prova && (
        <TrainingExamDialog
          trainingId={prova.id}
          trainingName={prova.name}
          onClose={() => setProva(null)}
        />
      )}

      {legado && (
        <TrainingHistoryImportDialog
          trainingId={legado.id}
          trainingName={legado.name}
          people={people}
          onClose={() => setLegado(null)}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------ meus
function MeusTreinamentos({ rows, paths }: { rows: MyEnrollmentRow[]; paths: TrilhaRow[] }) {
  const comStatus = rows.map((r) => ({ ...r, s: effComBloqueio(eff(r), r.bloqueada) }));
  // ordem de urgência: o que cobra primeiro aparece primeiro
  const peso: Record<EffTrainingStatus, number> = {
    atrasado: 0, vencido: 1, a_vencer: 2, em_andamento: 3, nao_iniciado: 4,
    // o que espera pré-requisito fica logo abaixo do que pode ser feito agora:
    // é pendência, mas não é a pendência que a pessoa consegue resolver hoje
    aguardando_pre_requisito: 5,
    aguardando_correcao: 6, reprovado: 7, no_show: 8, concluido: 9,
    isento: 10, cancelado: 11, nao_aplicavel: 12,
  };
  const ordenadas = [...comStatus].sort((a, b) => peso[a.s] - peso[b.s] || a.trainingName.localeCompare(b.trainingName, "pt-BR"));

  const pendentes = comStatus.filter((r) => r.mandatory && contaComoPendente(r.s)).length;
  const emDia = comStatus.filter((r) => r.mandatory && contaComoEmDia(r.s)).length;
  const horas = comStatus
    .filter((r) => r.s === "concluido" || r.s === "a_vencer" || r.s === "vencido")
    .reduce((soma, r) => soma + r.workloadMinutes, 0);

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nenhum treinamento atribuído"
        description="Quando um treinamento for obrigatório para o seu cargo ou setor, ele aparece aqui."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.8rem" }}>
        <StatCard label="Obrigatórios pendentes" value={pendentes} tone={pendentes > 0 ? "red" : "green"} />
        <StatCard label="Obrigatórios em dia" value={emDia} tone="green" />
        <StatCard label="Horas concluídas" value={cargaHoraria(horas)} tone="blue" icon={<GraduationCap size={16} />} />
      </div>

      <TrainingPathCards paths={paths} rows={rows} />

      <div className="card" style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Treinamento</th>
              <th>Tipo</th>
              <th>Carga</th>
              <th>Prazo</th>
              <th>Concluído em</th>
              <th>Validade</th>
              <th>Nota</th>
              <th>Situação</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 600 }}>
                  {r.trainingName}
                  {r.mandatory && <span style={{ color: "var(--mh-danger)", marginLeft: 4 }} title="Obrigatório">*</span>}
                  {r.cycleNo > 1 && <span className="soft" style={{ fontSize: "0.72rem" }}> · {r.cycleNo}º ciclo</span>}
                </td>
                <td className="muted">{DELIVERY_LABEL[r.delivery]}</td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{cargaHoraria(r.workloadMinutes)}</td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{r.dueAt ? formatDate(r.dueAt) : "—"}</td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{r.completedAt ? formatDate(r.completedAt.slice(0, 10)) : "—"}</td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{r.expiresAt ? formatDate(r.expiresAt) : "—"}</td>
                <td className="muted">{r.score != null ? `${r.score}%` : "—"}</td>
                <td><StatusBadge s={r.s} /></td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {r.bloqueada ? (
                    <span
                      className="soft"
                      style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.78rem" }}
                      title="Conclua o treinamento anterior da trilha para liberar este"
                    >
                      <Lock size={14} /> Aguardando
                    </span>
                  ) : PODE_FAZER.has(r.s) ? (
                    <Link href={`/treinamentos/realizar/${r.id}`} className="btn btn-primary btn-sm">
                      <PlayCircle size={14} style={{ marginRight: "0.3rem" }} />
                      {r.s === "em_andamento" ? "Continuar" : "Fazer"}
                    </Link>
                  ) : r.s === "concluido" || r.s === "a_vencer" ? (
                    <Link href={`/treinamentos/realizar/${r.id}`} className="btn btn-ghost btn-sm">
                      Rever
                    </Link>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Situações em que ainda há o que fazer: as demais só permitem rever. */
const PODE_FAZER = new Set<EffTrainingStatus>([
  "nao_iniciado", "em_andamento", "atrasado", "vencido", "reprovado",
]);

// ------------------------------------------------------------------ catálogo
function Catalogo({
  rows, podeCadastrar, onNovo, onEditar, onMatricular, onConteudo, onProva, onLegado,
}: {
  rows: TrainingRow[];
  podeCadastrar: boolean;
  onNovo: () => void;
  onEditar: (id: string) => void;
  onMatricular: (t: TrainingRow) => void;
  onConteudo: (t: TrainingRow) => void;
  onProva: (t: TrainingRow) => void;
  onLegado: (t: TrainingRow) => void;
}) {
  const [busca, setBusca] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const visiveis = useMemo(() => {
    const q = normalizar(busca.trim());
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.code, ...r.deptNames, ...r.pilarNames].some((v) => v && normalizar(v).includes(q)));
  }, [rows, busca]);

  const excluir = (t: TrainingRow) => {
    start(async () => {
      const ok = await confirmDialog({
        tone: "danger",
        confirmLabel: "Excluir",
        message: `Excluir o treinamento "${t.name}"? O histórico de quem já fez continua guardado.`,
      });
      if (!ok) return;
      await deleteTraining(t.id);
      router.refresh();
    });
  };

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", padding: "0.9rem 1.1rem", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        <input
          className="input"
          placeholder="Buscar por nome, código, setor ou pilar…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          style={{ width: 320, padding: "0.4rem 0.7rem", fontSize: "0.85rem" }}
        />
        {podeCadastrar && (
          <button type="button" className="btn btn-primary btn-sm" onClick={onNovo}>Novo treinamento</button>
        )}
      </div>

      {visiveis.length === 0 ? (
        <EmptyState
          title="Nenhum treinamento cadastrado"
          description="Cadastre os treinamentos da empresa e defina para quais cargos eles são obrigatórios."
        />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Treinamento</th>
                <th>Tipo</th>
                <th>Carga</th>
                <th>Periodicidade</th>
                <th>Escopo</th>
                <th>Responsáveis</th>
                <th>Público</th>
                <th>Situação</th>
                {podeCadastrar && <th></th>}
              </tr>
            </thead>
            <tbody>
              {visiveis.map((t) => (
                <tr key={t.id} style={{ opacity: t.active ? 1 : 0.6 }}>
                  <td>
                    <span style={{ fontWeight: 600 }}>{t.name}</span>
                    {t.mandatory && <span style={{ color: "var(--mh-danger)", marginLeft: 4 }} title="Obrigatório">*</span>}
                    {t.code && <div className="soft" style={{ fontSize: "0.72rem" }}>{t.code}</div>}
                  </td>
                  <td className="muted">{DELIVERY_LABEL[t.delivery]}</td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{cargaHoraria(t.workloadMinutes)}</td>
                  <td className="muted">{periodicidadeLabel(t.validadeMeses)}</td>
                  <td className="muted">
                    {t.deptNames.length > 0 ? t.deptNames.join(", ") : "Todos os setores"}
                    {t.subNames.length > 0 && <span className="soft"> · {t.subNames.join(", ")}</span>}
                    <div className="soft" style={{ fontSize: "0.72rem" }}>
                      {t.unitNames.length > 0 ? t.unitNames.join(", ") : "Todas as unidades"}
                    </div>
                  </td>
                  <td className="muted">{t.ownerNames.length > 0 ? t.ownerNames.join(", ") : "—"}</td>
                  <td className="muted">{t.ruleCount > 0 ? `${t.ruleCount} regra${t.ruleCount > 1 ? "s" : ""}` : "—"}</td>
                  <td><Badge tone={t.active ? "green" : "gray"}>{t.active ? "Ativo" : "Inativo"}</Badge></td>
                  {podeCadastrar && (
                    <td>
                      <span style={{ display: "inline-flex", gap: "0.3rem" }}>
                        <button type="button" className="icon-btn" title="Conteúdo do treinamento" onClick={() => onConteudo(t)}>
                          <Layers size={15} />
                        </button>
                        <button type="button" className="icon-btn" title="Avaliação" onClick={() => onProva(t)}>
                          <FileCheck size={15} />
                        </button>
                        <button type="button" className="icon-btn" title="Matricular colaboradores" onClick={() => onMatricular(t)}>
                          <UserPlus size={15} />
                        </button>
                        <button type="button" className="icon-btn" title="Importar histórico anterior ao sistema" onClick={() => onLegado(t)}>
                          <History size={15} />
                        </button>
                        <button type="button" className="icon-btn" title="Editar" onClick={() => onEditar(t.id)}>
                          <Pencil size={15} />
                        </button>
                        <button type="button" className="icon-btn icon-btn-danger" title="Excluir" disabled={pending} onClick={() => excluir(t)}>
                          <Trash2 size={15} />
                        </button>
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ acompanhamento
function Acompanhamento({
  rows, departments, currentUserId,
}: {
  rows: EnrollmentRow[];
  departments: Opt[];
  currentUserId: string;
}) {
  const [dept, setDept] = useState("");
  const [somentePendentes, setSomentePendentes] = useState(false);

  const comStatus = useMemo(() => rows.map((r) => ({ ...r, s: eff(r) })), [rows]);

  const visiveis = useMemo(() => comStatus.filter((r) => {
    if (dept && r.deptId !== dept) return false;
    if (somentePendentes && !(r.mandatory && contaComoPendente(r.s))) return false;
    return true;
  }), [comStatus, dept, somentePendentes]);

  const obrigatorias = comStatus.filter((r) => r.mandatory);
  const emDia = obrigatorias.filter((r) => contaComoEmDia(r.s)).length;
  // Conformidade = obrigatórios em dia sobre obrigatórios que valem. É a métrica
  // que a diretoria pede e a que a fiscalização confere.
  const conformidade = obrigatorias.length > 0 ? Math.round((emDia / obrigatorias.length) * 100) : null;
  const vencidos = comStatus.filter((r) => r.s === "vencido").length;
  const atrasados = comStatus.filter((r) => r.s === "atrasado").length;
  const aVencer = comStatus.filter((r) => r.s === "a_vencer").length;

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nada para acompanhar ainda"
        description="Assim que houver treinamentos atribuídos, o andamento de cada pessoa aparece aqui."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0.8rem" }}>
        <StatCard
          label="Conformidade"
          value={conformidade == null ? "—" : `${conformidade}%`}
          hint="Obrigatórios em dia"
          tone={conformidade == null ? "gray" : conformidade >= 90 ? "green" : conformidade >= 70 ? "amber" : "red"}
        />
        <StatCard label="Atrasados" value={atrasados} hint="Não fizeram no prazo" tone={atrasados > 0 ? "red" : "green"} />
        <StatCard label="Vencidos" value={vencidos} hint="Fizeram e caducou" tone={vencidos > 0 ? "red" : "green"} />
        <StatCard label="A vencer" value={aVencer} hint="Já podem reciclar" tone={aVencer > 0 ? "amber" : "gray"} />
      </div>

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: "0.7rem", padding: "0.8rem 1.1rem", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
          <select className="select" value={dept} onChange={(e) => setDept(e.target.value)} style={{ width: 220, fontSize: "0.85rem" }}>
            <option value="">Todos os setores</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem" }}>
            <input type="checkbox" checked={somentePendentes} onChange={(e) => setSomentePendentes(e.target.checked)} />
            Só obrigatórios pendentes
          </label>
          <span className="soft" style={{ fontSize: "0.8rem", marginLeft: "auto" }}>{visiveis.length} registros</span>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th>Treinamento</th>
                <th>Prazo</th>
                <th>Concluído</th>
                <th>Validade</th>
                <th>Nota</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.slice(0, 500).map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: r.userId === currentUserId ? 700 : 400 }}>{r.userName}</td>
                  <td className="muted">
                    {r.trainingName}
                    {r.mandatory && <span style={{ color: "var(--mh-danger)", marginLeft: 4 }} title="Obrigatório">*</span>}
                  </td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{r.dueAt ? formatDate(r.dueAt) : "—"}</td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{r.completedAt ? formatDate(r.completedAt.slice(0, 10)) : "—"}</td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{r.expiresAt ? formatDate(r.expiresAt) : "—"}</td>
                  <td className="muted">{r.score != null ? `${r.score}%` : "—"}</td>
                  <td><StatusBadge s={r.s} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {visiveis.length > 500 && (
            <p className="soft" style={{ fontSize: "0.78rem", padding: "0.6rem 1.1rem", margin: 0 }}>
              Mostrando os 500 primeiros de {visiveis.length}. Use o filtro de setor para reduzir a lista.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ matrícula avulsa
function MatricularDialog({ training, people, onClose }: { training: TrainingRow; people: Opt[]; onClose: () => void }) {
  const [ids, setIds] = useState<string[]>([]);
  const [prazo, setPrazo] = useState("");
  const [erro, setErro] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const salvar = () => {
    setErro("");
    start(async () => {
      const r = await enrollPeople(training.id, ids, prazo || null);
      if (r.error) { setErro(r.error); return; }
      router.refresh();
      onClose();
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 70, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 560, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)", gap: "0.75rem" }}>
          <div>
            <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>Matricular colaboradores</h2>
            <p className="soft" style={{ fontSize: "0.82rem", margin: "0.25rem 0 0" }}>{training.name}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>

        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>
            Use isto para pessoas específicas. Quando o treinamento vale para um cargo ou setor inteiro,
            defina a regra na edição do treinamento: aí a matrícula acompanha quem entra e quem sai do cargo.
          </p>
          <div>
            <label className="label">Colaboradores <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <PeoplePicker people={people} selected={ids} onChange={setIds} />
          </div>
          <div style={{ maxWidth: 220 }}>
            <label className="label">Prazo para concluir</label>
            <input type="date" className="input" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
          </div>
          {erro && (
            <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>{erro}</p>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={pending || ids.length === 0} onClick={salvar}>
            {pending ? "Matriculando…" : "Matricular"}
          </button>
        </div>
      </div>
    </div>
  );
}
