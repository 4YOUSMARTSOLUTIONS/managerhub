"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Check, CheckCircle2, Lock, LockOpen, Pencil, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PeoplePicker } from "@/components/PeoplePicker";
import { confirmDialog } from "@/components/ui/confirm";
import {
  cancelarTurma, convocar, desconvocar, getCandidatos, getListaDePresenca,
  lancarPresenca, liberarTurma, saveSession,
  type CandidatoConvocacao, type PresencaLinha,
} from "@/lib/actions/training-sessions";
import { normalizar } from "@/lib/format";
import { cargaHoraria } from "@/lib/training-schedule";
import { ABSENCE_KIND_LABEL } from "@/lib/constants";
import type { Enums } from "@/types/database";
import type { Opt } from "@/components/TrainingsManager";

/** o treinamento na hora de montar a turma: a carga horária define o término */
export type TrainingOpt = Opt & { workloadMinutes: number };

export type SessionRow = {
  id: string;
  trainingId: string;
  trainingName: string;
  code: number;
  name: string | null;
  startsAt: string;
  endsAt: string | null;
  mode: Enums<"training_session_mode">;
  roomId: string | null;
  roomName: string | null;
  meetingUrl: string | null;
  location: string | null;
  instructorId: string | null;
  instructorName: string | null;
  unitName: string | null;
  capacity: number | null;
  status: Enums<"training_session_status">;
  releasedAt: string | null;
  convocados: number;
  presentes: number;
  ausentes: number;
  justificados: number;
  podeGerir: boolean;
};

const STATUS_LABEL: Record<Enums<"training_session_status">, string> = {
  planejada: "Planejada",
  liberada: "Liberada",
  em_andamento: "Em andamento",
  concluida: "Concluída",
  cancelada: "Cancelada",
};
const STATUS_TONE: Record<Enums<"training_session_status">, "gray" | "blue" | "green" | "amber" | "red"> = {
  planejada: "gray",
  liberada: "blue",
  em_andamento: "amber",
  concluida: "green",
  cancelada: "red",
};

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

/**
 * Aderência da turma: quem apareceu sobre quem podia aparecer.
 *
 * Justificado sai do denominador: quem estava de férias não é falha de
 * ninguém, e contá-lo como falta faria o indicador punir o gestor por uma
 * ausência que o próprio sistema já sabia que existia.
 */
function aderencia(s: SessionRow): number | null {
  const base = s.presentes + s.ausentes;
  if (base === 0) return null;
  return Math.round((s.presentes / base) * 100);
}

export function TrainingSessionsManager({
  sessions, trainings, people, units, rooms, podeCriar,
}: {
  sessions: SessionRow[];
  /** só treinamentos com instrutor: auto instrucional não tem turma */
  trainings: TrainingOpt[];
  people: Opt[];
  units: Opt[];
  rooms: Opt[];
  podeCriar: boolean;
}) {
  const [editando, setEditando] = useState<SessionRow | null>(null);
  const [criando, setCriando] = useState(false);
  const [convocando, setConvocando] = useState<SessionRow | null>(null);
  const [presenca, setPresenca] = useState<SessionRow | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const alternarLiberacao = (s: SessionRow) => {
    start(async () => {
      await liberarTurma(s.id, !s.releasedAt);
      router.refresh();
    });
  };

  const cancelar = (s: SessionRow) => {
    start(async () => {
      const ok = await confirmDialog({
        tone: "danger",
        confirmLabel: "Cancelar turma",
        message: `Cancelar a turma de ${s.trainingName}? Quem foi convocado continua devendo o treinamento.`,
      });
      if (!ok) return;
      await cancelarTurma(s.id);
      router.refresh();
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {podeCriar && (
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "0.7rem" }}>
          {trainings.length === 0 && (
            <span className="soft" style={{ fontSize: "0.8rem" }}>
              Nenhum treinamento com instrutor cadastrado. Turma só existe para quem tem quem conduza.
            </span>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={trainings.length === 0}
            onClick={() => setCriando(true)}
          >
            <CalendarPlus size={15} /> Nova turma
          </button>
        </div>
      )}

      {sessions.length === 0 ? (
        <EmptyState
          title="Nenhuma turma programada"
          description="Programe uma turma para os treinamentos conduzidos por instrutor e convoque quem precisa participar."
        />
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Treinamento</th>
                <th>Quando</th>
                <th>Local</th>
                <th>Instrutor</th>
                <th>Convocados</th>
                <th>Presença</th>
                <th>Situação</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const ader = aderencia(s);
                return (
                  <tr key={s.id} style={{ opacity: s.status === "cancelada" ? 0.55 : 1 }}>
                    <td style={{ fontWeight: 600 }}>
                      {s.trainingName}
                      <div className="soft" style={{ fontSize: "0.72rem" }}>
                        Turma {s.code}{s.name ? ` · ${s.name}` : ""}
                      </div>
                    </td>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {dataHora(s.startsAt)}
                      {s.endsAt && <div className="soft" style={{ fontSize: "0.72rem" }}>até {dataHora(s.endsAt)}</div>}
                    </td>
                    <td className="muted">
                      {s.mode === "online" ? (
                        s.meetingUrl ? (
                          <a href={s.meetingUrl} target="_blank" rel="noreferrer">Link da chamada</a>
                        ) : "Online"
                      ) : (
                        s.roomName ?? s.location ?? "—"
                      )}
                      {s.unitName && <div className="soft" style={{ fontSize: "0.72rem" }}>{s.unitName}</div>}
                    </td>
                    <td className="muted">{s.instructorName ?? "—"}</td>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {s.convocados}
                      {s.capacity ? <span className="soft"> / {s.capacity}</span> : null}
                    </td>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {ader == null ? (
                        "—"
                      ) : (
                        <>
                          <strong style={{ color: ader >= 90 ? "var(--mh-success)" : ader >= 70 ? "var(--mh-warning, var(--text))" : "var(--mh-danger)" }}>
                            {ader}%
                          </strong>
                          <div className="soft" style={{ fontSize: "0.72rem" }}>
                            {s.presentes} presentes, {s.ausentes} faltas
                            {s.justificados > 0 && `, ${s.justificados} justificadas`}
                          </div>
                        </>
                      )}
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
                      {!s.releasedAt && s.status !== "concluida" && s.status !== "cancelada" && (
                        <div className="soft" style={{ fontSize: "0.7rem", marginTop: 2 }}>Início bloqueado</div>
                      )}
                    </td>
                    <td>
                      {s.podeGerir && s.status !== "cancelada" && (
                        <span style={{ display: "inline-flex", gap: "0.3rem" }}>
                          <button
                            type="button"
                            className="icon-btn"
                            title={s.releasedAt ? "Bloquear o início" : "Liberar o início para os convocados"}
                            disabled={pending}
                            onClick={() => alternarLiberacao(s)}
                          >
                            {s.releasedAt ? <LockOpen size={15} /> : <Lock size={15} />}
                          </button>
                          <button type="button" className="icon-btn" title="Convocar colaboradores" onClick={() => setConvocando(s)}>
                            <Users size={15} />
                          </button>
                          <button type="button" className="icon-btn" title="Lista de presença" onClick={() => setPresenca(s)}>
                            <CheckCircle2 size={15} />
                          </button>
                          <button type="button" className="icon-btn" title="Editar turma" onClick={() => setEditando(s)}>
                            <Pencil size={15} />
                          </button>
                          <button type="button" className="icon-btn icon-btn-danger" title="Cancelar turma" disabled={pending} onClick={() => cancelar(s)}>
                            <X size={15} />
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(criando || editando) && (
        <SessionDialog
          session={editando}
          trainings={trainings}
          people={people}
          units={units}
          rooms={rooms}
          onClose={() => { setCriando(false); setEditando(null); }}
        />
      )}
      {convocando && <ConvocarDialog session={convocando} onClose={() => setConvocando(null)} />}
      {presenca && <PresencaDialog session={presenca} onClose={() => setPresenca(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ turma
function SessionDialog({
  session, trainings, people, units, rooms, onClose,
}: {
  session: SessionRow | null;
  trainings: TrainingOpt[];
  people: Opt[];
  units: Opt[];
  rooms: Opt[];
  onClose: () => void;
}) {
  // datetime-local trabalha em hora local; o ISO do banco vem em UTC
  const paraInput = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    const off = d.getTimezoneOffset() * 60_000;
    return new Date(d.getTime() - off).toISOString().slice(0, 16);
  };

  const [trainingId, setTrainingId] = useState(session?.trainingId ?? "");
  const [nome, setNome] = useState(session?.name ?? "");
  const [inicio, setInicio] = useState(paraInput(session?.startsAt ?? null));
  const [fim, setFim] = useState(paraInput(session?.endsAt ?? null));
  /**
   * Término automático pela carga horária.
   *
   * A duração é informação do curso, então digitar o fim em toda turma é
   * retrabalho e fonte de divergência. O ajuste manual continua possível para
   * o que a carga não prevê: intervalo de almoço, turma dividida em dois dias.
   */
  const [fimManual, setFimManual] = useState(false);
  const cargaDoCurso = trainings.find((t) => t.id === trainingId)?.workloadMinutes ?? 0;
  const fimCalculado = inicio && cargaDoCurso > 0
    ? paraInput(new Date(new Date(inicio).getTime() + cargaDoCurso * 60_000).toISOString())
    : "";
  const fimEfetivo = fimManual ? fim : (fimCalculado || fim);
  const [modo, setModo] = useState<Enums<"training_session_mode">>(session?.mode ?? "presencial");
  const [roomId, setRoomId] = useState(session?.roomId ?? "");
  const [link, setLink] = useState(session?.meetingUrl ?? "");
  const [local, setLocal] = useState(session?.location ?? "");
  const [instrutor, setInstrutor] = useState<string[]>(session?.instructorId ? [session.instructorId] : []);
  const [unitId, setUnitId] = useState("");
  const [vagas, setVagas] = useState(session?.capacity ? String(session.capacity) : "");
  const [erro, setErro] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const salvar = () => {
    setErro("");
    if (!trainingId) { setErro("Escolha o treinamento."); return; }
    if (!inicio) { setErro("Informe a data e a hora de início."); return; }
    start(async () => {
      const r = await saveSession({
        id: session?.id,
        trainingId,
        name: nome,
        startsAt: inicio,
        endsAt: fimEfetivo || null,
        mode: modo,
        roomId: roomId || null,
        meetingUrl: link,
        location: local,
        instructorId: instrutor[0] ?? null,
        unitId: unitId || null,
        capacity: vagas ? Number(vagas) : null,
      });
      if (r.error) { setErro(r.error); return; }
      router.refresh();
      onClose();
    });
  };

  return (
    <Modal titulo={session ? "Editar turma" : "Nova turma"} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
        <div>
          <label className="label">Treinamento <span style={{ color: "var(--mh-danger)" }}>*</span></label>
          <select className="select" value={trainingId} onChange={(e) => setTrainingId(e.target.value)} disabled={!!session}>
            <option value="">Selecione…</option>
            {trainings.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Identificação</label>
          <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Manhã, reciclagem, turma da expedição…" />
          <p className="soft" style={{ fontSize: "0.72rem", margin: "0.3rem 0 0" }}>
            {session ? `Esta é a turma ${session.code}.` : "O número da turma é automático."} Este campo é
            só um complemento, quando ajudar a diferenciar.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.8rem" }}>
          <div>
            <label className="label">Início <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <input type="datetime-local" className="input" value={inicio} onChange={(e) => setInicio(e.target.value)} />
          </div>
          <div>
            <label className="label">Término</label>
            <input
              type="datetime-local"
              className="input"
              value={fimEfetivo}
              disabled={!fimManual && cargaDoCurso > 0}
              onChange={(e) => setFim(e.target.value)}
            />
            {cargaDoCurso > 0 && (
              <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.74rem", marginTop: "0.3rem" }} className="soft">
                <input
                  type="checkbox"
                  checked={fimManual}
                  onChange={(e) => { setFimManual(e.target.checked); if (e.target.checked) setFim(fimEfetivo); }}
                />
                Ajustar término manualmente
              </label>
            )}
            {cargaDoCurso > 0 && !fimManual && (
              <p className="soft" style={{ fontSize: "0.72rem", margin: "0.25rem 0 0" }}>
                Calculado pela carga horária ({cargaHoraria(cargaDoCurso)}).
              </p>
            )}
          </div>
          <div>
            <label className="label">Vagas</label>
            <input type="number" min={1} className="input" value={vagas} onChange={(e) => setVagas(e.target.value)} placeholder="Sem limite" />
          </div>
          <div>
            <label className="label">Unidade</label>
            <select className="select" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              <option value="">—</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Como acontece</label>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            {(["presencial", "online"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`btn btn-sm ${modo === m ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setModo(m)}
              >
                {m === "presencial" ? "Presencial" : "Online"}
              </button>
            ))}
          </div>
        </div>

        {modo === "presencial" ? (
          <>
            <div>
              <label className="label">Sala</label>
              <select className="select" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                <option value="">Selecione uma sala…</option>
                {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <p className="soft" style={{ fontSize: "0.72rem", margin: "0.3rem 0 0" }}>
                As mesmas salas cadastradas para as reuniões.
              </p>
            </div>
            <div>
              <label className="label">Ou outro local</label>
              <input className="input" value={local} onChange={(e) => setLocal(e.target.value)} placeholder="Auditório do cliente, visita técnica…" />
            </div>
          </>
        ) : (
          <div>
            <label className="label">Link da chamada <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
          </div>
        )}
        <div>
          <label className="label">Instrutor</label>
          <PeoplePicker people={people} selected={instrutor} onChange={setInstrutor} single placeholder="Buscar instrutor…" />
          <p className="soft" style={{ fontSize: "0.72rem", margin: "0.3rem 0 0" }}>
            É quem libera o início da turma e lança a presença.
          </p>
        </div>
        {erro && <Erro texto={erro} />}
      </div>
      <Rodape onClose={onClose} onSalvar={salvar} pending={pending} />
    </Modal>
  );
}

// ------------------------------------------------------------------ convocar
/**
 * Convocação em LISTA, não em busca.
 *
 * Com 300 pendentes, digitar nome por nome é inviável: o instrutor precisa ver
 * quem está disponível, filtrar por setor e marcar em bloco. A busca continua,
 * agora como filtro da lista em vez de único caminho.
 */
function ConvocarDialog({ session, onClose }: { session: SessionRow; onClose: () => void }) {
  const [candidatos, setCandidatos] = useState<CandidatoConvocacao[] | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [busca, setBusca] = useState("");
  const [setor, setSetor] = useState("");
  const [erro, setErro] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  useEffect(() => {
    let vivo = true;
    getCandidatos(session.trainingId).then((r) => { if (vivo) setCandidatos(r); });
    return () => { vivo = false; };
  }, [session.trainingId]);

  const disponiveis = (candidatos ?? []).filter((c) => !c.jaNaTurma);

  const setores = Array.from(
    new Map(disponiveis.filter((c) => c.deptId).map((c) => [c.deptId!, c.deptName ?? "—"])).entries(),
  ).sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));

  const visiveis = disponiveis.filter((c) => {
    if (setor && c.deptId !== setor) return false;
    if (busca.trim() && !normalizar(c.userName).includes(normalizar(busca.trim()))) return false;
    return true;
  });

  const todosVisiveisMarcados = visiveis.length > 0 && visiveis.every((c) => ids.includes(c.userId));
  const alternarTodos = () => {
    const idsVisiveis = visiveis.map((c) => c.userId);
    setIds(todosVisiveisMarcados
      ? ids.filter((id) => !idsVisiveis.includes(id))
      : Array.from(new Set([...ids, ...idsVisiveis])));
  };

  const vagasRestantes = session.capacity ? session.capacity - session.convocados : null;

  const salvar = () => {
    setErro("");
    start(async () => {
      const r = await convocar(session.id, ids);
      if (r.error) { setErro(r.error); return; }
      router.refresh();
      onClose();
    });
  };

  return (
    <Modal
      titulo="Convocar para a turma"
      subtitulo={`${session.trainingName} · Turma ${session.code} · ${dataHora(session.startsAt)}`}
      onClose={onClose}
      largura={720}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
        <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
          A lista traz quem tem este treinamento pendente e ainda não está em turma nenhuma.
          Convocar não cria cobrança nova: aproveita a matrícula que a pessoa já tem.
          {vagasRestantes != null && ` Restam ${vagasRestantes} vagas.`}
        </p>

        {candidatos === null ? (
          <p className="soft" style={{ fontSize: "0.85rem" }}>Carregando…</p>
        ) : disponiveis.length === 0 ? (
          <p className="soft" style={{ fontSize: "0.85rem" }}>
            Ninguém pendente fora de turma para este treinamento.
          </p>
        ) : (
          <>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <input
                className="input"
                placeholder="Filtrar por nome…"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                style={{ width: 220, padding: "0.4rem 0.7rem", fontSize: "0.85rem" }}
              />
              <select
                className="select"
                value={setor}
                onChange={(e) => setSetor(e.target.value)}
                style={{ width: 220, fontSize: "0.85rem" }}
              >
                <option value="">Todos os setores</option>
                {setores.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
              </select>
              <button type="button" className="btn btn-ghost btn-sm" onClick={alternarTodos} disabled={visiveis.length === 0}>
                {todosVisiveisMarcados ? "Desmarcar" : "Marcar"} os {visiveis.length} em vista
              </button>
              <span className="soft" style={{ fontSize: "0.8rem", marginLeft: "auto" }}>
                {ids.length} selecionados
              </span>
            </div>

            <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
              {visiveis.length === 0 ? (
                <p className="soft" style={{ fontSize: "0.85rem", padding: "0.8rem" }}>Nada com esse filtro.</p>
              ) : (
                visiveis.map((c) => {
                  const on = ids.includes(c.userId);
                  return (
                    <button
                      key={c.userId}
                      type="button"
                      onClick={() => setIds(on ? ids.filter((x) => x !== c.userId) : [...ids, c.userId])}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: "0.6rem",
                        padding: "0.45rem 0.7rem", background: on ? "var(--surface-2)" : "none",
                        border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer",
                        textAlign: "left", color: "var(--text)", fontSize: "0.86rem",
                      }}
                    >
                      <span style={{ width: 14, height: 14, flexShrink: 0, borderRadius: 4, border: "1px solid var(--border-strong)", display: "inline-flex", alignItems: "center", justifyContent: "center", background: on ? "var(--mh-primary-500)" : "transparent" }}>
                        {on && <Check size={11} color="#fff" />}
                      </span>
                      <span style={{ flex: 1 }}>{c.userName}</span>
                      <span className="soft" style={{ fontSize: "0.74rem" }}>
                        {c.deptName ?? ""}{c.positionName ? ` · ${c.positionName}` : ""}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}
        {erro && <Erro texto={erro} />}
      </div>
      <Rodape onClose={onClose} onSalvar={salvar} pending={pending} rotulo={`Convocar ${ids.length || ""}`.trim()} desabilitado={ids.length === 0} />
    </Modal>
  );
}

// ------------------------------------------------------------------ presença
function PresencaDialog({ session, onClose }: { session: SessionRow; onClose: () => void }) {
  const [linhas, setLinhas] = useState<PresencaLinha[] | null>(null);
  const [erro, setErro] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  if (linhas === null) {
    getListaDePresenca(session.id).then((r) =>
      // quem estava afastado já entra justificado: cobrar presença de quem não
      // podia estar lá vira falta indevida no relatório
      setLinhas(r.map((l) => ({ ...l, status: l.status ?? (l.afastado ? "justificado" : "presente") }))),
    );
  }

  const marcar = (enrollmentId: string, status: Enums<"training_attendance_status">) => {
    setLinhas((atual) => (atual ?? []).map((l) => (l.enrollmentId === enrollmentId ? { ...l, status } : l)));
  };

  const salvar = (fechar: boolean) => {
    setErro("");
    start(async () => {
      const r = await lancarPresenca(
        session.id,
        (linhas ?? []).map((l) => ({ enrollmentId: l.enrollmentId, status: l.status ?? "ausente" })),
        fechar,
      );
      if (r.error) { setErro(r.error); return; }
      router.refresh();
      onClose();
    });
  };

  const tirarDaTurma = (enrollmentId: string) => {
    start(async () => {
      await desconvocar(enrollmentId);
      setLinhas((atual) => (atual ?? []).filter((l) => l.enrollmentId !== enrollmentId));
      router.refresh();
    });
  };

  return (
    <Modal titulo="Lista de presença" subtitulo={`${session.trainingName} · ${dataHora(session.startsAt)}`} onClose={onClose} largura={720}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
        {linhas === null ? (
          <p className="soft" style={{ fontSize: "0.85rem" }}>Carregando…</p>
        ) : linhas.length === 0 ? (
          <p className="soft" style={{ fontSize: "0.85rem" }}>Ninguém convocado ainda para esta turma.</p>
        ) : (
          <>
            <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
              Presente conclui o treinamento e agenda a próxima reciclagem. Falta registra o não
              comparecimento e mantém a cobrança. Justificado não conta como falta e não conclui.
            </p>
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th style={{ width: 300 }}>Presença</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.enrollmentId}>
                      <td>
                        {l.userName}
                        {l.afastado && (
                          <div className="soft" style={{ fontSize: "0.72rem" }}>
                            {ABSENCE_KIND_LABEL[l.motivoAfastamento as keyof typeof ABSENCE_KIND_LABEL] ?? l.motivoAfastamento} na data
                          </div>
                        )}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "0.3rem" }}>
                          {(["presente", "ausente", "justificado"] as const).map((op) => (
                            <button
                              key={op}
                              type="button"
                              className={`btn btn-sm ${l.status === op ? "btn-primary" : "btn-ghost"}`}
                              onClick={() => marcar(l.enrollmentId, op)}
                            >
                              {op === "presente" ? "Presente" : op === "ausente" ? "Falta" : "Justificado"}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td>
                        <button type="button" className="icon-btn icon-btn-danger" title="Tirar da turma" disabled={pending} onClick={() => tirarDaTurma(l.enrollmentId)}>
                          <X size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {erro && <Erro texto={erro} />}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-ghost" disabled={pending || !linhas?.length} onClick={() => salvar(false)}>
          Salvar sem fechar
        </button>
        <button type="button" className="btn btn-primary" disabled={pending || !linhas?.length} onClick={() => salvar(true)}>
          {pending ? "Salvando…" : "Salvar e concluir turma"}
        </button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ base
function Modal({
  titulo, subtitulo, children, onClose, largura = 620,
}: {
  titulo: string; subtitulo?: string; children: React.ReactNode; onClose: () => void; largura?: number;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 70, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: largura, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)", gap: "0.75rem" }}>
          <div>
            <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>{titulo}</h2>
            {subtitulo && <p className="soft" style={{ fontSize: "0.82rem", margin: "0.25rem 0 0" }}>{subtitulo}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>
        <div style={{ padding: "1.25rem" }}>{children}</div>
      </div>
    </div>
  );
}

function Erro({ texto }: { texto: string }) {
  return (
    <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
      {texto}
    </p>
  );
}

function Rodape({
  onClose, onSalvar, pending, rotulo = "Salvar", desabilitado = false,
}: {
  onClose: () => void; onSalvar: () => void; pending: boolean; rotulo?: string; desabilitado?: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.1rem" }}>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      <button type="button" className="btn btn-primary" disabled={pending || desabilitado} onClick={onSalvar}>
        {pending ? "Salvando…" : rotulo}
      </button>
    </div>
  );
}
