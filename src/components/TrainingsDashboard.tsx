"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, GraduationCap, ShieldCheck } from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { ExportButton } from "@/components/ui/ExportButton";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  effTrainingStatus, cargaHoraria, contaComoEmDia, contaComoPendente, foraDaConta,
  TRAINING_STATUS_LABEL,
  type EffTrainingStatus,
} from "@/lib/training-schedule";
import { formatDate } from "@/lib/format";
import type { EnrollmentRow, Opt, TrainingRow } from "@/components/TrainingsManager";

/**
 * Painel de conformidade.
 *
 * A conta que importa para a fiscalização é uma só: dos treinamentos
 * OBRIGATÓRIOS que se aplicam, quantos estão em dia. Por isso isento,
 * cancelado e não aplicável saem do denominador, e não viram "pendente" nem
 * "em dia": contá-los de um lado ou do outro produziria um número bonito e
 * falso.
 *
 * Tudo é calculado sobre as matrículas que a RLS já deixou chegar aqui, então
 * gestor vê a própria equipe e o RH vê a empresa, sem esta tela precisar saber
 * de papel nenhum.
 */
export function TrainingsDashboard({
  enrollments, trainings, departments,
}: {
  enrollments: EnrollmentRow[];
  trainings: TrainingRow[];
  departments: Opt[];
}) {
  const [setor, setSetor] = useState("");

  const cargaPorCurso = useMemo(
    () => new Map(trainings.map((t) => [t.id, t.workloadMinutes])),
    [trainings],
  );
  const nomeSetor = useMemo(
    () => new Map(departments.map((d) => [d.id, d.name])),
    [departments],
  );

  const linhas = useMemo(() => {
    const base = setor ? enrollments.filter((e) => e.deptId === setor) : enrollments;
    return base.map((e) => ({ ...e, s: effTrainingStatus(e) }));
  }, [enrollments, setor]);

  const obrigatorias = linhas.filter((l) => l.mandatory && !foraDaConta(l.s));
  const emDia = obrigatorias.filter((l) => contaComoEmDia(l.s)).length;
  const pendentes = obrigatorias.filter((l) => contaComoPendente(l.s)).length;
  const conformidade = obrigatorias.length === 0 ? null : Math.round((emDia / obrigatorias.length) * 100);

  const hoje = new Date().toISOString().slice(0, 10);
  const emDias = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const vencendoEm = (dias: number) =>
    linhas.filter((l) => l.expiresAt && l.expiresAt >= hoje && l.expiresAt <= emDias(dias)).length;

  const vencidos = linhas.filter((l) => l.s === "vencido").length;
  const atrasados = linhas.filter((l) => l.s === "atrasado").length;

  const horas = linhas
    .filter((l) => l.completedAt)
    .reduce((soma, l) => soma + (cargaPorCurso.get(l.trainingId) ?? 0), 0);

  const notas = linhas.filter((l) => l.score !== null).map((l) => Number(l.score));
  const notaMedia = notas.length === 0 ? null : Math.round(notas.reduce((a, b) => a + b, 0) / notas.length);

  // por treinamento: só obrigatórios aplicáveis, que é o que a conta mede
  const porTreinamento = useMemo(() => {
    const mapa = new Map<string, { nome: string; total: number; emDia: number; pendente: number }>();
    for (const l of obrigatorias) {
      const atual = mapa.get(l.trainingId) ?? { nome: l.trainingName, total: 0, emDia: 0, pendente: 0 };
      atual.total += 1;
      if (contaComoEmDia(l.s)) atual.emDia += 1;
      if (contaComoPendente(l.s)) atual.pendente += 1;
      mapa.set(l.trainingId, atual);
    }
    return [...mapa.values()].sort((a, b) => (a.emDia / a.total) - (b.emDia / b.total));
  }, [obrigatorias]);

  const porSetor = useMemo(() => {
    const mapa = new Map<string, { nome: string; total: number; emDia: number }>();
    for (const l of obrigatorias) {
      const chave = l.deptId ?? "sem";
      const atual = mapa.get(chave) ?? {
        nome: l.deptId ? (nomeSetor.get(l.deptId) ?? "Setor removido") : "Sem setor",
        total: 0, emDia: 0,
      };
      atual.total += 1;
      if (contaComoEmDia(l.s)) atual.emDia += 1;
      mapa.set(chave, atual);
    }
    return [...mapa.values()].sort((a, b) => (a.emDia / a.total) - (b.emDia / b.total));
  }, [obrigatorias, nomeSetor]);

  if (enrollments.length === 0) {
    return (
      <EmptyState
        title="Sem matrículas para medir"
        description="Cadastre um treinamento com regra de público e a conformidade aparece aqui."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <div style={{ minWidth: 220 }}>
          <label className="label">Setor</label>
          <select className="select" value={setor} onChange={(e) => setSetor(e.target.value)}>
            <option value="">Todos os setores</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <ExportButton
          filename="treinamentos-conformidade"
          sheetName="Conformidade"
          headers={["Colaborador", "Treinamento", "Setor", "Obrigatório", "Situação", "Prazo", "Concluído em", "Vence em", "Nota"]}
          rows={linhas.map((l) => [
            l.userName,
            l.trainingName,
            l.deptId ? (nomeSetor.get(l.deptId) ?? "") : "",
            l.mandatory ? "Sim" : "Não",
            TRAINING_STATUS_LABEL[l.s],
            l.dueAt ? formatDate(l.dueAt) : "",
            l.completedAt ? formatDate(l.completedAt.slice(0, 10)) : "",
            l.expiresAt ? formatDate(l.expiresAt) : "",
            l.score ?? "",
          ])}
          label="Exportar conformidade"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.8rem" }}>
        <StatCard
          label="Conformidade"
          value={conformidade === null ? "—" : `${conformidade}%`}
          tone={conformidade === null ? "gray" : conformidade >= 90 ? "green" : conformidade >= 70 ? "amber" : "red"}
          icon={<ShieldCheck size={16} />}
        />
        <StatCard label="Obrigatórios pendentes" value={pendentes} tone={pendentes > 0 ? "red" : "green"} icon={<AlertTriangle size={16} />} />
        <StatCard label="Vencendo em 30 dias" value={vencendoEm(30)} tone="amber" icon={<CalendarClock size={16} />} />
        <StatCard label="Vencidos" value={vencidos} tone={vencidos > 0 ? "red" : "green"} />
        <StatCard label="Fora do prazo" value={atrasados} tone={atrasados > 0 ? "red" : "green"} />
        <StatCard label="Horas realizadas" value={cargaHoraria(horas)} tone="blue" icon={<GraduationCap size={16} />} />
        <StatCard label="Nota média" value={notaMedia === null ? "—" : `${notaMedia}%`} tone="blue" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1rem" }}>
        <Barras
          titulo="Conformidade por treinamento"
          vazio="Nenhum treinamento obrigatório no filtro."
          itens={porTreinamento.map((t) => ({
            nome: t.nome,
            pct: Math.round((t.emDia / t.total) * 100),
            detalhe: `${t.emDia} de ${t.total}`,
          }))}
        />
        <Barras
          titulo="Conformidade por setor"
          vazio="Nenhum setor no filtro."
          itens={porSetor.map((s) => ({
            nome: s.nome,
            pct: Math.round((s.emDia / s.total) * 100),
            detalhe: `${s.emDia} de ${s.total}`,
          }))}
        />
      </div>

      <div className="card" style={{ padding: "1rem" }}>
        <h3 style={{ fontSize: "0.92rem", fontWeight: 700, margin: "0 0 0.7rem" }}>Próximos vencimentos</h3>
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
          {[30, 60, 90].map((d) => (
            <div key={d}>
              <p className="soft" style={{ margin: 0, fontSize: "0.74rem" }}>Em {d} dias</p>
              <p style={{ margin: 0, fontSize: "1.3rem", fontWeight: 700 }}>{vencendoEm(d)}</p>
            </div>
          ))}
        </div>
        <p className="soft" style={{ fontSize: "0.74rem", margin: "0.7rem 0 0" }}>
          A reciclagem abre sozinha quando entra na janela de antecipação do treinamento, e quem
          precisa fazer recebe aviso no sino.
        </p>
      </div>
    </div>
  );
}

/** Barras em CSS puro, mesmo molde do painel de chamados: sem lib de gráfico. */
function Barras({
  titulo, itens, vazio,
}: {
  titulo: string;
  itens: { nome: string; pct: number; detalhe: string }[];
  vazio: string;
}) {
  return (
    <div className="card" style={{ padding: "1rem" }}>
      <h3 style={{ fontSize: "0.92rem", fontWeight: 700, margin: "0 0 0.8rem" }}>{titulo}</h3>
      {itens.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>{vazio}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
          {itens.slice(0, 12).map((i) => (
            <div key={i.nome}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", marginBottom: "0.25rem" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>{i.nome}</span>
                <span className="soft">{i.pct}% <span style={{ fontSize: "0.72rem" }}>({i.detalhe})</span></span>
              </div>
              <div style={{ height: 8, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}>
                <div
                  style={{
                    width: `${i.pct}%`, height: "100%", borderRadius: 999,
                    background: i.pct >= 90 ? "var(--mh-success)" : i.pct >= 70 ? "var(--mh-warning)" : "var(--mh-danger)",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export type { EffTrainingStatus };
