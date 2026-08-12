"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock, FileCheck } from "lucide-react";
import { toast } from "sonner";
import {
  enviarProva, getTentativa, iniciarProva, responderQuestao,
  type ResumoDaProva, type TentativaEmCurso,
} from "@/lib/actions/training-exams";

/**
 * Aplicação da prova.
 *
 * O cronômetro daqui é informativo. Quem decide se o prazo acabou é o servidor,
 * que gravou `deadline_at` na abertura: fechar o navegador, adiantar o relógio
 * da máquina ou perder a conexão não muda nada. Quando o contador zera, a tela
 * só pede o encerramento que o banco já teria feito de qualquer forma.
 */
export function TrainingExamRunner({
  enrollmentId, resumo,
}: {
  enrollmentId: string;
  resumo: ResumoDaProva;
}) {
  const [tentativa, setTentativa] = useState<TentativaEmCurso | null>(null);
  const [erro, setErro] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const emCurso = resumo.tentativas.find((t) => t.status === "em_andamento");
  const aprovada = resumo.tentativas.find((t) => t.status === "aprovado");
  const aguardando = resumo.tentativas.find((t) => t.status === "aguardando_correcao");
  const teto = resumo.maxAttempts === null ? null : resumo.maxAttempts + resumo.extraAttempts;
  const restantes = teto === null ? null : Math.max(0, teto - resumo.tentativas.length);

  // retoma a tentativa aberta sem pedir nada: quem recarregou a página no meio
  // da prova volta para onde estava
  useEffect(() => {
    if (!emCurso || tentativa) return;
    let vivo = true;
    getTentativa(emCurso.id).then((t) => { if (vivo && t) setTentativa(t); });
    return () => { vivo = false; };
  }, [emCurso, tentativa]);

  const abrir = () => {
    setErro("");
    start(async () => {
      const r = await iniciarProva(enrollmentId);
      if (r.error || !r.attemptId) { setErro(r.error ?? "Não foi possível abrir a avaliação."); return; }
      const t = await getTentativa(r.attemptId);
      if (t) setTentativa(t);
      router.refresh();
    });
  };

  if (tentativa && tentativa.status === "em_andamento") {
    return (
      <Prova
        tentativa={tentativa}
        onEncerrada={() => { setTentativa(null); router.refresh(); }}
      />
    );
  }

  return (
    <div className="card" style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
      <div>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <FileCheck size={17} /> {resumo.title}
        </h2>
        {resumo.instructions && (
          <p className="soft" style={{ fontSize: "0.85rem", margin: "0.4rem 0 0", whiteSpace: "pre-wrap" }}>
            {resumo.instructions}
          </p>
        )}
        <p className="soft" style={{ fontSize: "0.78rem", margin: "0.5rem 0 0" }}>
          Aprova a partir de {resumo.passingScore}%.
          {resumo.timeLimitMinutes ? ` Tempo de ${resumo.timeLimitMinutes} minutos.` : " Sem limite de tempo."}
          {teto === null ? " Tentativas ilimitadas." : ` ${restantes} de ${teto} tentativas restantes.`}
        </p>
      </div>

      {resumo.tentativas.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          {resumo.tentativas.map((t) => (
            <div
              key={t.id}
              style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.82rem" }}
            >
              <span className="soft">Tentativa {t.attemptNo}:</span>
              <span style={{ fontWeight: 600, color: cor(t.status) }}>{ROTULO[t.status]}</span>
              {t.score !== null && <span className="soft">{t.score}%</span>}
            </div>
          ))}
        </div>
      )}

      {aprovada ? (
        <p style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "var(--mh-success)", fontSize: "0.88rem", margin: 0, fontWeight: 600 }}>
          <CheckCircle2 size={16} /> Aprovado com {aprovada.score}%.
        </p>
      ) : aguardando ? (
        <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>
          Sua prova foi enviada e tem questão dissertativa aguardando correção. O resultado aparece
          aqui assim que quem responde pelo treinamento corrigir.
        </p>
      ) : restantes === 0 ? (
        <p style={{ display: "flex", alignItems: "flex-start", gap: "0.4rem", fontSize: "0.85rem", margin: 0, color: "var(--mh-danger)" }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          Tentativas esgotadas. Procure quem responde pelo treinamento para liberar uma nova.
        </p>
      ) : (
        <button type="button" className="btn btn-primary" style={{ alignSelf: "flex-start" }} disabled={pending} onClick={abrir}>
          {pending ? "Abrindo…" : resumo.tentativas.length > 0 ? "Nova tentativa" : "Iniciar avaliação"}
        </button>
      )}

      {erro && (
        <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
          {erro}
        </p>
      )}
    </div>
  );
}

const ROTULO: Record<string, string> = {
  em_andamento: "em andamento",
  aguardando_correcao: "aguardando correção",
  aprovado: "aprovado",
  reprovado: "reprovado",
};

const cor = (s: string) =>
  s === "aprovado" ? "var(--mh-success)" : s === "reprovado" ? "var(--mh-danger)" : "var(--text)";

function Prova({
  tentativa, onEncerrada,
}: {
  tentativa: TentativaEmCurso;
  onEncerrada: () => void;
}) {
  const [respostas, setRespostas] = useState<Record<string, string[] | string>>(() => {
    const inicial: Record<string, string[] | string> = {};
    for (const q of tentativa.questoes) {
      if (q.kind === "dissertativa") inicial[q.id] = q.respostaTexto ?? "";
      else inicial[q.id] = q.resposta ?? [];
    }
    return inicial;
  });
  const [restante, setRestante] = useState<number | null>(null);
  const [erro, setErro] = useState("");
  const [pending, start] = useTransition();
  const enviando = useRef(false);

  const podeEnviarEm = new Date(tentativa.startsAt).getTime() + tentativa.minMinutes * 60_000;
  const [cedoDemais, setCedoDemais] = useState(Date.now() < podeEnviarEm);

  const enviar = useCallback((automatico = false) => {
    if (enviando.current) return;
    enviando.current = true;
    start(async () => {
      const r = await enviarProva(tentativa.attemptId);
      enviando.current = false;
      if (r.error) { setErro(r.error); return; }
      const res = r.resultado;
      if (res?.status === "aprovado") toast.success(`Aprovado com ${res.score}%.`);
      else if (res?.status === "reprovado") toast.error(`Nota ${res.score}%, abaixo do mínimo.`);
      else toast.success(automatico ? "Tempo encerrado, prova enviada." : "Prova enviada para correção.");
      onEncerrada();
    });
  }, [tentativa.attemptId, onEncerrada]);

  useEffect(() => {
    const tick = () => {
      setCedoDemais(Date.now() < podeEnviarEm);
      if (!tentativa.deadlineAt) return;
      const falta = Math.floor((new Date(tentativa.deadlineAt).getTime() - Date.now()) / 1000);
      setRestante(falta);
      if (falta <= 0) enviar(true);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [tentativa.deadlineAt, podeEnviarEm, enviar]);

  /** Cada resposta vai ao servidor na hora: fechar a aba não perde o que já foi marcado. */
  const responder = (questionId: string, valor: string[] | string) => {
    setRespostas((a) => ({ ...a, [questionId]: valor }));
    void responderQuestao(tentativa.attemptId, questionId, valor);
  };

  const semResposta = tentativa.questoes.filter((q) => {
    const r = respostas[q.id];
    return Array.isArray(r) ? r.length === 0 : !String(r ?? "").trim();
  }).length;

  return (
    <div className="card" style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1.1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: 0 }}>Avaliação em andamento</h2>
        {restante !== null && (
          <span
            style={{
              display: "flex", alignItems: "center", gap: "0.35rem", fontVariantNumeric: "tabular-nums",
              fontWeight: 700, fontSize: "0.95rem",
              color: restante < 60 ? "var(--mh-danger)" : "var(--text)",
            }}
          >
            <Clock size={15} /> {relogio(restante)}
          </span>
        )}
      </div>

      {tentativa.questoes.map((q, i) => (
        <div key={q.id} style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)", paddingTop: i === 0 ? 0 : "1rem" }}>
          <p style={{ margin: "0 0 0.6rem", fontSize: "0.9rem", fontWeight: 600 }}>
            <span className="soft" style={{ marginRight: "0.4rem" }}>{i + 1}.</span>
            {q.statement}
            {q.kind === "multipla_selecao" && (
              <span className="soft" style={{ fontWeight: 400, fontSize: "0.75rem" }}> (mais de uma resposta)</span>
            )}
          </p>

          {q.kind === "dissertativa" ? (
            <textarea
              className="input"
              rows={4}
              value={String(respostas[q.id] ?? "")}
              onChange={(e) => setRespostas((a) => ({ ...a, [q.id]: e.target.value }))}
              onBlur={(e) => responder(q.id, e.target.value)}
              placeholder="Escreva sua resposta."
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {q.options.map((o) => {
                const marcadas = (respostas[q.id] as string[]) ?? [];
                const marcada = marcadas.includes(o.id);
                return (
                  <label
                    key={o.id}
                    style={{
                      display: "flex", alignItems: "center", gap: "0.55rem", cursor: "pointer",
                      border: `1px solid ${marcada ? "var(--mh-primary)" : "var(--border)"}`,
                      background: marcada ? "var(--mh-primary-soft)" : "transparent",
                      borderRadius: 8, padding: "0.5rem 0.7rem", fontSize: "0.87rem",
                    }}
                  >
                    <input
                      type={q.kind === "multipla_selecao" ? "checkbox" : "radio"}
                      name={q.id}
                      checked={marcada}
                      onChange={() => {
                        const novo = q.kind === "multipla_selecao"
                          ? (marcada ? marcadas.filter((x) => x !== o.id) : [...marcadas, o.id])
                          : [o.id];
                        responder(q.id, novo);
                      }}
                    />
                    {o.text}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {erro && (
        <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
          {erro}
        </p>
      )}

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
          {semResposta > 0
            ? `${semResposta} ${semResposta === 1 ? "questão sem resposta" : "questões sem resposta"}. Questão em branco conta como errada.`
            : "Todas as questões respondidas."}
          {cedoDemais && ` O envio libera após ${tentativa.minMinutes} minutos de prova.`}
        </p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending || cedoDemais}
          onClick={() => enviar(false)}
        >
          {pending ? "Enviando…" : "Enviar avaliação"}
        </button>
      </div>
    </div>
  );
}

function relogio(segundos: number) {
  const s = Math.max(0, segundos);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
