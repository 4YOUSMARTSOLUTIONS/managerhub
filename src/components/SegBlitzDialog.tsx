"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Plus } from "lucide-react";
import { PeoplePicker, type Person } from "@/components/PeoplePicker";
import { SEG_BLITZ_RESPOSTA, SEG_VEICULO_COR, SEG_VEICULO_PROPRIEDADE, type SegVeiculoCor } from "@/lib/constants";
import { formatDate, hojeYmd, shortName } from "@/lib/format";
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
  cor: string | null;
};

/** Onde está o que falta: o erro rola a tela até lá. */
type Secao = "colaborador" | "meio" | "veiculo" | "perguntas" | "decisao";

const obrigatorio = <span style={{ color: "var(--mh-danger)" }}>*</span>;

/**
 * O formulário da portaria. A fila anda, então tudo aqui existe para reduzir
 * toque e digitação (LUIZ, 10/11/2026: "o mais fácil e rápido possível"):
 *  - a busca abre com o cursor, acha sem acento e pela matrícula;
 *  - escolher o colaborador sugere o meio e o veículo da última blitz dele
 *    (placa, modelo, propriedade e cor, obrigatórios quando há veículo);
 *  - a data já é hoje e só abre se alguém tocar em "Alterar"; a observação,
 *    opcional, também fica fechada;
 *  - escolher o meio filtra as perguntas (sem vínculo = vale para todos);
 *  - o que falta aparece no rodapé, e a tela rola até o campo;
 *  - ao registrar, a tela confirma e oferece a próxima blitz na hora.
 *
 * As respostas começam VAZIAS de propósito: pré-marcar "sim" (ou um "marcar
 * todas") transformaria a blitz em carimbo. O avaliador toca cada resposta.
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
  const [editarData, setEditarData] = useState(false);
  const [meioId, setMeioId] = useState("");
  const [placa, setPlaca] = useState("");
  const [tipo, setTipo] = useState("");
  // sem valor inicial: propriedade e cor são escolha de quem avalia (ou vêm da última blitz)
  const [propriedade, setPropriedade] = useState<Enums<"seg_veiculo_propriedade"> | "">("");
  const [cor, setCor] = useState<SegVeiculoCor | "">("");
  const [sugerido, setSugerido] = useState(false);
  const [respostas, setRespostas] = useState<Record<string, Enums<"seg_blitz_resposta">>>({});
  const [liberado, setLiberado] = useState<boolean | null>(null);
  const [motivoId, setMotivoId] = useState("");
  const [observacao, setObservacao] = useState("");
  const [verObservacao, setVerObservacao] = useState(false);
  const [erro, setErro] = useState("");
  /** a blitz acabou de ser registrada: a tela confirma e oferece a próxima */
  const [registrada, setRegistrada] = useState<{ nome: string; situacao: string } | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  const secoes = useRef<Partial<Record<Secao, HTMLDivElement | null>>>({});

  const meiosAtivos = useMemo(() => meios.filter((m) => m.active), [meios]);
  const meio = useMemo(() => meios.find((m) => m.id === meioId) ?? null, [meios, meioId]);

  // a cascata: pergunta sem vínculo vale para todos os meios
  const perguntasDoMeio = useMemo(
    () => perguntas.filter((q) => q.active && (q.meioIds.length === 0 || (!!meioId && q.meioIds.includes(meioId)))),
    [perguntas, meioId],
  );
  const respondidas = perguntasDoMeio.filter((q) => respostas[q.id]).length;

  const limpar = () => {
    setUserId(""); setData(hoje); setEditarData(false); setMeioId(""); setPlaca(""); setTipo("");
    setPropriedade(""); setCor(""); setSugerido(false); setRespostas({}); setLiberado(null);
    setMotivoId(""); setObservacao(""); setVerObservacao(false); setErro("");
  };
  const fechar = () => { limpar(); setRegistrada(null); onClose(); };

  /** Escolher o colaborador sugere o veículo da última blitz dele. */
  const escolherPessoa = (ids: string[]) => {
    const id = ids[0] ?? "";
    setUserId(id);
    setErro("");
    const v = id ? veiculos.find((x) => x.userId === id) : undefined;
    setSugerido(!!v);
    if (v) {
      if (v.meioId) setMeioId(v.meioId);
      setPlaca(v.placa);
      setTipo(v.tipoDescricao ?? "");
      setPropriedade(v.propriedade);
      setCor(v.cor && v.cor in SEG_VEICULO_COR ? (v.cor as SegVeiculoCor) : "");
    }
  };

  const responder = (perguntaId: string, r: Enums<"seg_blitz_resposta">) =>
    setRespostas((atual) => ({ ...atual, [perguntaId]: r }));

  /** Mostra o que falta no rodapé e leva a tela até o campo (ou até o elemento exato). */
  const falta = (msg: string, secao: Secao, alvo?: Element | null) => {
    setErro(msg);
    (alvo ?? secoes.current[secao])?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const salvar = () => {
    setErro("");
    if (!userId) return falta("Escolha o colaborador.", "colaborador");
    if (!meioId) return falta("Escolha o meio de transporte.", "meio");
    if (meio?.temVeiculo) {
      if (!placa.trim()) return falta("Informe a placa do veículo.", "veiculo");
      if (!tipo.trim()) return falta("Informe o modelo do veículo.", "veiculo");
      if (!propriedade) return falta("Informe a propriedade do veículo.", "veiculo");
      if (!cor) return falta("Informe a cor do veículo.", "veiculo");
    }
    // toda pergunta visível precisa de resposta: pular pergunta é o mesmo
    // que não fazer a blitz
    const semResposta = perguntasDoMeio.filter((q) => !respostas[q.id]);
    if (semResposta.length > 0) {
      // rola até a primeira sem resposta, e não até o meio do bloco (que pode cair atrás do rodapé)
      const primeira = secoes.current.perguntas?.querySelector(`[data-pergunta="${semResposta[0].id}"]`);
      return falta(`Responda todas as perguntas (${semResposta.length} em aberto).`, "perguntas", primeira);
    }
    if (liberado === null) return falta("Informe se foi liberado ou bloqueado.", "decisao");
    if (!liberado && !motivoId) return falta("Bloqueio precisa de um motivo.", "decisao");

    const nome = shortName(pessoas.find((p) => p.id === userId)?.name);
    const situacao = !liberado
      ? "Bloqueado"
      : perguntasDoMeio.some((q) => respostas[q.id] === "nao") ? "Liberado com desvio" : "Conforme";

    iniciar(async () => {
      const r = await criarBlitz({
        userId,
        occurredOn: data,
        meioId,
        placa: meio?.temVeiculo ? placa : null,
        veiculoTipo: meio?.temVeiculo ? tipo : null,
        propriedade: meio?.temVeiculo && propriedade ? propriedade : null,
        cor: meio?.temVeiculo && cor ? cor : null,
        liberado,
        motivoBloqueioId: liberado ? null : motivoId,
        observacao,
        respostas: perguntasDoMeio.map((q) => ({ perguntaId: q.id, resposta: respostas[q.id] })),
      });
      if (r.error) { setErro(r.error); return; }
      limpar();
      setRegistrada({ nome, situacao });
      router.refresh();
    });
  };

  if (!open) return null;

  const tomDaSituacao = (s: string) =>
    s === "Conforme" ? "var(--mh-success)" : s === "Bloqueado" ? "var(--mh-danger)" : "var(--mh-warning)";

  return (
    // no celular (mh-folha*) o formulário ocupa a tela toda, com o cabeçalho e o
    // "Registrar blitz" fixos: a fila da portaria não pode depender de rolar
    // até o fim para achar o botão
    <div
      className="mh-folha-fundo"
      style={{
        position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)",
        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "5vh 1rem", zIndex: 60, overflowY: "auto",
      }}
    >
      <div className="card mh-folha" style={{ width: "100%", maxWidth: 620, boxShadow: "var(--mh-shadow-e3)" }}>
        <div className="mh-folha-topo" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.9rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>{registrada ? "Blitz registrada" : "Nova blitz"}</h2>
          <button
            type="button" onClick={fechar} className="icon-btn" aria-label="Fechar"
            style={{ fontSize: "1.3rem", lineHeight: 1, minWidth: 40, minHeight: 40 }}
          >
            ×
          </button>
        </div>

        {registrada ? (
          // confirmação: quem está na fila não espera a tela fechar e abrir de novo
          <div className="mh-folha-corpo" style={{ padding: "2rem 1.25rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.6rem", textAlign: "center" }}>
            <CircleCheck size={44} style={{ color: "var(--mh-success)" }} aria-hidden />
            <div style={{ fontSize: "1.05rem", fontWeight: 700 }}>{registrada.nome}</div>
            <div style={{ fontSize: "0.9rem", fontWeight: 600, color: tomDaSituacao(registrada.situacao) }}>{registrada.situacao}</div>
            {registrada.situacao !== "Conforme" && (
              <p className="soft" style={{ fontSize: "0.8rem", margin: 0, maxWidth: 360 }}>
                O gestor da pessoa já foi avisado para conversar e registrar a tratativa.
              </p>
            )}
          </div>
        ) : (
          <div
            className="mh-folha-corpo"
            // o aviso do que falta some quando a pessoa mexe; volta no próximo "Registrar" se ainda faltar
            onClickCapture={() => { if (erro) setErro(""); }}
            onChangeCapture={() => { if (erro) setErro(""); }}
            style={{ padding: "1.1rem 1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            <div ref={(el) => { secoes.current.colaborador = el; }}>
              <label className="label">Colaborador {obrigatorio}</label>
              <PeoplePicker
                people={pessoas} selected={userId ? [userId] : []}
                onChange={escolherPessoa} single autoFocus placeholder="Nome ou matrícula…"
              />
              {/* a data quase sempre é hoje: fica fechada até alguém precisar mudar */}
              <div className="soft" style={{ fontSize: "0.8rem", marginTop: "0.45rem", display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                {editarData ? (
                  <>
                    <label htmlFor="blitz-data">Data da blitz</label>
                    <input
                      id="blitz-data" className="input" type="date" value={data} max={hoje}
                      onChange={(e) => setData(e.target.value || hoje)} style={{ width: "auto" }}
                    />
                  </>
                ) : (
                  <>
                    <span>Data da blitz: {data === hoje ? `hoje, ${formatDate(data)}` : formatDate(data)}</span>
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEditarData(true)}>Alterar</button>
                  </>
                )}
              </div>
            </div>

            <div ref={(el) => { secoes.current.meio = el; }}>
              <label className="label">Meio de transporte {obrigatorio}</label>
              {/* no celular, grade de 2 colunas (LUIZ preferiu a um dropdown: um toque e à vista) */}
              <div className="grade-2-no-celular" style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                {meiosAtivos.map((m) => {
                  const on = meioId === m.id;
                  const src = segIconeSrc(m.imagePath);
                  return (
                    <button
                      key={m.id} type="button" aria-pressed={on}
                      onClick={() => { if (!on) { setMeioId(m.id); setRespostas({}); } }}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: "0.4rem",
                        padding: "0.4rem 0.8rem", cursor: "pointer",
                        background: on ? "var(--mh-primary-soft)" : "var(--surface-2)",
                        border: "1px solid " + (on ? "var(--mh-primary-500)" : "var(--border)"),
                        borderRadius: 999, color: "var(--mh-text-1)",
                        fontSize: "0.85rem", fontWeight: on ? 700 : 500,
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
              <div ref={(el) => { secoes.current.veiculo = el; }} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {sugerido && (
                  <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
                    Veículo da última blitz desta pessoa. Confira e corrija se mudou.
                  </p>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))", gap: "0.8rem" }}>
                  <div>
                    <label className="label" htmlFor="blitz-placa">Placa {obrigatorio}</label>
                    <input
                      id="blitz-placa" className="input" value={placa} maxLength={10}
                      placeholder="ABC1D23" style={{ textTransform: "uppercase" }}
                      autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false}
                      onChange={(e) => setPlaca(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="blitz-modelo">Modelo do veículo {obrigatorio}</label>
                    <input
                      id="blitz-modelo" className="input" value={tipo} placeholder="Exemplo: Gol, Strada"
                      autoCapitalize="words" autoComplete="off"
                      onChange={(e) => setTipo(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="blitz-propriedade">Propriedade {obrigatorio}</label>
                    <select
                      id="blitz-propriedade" className="select" value={propriedade}
                      onChange={(e) => setPropriedade(e.target.value as Enums<"seg_veiculo_propriedade"> | "")}
                    >
                      <option value="">Selecione…</option>
                      {(Object.keys(SEG_VEICULO_PROPRIEDADE) as Enums<"seg_veiculo_propriedade">[]).map((p) => (
                        <option key={p} value={p}>{SEG_VEICULO_PROPRIEDADE[p]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="blitz-cor">Cor {obrigatorio}</label>
                    <select id="blitz-cor" className="select" value={cor} onChange={(e) => setCor(e.target.value as SegVeiculoCor | "")}>
                      <option value="">Selecione…</option>
                      {(Object.keys(SEG_VEICULO_COR) as SegVeiculoCor[]).map((c) => (
                        <option key={c} value={c}>{SEG_VEICULO_COR[c]}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {meioId && perguntasDoMeio.length > 0 && (
              <div ref={(el) => { secoes.current.perguntas = el; }} style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem" }}>
                  <label className="label" style={{ marginBottom: 0 }}>Verificação {obrigatorio}</label>
                  <span className="soft" style={{ fontSize: "0.76rem" }}>
                    {respondidas} de {perguntasDoMeio.length} respondida{perguntasDoMeio.length === 1 ? "" : "s"}
                  </span>
                </div>
                {perguntasDoMeio.map((q) => {
                  const r = respostas[q.id];
                  // a borda conta a resposta: dá para conferir de relance o que falta
                  const borda = r === "sim" ? "var(--mh-success)" : r === "nao" ? "var(--mh-danger)" : r === "na" ? "var(--mh-text-3)" : "transparent";
                  return (
                    <div
                      key={q.id}
                      data-pergunta={q.id}
                      style={{
                        display: "flex", gap: "0.6rem", alignItems: "center", justifyContent: "space-between",
                        background: "var(--surface-2)", borderRadius: "var(--mh-radius-md)", padding: "0.6rem 0.75rem",
                        flexWrap: "wrap", border: `1px solid ${borda}`,
                      }}
                    >
                      <span style={{ fontSize: "0.86rem", flex: "1 1 240px" }}>{q.name}</span>
                      <span className="grade-3-no-celular" style={{ display: "inline-flex", gap: "0.35rem", flex: "1 1 220px", justifyContent: "flex-end" }}>
                        {(["sim", "nao", "na"] as Enums<"seg_blitz_resposta">[]).map((op) => {
                          const on = r === op;
                          const tom = op === "sim" ? "var(--mh-success)" : op === "nao" ? "var(--mh-danger)" : "var(--mh-text-3)";
                          return (
                            <button
                              key={op} type="button" aria-pressed={on}
                              onClick={() => responder(q.id, op)}
                              style={{
                                // altura de dedo: na portaria se responde com o polegar
                                minHeight: 38, minWidth: 56,
                                padding: "0.3rem 0.75rem", cursor: "pointer", fontSize: "0.82rem",
                                fontWeight: on ? 700 : 500, borderRadius: 999,
                                background: on ? `color-mix(in srgb, ${tom} 16%, transparent)` : "var(--surface-1)",
                                border: "1px solid " + (on ? tom : "var(--border)"),
                                color: on ? tom : "var(--mh-text-2)",
                              }}
                            >
                              {SEG_BLITZ_RESPOSTA[op]}
                            </button>
                          );
                        })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div ref={(el) => { secoes.current.decisao = el; }} style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
              <label className="label" style={{ marginBottom: 0 }}>Decisão {obrigatorio}</label>
              <div className="grade-2-no-celular" style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                {([true, false] as const).map((op) => {
                  const on = liberado === op;
                  const tom = op ? "var(--mh-success)" : "var(--mh-danger)";
                  return (
                    <button
                      key={String(op)} type="button" aria-pressed={on}
                      onClick={() => { setLiberado(op); if (op) setMotivoId(""); }}
                      style={{
                        minHeight: 44, padding: "0.45rem 1.2rem", cursor: "pointer", borderRadius: 999, fontSize: "0.88rem",
                        fontWeight: on ? 700 : 500,
                        background: on ? `color-mix(in srgb, ${tom} 16%, transparent)` : "var(--surface-2)",
                        border: "1px solid " + (on ? tom : "var(--border)"),
                        color: on ? tom : "var(--mh-text-1)",
                      }}
                    >
                      {op ? "Liberado" : "Bloqueado"}
                    </button>
                  );
                })}
              </div>
              {liberado === false && (
                <div>
                  <label className="label" htmlFor="blitz-motivo">Motivo do bloqueio {obrigatorio}</label>
                  <select id="blitz-motivo" className="select" value={motivoId} onChange={(e) => setMotivoId(e.target.value)}>
                    <option value="">Escolha o motivo</option>
                    {motivos.filter((m) => m.active).map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* opcional: fechada até alguém precisar, para não alongar a fila */}
            {verObservacao || observacao ? (
              <div>
                <label className="label" htmlFor="blitz-obs">Observação</label>
                <textarea
                  id="blitz-obs" className="input" rows={2} value={observacao} autoFocus={!observacao}
                  placeholder="O que vale registrar além das respostas."
                  onChange={(e) => setObservacao(e.target.value)}
                />
              </div>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setVerObservacao(true)}>
                <Plus size={14} /> Adicionar observação
              </button>
            )}

            {userId && (
              <p className="soft" style={{ fontSize: "0.74rem", margin: 0 }}>
                O gestor de {shortName(pessoas.find((p) => p.id === userId)?.name)} é avisado
                automaticamente se a blitz sair não conforme.
              </p>
            )}
          </div>
        )}

        <div className="mh-folha-rodape" style={{ display: "flex", flexDirection: "column", gap: "0.6rem", padding: "0.9rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          {/* o que falta fica no rodapé, sempre à vista, e a tela rola até o campo */}
          {erro && !registrada && (
            <p role="alert" style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
              {erro}
            </p>
          )}
          <div className="grade-2-no-celular" style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
            {registrada ? (
              <>
                <button type="button" className="btn btn-ghost" onClick={fechar}>Fechar</button>
                <button type="button" className="btn btn-primary" onClick={() => setRegistrada(null)}>
                  <Plus size={15} /> Próxima blitz
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-ghost" disabled={pendente} onClick={fechar}>Cancelar</button>
                <button type="button" className="btn btn-primary" disabled={pendente} onClick={salvar}>
                  {pendente ? "Registrando…" : "Registrar blitz"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
