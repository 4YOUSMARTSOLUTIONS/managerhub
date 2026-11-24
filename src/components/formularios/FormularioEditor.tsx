"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Eye, Plus, Send, Users } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { MultiSelect } from "@/components/ui/MultiSelect";
import { confirmDialog } from "@/components/ui/confirm";
import { shortName } from "@/lib/format";
import {
  GRUPOS_TIPO, ORDEM_TIPOS, TIPOS, campoNovo, ehEscolha, ehLayout, novoId, publicoDe, situacaoDe,
  type Campo, type Formulario, type OpcoesPublico, type TipoCampo,
} from "@/lib/formularios";
import { publicarFormulario, salvarFormulario, type DadosFormulario } from "@/lib/actions/formularios";
import { CampoEditor } from "./CampoEditor";

type Aba = "perguntas" | "publico" | "config";

/** "2026-11-30T18:00" (campo datetime-local, hora local) a partir do ISO do banco. */
function paraLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Check({ checked, onChange, children, disabled, dica }: {
  checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; disabled?: boolean; dica?: string;
}) {
  return (
    <label style={{ display: "flex", alignItems: "flex-start", gap: "0.55rem", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1 }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
      <span>
        <span style={{ fontSize: "0.88rem", fontWeight: 600 }}>{children}</span>
        {dica && <span className="soft" style={{ display: "block", fontSize: "0.78rem", marginTop: 2 }}>{dica}</span>}
      </span>
    </label>
  );
}

export function FormularioEditor({
  inicial, opcoes, totalRespostas,
}: {
  inicial: Formulario;
  opcoes: OpcoesPublico;
  totalRespostas: number;
}) {
  const router = useRouter();
  const [aba, setAba] = useState<Aba>("perguntas");
  const [titulo, setTitulo] = useState(inicial.titulo);
  const [descricao, setDescricao] = useState(inicial.descricao ?? "");
  const [campos, setCampos] = useState<Campo[]>(inicial.campos);
  const [anonimo, setAnonimo] = useState(inicial.anonimo);
  const [privado, setPrivado] = useState(inicial.privado);
  const [varias, setVarias] = useState(inicial.variasRespostas);
  const [editar, setEditar] = useState(inicial.permiteEditar);
  const [prazo, setPrazo] = useState(paraLocal(inicial.prazo));
  const [mensagem, setMensagem] = useState(inicial.mensagemFinal ?? "");
  const [todos, setTodos] = useState(inicial.publicoTodos);
  const [niveis, setNiveis] = useState(inicial.publicoNiveis);
  const [cargos, setCargos] = useState(inicial.publicoCargos);
  const [pessoas, setPessoas] = useState(inicial.publicoPessoas);
  const [unidades, setUnidades] = useState(inicial.unidades);
  const [aberto, setAberto] = useState<string | null>(null);
  const [sujo, setSujo] = useState(false);
  const [verLista, setVerLista] = useState(false);
  const [salvando, iniciar] = useTransition();
  const rolarPara = useRef<string | null>(null);

  const situacao = situacaoDe({ status: inicial.status, prazo: inicial.prazo });
  const marcar = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setSujo(true); };

  // aviso ao sair com alteração não salva
  useEffect(() => {
    if (!sujo) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [sujo]);

  useEffect(() => {
    if (!rolarPara.current) return;
    document.getElementById(`campo-${rolarPara.current}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    rolarPara.current = null;
  });

  const visiveis = campos.filter((c) => !c.removido);
  const numeros = useMemo(() => {
    const m = new Map<string, number>();
    let n = 0;
    for (const c of campos) if (!c.removido && !ehLayout(c.tipo)) m.set(c.id, ++n);
    return m;
  }, [campos]);
  const totalPerguntas = numeros.size;

  const regra = { publicoTodos: todos, publicoNiveis: niveis, publicoCargos: cargos, publicoPessoas: pessoas, unidades };
  const publico = useMemo(() => publicoDe(regra, opcoes.pessoas),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todos, niveis, cargos, pessoas, unidades, opcoes.pessoas]);

  const mudarCampos = (fn: (cs: Campo[]) => Campo[]) => { setCampos(fn); setSujo(true); };

  const adicionar = (tipo: TipoCampo) => {
    const novo = campoNovo(tipo);
    mudarCampos((cs) => {
      const i = aberto ? cs.findIndex((c) => c.id === aberto) : -1;
      if (i < 0) return [...cs, novo];
      return [...cs.slice(0, i + 1), novo, ...cs.slice(i + 1)];
    });
    setAberto(novo.id);
    rolarPara.current = novo.id;
  };

  // mover entre as visíveis (as removidas ficam onde estão, fora da tela)
  const mover = (id: string, delta: -1 | 1) => mudarCampos((cs) => {
    const vis = cs.filter((c) => !c.removido);
    const i = vis.findIndex((c) => c.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= vis.length) return cs;
    const nova = [...vis];
    [nova[i], nova[j]] = [nova[j], nova[i]];
    return [...nova, ...cs.filter((c) => c.removido)];
  });

  const tirar = async (c: Campo) => {
    const dependentes = campos.filter((x) => x.condicao?.campo === c.id && !x.removido);
    const ok = await confirmDialog({
      title: "Excluir pergunta",
      message: (
        <>
          {totalRespostas > 0 && !ehLayout(c.tipo)
            ? "A pergunta sai do formulário. As respostas que ela já recebeu continuam na planilha de respostas."
            : "A pergunta sai do formulário."}
          {dependentes.length > 0 && (
            <> {dependentes.length === 1 ? "Uma pergunta depende" : `${dependentes.length} perguntas dependem`} da resposta dela e vão passar a aparecer sempre.</>
          )}
        </>
      ),
      confirmLabel: "Excluir",
      tone: "danger",
    });
    if (!ok) return;
    mudarCampos((cs) => cs
      .filter((x) => x.id !== c.id)
      .map((x) => (x.condicao?.campo === c.id ? { ...x, condicao: null } : x)));
    if (aberto === c.id) setAberto(null);
  };

  const duplicar = (c: Campo) => {
    const copia: Campo = { ...c, id: novoId(), titulo: c.titulo ? `${c.titulo} (cópia)` : "" };
    mudarCampos((cs) => {
      const i = cs.findIndex((x) => x.id === c.id);
      return [...cs.slice(0, i + 1), copia, ...cs.slice(i + 1)];
    });
    setAberto(copia.id);
    rolarPara.current = copia.id;
  };

  const dados = (): DadosFormulario => ({
    titulo, descricao, campos, anonimo, privado, variasRespostas: varias,
    permiteEditar: editar && !anonimo && !varias,
    prazo: prazo ? new Date(prazo).toISOString() : null,
    mensagemFinal: mensagem,
    publicoTodos: todos, publicoNiveis: niveis, publicoCargos: cargos, publicoPessoas: pessoas, unidades,
  });

  /** Problemas que impedem publicar, com a aba onde se resolve. */
  const pendencias = (): { aba: Aba; texto: string; campo?: string }[] => {
    const lista: { aba: Aba; texto: string; campo?: string }[] = [];
    if (!titulo.trim()) lista.push({ aba: "perguntas", texto: "Dê um título ao formulário." });
    if (totalPerguntas === 0) lista.push({ aba: "perguntas", texto: "Inclua pelo menos uma pergunta." });
    for (const c of visiveis) {
      if (!ehLayout(c.tipo) && !c.titulo.trim()) { lista.push({ aba: "perguntas", texto: "Há pergunta sem enunciado.", campo: c.id }); break; }
    }
    for (const c of visiveis) {
      if ((c.tipo === "multipla_escolha" || c.tipo === "caixas_selecao" || c.tipo === "lista_suspensa" || c.tipo === "ranking")
        && (c.opcoes ?? []).filter((o) => o.trim()).length < (c.tipo === "ranking" ? 2 : 1)) {
        lista.push({ aba: "perguntas", texto: `"${c.titulo || "Pergunta"}" está sem opções.`, campo: c.id }); break;
      }
      if (c.condicao && c.condicao.valores.length === 0) {
        lista.push({ aba: "perguntas", texto: `"${c.titulo || "Pergunta"}" tem condição sem resposta marcada.`, campo: c.id }); break;
      }
    }
    if (publico.length === 0) lista.push({ aba: "publico", texto: "Escolha quem vai responder." });
    return lista;
  };

  const salvar = (depois?: () => Promise<void> | void) => iniciar(async () => {
    const r = await salvarFormulario(inicial.id, dados());
    if (r.error) { toast.error(r.error); return; }
    setSujo(false);
    if (depois) await depois();
    else { toast.success("Formulário salvo."); router.refresh(); }
  });

  const publicar = async () => {
    // prazo vencido o banco recusa, com a mensagem de ajustar o prazo
    const p = pendencias();
    if (p.length) {
      toast.error(p[0].texto);
      setAba(p[0].aba);
      if (p[0].campo) { setAberto(p[0].campo); rolarPara.current = p[0].campo; }
      return;
    }
    const reabrir = inicial.status === "encerrado";
    const ok = await confirmDialog({
      title: reabrir ? "Reabrir formulário" : "Publicar formulário",
      message: reabrir
        ? "O formulário volta a receber respostas. Quem já foi avisado não recebe aviso de novo."
        : <>O formulário vai para <b>{publico.length}</b> {publico.length === 1 ? "pessoa" : "pessoas"}, e cada uma recebe um aviso no sino e no celular.{" "}
            {privado
              ? "Só você, o Proprietário e o Administrador vão ver as respostas."
              : "Todo o público vai ver o histórico de respostas."}
            {anonimo ? " As respostas serão anônimas." : ""}</>,
      confirmLabel: reabrir ? "Reabrir" : "Publicar",
    });
    if (!ok) return;
    salvar(async () => {
      const r = await publicarFormulario(inicial.id);
      if (r.error) { toast.error(r.error); router.refresh(); return; }
      toast.success(reabrir ? "Formulário reaberto." : `Formulário publicado. ${r.avisados ?? 0} ${r.avisados === 1 ? "pessoa avisada" : "pessoas avisadas"}.`);
      router.push(`/formularios/${inicial.id}/respostas`);
    });
  };

  const previa = () => salvar(() => { router.push(`/formularios/${inicial.id}?previa=1`); });

  // perguntas de escolha anteriores a cada campo (as que podem ser condição)
  const anterioresDe = (id: string) => {
    const lista: Campo[] = [];
    for (const c of visiveis) {
      if (c.id === id) break;
      if (ehEscolha(c.tipo)) lista.push(c);
    }
    return lista;
  };

  const nomeDe = (lista: { id: string; nome: string }[]) => new Map(lista.map((x) => [x.id, x.nome]));
  const nomesUnidades = nomeDe(opcoes.unidades);

  const tabBtn = (id: Aba, label: string) => (
    <button type="button" className={`tab${aba === id ? " tab-active" : ""}`} onClick={() => setAba(id)}>{label}</button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 880, margin: "0 auto", width: "100%" }}>
      {/* barra fixa do editor */}
      <div
        className="card"
        style={{
          position: "sticky", top: 0, zIndex: 20, padding: "0.6rem 0.9rem",
          display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap",
        }}
      >
        <Link href="/formularios" className="btn btn-ghost btn-sm" aria-label="Voltar para Formulários"><ArrowLeft size={15} /> Formulários</Link>
        <Badge variant="quiet" tone={situacao === "rascunho" ? "amber" : situacao === "aberto" ? "green" : "gray"}>
          {situacao === "rascunho" ? "Rascunho" : situacao === "aberto" ? "Aberto" : "Encerrado"}
        </Badge>
        <span className="soft" style={{ fontSize: "0.78rem" }}>{sujo ? "Alterações não salvas" : "Tudo salvo"}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={salvando} onClick={previa}><Eye size={15} /> Pré-visualizar</button>
          <button type="button" className={`btn btn-sm ${situacao === "aberto" ? "btn-primary" : "btn-ghost"}`} disabled={salvando || !sujo} onClick={() => salvar()}>
            {salvando ? "Salvando..." : "Salvar"}
          </button>
          {inicial.status !== "publicado" && (
            <button type="button" className="btn btn-primary btn-sm" disabled={salvando} onClick={publicar}>
              <Send size={15} /> {inicial.status === "encerrado" ? "Reabrir" : "Publicar"}
            </button>
          )}
        </div>
      </div>

      {situacao === "aberto" && (
        <div className="soft" style={{ fontSize: "0.8rem", padding: "0 0.2rem" }}>
          O formulário está recebendo respostas: o que você salvar aqui vale na hora para quem ainda vai responder.
        </div>
      )}

      <div className="tabbar">
        {tabBtn("perguntas", `Perguntas (${totalPerguntas})`)}
        {tabBtn("publico", `Público (${publico.length})`)}
        {tabBtn("config", "Configurações")}
      </div>

      {aba === "perguntas" && (
        <>
          <div className="card" style={{ padding: "1rem 1.1rem", display: "flex", flexDirection: "column", gap: "0.7rem", borderTop: "4px solid var(--mh-primary-500)" }}>
            <input
              className="input" value={titulo} maxLength={150} aria-label="Título do formulário"
              placeholder="Título do formulário"
              onChange={(e) => marcar(setTitulo)(e.target.value)}
              style={{ fontSize: "1.15rem", fontWeight: 700 }}
            />
            <textarea
              className="textarea" rows={2} value={descricao} maxLength={4000} aria-label="Descrição do formulário"
              placeholder="Descrição (opcional): para que serve e como responder"
              onChange={(e) => marcar(setDescricao)(e.target.value)}
            />
          </div>

          {visiveis.map((c, i) => (
            <CampoEditor
              key={c.id}
              campo={c}
              numero={numeros.get(c.id) ?? null}
              aberto={aberto === c.id}
              anteriores={anterioresDe(c.id)}
              onAbrir={() => setAberto(aberto === c.id ? null : c.id)}
              onChange={(novo) => mudarCampos((cs) => cs.map((x) => (x.id === c.id ? novo : x)))}
              onSubir={() => mover(c.id, -1)}
              onDescer={() => mover(c.id, 1)}
              onDuplicar={() => duplicar(c)}
              onTirar={() => tirar(c)}
              primeiro={i === 0}
              ultimo={i === visiveis.length - 1}
            />
          ))}

          {/* paleta de tipos, como no sistema antigo */}
          <div className="card" style={{ padding: "0.9rem 1rem" }}>
            <div className="soft" style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.6rem" }}>
              {aberto ? "Adicionar depois da pergunta aberta" : "Adicionar pergunta"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
              {GRUPOS_TIPO.map((g) => {
                const tipos = ORDEM_TIPOS.filter((t) => TIPOS[t].grupo === g.id);
                return (
                  <div key={g.id} style={{ display: "flex", gap: "0.4rem 0.6rem", flexWrap: "wrap", alignItems: "baseline" }}>
                    <span className="soft" style={{ fontSize: "0.74rem", width: 150, flexShrink: 0 }}>{g.label}</span>
                    <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", flex: 1, minWidth: 220 }}>
                      {tipos.map((t) => (
                        <button key={t} type="button" className="btn btn-ghost btn-sm" title={TIPOS[t].dica} onClick={() => adicionar(t)}>
                          <Plus size={13} /> {TIPOS[t].label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {aba === "publico" && (
        <div className="card" style={{ padding: "1rem 1.1rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <Check checked={todos} onChange={marcar(setTodos)} dica="Todos os colaboradores ativos, respeitando as unidades escolhidas abaixo.">
            Todos da empresa
          </Check>
          {!todos && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.8rem" }}>
              <div>
                <MultiSelect
                  label="Níveis de hierarquia" allLabel="Nenhum"
                  options={opcoes.niveis.map((n) => ({ value: n.id, label: n.nome }))}
                  selected={niveis} onChange={marcar(setNiveis)}
                />
              </div>
              <div>
                <MultiSelect
                  label="Cargos" allLabel="Nenhum" searchable
                  options={opcoes.cargos.map((n) => ({ value: n.id, label: n.nome }))}
                  selected={cargos} onChange={marcar(setCargos)}
                />
              </div>
            </div>
          )}
          <div>
            <MultiSelect
              label="Unidades" allLabel="Todas as unidades"
              options={opcoes.unidades.map((n) => ({ value: n.id, label: n.nome }))}
              selected={unidades} onChange={marcar(setUnidades)}
            />
            <span className="soft" style={{ fontSize: "0.76rem", display: "block", marginTop: 4 }}>
              Recorta todos, níveis e cargos. Quem você escolher pelo nome recebe em qualquer unidade.
            </span>
          </div>
          <div>
            <MultiSelect
              label="Pessoas específicas" allLabel="Nenhuma" searchable
              options={opcoes.pessoas.map((p) => ({ value: p.id, label: p.nome }))}
              selected={pessoas} onChange={marcar(setPessoas)}
            />
          </div>

          <div style={{ background: "var(--surface-2)", borderRadius: 9, padding: "0.8rem 0.9rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <Users size={16} />
              <strong>{publico.length} {publico.length === 1 ? "pessoa recebe" : "pessoas recebem"} este formulário</strong>
              {unidades.length > 0 && (
                <span className="soft" style={{ fontSize: "0.78rem" }}>
                  · {unidades.map((u) => nomesUnidades.get(u) ?? "").filter(Boolean).join(", ")}
                </span>
              )}
              {publico.length > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={() => setVerLista((v) => !v)}>
                  {verLista ? "Esconder lista" : "Ver lista"}
                </button>
              )}
            </div>
            <span className="soft" style={{ fontSize: "0.76rem", display: "block", marginTop: 4 }}>
              O público acompanha o cadastro: quem entrar no nível, cargo ou unidade depois também passa a ver o formulário.
            </span>
            {anonimo && publico.length > 0 && publico.length < 5 && (
              <span style={{ fontSize: "0.78rem", display: "block", marginTop: 6, color: "var(--mh-warning)" }}>
                Com menos de 5 pessoas, uma resposta anônima fica fácil de reconhecer.
              </span>
            )}
            {verLista && (
              <div style={{ marginTop: "0.6rem", columns: "3 180px", fontSize: "0.8rem", lineHeight: 1.6 }}>
                {publico.slice(0, 500).map((p) => <div key={p.id} title={p.nome}>{shortName(p.nome)}</div>)}
                {publico.length > 500 && <div className="soft">e mais {publico.length - 500}</div>}
              </div>
            )}
          </div>
        </div>
      )}

      {aba === "config" && (
        <div className="card" style={{ padding: "1rem 1.1rem", display: "flex", flexDirection: "column", gap: "1.05rem" }}>
          <Check
            checked={privado}
            onChange={marcar(setPrivado)}
            disabled={inicial.privado && totalRespostas > 0}
            dica={inicial.privado && totalRespostas > 0
              ? "O formulário já tem respostas: o histórico continua privado."
              : privado
                ? "Só quem criou, o Proprietário e o Administrador veem as respostas. Cada pessoa vê só a própria."
                : "Desmarcado, todo o público vê o histórico de respostas, como um livro de registros compartilhado."}
          >
            Histórico privado
          </Check>
          <Check
            checked={anonimo}
            onChange={(v) => { marcar(setAnonimo)(v); if (v) setEditar(false); }}
            disabled={totalRespostas > 0}
            dica={totalRespostas > 0
              ? "O formulário já tem respostas: isto não muda mais."
              : "Ninguém vê quem respondeu, nem você nem a administração. Sem lista de quem falta responder."}
          >
            Respostas anônimas
          </Check>
          <Check
            checked={varias}
            onChange={(v) => { marcar(setVarias)(v); if (v) setEditar(false); }}
            dica="Para registros que se repetem (inspeção, ocorrência, visita). Sem isso, cada pessoa responde uma vez."
          >
            Permitir mais de uma resposta por pessoa
          </Check>
          <Check
            checked={editar && !anonimo && !varias}
            onChange={marcar(setEditar)}
            disabled={anonimo || varias}
            dica={anonimo || varias
              ? "Só vale para formulário identificado e com uma resposta por pessoa."
              : "A pessoa corrige a própria resposta enquanto o formulário estiver aberto."}
          >
            Permitir editar a resposta depois de enviar
          </Check>
          <div>
            <label className="label">Prazo para responder</label>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <input className="input" type="datetime-local" value={prazo} onChange={(e) => marcar(setPrazo)(e.target.value)} style={{ maxWidth: 240 }} />
              {prazo && <button type="button" className="btn btn-ghost btn-sm" onClick={() => marcar(setPrazo)("")}>Sem prazo</button>}
            </div>
            <span className="soft" style={{ fontSize: "0.76rem", display: "block", marginTop: 4 }}>
              Depois dele o formulário para de receber respostas sozinho.
            </span>
          </div>
          <div>
            <label className="label">Mensagem depois do envio</label>
            <textarea className="textarea" rows={2} value={mensagem} maxLength={1000}
              placeholder="Obrigado! Sua resposta foi registrada."
              onChange={(e) => marcar(setMensagem)(e.target.value)} />
          </div>
        </div>
      )}
    </div>
  );
}
