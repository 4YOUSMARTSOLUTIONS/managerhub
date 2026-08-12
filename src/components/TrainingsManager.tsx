"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, Pencil, Trash2, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatCard } from "@/components/ui/StatCard";
import { Tabs, type Tab } from "@/components/ui/Tabs";
import { confirmDialog } from "@/components/ui/confirm";
import { PeoplePicker } from "@/components/PeoplePicker";
import { TrainingDialog } from "@/components/TrainingDialog";
import { deleteTraining, enrollPeople, getTrainingForEdit, type TrainingForEdit } from "@/lib/actions/trainings";
import {
  effTrainingStatus, TRAINING_STATUS_LABEL, TRAINING_STATUS_TONE,
  cargaHoraria, periodicidadeLabel, DELIVERY_LABEL,
  contaComoEmDia, contaComoPendente,
  type EffTrainingStatus,
} from "@/lib/training-schedule";
import { formatDate, normalizar } from "@/lib/format";
import type { Enums } from "@/types/database";

export type Opt = { id: string; name: string };
export type SubOpt = { id: string; name: string; departmentId: string };

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
  unitName: string | null;
  deptName: string | null;
  subName: string | null;
  pilarName: string | null;
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
};

const eff = (e: { status: Enums<"training_enrollment_status">; dueAt: string | null; expiresAt: string | null; antecipacaoDias: number }) =>
  effTrainingStatus({ status: e.status, dueAt: e.dueAt, expiresAt: e.expiresAt, antecipacaoDias: e.antecipacaoDias });

function StatusBadge({ s }: { s: EffTrainingStatus }) {
  return <Badge tone={TRAINING_STATUS_TONE[s]}>{TRAINING_STATUS_LABEL[s]}</Badge>;
}

export function TrainingsManager({
  trainings, myEnrollments, enrollments, podeCadastrar, currentUserId,
  people, departments, subdepartments, positions, pilares, units,
}: {
  trainings: TrainingRow[];
  myEnrollments: MyEnrollmentRow[];
  enrollments: EnrollmentRow[];
  podeCadastrar: boolean;
  currentUserId: string;
  people: Opt[];
  departments: Opt[];
  subdepartments: SubOpt[];
  positions: Opt[];
  pilares: Opt[];
  units: Opt[];
}) {
  const [editing, setEditing] = useState<TrainingForEdit | null>(null);
  const [criando, setCriando] = useState(false);
  const [matricular, setMatricular] = useState<TrainingRow | null>(null);

  const tabs: Tab[] = [
    {
      id: "meus",
      label: `Meus treinamentos${myEnrollments.length ? ` · ${myEnrollments.length}` : ""}`,
      content: <MeusTreinamentos rows={myEnrollments} />,
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
        />
      ),
    },
    {
      id: "acompanhamento",
      label: "Acompanhamento",
      content: <Acompanhamento rows={enrollments} departments={departments} currentUserId={currentUserId} />,
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
    </>
  );
}

// ------------------------------------------------------------------ meus
function MeusTreinamentos({ rows }: { rows: MyEnrollmentRow[] }) {
  const comStatus = rows.map((r) => ({ ...r, s: eff(r) }));
  // ordem de urgência: o que cobra primeiro aparece primeiro
  const peso: Record<EffTrainingStatus, number> = {
    atrasado: 0, vencido: 1, a_vencer: 2, em_andamento: 3, nao_iniciado: 4,
    aguardando_correcao: 5, reprovado: 6, no_show: 7, concluido: 8,
    isento: 9, cancelado: 10, nao_aplicavel: 11,
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
        O conteúdo e a prova entram na próxima etapa do módulo. Por enquanto esta tela mostra o que
        está atribuído a você e o prazo de cada item.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ catálogo
function Catalogo({
  rows, podeCadastrar, onNovo, onEditar, onMatricular,
}: {
  rows: TrainingRow[];
  podeCadastrar: boolean;
  onNovo: () => void;
  onEditar: (id: string) => void;
  onMatricular: (t: TrainingRow) => void;
}) {
  const [busca, setBusca] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const visiveis = useMemo(() => {
    const q = normalizar(busca.trim());
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.code, r.deptName, r.pilarName].some((v) => v && normalizar(v).includes(q)));
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
                    {t.deptName ?? "Toda a empresa"}
                    {t.subName && <span className="soft"> · {t.subName}</span>}
                    {t.unitName && <div className="soft" style={{ fontSize: "0.72rem" }}>{t.unitName}</div>}
                  </td>
                  <td className="muted">{t.ownerNames.length > 0 ? t.ownerNames.join(", ") : "—"}</td>
                  <td className="muted">{t.ruleCount > 0 ? `${t.ruleCount} regra${t.ruleCount > 1 ? "s" : ""}` : "—"}</td>
                  <td><Badge tone={t.active ? "green" : "gray"}>{t.active ? "Ativo" : "Inativo"}</Badge></td>
                  {podeCadastrar && (
                    <td>
                      <span style={{ display: "inline-flex", gap: "0.3rem" }}>
                        <button type="button" className="icon-btn" title="Matricular colaboradores" onClick={() => onMatricular(t)}>
                          <UserPlus size={15} />
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
