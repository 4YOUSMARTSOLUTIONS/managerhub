"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Eye, History, Lock, Pencil, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { formatDateTime, shortName } from "@/lib/format";
import {
  ehLayout, validarRespostas, visiveis,
  type Formulario, type Respostas, type Valor,
} from "@/lib/formularios";
import { editarResposta, enviarResposta } from "@/lib/actions/formularios";
import { CampoResposta } from "./CampoResposta";
import { RespostaFicha } from "./RespostaFicha";

type MinhaResposta = { id: string; respostas: Respostas; enviadaEm: string; editadaEm: string | null };

function Preenchimento({
  form, modo, respostaId, iniciais, urlsIniciais, pessoas, onFim,
}: {
  form: Formulario;
  modo: "responder" | "previa" | "editar";
  respostaId?: string;
  iniciais?: Respostas;
  urlsIniciais?: Record<string, string>;
  pessoas: { id: string; nome: string }[];
  onFim: () => void;
}) {
  const router = useRouter();
  const [respostas, setRespostas] = useState<Respostas>(iniciais ?? {});
  const [erros, setErros] = useState<Record<string, string>>({});
  const [urls, setUrls] = useState<Record<string, string>>(urlsIniciais ?? {});
  const [subindo, setSubindo] = useState(0);
  const [mexeu, setMexeu] = useState(false);
  const [enviando, iniciar] = useTransition();
  const [enviado, setEnviado] = useState(false);
  // a chave remonta os campos para "Enviar outra resposta" voltar limpo
  const [rodada, setRodada] = useState(0);

  const campos = useMemo(() => form.campos.filter((c) => !c.removido), [form.campos]);
  const vis = visiveis(campos, respostas);
  const numeros = useMemo(() => {
    const m = new Map<string, number>();
    let n = 0;
    for (const c of campos) if (!ehLayout(c.tipo) && vis.has(c.id)) m.set(c.id, ++n);
    return m;
  }, [campos, vis]);

  useEffect(() => {
    if (!mexeu || enviado || modo === "previa") return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [mexeu, enviado, modo]);

  const mudar = (id: string, v: Valor | undefined) => {
    setMexeu(true);
    setRespostas((r) => {
      const n = { ...r };
      if (v === undefined) delete n[id]; else n[id] = v;
      return n;
    });
    if (erros[id]) setErros((e) => { const n = { ...e }; delete n[id]; return n; });
  };

  const enviar = () => {
    const e = validarRespostas(campos, respostas);
    setErros(e);
    const primeiro = campos.find((c) => e[c.id]);
    if (primeiro) {
      document.querySelector(`[data-campo="${primeiro.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      toast.error(Object.keys(e).length === 1 ? "Falta uma resposta." : `Faltam ${Object.keys(e).length} respostas.`);
      return;
    }
    if (modo === "previa") { toast.success("Tudo certo. Na pré-visualização nada é enviado."); return; }
    iniciar(async () => {
      const r = modo === "editar" && respostaId
        ? await editarResposta(respostaId, respostas)
        : await enviarResposta(form.id, respostas);
      if (r.error) { toast.error(r.error); return; }
      setEnviado(true);
      if (modo === "editar") { toast.success("Resposta atualizada."); onFim(); }
      router.refresh();
    });
  };

  if (enviado && modo !== "editar") {
    return (
      <div className="card" style={{ padding: "1.6rem 1.2rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.7rem", textAlign: "center" }}>
        <CheckCircle2 size={40} color="var(--mh-success)" />
        <strong style={{ fontSize: "1.05rem" }}>Resposta enviada</strong>
        <p className="soft" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{form.mensagemFinal || "Obrigado! Sua resposta foi registrada."}</p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center" }}>
          <Link href="/formularios" className="btn btn-ghost">Voltar para Formulários</Link>
          {form.variasRespostas && (
            <button type="button" className="btn btn-primary" onClick={() => {
              setRespostas({}); setErros({}); setUrls({}); setMexeu(false); setEnviado(false); setRodada((n) => n + 1);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}>Enviar outra resposta</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div key={rodada} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {campos.filter((c) => vis.has(c.id)).map((c) => (
        <CampoResposta
          key={c.id}
          campo={c}
          numero={numeros.get(c.id) ?? null}
          valor={respostas[c.id]}
          onChange={(v) => mudar(c.id, v)}
          erro={erros[c.id]}
          formId={form.id}
          podeSubir={modo !== "previa"}
          pessoas={pessoas}
          urls={urls}
          onUrl={(path, url) => setUrls((u) => ({ ...u, [path]: url }))}
          onSubindo={(d) => setSubindo((n) => n + d)}
        />
      ))}
      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", flexWrap: "wrap", alignItems: "center" }}>
        {modo === "editar" && <button type="button" className="btn btn-ghost" onClick={onFim}>Cancelar</button>}
        {subindo > 0 && <span className="soft" style={{ fontSize: "0.8rem" }}>Aguarde o envio dos arquivos...</span>}
        <button type="button" className="btn btn-primary largo-no-celular" disabled={enviando || subindo > 0} onClick={enviar}>
          {enviando ? "Enviando..." : modo === "editar" ? "Salvar alterações" : modo === "previa" ? "Conferir respostas" : "Enviar resposta"}
        </button>
      </div>
    </div>
  );
}

export function FormularioTela({
  form, criadoPorNome, previa, foraDoPublico, situacao, minhasRespostas, minhaResposta, urlsMinha, pessoas, gere, verHistorico,
}: {
  form: Formulario;
  criadoPorNome: string;
  previa: boolean;
  foraDoPublico: boolean;
  situacao: "rascunho" | "aberto" | "encerrado";
  minhasRespostas: number;
  minhaResposta: MinhaResposta | null;
  urlsMinha: Record<string, string>;
  pessoas: { id: string; nome: string }[];
  gere: boolean;
  /** pode abrir a tabela de respostas (gere, ou está no público de um formulário comum) */
  verHistorico: boolean;
}) {
  const [editando, setEditando] = useState(false);
  const temObrigatoria = form.campos.some((c) => c.obrigatorio && !c.removido);

  const cabecalho = (
    <div className="card" style={{ padding: "1.1rem 1.15rem", borderTop: "4px solid var(--mh-primary-500)", display: "flex", flexDirection: "column", gap: "0.45rem" }}>
      <h1 style={{ fontSize: "1.3rem", fontWeight: 700, margin: 0 }}>{form.titulo}</h1>
      {form.descricao && <p style={{ margin: 0, fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>{form.descricao}</p>}
      <div className="soft" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", fontSize: "0.8rem" }}>
        <span title={criadoPorNome}>Enviado por {shortName(criadoPorNome)}</span>
        <span>·</span>
        <span>{form.prazo ? `Prazo: ${formatDateTime(form.prazo)}` : "Sem prazo"}</span>
        {form.anonimo && (
          <Badge variant="quiet" tone="blue"><ShieldCheck size={12} style={{ marginRight: 3 }} />Respostas anônimas</Badge>
        )}
      </div>
      <div className="soft" style={{ display: "flex", gap: "0.45rem", alignItems: "center", flexWrap: "wrap", fontSize: "0.78rem" }}>
        {form.privado ? (
          <><Lock size={13} /> Histórico privado: só quem criou, o Proprietário e o Administrador veem as respostas.</>
        ) : (
          <>
            <History size={13} />
            {form.anonimo
              ? "Histórico compartilhado: todo o público vê as respostas, sem o nome de quem respondeu."
              : "Histórico compartilhado: todo o público vê as respostas e quem respondeu."}
          </>
        )}
        {verHistorico && (
          <Link href={`/formularios/${form.id}/respostas`} className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }}>
            <History size={14} /> {gere ? "Ver respostas" : "Ver histórico"}
          </Link>
        )}
      </div>
      {temObrigatoria && <span className="soft" style={{ fontSize: "0.76rem" }}><span style={{ color: "var(--mh-danger)" }}>*</span> resposta obrigatória</span>}
    </div>
  );

  let corpo: React.ReactNode;
  if (previa || foraDoPublico) {
    corpo = (
      <>
        <div className="card" style={{ padding: "0.7rem 0.9rem", display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", background: "var(--surface-2)" }}>
          <Eye size={16} />
          <span style={{ fontSize: "0.85rem", flex: 1, minWidth: 200 }}>
            {foraDoPublico && !previa
              ? "Você não está no público deste formulário. Esta é a pré-visualização: nada é enviado."
              : "Pré-visualização: é assim que as pessoas veem o formulário. Nada é enviado."}
          </span>
          {gere && <Link href={`/formularios/${form.id}/editar`} className="btn btn-ghost btn-sm"><Pencil size={14} /> Voltar ao editor</Link>}
        </div>
        <Preenchimento form={form} modo="previa" pessoas={pessoas} onFim={() => {}} />
      </>
    );
  } else if (editando && minhaResposta) {
    corpo = (
      <Preenchimento
        form={form} modo="editar" respostaId={minhaResposta.id} iniciais={minhaResposta.respostas}
        urlsIniciais={urlsMinha} pessoas={pessoas} onFim={() => setEditando(false)}
      />
    );
  } else if (situacao !== "aberto" || (minhasRespostas > 0 && !form.variasRespostas)) {
    const podeEditar = situacao === "aberto" && form.permiteEditar && !!minhaResposta;
    corpo = (
      <div className="card" style={{ padding: "1rem 1.1rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
          {minhasRespostas > 0 ? <CheckCircle2 size={20} color="var(--mh-success)" /> : null}
          <strong style={{ flex: 1, minWidth: 200 }}>
            {minhasRespostas > 0
              ? minhaResposta
                ? `Você respondeu em ${formatDateTime(minhaResposta.editadaEm ?? minhaResposta.enviadaEm)}${minhaResposta.editadaEm ? " (editada)" : ""}.`
                : form.anonimo ? "Você já respondeu. A resposta é anônima e não fica ligada ao seu nome." : "Você já respondeu."
              : "Este formulário não está mais recebendo respostas."}
          </strong>
          {podeEditar && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditando(true)}><Pencil size={14} /> Editar resposta</button>
          )}
        </div>
        {minhaResposta && <RespostaFicha campos={form.campos} respostas={minhaResposta.respostas} urls={urlsMinha} />}
      </div>
    );
  } else {
    corpo = (
      <>
        {minhasRespostas > 0 && (
          <div className="soft" style={{ fontSize: "0.82rem", padding: "0 0.2rem" }}>
            Você já enviou {minhasRespostas} {minhasRespostas === 1 ? "resposta" : "respostas"} neste formulário. Pode enviar outra.
          </div>
        )}
        <Preenchimento form={form} modo="responder" pessoas={pessoas} onFim={() => {}} />
      </>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem", maxWidth: 760, margin: "0 auto", width: "100%" }}>
      <div>
        <Link href="/formularios" className="btn btn-ghost btn-sm"><ArrowLeft size={15} /> Formulários</Link>
      </div>
      {cabecalho}
      {corpo}
    </div>
  );
}
