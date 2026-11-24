"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Eye, Lock, Paperclip, Pencil, Play, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { ExportButton } from "@/components/ui/ExportButton";
import { DetailModal } from "@/components/ui/DetailModal";
import { confirmDialog } from "@/components/ui/confirm";
import { formatDateTime, normalizar, shortName } from "@/lib/format";
import {
  ehGrade, ehLayout, situacaoDe, textoDaResposta,
  type Campo, type Formulario, type Respostas,
} from "@/lib/formularios";
import {
  apagarResposta, encerrarFormulario, lerPendentes, linksDaResposta, publicarFormulario,
} from "@/lib/actions/formularios";
import { RespostaFicha } from "./RespostaFicha";

export type LinhaResposta = {
  id: string;
  numero: number;
  respondenteId: string | null;
  respondenteNome: string | null;
  matricula: string | null;
  unidade: string | null;
  respostas: Respostas;
  temArquivos: boolean;
  enviadaEm: string;
  editadaEm: string | null;
};

const CORTE: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" };
const POR_VEZ = 200;

/** Número da resposta para planilha: as escalas saem como número de verdade. */
function valorDaPlanilha(c: Campo, r: Respostas): string | number | null {
  const v = r[c.id];
  if (v === undefined) return null;
  if ((c.tipo === "numero" || c.tipo === "escala" || c.tipo === "nps" || c.tipo === "avaliacao") && typeof v === "number") return v;
  return textoDaResposta(c, v) || null;
}

export function FormularioRespostas({ form, linhas, resumo, gere }: {
  form: Formulario;
  linhas: LinhaResposta[];
  resumo: { publico: number; responderam: number; respostas: number };
  /** quem gere administra; o público do formulário comum só lê o histórico */
  gere: boolean;
}) {
  const router = useRouter();
  const [, iniciar] = useTransition();
  const [aba, setAba] = useState<"respostas" | "faltam">("respostas");
  const [busca, setBusca] = useState("");
  const [limite, setLimite] = useState(POR_VEZ);
  const [aberta, setAberta] = useState<LinhaResposta | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [faltam, setFaltam] = useState<{ id: string; nome: string }[] | null>(null);
  const situacao = situacaoDe(form);

  // perguntas na ordem; as removidas (que ainda têm resposta) vão para o fim
  const perguntas = useMemo(() => form.campos.filter((c) => !ehLayout(c.tipo)), [form.campos]);
  const numeros = useMemo(() => {
    const m = new Map<string, number>();
    let n = 0;
    for (const c of perguntas) if (!c.removido) m.set(c.id, ++n);
    return m;
  }, [perguntas]);
  const rotulo = (c: Campo) => `${numeros.has(c.id) ? `${numeros.get(c.id)}. ` : ""}${c.titulo || "Pergunta"}${c.removido ? " (removida)" : ""}`;
  // até 3 perguntas viram coluna na tabela; a ficha e a planilha têm todas
  const colunas = perguntas.filter((c) => !c.removido && c.tipo !== "assinatura").slice(0, 3);

  const termo = normalizar(busca.trim());
  const filtradas = useMemo(() => {
    if (!termo) return linhas;
    return linhas.filter((l) => {
      const alvo = [
        l.respondenteNome ?? "", l.matricula ?? "", l.unidade ?? "",
        ...perguntas.map((c) => textoDaResposta(c, l.respostas[c.id])),
      ].join(" ");
      return normalizar(alvo).includes(termo);
    });
  }, [linhas, perguntas, termo]);

  // planilha completa: uma coluna por pergunta (grade: uma por linha da grade)
  const planilha = useMemo(() => {
    const cab: string[] = ["Nº", "Enviada em", "Editada em"];
    if (!form.anonimo) cab.push("Matrícula", "Respondente", "Unidade");
    const extratores: ((l: LinhaResposta) => string | number | null)[] = [];
    const colunasDeData: string[] = [];
    for (const c of perguntas) {
      if (ehGrade(c.tipo)) {
        for (const lin of c.linhas ?? []) {
          cab.push(`${rotulo(c)} [${lin}]`);
          extratores.push((l) => {
            const x = (l.respostas[c.id] as Record<string, string | string[]> | undefined)?.[lin];
            return x === undefined ? null : Array.isArray(x) ? x.join(", ") : x;
          });
        }
        continue;
      }
      const h = rotulo(c);
      cab.push(h);
      if (c.tipo === "data") colunasDeData.push(h);
      extratores.push((l) => (c.tipo === "data" ? ((l.respostas[c.id] as string | undefined) ?? null) : valorDaPlanilha(c, l.respostas)));
    }
    const rows = [...linhas].reverse().map((l) => [
      l.numero, formatDateTime(l.enviadaEm), l.editadaEm ? formatDateTime(l.editadaEm) : null,
      ...(form.anonimo ? [] : [l.matricula, l.respondenteNome, l.unidade]),
      ...extratores.map((x) => x(l)),
    ]);
    return { cab, rows, colunasDeData };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhas, perguntas, form.anonimo]);

  const abrir = (l: LinhaResposta) => {
    setAberta(l);
    if (l.temArquivos) {
      void linksDaResposta(l.id).then((r) => {
        if (r.error) toast.error(r.error);
        else setUrls((u) => ({ ...u, ...(r.urls ?? {}) }));
      });
    }
  };

  const verFaltam = () => {
    setAba("faltam");
    if (faltam === null) {
      void lerPendentes(form.id).then((r) => {
        if (r.error) { toast.error(r.error); setFaltam([]); return; }
        setFaltam(r.pessoas ?? []);
      });
    }
  };

  const executar = (fn: () => Promise<{ error?: string }>, ok: string) => iniciar(async () => {
    const r = await fn();
    if (r.error) { toast.error(r.error); return; }
    toast.success(ok);
    router.refresh();
  });

  const pct = resumo.publico > 0 ? Math.round((resumo.responderam / resumo.publico) * 100) : 0;
  const faltamQtd = Math.max(0, resumo.publico - resumo.responderam);
  const nomeArquivo = `respostas-${form.titulo.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60) || "formulario"}`;

  const stat = (rot: string, val: React.ReactNode, dica?: string) => (
    <div title={dica} style={{ background: "var(--surface-2)", borderRadius: 9, padding: "0.6rem 0.8rem", minWidth: 120, flex: 1 }}>
      <div className="soft" style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{rot}</div>
      <div style={{ fontSize: "1.25rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{val}</div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <Link href={gere ? "/formularios" : `/formularios/${form.id}`} className="btn btn-ghost btn-sm">
          <ArrowLeft size={15} /> {gere ? "Formulários" : "Voltar ao formulário"}
        </Link>
        {gere && <div style={{ marginLeft: "auto", display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
          <Link href={`/formularios/${form.id}?previa=1`} className="btn btn-ghost btn-sm"><Eye size={15} /> Pré-visualizar</Link>
          <Link href={`/formularios/${form.id}/editar`} className="btn btn-ghost btn-sm"><Pencil size={15} /> Editar</Link>
          {situacao === "aberto" && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={async () => {
              if (!(await confirmDialog({ title: "Encerrar formulário", message: "O formulário para de receber respostas agora. Dá para reabrir depois.", confirmLabel: "Encerrar" }))) return;
              executar(() => encerrarFormulario(form.id), "Formulário encerrado.");
            }}><Lock size={15} /> Encerrar</button>
          )}
          {form.status === "encerrado" && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => executar(() => publicarFormulario(form.id), "Formulário reaberto.")}>
              <Play size={15} /> Reabrir
            </button>
          )}
          <ExportButton
            filename={nomeArquivo} sheetName="Respostas" label="Exportar respostas"
            headers={planilha.cab} rows={planilha.rows} colunasDeData={planilha.colunasDeData}
          />
        </div>}
      </div>

      <div className="card" style={{ padding: "1rem 1.1rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: "1.2rem", fontWeight: 700, margin: 0, flex: 1, minWidth: 200 }}>{form.titulo}</h1>
          <Badge variant="quiet" tone={situacao === "rascunho" ? "amber" : situacao === "aberto" ? "green" : "gray"}>
            {situacao === "rascunho" ? "Rascunho" : situacao === "aberto" ? "Aberto" : "Encerrado"}
          </Badge>
          {form.anonimo && <Badge variant="quiet" tone="blue">Anônimo</Badge>}
          <Badge variant="quiet" tone="gray">{form.privado ? "Histórico privado" : "Histórico compartilhado"}</Badge>
        </div>
        {!gere && (
          <div className="soft" style={{ fontSize: "0.82rem" }}>
            Histórico de respostas: todo o público deste formulário vê o que foi enviado.
          </div>
        )}
        <div className="soft" style={{ fontSize: "0.8rem" }}>
          {form.prazo ? `Prazo: ${formatDateTime(form.prazo)}` : "Sem prazo"}
          {form.publicadoEm ? ` · Publicado em ${formatDateTime(form.publicadoEm)}` : ""}
        </div>
        {gere && (
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
            {stat("Respostas", resumo.respostas)}
            {stat("Responderam", `${resumo.responderam} de ${resumo.publico}`, "Pessoas do público de hoje que já responderam")}
            {stat("Adesão", `${pct}%`)}
            {!form.anonimo && stat("Faltam", faltamQtd)}
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ padding: "0.75rem 1rem 0" }}>
          <div className="tabbar">
            <button type="button" className={`tab${aba === "respostas" ? " tab-active" : ""}`} onClick={() => setAba("respostas")}>
              Respostas ({linhas.length})
            </button>
            {gere && !form.anonimo && (
              <button type="button" className={`tab${aba === "faltam" ? " tab-active" : ""}`} onClick={verFaltam}>
                Quem falta ({faltamQtd})
              </button>
            )}
            {aba === "respostas" && linhas.length > 0 && (
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", paddingBottom: 4 }}>
                <input className="input" value={busca} onChange={(e) => { setBusca(e.target.value); setLimite(POR_VEZ); }}
                  placeholder="Buscar nas respostas" aria-label="Buscar nas respostas" style={{ maxWidth: 240 }} />
              </div>
            )}
          </div>
        </div>

        {aba === "respostas" && (
          linhas.length === 0 ? (
            <p className="soft" style={{ padding: "2rem 1rem", textAlign: "center", margin: 0 }}>
              {form.status === "rascunho" ? "O formulário ainda é um rascunho. Publique para começar a receber respostas." : "Nenhuma resposta ainda."}
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table table-linha" style={{ tableLayout: "fixed", minWidth: form.anonimo ? 560 : 860 }}>
                <colgroup>
                  <col style={{ width: 52 }} />
                  <col style={{ width: 118 }} />
                  {!form.anonimo && <col style={{ width: 82 }} />}
                  {!form.anonimo && <col style={{ width: 150 }} />}
                  {!form.anonimo && <col style={{ width: 110 }} />}
                  {colunas.map((c) => <col key={c.id} />)}
                  <col style={{ width: 34 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Nº</th>
                    <th>Enviada em</th>
                    {!form.anonimo && <th>Matrícula</th>}
                    {!form.anonimo && <th>Respondente</th>}
                    {!form.anonimo && <th>Unidade</th>}
                    {colunas.map((c) => <th key={c.id}><span style={CORTE} title={c.titulo}>{c.titulo || "Pergunta"}</span></th>)}
                    <th aria-label="Anexos" />
                  </tr>
                </thead>
                <tbody>
                  {filtradas.slice(0, limite).map((l) => (
                    <tr key={l.id} style={{ cursor: "pointer" }} onClick={() => abrir(l)}>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{l.numero}</td>
                      <td title={l.editadaEm ? `Editada em ${formatDateTime(l.editadaEm)}` : undefined}>{formatDateTime(l.enviadaEm)}</td>
                      {!form.anonimo && <td>{l.matricula ?? "—"}</td>}
                      {!form.anonimo && <td><span style={CORTE} title={l.respondenteNome ?? ""}>{shortName(l.respondenteNome)}</span></td>}
                      {!form.anonimo && <td><span style={CORTE} title={l.unidade ?? ""}>{l.unidade ?? "—"}</span></td>}
                      {colunas.map((c) => {
                        const t = textoDaResposta(c, l.respostas[c.id]);
                        return <td key={c.id}><span style={CORTE} title={t}>{t || "—"}</span></td>;
                      })}
                      <td>{l.temArquivos ? <Paperclip size={13} aria-label="Tem anexos" /> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtradas.length === 0 && <p className="soft" style={{ padding: "1.2rem", textAlign: "center", margin: 0 }}>Nada encontrado.</p>}
              {filtradas.length > limite && (
                <div style={{ padding: "0.7rem", textAlign: "center" }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLimite((n) => n + POR_VEZ)}>
                    Mostrar mais ({filtradas.length - limite} restantes)
                  </button>
                </div>
              )}
            </div>
          )
        )}

        {aba === "faltam" && (
          <div style={{ padding: "0.9rem 1rem" }}>
            {faltam === null ? <p className="soft" style={{ margin: 0 }}>Carregando...</p>
              : faltam.length === 0 ? <p className="soft" style={{ margin: 0 }}>Todo o público já respondeu.</p>
              : (
                <>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.5rem" }}>
                    <ExportButton filename={`${nomeArquivo}-quem-falta`} sheetName="Quem falta" label="Exportar lista"
                      headers={["Nome"]} rows={faltam.map((p) => [p.nome])} />
                  </div>
                  <div style={{ columns: "3 200px", fontSize: "0.84rem", lineHeight: 1.7 }}>
                    {faltam.map((p) => <div key={p.id} title={p.nome}>{shortName(p.nome)}</div>)}
                  </div>
                </>
              )}
          </div>
        )}
      </div>

      <DetailModal
        open={!!aberta}
        onClose={() => setAberta(null)}
        width="lg"
        title={aberta ? (form.anonimo ? `Resposta nº ${aberta.numero}` : aberta.respondenteNome ?? `Resposta nº ${aberta.numero}`) : ""}
        badges={aberta ? (
          <>
            <Badge variant="quiet" tone="gray">Nº {aberta.numero}</Badge>
            <Badge variant="quiet" tone="gray">Enviada em {formatDateTime(aberta.enviadaEm)}</Badge>
            {aberta.editadaEm && <Badge variant="quiet" tone="gray">Editada em {formatDateTime(aberta.editadaEm)}</Badge>}
            {aberta.unidade && <Badge variant="quiet" tone="gray">{aberta.unidade}</Badge>}
          </>
        ) : null}
        footer={aberta && gere ? (
          <button type="button" className="btn btn-danger btn-sm" onClick={async () => {
            if (!(await confirmDialog({
              title: "Apagar resposta",
              message: form.anonimo
                ? "A resposta e os arquivos dela serão apagados. Não há como desfazer. Como é anônima, quem respondeu continua sem poder responder de novo."
                : "A resposta e os arquivos dela serão apagados, e a pessoa poderá responder de novo. Não há como desfazer.",
              confirmLabel: "Apagar", tone: "danger",
            }))) return;
            const id = aberta.id;
            setAberta(null);
            executar(() => apagarResposta(id), "Resposta apagada.");
          }}><Trash2 size={14} /> Apagar resposta</button>
        ) : null}
      >
        {aberta && <RespostaFicha campos={form.campos} respostas={aberta.respostas} urls={urls} />}
      </DetailModal>
    </div>
  );
}
