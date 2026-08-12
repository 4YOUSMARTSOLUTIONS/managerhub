"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { confirmDialog } from "@/components/ui/confirm";
import {
  deleteQuestao, getExam, saveExam, saveQuestao,
  type ExamRow, type OpcaoQuestao, type QuestaoRow,
} from "@/lib/actions/training-exams";
import type { Enums } from "@/types/database";

type Kind = Enums<"training_question_kind">;

const KIND_LABEL: Record<Kind, string> = {
  multipla_escolha: "Múltipla escolha",
  multipla_selecao: "Múltipla seleção",
  verdadeiro_falso: "Verdadeiro ou falso",
  dissertativa: "Dissertativa",
};

const LETRAS = "abcdefghij".split("");

export function TrainingExamDialog({
  trainingId, trainingName, onClose,
}: {
  trainingId: string;
  trainingName: string;
  onClose: () => void;
}) {
  const [exam, setExam] = useState<ExamRow | null | undefined>(undefined);
  const [editandoQuestao, setEditandoQuestao] = useState<QuestaoRow | "nova" | null>(null);
  const router = useRouter();

  const recarregar = () => getExam(trainingId).then(setExam);
  useEffect(() => {
    let vivo = true;
    getExam(trainingId).then((r) => { if (vivo) setExam(r); });
    return () => { vivo = false; };
  }, [trainingId]);

  if (exam === undefined) {
    return (
      <Modal titulo="Avaliação" subtitulo={trainingName} onClose={onClose}>
        <p className="soft" style={{ fontSize: "0.85rem" }}>Carregando…</p>
      </Modal>
    );
  }

  if (exam === null) {
    return (
      <Modal titulo="Avaliação" subtitulo={trainingName} onClose={onClose}>
        <ExamForm
          exam={null}
          trainingId={trainingId}
          onClose={onClose}
          onSalvo={async () => { await recarregar(); router.refresh(); }}
        />
      </Modal>
    );
  }

  if (editandoQuestao) {
    return (
      <Modal titulo="Questão" subtitulo={trainingName} onClose={() => setEditandoQuestao(null)} largura={700}>
        <QuestaoForm
          questao={editandoQuestao === "nova" ? null : editandoQuestao}
          examId={exam.id}
          proximaOrdem={exam.questoes.length + 1}
          onClose={() => setEditandoQuestao(null)}
          onSalvo={async () => { setEditandoQuestao(null); await recarregar(); router.refresh(); }}
        />
      </Modal>
    );
  }

  const excluir = async (q: QuestaoRow) => {
    const ok = await confirmDialog({
      title: "Remover questão",
      message: "A questão sai das próximas provas. As tentativas já respondidas continuam com ela, porque cada tentativa guarda a prova como foi aplicada.",
      confirmLabel: "Remover",
      tone: "danger",
    });
    if (!ok) return;
    await deleteQuestao(q.id);
    await recarregar();
    router.refresh();
  };

  const pesoTotal = exam.questoes.reduce((s, q) => s + q.weight, 0);

  return (
    <Modal titulo="Avaliação" subtitulo={trainingName} onClose={onClose} largura={760}>
      <ExamForm
        exam={exam}
        trainingId={trainingId}
        onClose={onClose}
        onSalvo={async () => { await recarregar(); router.refresh(); }}
      />

      <div style={{ borderTop: "1px solid var(--border)", marginTop: "1.2rem", paddingTop: "1.2rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.7rem" }}>
          <div>
            <h3 style={{ fontSize: "0.92rem", fontWeight: 700, margin: 0 }}>
              Questões {exam.questoes.length > 0 && <span className="soft">· {exam.questoes.length}</span>}
            </h3>
            {exam.questoes.length > 0 && (
              <p className="soft" style={{ fontSize: "0.74rem", margin: "0.2rem 0 0" }}>
                Peso total {pesoTotal}. A nota é o percentual do peso obtido, e aprova a partir de {exam.passingScore}%.
              </p>
            )}
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditandoQuestao("nova")}>
            <Plus size={14} style={{ marginRight: "0.3rem" }} /> Nova questão
          </button>
        </div>

        {exam.questoes.length === 0 ? (
          <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>
            Sem questões, a avaliação não abre para ninguém.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {exam.questoes.map((q, i) => (
              <div
                key={q.id}
                style={{ display: "flex", gap: "0.7rem", alignItems: "flex-start", border: "1px solid var(--border)", borderRadius: 10, padding: "0.6rem 0.8rem" }}
              >
                <span className="soft" style={{ fontSize: "0.8rem", fontWeight: 700, minWidth: 18 }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: "0.87rem" }}>{q.statement}</p>
                  <p className="soft" style={{ margin: "0.2rem 0 0", fontSize: "0.73rem" }}>
                    {KIND_LABEL[q.kind]}, peso {q.weight}
                    {q.kind !== "dissertativa" && `, ${q.options.length} alternativas`}
                  </p>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" title="Editar" onClick={() => setEditandoQuestao(q)}>
                  <Pencil size={14} />
                </button>
                <button type="button" className="btn btn-ghost btn-sm" title="Remover" onClick={() => excluir(q)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.1rem" }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>
      </div>
    </Modal>
  );
}

function ExamForm({
  exam, trainingId, onClose, onSalvo,
}: {
  exam: ExamRow | null;
  trainingId: string;
  onClose: () => void;
  onSalvo: () => void;
}) {
  const [titulo, setTitulo] = useState(exam?.title ?? "Avaliação");
  const [instrucoes, setInstrucoes] = useState(exam?.instructions ?? "");
  const [nota, setNota] = useState(String(exam?.passingScore ?? 70));
  const [tentativas, setTentativas] = useState(exam?.maxAttempts ? String(exam.maxAttempts) : "3");
  const [semLimiteTentativas, setSemLimite] = useState(exam ? exam.maxAttempts === null : false);
  const [tempo, setTempo] = useState(exam?.timeLimitMinutes ? String(exam.timeLimitMinutes) : "");
  const [tempoMinimo, setTempoMinimo] = useState(String(exam?.minMinutes ?? 0));
  const [embaralharQ, setEmbaralharQ] = useState(exam?.shuffleQuestions ?? true);
  const [embaralharO, setEmbaralharO] = useState(exam?.shuffleOptions ?? true);
  const [mostrarDetalhe, setMostrarDetalhe] = useState(exam?.showResultDetail ?? true);
  const [depoisDoConteudo, setDepoisDoConteudo] = useState(exam?.startsAfterContent ?? true);
  const [ativa, setAtiva] = useState(exam?.active ?? true);
  const [erro, setErro] = useState("");
  const [pending, start] = useTransition();

  const salvar = () => {
    setErro("");
    start(async () => {
      const r = await saveExam({
        id: exam?.id,
        trainingId,
        title: titulo,
        instructions: instrucoes,
        passingScore: Math.min(100, Math.max(1, Number(nota) || 70)),
        maxAttempts: semLimiteTentativas ? null : Math.max(1, Number(tentativas) || 1),
        timeLimitMinutes: tempo ? Math.max(1, Number(tempo)) : null,
        minMinutes: Math.max(0, Number(tempoMinimo) || 0),
        shuffleQuestions: embaralharQ,
        shuffleOptions: embaralharO,
        showResultDetail: mostrarDetalhe,
        startsAfterContent: depoisDoConteudo,
        active: ativa,
      });
      if (r.error) { setErro(r.error); return; }
      onSalvo();
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
      {!exam && (
        <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>
          Este treinamento ainda não tem avaliação. Ao criar uma, o treinamento passa a exigir
          aprovação para ser concluído.
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.8rem" }}>
        <div>
          <label className="label">Título <span style={{ color: "var(--mh-danger)" }}>*</span></label>
          <input className="input" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        </div>
        <div>
          <label className="label">Nota mínima para aprovar</label>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <input type="number" min={1} max={100} className="input" style={{ maxWidth: 90 }} value={nota} onChange={(e) => setNota(e.target.value)} />
            <span className="soft" style={{ fontSize: "0.84rem" }}>%</span>
          </div>
        </div>
      </div>

      <div>
        <label className="label">Instruções</label>
        <textarea className="input" rows={2} value={instrucoes} onChange={(e) => setInstrucoes(e.target.value)} placeholder="O que a pessoa precisa saber antes de começar." />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.8rem" }}>
        <div>
          <label className="label">Tentativas</label>
          <input
            type="number" min={1} className="input"
            value={semLimiteTentativas ? "" : tentativas}
            disabled={semLimiteTentativas}
            onChange={(e) => setTentativas(e.target.value)}
          />
          <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.74rem", marginTop: "0.3rem" }} className="soft">
            <input type="checkbox" checked={semLimiteTentativas} onChange={(e) => setSemLimite(e.target.checked)} />
            Sem limite
          </label>
        </div>
        <div>
          <label className="label">Tempo de prova</label>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <input type="number" min={1} className="input" style={{ maxWidth: 90 }} value={tempo} onChange={(e) => setTempo(e.target.value)} placeholder="Sem" />
            <span className="soft" style={{ fontSize: "0.84rem" }}>min</span>
          </div>
          <p className="soft" style={{ fontSize: "0.72rem", margin: "0.3rem 0 0" }}>
            O prazo é contado pelo servidor a partir da abertura.
          </p>
        </div>
        <div>
          <label className="label">Tempo mínimo antes de enviar</label>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <input type="number" min={0} className="input" style={{ maxWidth: 90 }} value={tempoMinimo} onChange={(e) => setTempoMinimo(e.target.value)} />
            <span className="soft" style={{ fontSize: "0.84rem" }}>min</span>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0.5rem" }}>
        <Marcador checked={embaralharQ} onChange={setEmbaralharQ} label="Embaralhar as questões" />
        <Marcador checked={embaralharO} onChange={setEmbaralharO} label="Embaralhar as alternativas" />
        <Marcador checked={depoisDoConteudo} onChange={setDepoisDoConteudo} label="Exigir o conteúdo antes da prova" />
        <Marcador checked={mostrarDetalhe} onChange={setMostrarDetalhe} label="Mostrar o que errou depois de corrigida" />
        <Marcador checked={ativa} onChange={setAtiva} label="Avaliação ativa" />
      </div>

      {erro && (
        <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
          {erro}
        </p>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
        {!exam && <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>}
        <button type="button" className="btn btn-primary" disabled={pending} onClick={salvar}>
          {pending ? "Salvando…" : exam ? "Salvar regras" : "Criar avaliação"}
        </button>
      </div>
    </div>
  );
}

function QuestaoForm({
  questao, examId, proximaOrdem, onClose, onSalvo,
}: {
  questao: QuestaoRow | null;
  examId: string;
  proximaOrdem: number;
  onClose: () => void;
  onSalvo: () => void;
}) {
  const [kind, setKind] = useState<Kind>(questao?.kind ?? "multipla_escolha");
  const [enunciado, setEnunciado] = useState(questao?.statement ?? "");
  const [peso, setPeso] = useState(String(questao?.weight ?? 1));
  const [opcoes, setOpcoes] = useState<OpcaoQuestao[]>(
    questao?.options?.length
      ? questao.options
      : [{ id: "a", text: "" }, { id: "b", text: "" }],
  );
  const [certas, setCertas] = useState<string[]>(questao?.correct ?? []);
  const [erro, setErro] = useState("");
  const [pending, start] = useTransition();

  // verdadeiro ou falso é múltipla escolha com as alternativas prontas
  const trocarTipo = (k: Kind) => {
    setKind(k);
    setCertas([]);
    if (k === "verdadeiro_falso") {
      setOpcoes([{ id: "v", text: "Verdadeiro" }, { id: "f", text: "Falso" }]);
    } else if (k !== "dissertativa" && opcoes.length < 2) {
      setOpcoes([{ id: "a", text: "" }, { id: "b", text: "" }]);
    }
  };

  const marcar = (id: string) => {
    if (kind === "multipla_selecao") {
      setCertas((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
    } else {
      setCertas([id]);
    }
  };

  const salvar = () => {
    setErro("");
    start(async () => {
      const r = await saveQuestao({
        id: questao?.id,
        examId,
        sort: questao?.sort ?? proximaOrdem,
        kind,
        statement: enunciado,
        options: opcoes.filter((o) => o.text.trim()),
        correct: certas,
        weight: Math.max(0.5, Number(peso) || 1),
      });
      if (r.error) { setErro(r.error); return; }
      onSalvo();
    });
  };

  const objetiva = kind !== "dissertativa";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
      <div>
        <label className="label">Tipo <span style={{ color: "var(--mh-danger)" }}>*</span></label>
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`btn btn-sm ${kind === k ? "btn-primary" : "btn-ghost"}`}
              onClick={() => trocarTipo(k)}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label">Enunciado <span style={{ color: "var(--mh-danger)" }}>*</span></label>
        <textarea className="input" rows={3} value={enunciado} onChange={(e) => setEnunciado(e.target.value)} />
      </div>

      {objetiva && (
        <div>
          <label className="label">
            Alternativas <span style={{ color: "var(--mh-danger)" }}>*</span>
            <span className="soft" style={{ fontWeight: 400 }}>
              {" "}({kind === "multipla_selecao" ? "marque todas as certas" : "marque a certa"})
            </span>
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {opcoes.map((o, i) => (
              <div key={o.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <button
                  type="button"
                  onClick={() => marcar(o.id)}
                  title="Marcar como certa"
                  style={{
                    width: 26, height: 26, flexShrink: 0, borderRadius: kind === "multipla_selecao" ? 6 : "50%",
                    border: `1px solid ${certas.includes(o.id) ? "var(--mh-success)" : "var(--border)"}`,
                    background: certas.includes(o.id) ? "var(--mh-success-soft)" : "transparent",
                    color: certas.includes(o.id) ? "var(--mh-success)" : "var(--text-muted)",
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "0.72rem", fontWeight: 700,
                  }}
                >
                  {certas.includes(o.id) ? <Check size={14} /> : LETRAS[i]?.toUpperCase()}
                </button>
                <input
                  className="input"
                  value={o.text}
                  disabled={kind === "verdadeiro_falso"}
                  onChange={(e) => setOpcoes((a) => a.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)))}
                  placeholder={`Alternativa ${LETRAS[i]?.toUpperCase()}`}
                />
                {kind !== "verdadeiro_falso" && opcoes.length > 2 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    title="Remover alternativa"
                    onClick={() => {
                      setOpcoes((a) => a.filter((x) => x.id !== o.id));
                      setCertas((c) => c.filter((x) => x !== o.id));
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {kind !== "verdadeiro_falso" && opcoes.length < LETRAS.length && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ marginTop: "0.4rem" }}
              onClick={() => setOpcoes((a) => [...a, { id: LETRAS[a.length], text: "" }])}
            >
              <Plus size={14} style={{ marginRight: "0.3rem" }} /> Alternativa
            </button>
          )}
        </div>
      )}

      {!objetiva && (
        <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
          A dissertativa vai para a fila de correção de quem responde pelo treinamento. Enquanto
          não for corrigida, a prova fica aguardando e a matrícula não conta como pendente.
        </p>
      )}

      <div style={{ maxWidth: 140 }}>
        <label className="label">Peso</label>
        <input type="number" min={0.5} step={0.5} className="input" value={peso} onChange={(e) => setPeso(e.target.value)} />
      </div>

      {erro && (
        <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
          {erro}
        </p>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={salvar}>
          {pending ? "Salvando…" : "Salvar questão"}
        </button>
      </div>
    </div>
  );
}

function Marcador({
  checked, onChange, label,
}: {
  checked: boolean; onChange: (v: boolean) => void; label: string;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.84rem" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

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
