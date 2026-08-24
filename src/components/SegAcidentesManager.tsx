"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, ListChecks, Paperclip, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { ExportButton } from "@/components/ui/ExportButton";
import { confirmDialog } from "@/components/ui/confirm";
import type { Person } from "@/components/PeoplePicker";
import {
  SEG_ACIDENTE_CLASS, SEG_ACIDENTE_CLASS_LONGO, SEG_ACIDENTE_CLASS_TONE,
  SEG_ACIDENTE_STATUS, SEG_ACIDENTE_STATUS_TONE,
  SEG_ACIDENTE_TIPO, SEG_ACIDENTE_TIPO_TONE,
} from "@/lib/constants";
import { normalizar, shortName } from "@/lib/format";
import { SegAcidenteDialog } from "@/components/SegAcidenteDialog";
import { SegAcaoDialog } from "@/components/SegAcaoDialog";
import {
  anexarAoAcidente, encerrarAcidente, excluirAcidente, reabrirAcidente,
  removerAnexoAcidente, urlAnexoAcidente,
} from "@/lib/actions/seguranca";
import type { Enums } from "@/types/database";

export type AnexoRow = { id: string; nome: string; mime: string | null; tamanho: number | null };

export type AcidenteRow = {
  id: string;
  userId: string;
  pessoa: string | null;
  matricula: string | null;
  setor: string | null;
  subsetor: string | null;
  funcao: string | null;
  gestor: string | null;
  // os ids do vínculo da época, para a ação de tratamento nascer no lugar
  // certo e já com o gestor sugerido
  setorId: string | null;
  subsetorId: string | null;
  gestorId: string | null;
  unidade: string | null;
  unitId: string | null;
  occurredOn: string;
  occurredAt: string | null;
  turno: string | null;
  classe: Enums<"seg_acidente_class">;
  /** típico (na operação) ou de trajeto (no percurso casa-trabalho) */
  tipo: Enums<"seg_acidente_tipo">;
  status: Enums<"seg_acidente_status">;
  localId: string | null;
  areaId: string | null;
  descricao: string;
  testemunhas: string | null;
  parteCorpo: string | null;
  agenteCausador: string | null;
  naturezaLesao: string | null;
  analiseCausa: string | null;
  causaId: string | null;
  catNumero: string | null;
  catEmitidaEm: string | null;
  cidCode: string | null;
  cidDescricao: string | null;
  diasAfastamento: number | null;
  afastamentoDe: string | null;
  retornoEm: string | null;
  /** carimbo de inclusão no sistema, que a data do ocorrido não responde */
  criadoEm: string;
  criadoPor: string | null;
  /** ações de tratamento abertas a partir deste acidente; vivem em /acoes */
  acoes: { id: string; codigo: number; prazo: string | null; concluida: boolean; pendentes: number }[];
  anexos: AnexoRow[];
};

/** Data e hora do carimbo, no fuso de quem lê. */
function dataHoraBr(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

function dataBr(iso: string | null) {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/**
 * A lista de acidentes e o painel do caso.
 *
 * Os cartões do topo são os números que a equipe olha primeiro: quantos casos
 * abertos, quantos com afastamento e quantos dias a operação perdeu. É a mesma
 * conta que vai alimentar a pirâmide.
 */
export function SegAcidentesManager({
  rows, pessoas, locais, areas, causas, ehProprietario, itemPrograma,
  unidades, setores, subsetores, solicitantePadrao,
}: {
  rows: AcidenteRow[];
  pessoas: Person[];
  locais: { id: string; name: string; active: boolean }[];
  areas: { id: string; name: string; localId: string | null; active: boolean }[];
  causas: { id: string; name: string; active: boolean }[];
  /** excluir acidente e do proprietario: e registro legal, nao fila de trabalho */
  ehProprietario: boolean;
  /** item do Programa ao qual a ação de tratamento é amarrada (1.1) */
  itemPrograma: { item: string; bloco: string; secao: string | null; pilar: string | null } | null;
  /** recorte da AÇÃO de tratamento, editável na hora de abrir */
  unidades: { id: string; name: string }[];
  setores: { id: string; name: string }[];
  subsetores: { id: string; name: string; departmentId: string }[];
  solicitantePadrao: string;
}) {
  const [form, setForm] = useState<{ open: boolean; editando: AcidenteRow | null }>({ open: false, editando: null });
  const [aberto, setAberto] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [classe, setClasse] = useState("");
  const [status, setStatus] = useState("");
  const [tipo, setTipo] = useState("");
  const [retorno, setRetorno] = useState("");
  const [acao, setAcao] = useState(false);
  const [pendente, iniciar] = useTransition();
  const inputAnexo = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const nomeLocal = useMemo(() => new Map(locais.map((l) => [l.id, l.name])), [locais]);
  const nomeArea = useMemo(() => new Map(areas.map((a) => [a.id, a.name])), [areas]);
  const nomeCausa = useMemo(() => new Map(causas.map((c) => [c.id, c.name])), [causas]);

  const lista = useMemo(() => {
    const q = normalizar(busca.trim());
    return rows.filter((r) => {
      if (classe && r.classe !== classe) return false;
      if (tipo && r.tipo !== tipo) return false;
      if (status && r.status !== status) return false;
      if (!q) return true;
      return [r.pessoa, r.descricao, r.setor, r.parteCorpo, r.agenteCausador, r.catNumero]
        .some((v) => v && normalizar(v).includes(q));
    });
  }, [rows, busca, classe, tipo, status]);

  const numeros = useMemo(() => ({
    total: rows.length,
    abertos: rows.filter((r) => r.status === "aberto").length,
    comAfastamento: rows.filter((r) => r.classe === "lti").length,
    diasPerdidos: rows.reduce((s, r) => s + (r.diasAfastamento ?? 0), 0),
    sif: rows.filter((r) => r.classe === "sif").length,
  }), [rows]);

  const detalhe = aberto ? rows.find((r) => r.id === aberto) ?? null : null;
  const pendentesDoCaso = detalhe?.acoes.filter((a) => !a.concluida).length ?? 0;

  const encerrar = () => {
    if (!detalhe) return;
    iniciar(async () => {
      const r = await encerrarAcidente(detalhe.id, retorno || null);
      if (r.error) { toast.error(r.error); return; }
      // a data fica: reabrir o caso não desfaz o retorno que já aconteceu, e
      // limpar o campo faria o próximo encerramento pedir a data de novo
      toast.success(r.message ?? "Acidente encerrado.");
      router.refresh();
    });
  };

  const excluir = () => {
    if (!detalhe) return;
    void (async () => {
      const ok = await confirmDialog({
        title: "Excluir o acidente?",
        message: `O registro de ${shortName(detalhe.pessoa)} em ${dataBr(detalhe.occurredOn)} sai da base, junto com os documentos anexados. A pirâmide e os dias perdidos são recalculados, e a exclusão fica nos Logs do sistema.`,
        confirmLabel: "Excluir",
        tone: "danger",
      });
      if (!ok) return;
      const r = await excluirAcidente(detalhe.id);
      if (r.error) { toast.error(r.error); return; }
      toast.success(r.message ?? "Acidente excluído.");
      setAberto(null);
      router.refresh();
    })();
  };

  const reabrir = () => {
    if (!detalhe) return;
    iniciar(async () => {
      const r = await reabrirAcidente(detalhe.id);
      if (r.error) { toast.error(r.error); return; }
      toast.success(r.message ?? "Acidente reaberto.");
      setRetorno(detalhe.retornoEm ?? "");
      router.refresh();
    });
  };

  const anexar = (file: File | undefined) => {
    if (!file || !detalhe) return;
    const fd = new FormData();
    fd.set("id", detalhe.id);
    fd.set("file", file);
    iniciar(async () => {
      const r = await anexarAoAcidente(fd);
      if (r.error) toast.error(r.error);
      else toast.success(r.message ?? "Documento anexado.");
      if (inputAnexo.current) inputAnexo.current.value = "";
      router.refresh();
    });
  };

  const abrirAnexo = (anexoId: string) => {
    iniciar(async () => {
      const url = await urlAnexoAcidente(anexoId);
      if (!url) { toast.error("Não foi possível abrir o documento."); return; }
      window.open(url, "_blank", "noopener");
    });
  };

  const excluirAnexo = async (anexo: AnexoRow) => {
    const ok = await confirmDialog({
      title: "Remover documento",
      tone: "danger",
      confirmLabel: "Remover",
      message: `Remover "${anexo.nome}" deste acidente?`,
    });
    if (!ok) return;
    iniciar(async () => {
      const r = await removerAnexoAcidente(anexo.id);
      if (r.error) toast.error(r.error);
      router.refresh();
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
      {/* O cabeçalho mora aqui, e não na página, porque os botões dependem do
          estado desta tela (o filtro que a exportação usa, o formulário que o
          botão abre). Na linha dos filtros eles quebravam para baixo e
          abriam um vão entre os cartões e a tabela. */}
      <PageHeader
        title="Acidentes"
        subtitle="Registro dos acidentes de trabalho, com o que a empresa precisa e o que a lei pede."
        action={(
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <ExportButton
              filename="acidentes.xlsx"
              sheetName="Acidentes"
              headers={[
                "Data", "Hora", "Classificação", "Tipo", "Colaborador", "Matrícula", "Setor", "Função", "Gestor",
                "Unidade", "Local", "Área", "Parte do corpo", "Agente causador", "Natureza da lesão",
                "CAT", "CAT emitida em", "CID", "Dias de afastamento", "Retorno", "Situação", "Descrição",
                "Lançado em", "Lançado por",
              ]}
              rows={lista.map((r) => [
                dataBr(r.occurredOn), r.occurredAt?.slice(0, 5) ?? "", SEG_ACIDENTE_CLASS[r.classe],
                SEG_ACIDENTE_TIPO[r.tipo],
                r.pessoa ?? "", r.matricula ?? "", r.setor ?? "", r.funcao ?? "", r.gestor ?? "",
                r.unidade ?? "", (r.localId && nomeLocal.get(r.localId)) || "", (r.areaId && nomeArea.get(r.areaId)) || "",
                r.parteCorpo ?? "", r.agenteCausador ?? "", r.naturezaLesao ?? "",
                r.catNumero ?? "", dataBr(r.catEmitidaEm), r.cidCode ?? "",
                r.diasAfastamento ?? "", dataBr(r.retornoEm), SEG_ACIDENTE_STATUS[r.status], r.descricao,
                dataHoraBr(r.criadoEm), r.criadoPor ?? "",
              ])}
            />
            <button type="button" className="btn btn-primary" onClick={() => setForm({ open: true, editando: null })}>
              <Plus size={15} /> Registrar acidente
            </button>
          </div>
        )}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0.8rem" }}>
        <StatCard label="Acidentes registrados" value={numeros.total} />
        <StatCard label="Em apuração" value={numeros.abertos} tone="amber" />
        <StatCard label="Com afastamento" value={numeros.comAfastamento} tone="red" hint="LTI" />
        <StatCard label="Dias perdidos" value={numeros.diasPerdidos} tone="red" />
        <StatCard label="Graves ou fatais" value={numeros.sif} tone="dark" hint="SIF" />
      </div>

      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input" placeholder="Buscar por pessoa, descrição, setor, CAT…"
          value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 320 }}
        />
        <select className="select" value={classe} onChange={(e) => setClasse(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">Todas as classificações</option>
          {(Object.keys(SEG_ACIDENTE_CLASS) as Enums<"seg_acidente_class">[]).map((c) => (
            <option key={c} value={c}>{SEG_ACIDENTE_CLASS_LONGO[c]}</option>
          ))}
        </select>
        <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value)} style={{ maxWidth: 170 }}>
          <option value="">Típicos e de trajeto</option>
          {(Object.keys(SEG_ACIDENTE_TIPO) as Enums<"seg_acidente_tipo">[]).map((t) => (
            <option key={t} value={t}>{SEG_ACIDENTE_TIPO[t]}</option>
          ))}
        </select>
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 170 }}>
          <option value="">Todos os status</option>
          {(Object.keys(SEG_ACIDENTE_STATUS) as Enums<"seg_acidente_status">[]).map((s) => (
            <option key={s} value={s}>{SEG_ACIDENTE_STATUS[s]}</option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Nenhum acidente registrado"
          description="Que continue assim. Quando houver, registre aqui com CAT, CID e afastamento: é este cadastro que sustenta a pirâmide e o histórico legal."
        />
      ) : lista.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>Nenhum acidente com esses filtros.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 100 }}>Data</th>
              <th style={{ width: 80 }}>Classe</th>
              <th style={{ width: 100 }}>Tipo</th>
              <th>Colaborador</th>
              <th style={{ width: 130 }}>Setor</th>
              <th style={{ width: 160 }}>Função</th>
              <th style={{ width: 120 }}>Local</th>
              <th style={{ width: 110 }}>Área</th>
              <th style={{ width: 110 }}>Afastamento</th>
              <th style={{ width: 130 }}>Situação</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((r) => (
              <tr key={r.id} onClick={() => { setAberto(r.id); setRetorno(r.retornoEm ?? ""); }} style={{ cursor: "pointer" }} title="Abrir o caso">
                <td>{dataBr(r.occurredOn)}</td>
                <td>
                  <Badge tone={SEG_ACIDENTE_CLASS_TONE[r.classe]}>{SEG_ACIDENTE_CLASS[r.classe]}</Badge>
                </td>
                <td>
                  <Badge tone={SEG_ACIDENTE_TIPO_TONE[r.tipo]}>{SEG_ACIDENTE_TIPO[r.tipo]}</Badge>
                </td>
                <td style={{ fontWeight: 600 }}>{shortName(r.pessoa)}</td>
                <td className="muted" style={{ fontSize: "0.82rem" }}>{r.setor ?? "—"}</td>
                <td className="muted" style={{ fontSize: "0.82rem" }}>{r.funcao ?? "—"}</td>
                <td className="muted" style={{ fontSize: "0.82rem" }}>
                  {(r.localId && nomeLocal.get(r.localId)) || "—"}
                </td>
                <td className="muted" style={{ fontSize: "0.82rem" }}>
                  {(r.areaId && nomeArea.get(r.areaId)) || "—"}
                </td>
                <td className="muted" style={{ fontSize: "0.82rem" }}>
                  {r.diasAfastamento ? `${r.diasAfastamento} dia${r.diasAfastamento > 1 ? "s" : ""}` : "—"}
                </td>
                <td><Badge tone={SEG_ACIDENTE_STATUS_TONE[r.status]}>{SEG_ACIDENTE_STATUS[r.status]}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {detalhe && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)",
            backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            padding: "4vh 1rem", zIndex: 50, overflowY: "auto",
          }}
        >
          <div className="card" style={{ width: "100%", maxWidth: 680, boxShadow: "var(--mh-shadow-e3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
              <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>
                {shortName(detalhe.pessoa)} · {dataBr(detalhe.occurredOn)}
              </h2>
              <button
                type="button" onClick={() => setAberto(null)} className="muted" aria-label="Fechar"
                style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            <div style={{ padding: "1.15rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                <Badge tone={SEG_ACIDENTE_CLASS_TONE[detalhe.classe]}>{SEG_ACIDENTE_CLASS_LONGO[detalhe.classe]}</Badge>
                <Badge tone={SEG_ACIDENTE_TIPO_TONE[detalhe.tipo]}>{SEG_ACIDENTE_TIPO[detalhe.tipo]}</Badge>
                <Badge tone={SEG_ACIDENTE_STATUS_TONE[detalhe.status]}>{SEG_ACIDENTE_STATUS[detalhe.status]}</Badge>
              </div>

              <p style={{ margin: 0, fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>{detalhe.descricao}</p>

              <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.7rem", margin: 0, fontSize: "0.82rem" }}>
                <div><dt className="soft">Setor</dt><dd style={{ margin: 0 }}>{detalhe.setor ?? "—"}</dd></div>
                <div><dt className="soft">Função</dt><dd style={{ margin: 0 }}>{detalhe.funcao ?? "—"}</dd></div>
                <div><dt className="soft">Gestor</dt><dd style={{ margin: 0 }}>{shortName(detalhe.gestor)}</dd></div>
                <div><dt className="soft">Unidade</dt><dd style={{ margin: 0 }}>{detalhe.unidade ?? "—"}</dd></div>
                <div><dt className="soft">Hora e turno</dt><dd style={{ margin: 0 }}>{[detalhe.occurredAt?.slice(0, 5), detalhe.turno].filter(Boolean).join(" · ") || "—"}</dd></div>
                <div><dt className="soft">Local e área</dt><dd style={{ margin: 0 }}>{[(detalhe.localId && nomeLocal.get(detalhe.localId)), (detalhe.areaId && nomeArea.get(detalhe.areaId))].filter(Boolean).join(" · ") || "—"}</dd></div>
                <div><dt className="soft">Parte do corpo</dt><dd style={{ margin: 0 }}>{detalhe.parteCorpo ?? "—"}</dd></div>
                <div><dt className="soft">Agente causador</dt><dd style={{ margin: 0 }}>{detalhe.agenteCausador ?? "—"}</dd></div>
                <div><dt className="soft">Natureza da lesão</dt><dd style={{ margin: 0 }}>{detalhe.naturezaLesao ?? "—"}</dd></div>
                <div><dt className="soft">CAT</dt><dd style={{ margin: 0 }}>{detalhe.catNumero ? `${detalhe.catNumero} · ${dataBr(detalhe.catEmitidaEm)}` : "—"}</dd></div>
                <div><dt className="soft">Causa-raiz</dt><dd style={{ margin: 0 }}>{(detalhe.causaId && nomeCausa.get(detalhe.causaId)) || "Não apontada"}</dd></div>
                <div><dt className="soft">CID-10</dt><dd style={{ margin: 0 }}>{detalhe.cidCode ? `${detalhe.cidCode} ${detalhe.cidDescricao ?? ""}` : "—"}</dd></div>
                <div><dt className="soft">Afastamento</dt><dd style={{ margin: 0 }}>{detalhe.diasAfastamento ? `${detalhe.diasAfastamento} dias, retorno ${dataBr(detalhe.retornoEm)}` : "—"}</dd></div>
              </dl>

              {/* com data retroativa liberada, a data do fato não conta a história
                  toda: esta linha diz quando o caso entrou no sistema e por quem */}
              <p className="soft" style={{ fontSize: "0.75rem", margin: 0 }}>
                Lançado no sistema em {dataHoraBr(detalhe.criadoEm)}
                {detalhe.criadoPor ? ` por ${shortName(detalhe.criadoPor)}` : ""}.
              </p>

              {detalhe.testemunhas && (
                <div>
                  <div className="soft" style={{ fontSize: "0.78rem" }}>Testemunhas</div>
                  <p style={{ margin: 0, fontSize: "0.84rem" }}>{detalhe.testemunhas}</p>
                </div>
              )}

              {detalhe.analiseCausa && (
                <div>
                  <div className="soft" style={{ fontSize: "0.78rem" }}>Análise da causa</div>
                  <p style={{ margin: 0, fontSize: "0.84rem", whiteSpace: "pre-wrap" }}>{detalhe.analiseCausa}</p>
                </div>
              )}

              <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.9rem" }}>
                <h3 style={{ fontSize: "0.85rem", fontWeight: 700, margin: "0 0 0.4rem" }}>Ações de tratamento</h3>
                {detalhe.acoes.length === 0 ? (
                  <p className="soft" style={{ fontSize: "0.8rem", margin: "0 0 0.5rem" }}>
                    Nenhuma ação aberta. O que a empresa vai mudar para não repetir vira ação aqui,
                    com responsável e prazo.
                  </p>
                ) : (
                  <ul style={{ margin: "0 0 0.5rem", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                    {detalhe.acoes.map((a) => (
                      <li key={a.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", fontSize: "0.82rem" }}>
                        {/* a ação mora no módulo de Ações: aqui vai o ponteiro,
                            não uma segunda cópia do acompanhamento */}
                        <Link href={`/acoes?busca=${a.codigo}`} className="btn btn-ghost btn-sm">
                          <ExternalLink size={13} /> Ação #{a.codigo}
                        </Link>
                        <Badge tone={a.concluida ? "green" : "amber"}>
                          {a.concluida ? "Concluída" : `${a.pendentes} demanda${a.pendentes === 1 ? "" : "s"} em aberto`}
                        </Badge>
                        {a.prazo && <span className="soft">prazo {dataBr(a.prazo)}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                <button type="button" className="btn btn-ghost btn-sm" disabled={pendente} onClick={() => setAcao(true)}>
                  <ListChecks size={14} /> Criar ação de tratamento
                </button>
              </div>

              <div>
                <h3 style={{ fontSize: "0.85rem", fontWeight: 700, margin: "0 0 0.4rem" }}>Documentos</h3>
                {detalhe.anexos.length === 0 ? (
                  <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>Nenhum documento anexado.</p>
                ) : (
                  <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                    {detalhe.anexos.map((x) => (
                      <li key={x.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <button
                          type="button" className="btn btn-ghost btn-sm" disabled={pendente}
                          onClick={() => abrirAnexo(x.id)} style={{ flex: 1, justifyContent: "flex-start" }}
                        >
                          <Paperclip size={14} /> {x.nome}
                        </button>
                        <button type="button" className="icon-btn icon-btn-danger" title="Remover" disabled={pendente} onClick={() => excluirAnexo(x)}>
                          <Trash2 size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button" className="btn btn-ghost btn-sm" style={{ marginTop: "0.5rem" }}
                  disabled={pendente} onClick={() => inputAnexo.current?.click()}
                >
                  <Paperclip size={14} /> Anexar CAT, laudo ou foto
                </button>
              </div>

              {detalhe.status === "aberto" && (
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.9rem", display: "flex", gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 180 }}>
                    <label className="label">Retorno ao trabalho</label>
                    <input className="input" type="date" value={retorno} onChange={(e) => setRetorno(e.target.value)} />
                  </div>
                  <button type="button" className="btn btn-primary btn-sm" disabled={pendente} onClick={encerrar}>
                    Encerrar caso
                  </button>
                  {detalhe.classe === "lti" && (
                    <span className="soft" style={{ fontSize: "0.75rem" }}>
                      Acidente com afastamento só encerra com a data de retorno.
                    </span>
                  )}
                  {/* encerrar o caso é sobre o retorno ao trabalho; a ação
                      corretiva pode levar meses e não trava o encerramento */}
                  {pendentesDoCaso > 0 && (
                    <span className="soft" style={{ fontSize: "0.75rem" }}>
                      {pendentesDoCaso === 1 ? "Há 1 ação de tratamento em aberto" : `Há ${pendentesDoCaso} ações de tratamento em aberto`}.
                      O caso encerra assim mesmo, e ela continua sendo cobrada em Ações.
                    </span>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm({ open: true, editando: detalhe })}>
                  <Pencil size={14} /> Editar
                </button>
                {detalhe.status === "encerrado" && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={pendente} onClick={reabrir}>
                    <RotateCcw size={14} /> Reabrir
                  </button>
                )}
                {ehProprietario && (
                  <button
                    type="button" className="btn btn-ghost btn-sm" disabled={pendente}
                    style={{ color: "var(--mh-danger)" }} onClick={excluir}
                  >
                    <Trash2 size={14} /> Excluir
                  </button>
                )}
              </div>
              <button type="button" className="btn btn-ghost" onClick={() => setAberto(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {detalhe && (
        <SegAcaoDialog
          open={acao} onClose={() => setAcao(false)}
          alvo={{ tipo: "acidente", id: detalhe.id }}
          problema={`${SEG_ACIDENTE_CLASS_LONGO[detalhe.classe]} em ${dataBr(detalhe.occurredOn)}: ${detalhe.descricao}`}
          // o gestor da época do acidentado é quem tem alçada para corrigir
          sugestaoResponsaveis={detalhe.gestorId ? [detalhe.gestorId] : []}
          pessoas={pessoas}
          unitId={detalhe.unitId}
          departmentId={detalhe.setorId}
          subdepartmentId={detalhe.subsetorId}
          itemPrograma={itemPrograma}
          unidades={unidades}
          setores={setores}
          subsetores={subsetores}
          solicitantePadrao={solicitantePadrao}
        />
      )}

      {/* montado só quando abre, com `key` por registro: cada abertura começa
          limpa, sem efeito de reset e sem rascunho do acidente anterior */}
      {form.open && (
        <SegAcidenteDialog
          key={form.editando?.id ?? "novo"}
          onClose={() => setForm({ open: false, editando: null })}
          editando={form.editando} pessoas={pessoas} locais={locais} areas={areas} causas={causas}
        />
      )}

      <input
        ref={inputAnexo} type="file" style={{ display: "none" }}
        onChange={(e) => anexar(e.target.files?.[0])}
      />
    </div>
  );
}
