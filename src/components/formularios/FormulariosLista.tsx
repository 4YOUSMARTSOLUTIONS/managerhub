"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Eye, FileText, Lock, Pencil, Play, Table2, Trash2 } from "lucide-react";
import { Tabs } from "@/components/ui/Tabs";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { MenuDeLinha, type ItemDaLinha } from "@/components/ui/MenuDeLinha";
import { confirmDialog } from "@/components/ui/confirm";
import { formatDate, formatDateTime, normalizar, shortName } from "@/lib/format";
import type { Formulario } from "@/lib/formularios";
import {
  apagarFormulario, duplicarFormulario, encerrarFormulario, publicarFormulario,
} from "@/lib/actions/formularios";

export type LinhaLista = Formulario & {
  situacao: "rascunho" | "aberto" | "encerrado";
  paraMim: boolean;
  minhasRespostas: number;
  minhaUltimaResposta: string | null;
  respostas: number;
  meu: boolean;
  naUnidadeDoTopo: boolean;
};

const CORTE: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

const prazoCurto = (p: string | null) => (p ? formatDateTime(p) : "Sem prazo");

function SituacaoParaMim({ f }: { f: LinhaLista }) {
  const s = f.situacao;
  if (f.minhasRespostas > 0) return <Badge variant="quiet" tone="green">Respondido</Badge>;
  if (s === "aberto") return <Badge tone="amber">Pendente</Badge>;
  return <Badge variant="quiet" tone="gray">Encerrado</Badge>;
}

function SituacaoGestao({ f }: { f: LinhaLista }) {
  const s = f.situacao;
  if (s === "rascunho") return <Badge variant="quiet" tone="amber">Rascunho</Badge>;
  if (s === "aberto") return <Badge variant="quiet" tone="green">Aberto</Badge>;
  return <Badge variant="quiet" tone="gray">Encerrado</Badge>;
}

export function FormulariosLista({ formularios, ehAdmin }: { formularios: LinhaLista[]; ehAdmin: boolean }) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [, iniciar] = useTransition();
  const termo = normalizar(busca.trim());
  const filtra = (f: LinhaLista) => !termo || normalizar(f.titulo).includes(termo);

  const paraMim = useMemo(() => {
    const pendente = (f: LinhaLista) => f.situacao === "aberto" && f.minhasRespostas === 0;
    return formularios.filter((f) => f.paraMim && filtra(f)).sort((a, b) => {
      const pa = pendente(a), pb = pendente(b);
      if (pa !== pb) return pa ? -1 : 1;
      if (pa && pb) {
        // pendentes: o prazo mais curto primeiro; sem prazo no fim
        const xa = a.prazo ? new Date(a.prazo).getTime() : Infinity;
        const xb = b.prazo ? new Date(b.prazo).getTime() : Infinity;
        if (xa !== xb) return xa - xb;
      }
      return (b.publicadoEm ?? b.updatedAt).localeCompare(a.publicadoEm ?? a.updatedAt);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formularios, termo]);

  const meus = formularios.filter((f) => f.meu && filtra(f));
  const todos = formularios.filter((f) => f.naUnidadeDoTopo && filtra(f));
  const pendentes = formularios.filter((f) => f.paraMim && f.situacao === "aberto" && f.minhasRespostas === 0).length;

  const abrir = (f: LinhaLista) => router.push(`/formularios/${f.id}`);
  const abrirGestao = (f: LinhaLista) =>
    router.push(f.status === "rascunho" ? `/formularios/${f.id}/editar` : `/formularios/${f.id}/respostas`);

  const executar = (fn: () => Promise<{ error?: string }>, ok: string) => iniciar(async () => {
    const r = await fn();
    if (r.error) { toast.error(r.error); return; }
    toast.success(ok);
    router.refresh();
  });

  const itensDe = (f: LinhaLista): ItemDaLinha[] => {
    const s = f.situacao;
    const itens: ItemDaLinha[] = [
      { rotulo: "Editar", icone: <Pencil size={14} />, onClick: () => router.push(`/formularios/${f.id}/editar`) },
    ];
    if (f.status !== "rascunho" || f.respostas > 0) {
      itens.push({ rotulo: "Respostas", icone: <Table2 size={14} />, onClick: () => router.push(`/formularios/${f.id}/respostas`) });
    }
    itens.push({ rotulo: "Pré-visualizar", icone: <Eye size={14} />, onClick: () => router.push(`/formularios/${f.id}?previa=1`) });
    itens.push({
      rotulo: "Duplicar", icone: <Copy size={14} />,
      onClick: () => iniciar(async () => {
        const r = await duplicarFormulario(f.id);
        if (r.error || !r.id) { toast.error(r.error ?? "Não foi possível duplicar."); return; }
        toast.success("Cópia criada como rascunho.");
        router.push(`/formularios/${r.id}/editar`);
      }),
    });
    if (s === "aberto") {
      itens.push({
        rotulo: "Encerrar", icone: <Lock size={14} />,
        onClick: async () => {
          if (!(await confirmDialog({
            title: "Encerrar formulário",
            message: "O formulário para de receber respostas agora. Dá para reabrir depois.",
            confirmLabel: "Encerrar",
          }))) return;
          executar(() => encerrarFormulario(f.id), "Formulário encerrado.");
        },
      });
    } else if (f.status === "encerrado") {
      itens.push({
        rotulo: "Reabrir", icone: <Play size={14} />,
        onClick: () => executar(() => publicarFormulario(f.id), "Formulário reaberto."),
      });
    }
    itens.push({
      rotulo: "Excluir", icone: <Trash2 size={14} />, perigo: true,
      onClick: async () => {
        if (!(await confirmDialog({
          title: "Excluir formulário",
          message: f.respostas > 0
            ? <>O formulário <b>{f.titulo}</b> e as <b>{f.respostas}</b> respostas dele serão apagados, com fotos e arquivos. Não há como desfazer.</>
            : <>O formulário <b>{f.titulo}</b> será apagado. Não há como desfazer.</>,
          confirmLabel: "Excluir",
          tone: "danger",
        }))) return;
        executar(() => apagarFormulario(f.id), "Formulário excluído.");
      },
    });
    return itens;
  };

  const tabelaParaMim = paraMim.length === 0 ? (
    <EmptyState
      icon={<FileText size={22} />}
      title={termo ? "Nenhum formulário com esse nome" : "Nenhum formulário para responder"}
      description={termo ? undefined : "Quando alguém enviar um formulário para você, ele aparece aqui."}
    />
  ) : (
    <>
      <div className="so-desktop" style={{ overflowX: "auto" }}>
        <table className="table table-linha" style={{ tableLayout: "fixed", minWidth: 720 }}>
          <colgroup>
            <col />
            <col style={{ width: 150 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 120 }} />
          </colgroup>
          <thead>
            <tr><th>Formulário</th><th>Enviado por</th><th>Prazo</th><th>Situação</th><th /></tr>
          </thead>
          <tbody>
            {paraMim.map((f) => {
              const aberto = f.situacao === "aberto";
              const podeResponder = aberto && (f.minhasRespostas === 0 || f.variasRespostas);
              return (
                <tr key={f.id} style={{ cursor: "pointer" }} onClick={() => abrir(f)}>
                  <td><span style={{ ...CORTE, display: "block" }} title={f.descricao ? `${f.titulo}\n\n${f.descricao}` : f.titulo}>{f.titulo}</span></td>
                  <td><span style={{ ...CORTE, display: "block" }} title={f.criadoPorNome}>{shortName(f.criadoPorNome)}</span></td>
                  <td>{prazoCurto(f.prazo)}</td>
                  <td><SituacaoParaMim f={f} /></td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      className={`btn btn-sm ${podeResponder && f.minhasRespostas === 0 ? "btn-primary" : "btn-ghost"}`}
                      onClick={(e) => { e.stopPropagation(); abrir(f); }}
                    >
                      {podeResponder ? (f.minhasRespostas > 0 ? "Responder de novo" : "Responder") : "Ver"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="so-celular" style={{ padding: "0.6rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {paraMim.map((f) => (
          <button key={f.id} type="button" className="card" onClick={() => abrir(f)}
            style={{ textAlign: "left", padding: "0.75rem 0.85rem", display: "flex", flexDirection: "column", gap: "0.35rem", cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "flex-start" }}>
              <strong style={{ fontSize: "0.92rem" }}>{f.titulo}</strong>
              <SituacaoParaMim f={f} />
            </div>
            <span className="soft" style={{ fontSize: "0.78rem" }}>
              {shortName(f.criadoPorNome)} · {f.prazo ? `até ${formatDateTime(f.prazo)}` : "sem prazo"}
            </span>
          </button>
        ))}
      </div>
    </>
  );

  const tabelaGestao = (itens: LinhaLista[], comAutor: boolean, vazioTitulo: string, vazioTexto: string) =>
    itens.length === 0 ? (
      <EmptyState icon={<FileText size={22} />} title={termo ? "Nenhum formulário com esse nome" : vazioTitulo} description={termo ? undefined : vazioTexto} />
    ) : (
      <>
        <div className="so-desktop" style={{ overflowX: "auto" }}>
          <table className="table table-linha" style={{ tableLayout: "fixed", minWidth: comAutor ? 860 : 720 }}>
            <colgroup>
              <col />
              {comAutor && <col style={{ width: 150 }} />}
              <col style={{ width: 105 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 95 }} />
              <col style={{ width: 46 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Formulário</th>
                {comAutor && <th>Criado por</th>}
                <th>Situação</th>
                <th style={{ textAlign: "right" }}>Respostas</th>
                <th>Prazo</th>
                <th>Atualizado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {itens.map((f) => (
                <tr key={f.id} style={{ cursor: "pointer" }} onClick={() => abrirGestao(f)}>
                  <td><span style={{ ...CORTE, display: "block" }} title={f.titulo}>{f.titulo}</span></td>
                  {comAutor && <td><span style={{ ...CORTE, display: "block" }} title={f.criadoPorNome}>{shortName(f.criadoPorNome)}</span></td>}
                  <td><SituacaoGestao f={f} /></td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{f.respostas}</td>
                  <td>{prazoCurto(f.prazo)}</td>
                  <td>{formatDate(f.updatedAt)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <MenuDeLinha rotulo={`Ações de ${f.titulo}`} itens={itensDe(f)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="so-celular" style={{ padding: "0.6rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {itens.map((f) => (
            <button key={f.id} type="button" className="card" onClick={() => abrirGestao(f)}
              style={{ textAlign: "left", padding: "0.75rem 0.85rem", display: "flex", flexDirection: "column", gap: "0.35rem", cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "flex-start" }}>
                <strong style={{ fontSize: "0.92rem" }}>{f.titulo}</strong>
                <SituacaoGestao f={f} />
              </div>
              <span className="soft" style={{ fontSize: "0.78rem" }}>
                {f.respostas} {f.respostas === 1 ? "resposta" : "respostas"} · {f.prazo ? `até ${formatDateTime(f.prazo)}` : "sem prazo"}
              </span>
            </button>
          ))}
        </div>
      </>
    );

  const tabs = [
    { id: "responder", label: pendentes > 0 ? `Para responder (${pendentes})` : "Para responder", content: tabelaParaMim },
    {
      id: "meus", label: "Criados por mim",
      content: tabelaGestao(meus, false, "Você ainda não criou formulários", "Use Novo formulário para montar o primeiro."),
    },
    ...(ehAdmin ? [{
      id: "todos", label: "Todos da empresa",
      content: tabelaGestao(todos, true, "Nenhum formulário na empresa", "Os formulários criados por qualquer pessoa aparecem aqui."),
    }] : []),
  ];

  return (
    <div className="card">
      <div style={{ padding: "0.75rem 1rem 0" }}>
        <Tabs
          tabs={tabs}
          aside={(
            <input
              className="input"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar formulário"
              aria-label="Buscar formulário"
              style={{ maxWidth: 240 }}
            />
          )}
        />
      </div>
    </div>
  );
}
