"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Check, FileText, Paperclip, Pencil, Printer, Send, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Tabs, type Tab } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { ExportButton } from "@/components/ui/ExportButton";
import { PeoplePicker } from "@/components/PeoplePicker";
import { confirmDialog } from "@/components/ui/confirm";
import { formatDate, normalizar } from "@/lib/format";
import {
  INFRACTION_SEVERITY, INFRACTION_SEVERITY_TONE, PUNICAO_STATUS, PUNICAO_STATUS_TONE,
} from "@/lib/constants";
import {
  anexarDocumentoAssinado, cancelarPunicao, decidirPunicao, excluirRascunhoPunicao,
  getDocumentoAssinadoUrl, removerDocumentoAssinado, salvarRascunhoPunicao, submeterPunicao,
} from "@/lib/actions/punicoes";
import type { Enums } from "@/types/database";

export type PunicaoRow = {
  id: string;
  status: Enums<"punicao_status">;
  userId: string;
  appliedOn: string | null;
  infractionTypeId: string | null;
  infractionCode: string | null;
  infractionName: string | null;
  infractionDescription: string | null;
  severity: Enums<"infraction_severity"> | null;
  sanctionTypeId: string | null;
  sanctionName: string | null;
  extraInfo: string | null;
  fullName: string | null;
  employeeCode: string | null;
  departmentName: string | null;
  subdepartmentName: string | null;
  positionName: string | null;
  managerName: string | null;
  unitName: string | null;
  signedPath: string | null;
  signedFilename: string | null;
  createdBy: string;
  createdByName: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  cancelledAt: string | null;
  cancelNote: string | null;
};

export type Pessoa = {
  id: string;
  name: string;
  matricula: string | null;
  setor: string | null;
  subsetor: string | null;
  funcao: string | null;
  gestor: string | null;
  unidade: string | null;
};

type Infracao = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  severity: Enums<"infraction_severity">;
  active: boolean;
};

type Rascunho = {
  id?: string;
  userId: string;
  appliedOn: string;
  infractionTypeId: string;
  sanctionTypeId: string;
  extraInfo: string;
};

const hoje = () => new Date().toISOString().slice(0, 10);

/**
 * A tela do processo de punição.
 *
 * As três abas são recortes da MESMA lista, e não telas diferentes: "Aguardando
 * o RH" é a fila de quem decide, "Meus lançamentos" é o que a pessoa abriu e
 * "Histórico" é o que já foi decidido. Molde do `TicketsManager`.
 *
 * O formulário não tem campo de gravidade, e isso é de propósito: ela vem do
 * catálogo de infração. Também não tem CPF: ele aparece só no documento
 * impresso, buscado por RPC no servidor.
 */
export function PunicoesManager({
  rows, pessoas, infracoes, punicoes, meuId, podeDecidir, podeCancelar,
}: {
  rows: PunicaoRow[];
  pessoas: Pessoa[];
  infracoes: Infracao[];
  punicoes: { id: string; name: string; active: boolean }[];
  meuId: string;
  /** RH, administrador e proprietário: quem aprova ou reprova */
  podeDecidir: boolean;
  /** só administrador e proprietário desfazem uma punição já aprovada */
  podeCancelar: boolean;
}) {
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [aberto, setAberto] = useState<PunicaoRow | null>(null);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const infracoesAtivas = infracoes.filter((i) => i.active);
  const punicoesAtivas = punicoes.filter((p) => p.active);
  const pessoaPorId = useMemo(() => new Map(pessoas.map((p) => [p.id, p])), [pessoas]);

  const filtrar = (lista: PunicaoRow[]) => {
    const q = normalizar(busca.trim());
    if (!q) return lista;
    return lista.filter((r) =>
      [r.fullName, r.infractionName, r.infractionCode, r.sanctionName, r.employeeCode]
        .some((v) => v && normalizar(v).includes(q)));
  };

  const meus = filtrar(rows.filter((r) => r.createdBy === meuId));
  const fila = filtrar(rows.filter((r) => r.status === "pendente"));
  const historico = filtrar(rows.filter((r) => r.status === "aprovada" || r.status === "reprovada" || r.status === "cancelada"));

  const abrirNovo = () => {
    setErro("");
    setRascunho({
      userId: "", appliedOn: hoje(),
      infractionTypeId: infracoesAtivas[0]?.id ?? "",
      sanctionTypeId: punicoesAtivas[0]?.id ?? "",
      extraInfo: "",
    });
  };

  const abrirEdicao = (r: PunicaoRow) => {
    setErro("");
    setRascunho({
      id: r.id, userId: r.userId, appliedOn: r.appliedOn ?? hoje(),
      infractionTypeId: r.infractionTypeId ?? "",
      sanctionTypeId: r.sanctionTypeId ?? "",
      extraInfo: r.extraInfo ?? "",
    });
  };

  const salvar = () => {
    if (!rascunho) return;
    setErro("");
    iniciar(async () => {
      const r = await salvarRascunhoPunicao({
        id: rascunho.id,
        userId: rascunho.userId,
        appliedOn: rascunho.appliedOn,
        infractionTypeId: rascunho.infractionTypeId,
        sanctionTypeId: rascunho.sanctionTypeId,
        extraInfo: rascunho.extraInfo,
      });
      if (r.error) { setErro(r.error); return; }
      // segue aberto com o id: é daqui que saem a impressão e o anexo
      setRascunho({ ...rascunho, id: r.id });
      router.refresh();
    });
  };

  const excluir = async (r: PunicaoRow) => {
    const ok = await confirmDialog({
      title: "Excluir rascunho",
      tone: "danger",
      confirmLabel: "Excluir",
      message: `Excluir o rascunho da punição de ${r.fullName ?? "colaborador"}? Nada foi enviado ao RH, então nada se perde além do que está preenchido.`,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("id", r.id);
    iniciar(async () => {
      const res = await excluirRascunhoPunicao(fd);
      if (res.error) setErro(res.error);
      setRascunho(null);
      router.refresh();
    });
  };

  const enviar = async (id: string) => {
    const ok = await confirmDialog({
      title: "Enviar ao RH",
      confirmLabel: "Enviar",
      message: "Depois de enviado o lançamento fica congelado até o RH decidir. Para corrigir algo, será preciso pedir a reprovação.",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("id", id);
    iniciar(async () => {
      const res = await submeterPunicao(fd);
      if (res.error) { setErro(res.error); return; }
      setRascunho(null);
      setAberto(null);
      router.refresh();
    });
  };

  const baixarAssinado = async (path: string) => {
    const url = await getDocumentoAssinadoUrl(path);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  const linhaDaTabela = (r: PunicaoRow, comAutor: boolean) => (
    <tr key={r.id}>
      <td>
        <span style={{ fontWeight: 600 }}>{r.fullName ?? "Sem nome"}</span>
        <div className="soft" style={{ fontSize: "0.74rem" }}>
          {[r.employeeCode, r.positionName, r.departmentName].filter(Boolean).join(" · ") || "–"}
        </div>
      </td>
      <td>
        {r.infractionName ? (
          <>
            <span>{r.infractionCode ? `${r.infractionCode} ` : ""}{r.infractionName}</span>
            {r.severity && (
              <div style={{ marginTop: "0.2rem" }}>
                <Badge tone={INFRACTION_SEVERITY_TONE[r.severity]}>{INFRACTION_SEVERITY[r.severity]}</Badge>
              </div>
            )}
          </>
        ) : <span className="soft">Não informada</span>}
      </td>
      <td>{r.sanctionName ?? <span className="soft">Não informada</span>}</td>
      <td>{r.appliedOn ? formatDate(r.appliedOn) : <span className="soft">Sem data</span>}</td>
      {comAutor && <td>{r.createdByName ?? <span className="soft">–</span>}</td>}
      <td><Badge tone={PUNICAO_STATUS_TONE[r.status]}>{PUNICAO_STATUS[r.status]}</Badge></td>
      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        <span style={{ display: "inline-flex", gap: "0.3rem" }}>
          <button type="button" className="icon-btn" title="Ver" onClick={() => setAberto(r)}>
            <FileText size={15} />
          </button>
          {r.status === "rascunho" && r.createdBy === meuId && (
            <>
              <button type="button" className="icon-btn" title="Editar" onClick={() => abrirEdicao(r)}>
                <Pencil size={15} />
              </button>
              <button type="button" className="icon-btn icon-btn-danger" title="Excluir" disabled={pendente} onClick={() => excluir(r)}>
                <Trash2 size={15} />
              </button>
            </>
          )}
        </span>
      </td>
    </tr>
  );

  const tabela = (lista: PunicaoRow[], comAutor: boolean, vazio: string) =>
    lista.length === 0 ? (
      <EmptyState title="Nada por aqui" description={vazio} />
    ) : (
      <table className="table">
        <thead>
          <tr>
            <th>Colaborador</th>
            <th>Infração</th>
            <th style={{ width: 160 }}>Punição</th>
            <th style={{ width: 110 }}>Aplicada em</th>
            {comAutor && <th style={{ width: 180 }}>Lançada por</th>}
            <th style={{ width: 150 }}>Situação</th>
            <th style={{ width: 110 }}></th>
          </tr>
        </thead>
        <tbody>{lista.map((r) => linhaDaTabela(r, comAutor))}</tbody>
      </table>
    );

  const abas: Tab[] = [
    {
      id: "meus", label: `Meus lançamentos (${meus.length})`,
      content: tabela(meus, false, "Você ainda não lançou nenhuma punição. Comece por “Nova punição”."),
    },
  ];
  if (podeDecidir) {
    abas.push({
      id: "fila", label: `Aguardando o RH (${fila.length})`,
      content: tabela(fila, true, "Nenhum lançamento aguardando decisão."),
    });
  }
  abas.push({
    id: "historico", label: `Histórico (${historico.length})`,
    content: tabela(historico, true, "Nenhum lançamento decidido ainda."),
  });

  const infracaoEscolhida = infracoes.find((i) => i.id === rascunho?.infractionTypeId) ?? null;
  const pessoaEscolhida = rascunho?.userId ? pessoaPorId.get(rascunho.userId) ?? null : null;
  const salvo = rows.find((r) => r.id === rascunho?.id) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input" placeholder="Buscar por colaborador, infração ou punição…"
          value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 340 }}
        />
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginLeft: "auto", flexWrap: "wrap" }}>
          <ExportButton
            filename="punicoes-lancadas.xlsx"
            sheetName="Punições"
            headers={["Colaborador", "Matrícula", "Setor", "Função", "Unidade", "Código", "Infração", "Gravidade", "Punição", "Aplicada em", "Situação", "Lançada por", "Decidida por", "Motivo"]}
            rows={rows.map((r) => [
              r.fullName ?? "", r.employeeCode ?? "", r.departmentName ?? "", r.positionName ?? "",
              r.unitName ?? "", r.infractionCode ?? "", r.infractionName ?? "",
              r.severity ? INFRACTION_SEVERITY[r.severity] : "", r.sanctionName ?? "",
              r.appliedOn ?? "", PUNICAO_STATUS[r.status], r.createdByName ?? "",
              r.decidedByName ?? "", r.decisionNote ?? "",
            ])}
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={abrirNovo}>+ Nova punição</button>
        </div>
      </div>

      {erro && !rascunho && !aberto && (
        <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{erro}</p>
      )}

      <Tabs tabs={abas} />

      {/* ---------------- formulário ---------------- */}
      {rascunho && (
        <Dialogo titulo={rascunho.id ? "Lançamento de punição" : "Nova punição"} onFechar={() => setRascunho(null)}>
          {infracoesAtivas.length === 0 || punicoesAtivas.length === 0 ? (
            <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>
              Antes de lançar, o RH precisa cadastrar os tipos de infração e de punição em
              Configurações, na aba Punições.
            </p>
          ) : (
            <>
              <div>
                <label className="label">Colaborador <span style={{ color: "var(--mh-danger)" }}>*</span></label>
                {rascunho.id ? (
                  <p style={{ margin: 0, fontWeight: 600 }}>{salvo?.fullName ?? pessoaEscolhida?.name}</p>
                ) : (
                  <PeoplePicker
                    people={pessoas.map((p) => ({ id: p.id, name: p.name }))}
                    selected={rascunho.userId ? [rascunho.userId] : []}
                    onChange={(ids) => setRascunho((r) => (r ? { ...r, userId: ids[0] ?? "" } : r))}
                    placeholder="Buscar na sua equipe…"
                    single
                  />
                )}
              </div>

              {pessoaEscolhida && (
                <div style={{ border: "1px solid var(--border)", borderRadius: "var(--mh-radius-lg)", background: "var(--surface-2)", padding: "0.75rem" }}>
                  <p className="soft" style={{ fontSize: "0.72rem", margin: "0 0 0.4rem" }}>
                    Do cadastro do colaborador, congelado no lançamento assim que ele for enviado ao RH.
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.5rem 1rem" }}>
                    <Campo rotulo="Matrícula" valor={pessoaEscolhida.matricula} />
                    <Campo rotulo="Setor" valor={pessoaEscolhida.setor} />
                    <Campo rotulo="Subsetor" valor={pessoaEscolhida.subsetor} />
                    <Campo rotulo="Função" valor={pessoaEscolhida.funcao} />
                    <Campo rotulo="Gestor imediato" valor={pessoaEscolhida.gestor} />
                    <Campo rotulo="Unidade" valor={pessoaEscolhida.unidade} />
                  </div>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.8rem" }}>
                <div>
                  <label className="label">Data da aplicação <span style={{ color: "var(--mh-danger)" }}>*</span></label>
                  <input
                    type="date" className="input" value={rascunho.appliedOn}
                    onChange={(e) => setRascunho((r) => (r ? { ...r, appliedOn: e.target.value } : r))}
                  />
                </div>
                <div>
                  <label className="label">Punição aplicada <span style={{ color: "var(--mh-danger)" }}>*</span></label>
                  <select
                    className="select" value={rascunho.sanctionTypeId}
                    onChange={(e) => setRascunho((r) => (r ? { ...r, sanctionTypeId: e.target.value } : r))}
                  >
                    {punicoesAtivas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Infração <span style={{ color: "var(--mh-danger)" }}>*</span></label>
                <select
                  className="select" value={rascunho.infractionTypeId}
                  onChange={(e) => setRascunho((r) => (r ? { ...r, infractionTypeId: e.target.value } : r))}
                >
                  {infracoesAtivas.map((i) => (
                    <option key={i.id} value={i.id}>{i.code} {i.name}</option>
                  ))}
                </select>
                {infracaoEscolhida && (
                  <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
                    <Badge tone={INFRACTION_SEVERITY_TONE[infracaoEscolhida.severity]}>
                      {INFRACTION_SEVERITY[infracaoEscolhida.severity]}
                    </Badge>
                    <span className="soft" style={{ fontSize: "0.78rem" }}>
                      {infracaoEscolhida.description ?? "Sem descrição cadastrada."}
                    </span>
                  </div>
                )}
              </div>

              <div>
                <label className="label">Informação complementar</label>
                <textarea
                  className="input" rows={3} value={rascunho.extraInfo}
                  placeholder="O que o gestor precisa registrar sobre o caso. Sai impresso no documento."
                  onChange={(e) => setRascunho((r) => (r ? { ...r, extraInfo: e.target.value } : r))}
                />
              </div>

              {rascunho.id && salvo && (
                <Anexo
                  linha={salvo}
                  pendente={pendente}
                  onErro={setErro}
                  onFeito={() => router.refresh()}
                  onAbrir={baixarAssinado}
                />
              )}

              {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{erro}</p>}

              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <button type="button" className="btn btn-primary btn-sm" disabled={pendente} onClick={salvar}>
                  {pendente ? "Salvando…" : "Salvar rascunho"}
                </button>
                {rascunho.id && (
                  <a
                    className="btn btn-ghost btn-sm" target="_blank" rel="noopener noreferrer"
                    href={`/punicoes/${rascunho.id}/documento`}
                  >
                    <Printer size={15} /> Imprimir documento
                  </a>
                )}
                {rascunho.id && (
                  <button
                    type="button" className="btn btn-primary btn-sm"
                    disabled={pendente || !salvo?.signedPath}
                    title={salvo?.signedPath ? undefined : "Anexe o documento assinado primeiro"}
                    onClick={() => enviar(rascunho.id as string)}
                  >
                    <Send size={15} /> Enviar ao RH
                  </button>
                )}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRascunho(null)}>Fechar</button>
              </div>

              <p className="soft" style={{ fontSize: "0.75rem", margin: 0 }}>
                Rascunho não vale como punição e não altera remuneração variável. O lançamento só
                passa a valer depois que o RH aprovar.
              </p>
            </>
          )}
        </Dialogo>
      )}

      {/* ---------------- detalhe ---------------- */}
      {aberto && (
        <Dialogo titulo="Punição" onFechar={() => { setAberto(null); setErro(""); }}>
          <Detalhe
            linha={aberto}
            podeDecidir={podeDecidir}
            podeCancelar={podeCancelar}
            erro={erro}
            onErro={setErro}
            onAbrirAssinado={baixarAssinado}
            onFechar={() => { setAberto(null); setErro(""); }}
          />
        </Dialogo>
      )}
    </div>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  return (
    <div>
      <div className="soft" style={{ fontSize: "0.7rem" }}>{rotulo}</div>
      <div style={{ fontSize: "0.85rem" }}>{valor ?? "–"}</div>
    </div>
  );
}

/**
 * Modal do módulo.
 *
 * Fecha por X ou pelo botão, nunca por clique no fundo: é formulário longo, e
 * perder o preenchido por um clique fora é a reclamação que originou a regra.
 */
function Dialogo({ titulo, children, onFechar }: { titulo: string; children: React.ReactNode; onFechar: () => void }) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)",
        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "4vh 1rem", zIndex: 50, overflowY: "auto",
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 720, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>{titulo}</h2>
          <button type="button" onClick={onFechar} className="muted" aria-label="Fechar"
            style={{ background: "none", border: "none", cursor: "pointer", lineHeight: 1, display: "flex" }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** O anexo assinado: sem ele o banco recusa a saída do rascunho. */
function Anexo({
  linha, pendente, onErro, onFeito, onAbrir,
}: {
  linha: PunicaoRow;
  pendente: boolean;
  onErro: (m: string) => void;
  onFeito: () => void;
  onAbrir: (path: string) => void;
}) {
  const [enviando, iniciar] = useTransition();
  const ocupado = pendente || enviando;

  const subir = (file: File) => {
    onErro("");
    const fd = new FormData();
    fd.set("id", linha.id);
    fd.set("file", file);
    iniciar(async () => {
      const r = await anexarDocumentoAssinado(fd);
      if (r.error) onErro(r.error);
      onFeito();
    });
  };

  const remover = () => {
    const fd = new FormData();
    fd.set("id", linha.id);
    iniciar(async () => {
      const r = await removerDocumentoAssinado(fd);
      if (r.error) onErro(r.error);
      onFeito();
    });
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--mh-radius-lg)", padding: "0.75rem" }}>
      <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.3rem" }}>Documento assinado</div>
      <p className="soft" style={{ fontSize: "0.75rem", margin: "0 0 0.6rem" }}>
        Imprima o documento, colha as assinaturas do colaborador, do gestor, do RH e da diretoria,
        e anexe aqui o papel digitalizado. PDF ou foto, até 10 MB.
      </p>
      {linha.signedPath ? (
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAbrir(linha.signedPath as string)}>
            <Paperclip size={15} /> {linha.signedFilename ?? "Ver documento"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={ocupado} onClick={remover}>
            Remover
          </button>
        </div>
      ) : (
        <input
          type="file" className="input" disabled={ocupado}
          accept="application/pdf,image/*"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f); e.target.value = ""; }}
        />
      )}
      {enviando && <p className="soft" style={{ fontSize: "0.75rem", margin: "0.4rem 0 0" }}>Enviando…</p>}
    </div>
  );
}

/** A ficha completa de um lançamento já enviado. */
function Detalhe({
  linha, podeDecidir, podeCancelar, erro, onErro, onAbrirAssinado, onFechar,
}: {
  linha: PunicaoRow;
  podeDecidir: boolean;
  podeCancelar: boolean;
  erro: string;
  onErro: (m: string) => void;
  onAbrirAssinado: (path: string) => void;
  onFechar: () => void;
}) {
  return (
    <>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <Badge tone={PUNICAO_STATUS_TONE[linha.status]}>{PUNICAO_STATUS[linha.status]}</Badge>
        {linha.severity && (
          <Badge tone={INFRACTION_SEVERITY_TONE[linha.severity]}>{INFRACTION_SEVERITY[linha.severity]}</Badge>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.6rem 1rem" }}>
        <Campo rotulo="Colaborador" valor={linha.fullName} />
        <Campo rotulo="Matrícula" valor={linha.employeeCode} />
        <Campo rotulo="Setor" valor={linha.departmentName} />
        <Campo rotulo="Subsetor" valor={linha.subdepartmentName} />
        <Campo rotulo="Função" valor={linha.positionName} />
        <Campo rotulo="Gestor imediato" valor={linha.managerName} />
        <Campo rotulo="Unidade" valor={linha.unitName} />
        <Campo rotulo="Aplicada em" valor={linha.appliedOn ? formatDate(linha.appliedOn) : null} />
      </div>

      <div>
        <div className="soft" style={{ fontSize: "0.7rem" }}>Infração</div>
        <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>
          {linha.infractionCode ? `${linha.infractionCode} ` : ""}{linha.infractionName ?? "–"}
        </div>
        {linha.infractionDescription && (
          <p className="soft" style={{ fontSize: "0.8rem", margin: "0.2rem 0 0" }}>{linha.infractionDescription}</p>
        )}
      </div>

      <Campo rotulo="Punição aplicada" valor={linha.sanctionName} />
      {linha.extraInfo && <Campo rotulo="Informação complementar" valor={linha.extraInfo} />}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.6rem 1rem" }}>
        <Campo rotulo="Lançada por" valor={linha.createdByName} />
        <Campo rotulo="Enviada ao RH em" valor={linha.submittedAt ? formatDate(linha.submittedAt) : null} />
        <Campo rotulo="Decidida por" valor={linha.decidedByName} />
        <Campo rotulo="Decidida em" valor={linha.decidedAt ? formatDate(linha.decidedAt) : null} />
      </div>
      {linha.decisionNote && <Campo rotulo="Motivo da decisão" valor={linha.decisionNote} />}
      {linha.cancelNote && <Campo rotulo="Motivo do cancelamento" valor={linha.cancelNote} />}

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        {linha.signedPath && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAbrirAssinado(linha.signedPath as string)}>
            <Paperclip size={15} /> {linha.signedFilename ?? "Documento assinado"}
          </button>
        )}
        <a className="btn btn-ghost btn-sm" target="_blank" rel="noopener noreferrer" href={`/punicoes/${linha.id}/documento`}>
          <Printer size={15} /> Documento do sistema
        </a>
      </div>

      <Decisao
        linha={linha}
        podeDecidir={podeDecidir}
        podeCancelar={podeCancelar}
        erro={erro}
        onErro={onErro}
        onFechar={onFechar}
      />
    </>
  );
}

/**
 * Aprovar, reprovar e cancelar.
 *
 * Aprovar é o único botão que cria punição de verdade, então ele avisa do efeito
 * na remuneração variável antes de gravar. Reprovar exige motivo, porque o
 * motivo é o que volta para o gestor saber o que corrigir.
 */
function Decisao({
  linha, podeDecidir, podeCancelar, erro, onErro, onFechar,
}: {
  linha: PunicaoRow;
  podeDecidir: boolean;
  podeCancelar: boolean;
  erro: string;
  onErro: (m: string) => void;
  onFechar: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const decidir = (aprovar: boolean) => {
    onErro("");
    const fd = new FormData();
    fd.set("id", linha.id);
    fd.set("aprovar", aprovar ? "1" : "0");
    fd.set("nota", motivo);
    iniciar(async () => {
      const r = await decidirPunicao(fd);
      if (r.error) { onErro(r.error); return; }
      onFechar();
      router.refresh();
    });
  };

  const aprovar = async () => {
    const ok = await confirmDialog({
      title: "Aprovar punição",
      confirmLabel: "Aprovar",
      message: `Aprovar a ${(linha.sanctionName ?? "punição").toLowerCase()} de ${linha.fullName ?? "colaborador"}? A partir daqui ela passa a valer e entra no cálculo da remuneração variável do mês.`,
    });
    if (ok) decidir(true);
  };

  const reprovar = () => {
    if (!motivo.trim()) { onErro("Informe o motivo da reprovação."); return; }
    decidir(false);
  };

  const cancelar = async () => {
    const ok = await confirmDialog({
      title: "Cancelar punição",
      tone: "danger",
      confirmLabel: "Cancelar a punição",
      message: `Cancelar a ${(linha.sanctionName ?? "punição").toLowerCase()} de ${linha.fullName ?? "colaborador"}? Ela deixa de contar para a remuneração variável, e o lançamento fica registrado como cancelado.`,
    });
    if (!ok) return;
    onErro("");
    const fd = new FormData();
    fd.set("id", linha.id);
    fd.set("nota", motivo);
    iniciar(async () => {
      const r = await cancelarPunicao(fd);
      if (r.error) { onErro(r.error); return; }
      onFechar();
      router.refresh();
    });
  };

  const decidindo = podeDecidir && linha.status === "pendente";
  const cancelando = podeCancelar && linha.status === "aprovada";
  if (!decidindo && !cancelando) {
    return erro ? <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{erro}</p> : null;
  }

  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <div>
        <label className="label">
          {decidindo ? "Motivo da reprovação" : "Motivo do cancelamento"}
          {decidindo && <span className="soft" style={{ fontWeight: 400 }}> (obrigatório para reprovar)</span>}
        </label>
        <textarea
          className="input" rows={2} value={motivo}
          placeholder={decidindo
            ? "O que o gestor precisa corrigir antes de reenviar."
            : "Por que esta punição deixou de valer."}
          onChange={(e) => setMotivo(e.target.value)}
        />
      </div>
      {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{erro}</p>}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {decidindo && (
          <>
            <button type="button" className="btn btn-primary btn-sm" disabled={pendente} onClick={aprovar}>
              <Check size={15} /> Aprovar
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={pendente} onClick={reprovar}>
              <Ban size={15} /> Reprovar
            </button>
          </>
        )}
        {cancelando && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={pendente} onClick={cancelar}>
            <Ban size={15} /> Cancelar a punição
          </button>
        )}
      </div>
    </div>
  );
}
