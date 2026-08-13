"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Ban, Check, FileText, Mail, Paperclip, Pencil, Send, Stethoscope, X,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Tabs, type Tab } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { ExportButton } from "@/components/ui/ExportButton";
import { PeoplePicker } from "@/components/PeoplePicker";
import { confirmDialog } from "@/components/ui/confirm";
import { formatDate, normalizar } from "@/lib/format";
import {
  ABSENCE_KIND_LABEL, ABSENCE_KIND_TONE,
  ABSENTEISMO_STATUS, ABSENTEISMO_STATUS_TONE,
} from "@/lib/constants";
import {
  anexarDocumentoAbsenteismo, cancelarAbsenteismo, confirmarAbsenteismo, decidirAbsenteismo,
  getAtestado, getDocumentoAbsenteismoUrl, lancarNaoComparecimento, reenviarComunicado,
  removerDocumentoAbsenteismo, salvarConfirmacao,
  type AtestadoLido,
} from "@/lib/actions/absenteismos";
import type { Enums } from "@/types/database";

export type AbsenteismoRow = {
  id: string;
  status: Enums<"absenteismo_status">;
  userId: string;
  occurredOn: string;
  reasonNote: string | null;
  absenceTypeId: string | null;
  typeName: string | null;
  kind: Enums<"absence_kind"> | null;
  requiresDocument: boolean;
  requiresMedical: boolean;
  startDate: string | null;
  endDate: string | null;
  discountsRv: boolean | null;
  note: string | null;
  fullName: string | null;
  employeeCode: string | null;
  departmentName: string | null;
  subdepartmentName: string | null;
  positionName: string | null;
  managerName: string | null;
  unitName: string | null;
  docPath: string | null;
  docFilename: string | null;
  createdBy: string;
  createdByName: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  cancelledAt: string | null;
  cancelNote: string | null;
  emailStatus: string | null;
  emailAt: string | null;
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

type Tipo = {
  id: string;
  name: string;
  description: string | null;
  kind: Enums<"absence_kind">;
  requiresDocument: boolean;
  requiresMedical: boolean;
  discountsRvDefault: boolean;
  active: boolean;
};

type Confirmacao = {
  absenceTypeId: string;
  startDate: string;
  endDate: string;
  note: string;
  cid: string;
  cidDescricao: string;
  medico: string;
  crm: string;
  local: string;
  emitidoEm: string;
  dias: string;
};

/** O dia de HOJE do navegador. No servidor, em UTC, viraria amanhã às 21h. */
const hoje = () => {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
};

/**
 * A tela do processo de absenteísmo.
 *
 * Três abas sobre a mesma lista: "Em aberto" é o que foi lançado e ainda não tem
 * motivo confirmado; "Aguardando o RH" é a fila de quem decide; "Histórico" é o
 * que já foi decidido.
 *
 * O bloco de atestado (CID, médico, local) só aparece quando o TIPO exige, e o
 * dado é buscado sob demanda pela RPC, nunca junto da lista.
 */
export function AbsenteismosManager({
  rows, pessoas, tipos, kindsComRedutor, meuId, podeDecidir, podeCancelarAprovado,
}: {
  rows: AbsenteismoRow[];
  pessoas: Pessoa[];
  tipos: Tipo[];
  /**
   * Comportamentos que já têm faixa de redutor ativa em Remuneração variável.
   * A tela usa para dizer ao gestor o efeito real do tipo escolhido, em vez de
   * deixá-lo adivinhar.
   */
  kindsComRedutor: Enums<"absence_kind">[];
  meuId: string;
  podeDecidir: boolean;
  podeCancelarAprovado: boolean;
}) {
  const [novo, setNovo] = useState<{ userId: string; occurredOn: string; reasonNote: string } | null>(null);
  const [confirmando, setConfirmando] = useState<AbsenteismoRow | null>(null);
  const [aberto, setAberto] = useState<AbsenteismoRow | null>(null);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const tiposAtivos = tipos.filter((t) => t.active);
  const pessoaPorId = useMemo(() => new Map(pessoas.map((p) => [p.id, p])), [pessoas]);

  const filtrar = (lista: AbsenteismoRow[]) => {
    const q = normalizar(busca.trim());
    if (!q) return lista;
    return lista.filter((r) =>
      [r.fullName, r.typeName, r.employeeCode, r.departmentName]
        .some((v) => v && normalizar(v).includes(q)));
  };

  const emAberto = filtrar(rows.filter((r) => r.status === "aberto"));
  const fila = filtrar(rows.filter((r) => r.status === "pendente"));
  const historico = filtrar(rows.filter((r) =>
    r.status === "aprovado" || r.status === "reprovado" || r.status === "cancelado"));

  const lancar = () => {
    if (!novo) return;
    setErro("");
    iniciar(async () => {
      const r = await lancarNaoComparecimento(novo);
      if (r.error) { setErro(r.error); return; }
      setNovo(null);
      if (r.warning) setErro(r.warning);
      router.refresh();
    });
  };

  const abrirDocumento = async (path: string) => {
    const url = await getDocumentoAbsenteismoUrl(path);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  const podeMexer = (r: AbsenteismoRow) =>
    (r.status === "aberto" || r.status === "reprovado")
    && (r.createdBy === meuId || podeDecidir);

  const linha = (r: AbsenteismoRow, comAutor: boolean) => (
    <tr key={r.id}>
      <td>
        <span style={{ fontWeight: 600 }}>{r.fullName ?? "Sem nome"}</span>
        <div className="soft" style={{ fontSize: "0.74rem" }}>
          {[r.employeeCode, r.positionName, r.departmentName].filter(Boolean).join(" · ") || "–"}
        </div>
      </td>
      <td style={{ whiteSpace: "nowrap" }}>{formatDate(r.occurredOn)}</td>
      <td>
        {r.typeName ? (
          <>
            <span>{r.typeName}</span>
            {r.kind && (
              <div style={{ marginTop: "0.2rem" }}>
                <Badge tone={ABSENCE_KIND_TONE[r.kind]}>{ABSENCE_KIND_LABEL[r.kind]}</Badge>
              </div>
            )}
          </>
        ) : <span className="soft">Motivo não confirmado</span>}
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        {r.startDate && r.endDate
          ? `${formatDate(r.startDate)} a ${formatDate(r.endDate)}`
          : <span className="soft">–</span>}
      </td>
      {comAutor && <td>{r.createdByName ?? <span className="soft">–</span>}</td>}
      <td><Badge tone={ABSENTEISMO_STATUS_TONE[r.status]}>{ABSENTEISMO_STATUS[r.status]}</Badge></td>
      <td style={{ textAlign: "center" }}>
        {r.emailStatus === "sent" && <Mail size={15} aria-label="Comunicado enviado" />}
        {r.emailStatus === "failed" && (
          <span title="O comunicado não pôde ser enviado" style={{ color: "var(--mh-danger)", display: "inline-flex" }}>
            <Mail size={15} />
          </span>
        )}
        {r.emailStatus === "skipped" && (
          <span title="Nenhum destinatário configurado" className="soft" style={{ display: "inline-flex" }}>
            <Mail size={15} />
          </span>
        )}
      </td>
      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        <span style={{ display: "inline-flex", gap: "0.3rem", alignItems: "center" }}>
          <button type="button" className="icon-btn" title="Ver" onClick={() => setAberto(r)}>
            <FileText size={15} />
          </button>
          {/* Botão com NOME, não ícone: efetivar é o passo central do fluxo, e
              escondê-lo num lápis fez parecer que o comunicado ia direto ao RH. */}
          {podeMexer(r) && (
            <button
              type="button" className="btn btn-primary btn-sm"
              onClick={() => { setErro(""); setConfirmando(r); }}
            >
              <Pencil size={14} /> Efetivar
            </button>
          )}
        </span>
      </td>
    </tr>
  );

  const tabela = (lista: AbsenteismoRow[], comAutor: boolean, vazio: string) =>
    lista.length === 0 ? (
      <EmptyState title="Nada por aqui" description={vazio} />
    ) : (
      <table className="table">
        <thead>
          <tr>
            <th>Colaborador</th>
            <th style={{ width: 110 }}>Faltou em</th>
            <th style={{ width: 190 }}>Motivo</th>
            <th style={{ width: 190 }}>Período</th>
            {comAutor && <th style={{ width: 170 }}>Lançado por</th>}
            <th style={{ width: 160 }}>Situação</th>
            <th style={{ width: 50, textAlign: "center" }} title="Comunicado por e-mail">
              <Mail size={14} />
            </th>
            <th style={{ width: 90 }}></th>
          </tr>
        </thead>
        <tbody>{lista.map((r) => linha(r, comAutor))}</tbody>
      </table>
    );

  const abas: Tab[] = [
    {
      id: "abertos", label: `Em aberto (${emAberto.length})`,
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
            Comunicados registrados, ainda sem definição. Nada daqui foi ao RH nem conta como
            ausência: quando a situação estiver confirmada (atestado em mãos, falta assumida),
            use <strong>Efetivar</strong> para informar o motivo, o período real e os documentos.
          </p>
          {tabela(emAberto, true, "Nenhum não comparecimento em aberto. Quando alguém não aparecer, lance por aqui.")}
        </div>
      ),
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

  const pessoaEscolhida = novo?.userId ? pessoaPorId.get(novo.userId) ?? null : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input" placeholder="Buscar por colaborador, motivo ou setor…"
          value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 340 }}
        />
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginLeft: "auto", flexWrap: "wrap" }}>
          {/* Sem CID nem médico na planilha: o arquivo sai do sistema e vai
              parar em pasta compartilhada, e-mail e pen drive. */}
          <ExportButton
            filename="absenteismos.xlsx"
            sheetName="Absenteísmos"
            headers={["Colaborador", "Matrícula", "Setor", "Função", "Unidade", "Faltou em", "Motivo", "Comportamento", "Início", "Término", "Desconta RV", "Situação", "Lançado por", "Decidido por", "Observação da decisão"]}
            rows={rows.map((r) => [
              r.fullName ?? "", r.employeeCode ?? "", r.departmentName ?? "", r.positionName ?? "",
              r.unitName ?? "", r.occurredOn, r.typeName ?? "",
              r.kind ? ABSENCE_KIND_LABEL[r.kind] : "",
              r.startDate ?? "", r.endDate ?? "",
              r.discountsRv === null ? "" : r.discountsRv ? "Sim" : "Não",
              ABSENTEISMO_STATUS[r.status], r.createdByName ?? "",
              r.decidedByName ?? "", r.decisionNote ?? "",
            ])}
          />
          <button
            type="button" className="btn btn-primary btn-sm"
            onClick={() => { setErro(""); setNovo({ userId: "", occurredOn: hoje(), reasonNote: "" }); }}
          >
            + Lançar não comparecimento
          </button>
        </div>
      </div>

      {erro && !novo && !confirmando && !aberto && (
        <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{erro}</p>
      )}

      <Tabs tabs={abas} />

      {/* ---------------- lançamento do não comparecimento ---------------- */}
      {novo && (
        <Dialogo titulo="Lançar não comparecimento" onFechar={() => setNovo(null)}>
          <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
            Use isto quando a pessoa não apareceu e o motivo ainda não é conhecido. O comunicado por
            e-mail sai na hora, para os endereços definidos em Configurações, e é só isso: nada vai
            ao RH agora. Quando a situação estiver confirmada, volte na aba Em aberto e use
            Efetivar, informando o motivo, o período real (que pode ser maior que um dia) e os
            documentos.
          </p>

          <div>
            <label className="label">Colaborador <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <PeoplePicker
              people={pessoas.map((p) => ({ id: p.id, name: p.name }))}
              selected={novo.userId ? [novo.userId] : []}
              onChange={(ids) => setNovo((n) => (n ? { ...n, userId: ids[0] ?? "" } : n))}
              placeholder="Buscar na sua equipe…"
              single
            />
          </div>

          {pessoaEscolhida && (
            <div style={{ border: "1px solid var(--border)", borderRadius: "var(--mh-radius-lg)", background: "var(--surface-2)", padding: "0.75rem" }}>
              <p className="soft" style={{ fontSize: "0.72rem", margin: "0 0 0.4rem" }}>
                Do cadastro do colaborador, congelado no lançamento.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.5rem 1rem" }}>
                <Campo rotulo="Matrícula" valor={pessoaEscolhida.matricula} />
                <Campo rotulo="Setor" valor={pessoaEscolhida.setor} />
                <Campo rotulo="Função" valor={pessoaEscolhida.funcao} />
                <Campo rotulo="Gestor imediato" valor={pessoaEscolhida.gestor} />
                <Campo rotulo="Unidade" valor={pessoaEscolhida.unidade} />
              </div>
            </div>
          )}

          <div style={{ maxWidth: 200 }}>
            <label className="label">Dia <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <input
              type="date" className="input" value={novo.occurredOn}
              onChange={(e) => setNovo((n) => (n ? { ...n, occurredOn: e.target.value } : n))}
            />
          </div>

          <div>
            <label className="label">O que se sabe até agora</label>
            <textarea
              className="input" rows={3} value={novo.reasonNote}
              placeholder="Ex.: não avisou nada até agora; avisou por mensagem que passaria no médico."
              onChange={(e) => setNovo((n) => (n ? { ...n, reasonNote: e.target.value } : n))}
            />
          </div>

          {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{erro}</p>}

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={pendente} onClick={lancar}>
              {pendente ? "Lançando…" : "Lançar e comunicar"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNovo(null)}>Cancelar</button>
          </div>
        </Dialogo>
      )}

      {/* ---------------- efetivação ---------------- */}
      {confirmando && (
        <Dialogo titulo="Efetivar o não comparecimento" onFechar={() => { setConfirmando(null); setErro(""); }}>
          <PainelConfirmacao
            linha={confirmando}
            tipos={tiposAtivos}
            kindsComRedutor={kindsComRedutor}
            onErro={setErro}
            erro={erro}
            onAbrirDocumento={abrirDocumento}
            onFechar={() => { setConfirmando(null); setErro(""); }}
          />
        </Dialogo>
      )}

      {/* ---------------- ficha ---------------- */}
      {aberto && (
        <Dialogo titulo="Absenteísmo" onFechar={() => { setAberto(null); setErro(""); }}>
          <Ficha
            linha={aberto}
            podeDecidir={podeDecidir}
            podeCancelarAprovado={podeCancelarAprovado}
            podeCancelarProprio={aberto.createdBy === meuId || podeDecidir}
            erro={erro}
            onErro={setErro}
            onAbrirDocumento={abrirDocumento}
            onEfetivar={podeMexer(aberto) ? () => { const r = aberto; setAberto(null); setErro(""); setConfirmando(r); } : undefined}
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

/** Fecha por X ou pelo botão, nunca por clique no fundo. */
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
      <div className="card" style={{ width: "100%", maxWidth: 760, boxShadow: "var(--mh-shadow-e3)" }}>
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

/**
 * O que a confirmação descobriu.
 *
 * As exigências vêm do tipo escolhido, e não da tela: escolher "Atestado" abre o
 * bloco clínico e trava o envio sem o documento.
 */
function PainelConfirmacao({
  linha, tipos, kindsComRedutor, erro, onErro, onAbrirDocumento, onFechar,
}: {
  linha: AbsenteismoRow;
  tipos: Tipo[];
  kindsComRedutor: Enums<"absence_kind">[];
  erro: string;
  onErro: (m: string) => void;
  onAbrirDocumento: (path: string) => void;
  onFechar: () => void;
}) {
  const [c, setC] = useState<Confirmacao>({
    absenceTypeId: linha.absenceTypeId ?? tipos[0]?.id ?? "",
    startDate: linha.startDate ?? linha.occurredOn,
    endDate: linha.endDate ?? linha.occurredOn,
    note: linha.note ?? "",
    cid: "", cidDescricao: "", medico: "", crm: "", local: "", emitidoEm: "", dias: "",
  });
  const [temDoc, setTemDoc] = useState(Boolean(linha.docPath));
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const tipo = tipos.find((t) => t.id === c.absenceTypeId) ?? null;

  // O dado clínico já gravado vem pela RPC, uma vez, ao abrir. Não viaja na
  // listagem justamente para isso.
  useEffect(() => {
    if (!linha.requiresMedical) return;
    let vivo = true;
    getAtestado(linha.id).then((a: AtestadoLido | null) => {
      if (!vivo || !a) return;
      setC((x) => ({
        ...x,
        cid: a.cid ?? "", cidDescricao: a.cidDescricao ?? "",
        medico: a.medico ?? "", crm: a.crm ?? "", local: a.local ?? "",
        emitidoEm: a.emitidoEm ?? "", dias: a.diasAfastamento?.toString() ?? "",
      }));
    });
    return () => { vivo = false; };
  }, [linha.id, linha.requiresMedical]);

  const salvar = (depois?: () => void) => {
    onErro("");
    iniciar(async () => {
      const r = await salvarConfirmacao({
        id: linha.id,
        absenceTypeId: c.absenceTypeId,
        startDate: c.startDate,
        endDate: c.endDate,
        note: c.note,
        atestado: tipo?.requiresMedical ? {
          cid: c.cid, cidDescricao: c.cidDescricao, medico: c.medico, crm: c.crm,
          local: c.local, emitidoEm: c.emitidoEm, dias: c.dias,
        } : undefined,
      });
      if (r.error) { onErro(r.error); return; }
      router.refresh();
      if (depois) depois();
    });
  };

  const enviar = async () => {
    const ok = await confirmDialog({
      title: "Enviar ao RH",
      confirmLabel: "Enviar",
      message: "Depois de enviado o lançamento fica congelado até o RH decidir. Para corrigir algo, será preciso pedir a reprovação.",
    });
    if (!ok) return;
    onErro("");
    iniciar(async () => {
      // salva antes de enviar: a RPC valida o que está GRAVADO, não o que está
      // na tela, e o gestor não deveria descobrir isso por uma mensagem estranha
      const s = await salvarConfirmacao({
        id: linha.id,
        absenceTypeId: c.absenceTypeId,
        startDate: c.startDate,
        endDate: c.endDate,
        note: c.note,
        atestado: tipo?.requiresMedical ? {
          cid: c.cid, cidDescricao: c.cidDescricao, medico: c.medico, crm: c.crm,
          local: c.local, emitidoEm: c.emitidoEm, dias: c.dias,
        } : undefined,
      });
      if (s.error) { onErro(s.error); return; }

      const fd = new FormData();
      fd.set("id", linha.id);
      const r = await confirmarAbsenteismo(fd);
      if (r.error) { onErro(r.error); return; }
      onFechar();
      router.refresh();
    });
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.6rem 1rem" }}>
        <Campo rotulo="Colaborador" valor={linha.fullName} />
        <Campo rotulo="Faltou em" valor={formatDate(linha.occurredOn)} />
        <Campo rotulo="Setor" valor={linha.departmentName} />
        <Campo rotulo="Função" valor={linha.positionName} />
      </div>
      {linha.reasonNote && <Campo rotulo="O que se sabia no lançamento" valor={linha.reasonNote} />}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.8rem" }}>
        <div style={{ gridColumn: "span 2", minWidth: 0 }}>
          <label className="label">Motivo <span style={{ color: "var(--mh-danger)" }}>*</span></label>
          <select
            className="select" value={c.absenceTypeId}
            onChange={(e) => setC((x) => ({ ...x, absenceTypeId: e.target.value }))}
          >
            {tipos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {tipo && (
            <div style={{ marginTop: "0.4rem", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <Badge tone={ABSENCE_KIND_TONE[tipo.kind]}>{ABSENCE_KIND_LABEL[tipo.kind]}</Badge>
              {tipo.description && (
                <span className="soft" style={{ fontSize: "0.78rem" }}>{tipo.description}</span>
              )}
            </div>
          )}
        </div>
        <div>
          <label className="label">Início <span style={{ color: "var(--mh-danger)" }}>*</span></label>
          <input
            type="date" className="input" value={c.startDate}
            onChange={(e) => setC((x) => ({ ...x, startDate: e.target.value }))}
          />
        </div>
        <div>
          <label className="label">Término <span style={{ color: "var(--mh-danger)" }}>*</span></label>
          <input
            type="date" className="input" value={c.endDate}
            onChange={(e) => setC((x) => ({ ...x, endDate: e.target.value }))}
          />
        </div>
      </div>

      {/* O efeito na remuneração variável é POLÍTICA do tipo, definida em
          Configurações, e não escolha de quem lança: se cada gestor marcasse
          por conta, o mesmo atestado descontaria numa equipe e não na outra.
          Aqui a tela só INFORMA o que vai acontecer. */}
      {tipo && (
        <p className="soft" style={{ fontSize: "0.78rem", margin: 0, background: "var(--surface-2)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
          {kindsComRedutor.includes(tipo.kind)
            ? <>Efeito na remuneração variável: este motivo já entra no <strong>redutor por faixa de dias</strong> configurado em Remuneração variável. Para não descontar duas vezes o mesmo dia, os dias do período não são descontados de novo na proporcionalidade.</>
            : tipo.discountsRvDefault
              ? <>Efeito na remuneração variável: os dias do período <strong>descontam proporcionalmente</strong> o valor do mês, conforme definido para este tipo em Configurações.</>
              : <>Efeito na remuneração variável: <strong>nenhum</strong>, conforme definido para este tipo em Configurações.</>}
        </p>
      )}

      {tipo?.requiresMedical && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--mh-radius-lg)", background: "var(--surface-2)", padding: "0.9rem" }}>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginBottom: "0.3rem" }}>
            <Stethoscope size={15} />
            <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Dados do atestado</span>
          </div>
          <p className="soft" style={{ fontSize: "0.74rem", margin: "0 0 0.7rem" }}>
            Ficam guardados à parte, com acesso restrito a você e ao RH. Não saem em e-mail, não
            entram na planilha exportada e não aparecem em Logs do sistema.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.8rem" }}>
            <div>
              <label className="label">CID <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <input
                className="input" value={c.cid} placeholder="J11"
                onChange={(e) => setC((x) => ({ ...x, cid: e.target.value }))}
              />
            </div>
            <div style={{ gridColumn: "span 2", minWidth: 0 }}>
              <label className="label">Descrição do CID</label>
              <input
                className="input" value={c.cidDescricao} placeholder="Influenza"
                onChange={(e) => setC((x) => ({ ...x, cidDescricao: e.target.value }))}
              />
            </div>
            <div style={{ gridColumn: "span 2", minWidth: 0 }}>
              <label className="label">Profissional <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <input
                className="input" value={c.medico} placeholder="Dra. Marina Alves"
                onChange={(e) => setC((x) => ({ ...x, medico: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">CRM ou registro</label>
              <input
                className="input" value={c.crm} placeholder="CRM-BA 12345"
                onChange={(e) => setC((x) => ({ ...x, crm: e.target.value }))}
              />
            </div>
            <div style={{ gridColumn: "span 2", minWidth: 0 }}>
              <label className="label">Hospital, clínica ou local</label>
              <input
                className="input" value={c.local} placeholder="Hospital Santa Izabel"
                onChange={(e) => setC((x) => ({ ...x, local: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Emitido em <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <input
                type="date" className="input" value={c.emitidoEm}
                onChange={(e) => setC((x) => ({ ...x, emitidoEm: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Dias de afastamento</label>
              <input
                type="number" min={0} className="input" value={c.dias}
                onChange={(e) => setC((x) => ({ ...x, dias: e.target.value }))}
              />
            </div>
          </div>
        </div>
      )}

      {/* O anexo aparece para QUALQUER tipo: uma falta pode ter o print da
          conversa em que o colaborador a assume. O que o catálogo controla é a
          obrigatoriedade, não a possibilidade. */}
      <Anexo
        linha={linha}
        obrigatorio={Boolean(tipo?.requiresDocument)}
        temDoc={temDoc}
        onMudou={(v) => setTemDoc(v)}
        onErro={onErro}
        onAbrir={onAbrirDocumento}
      />

      <div>
        <label className="label">Observação</label>
        <textarea
          className="input" rows={2} value={c.note}
          placeholder="O que o RH precisa saber para conferir."
          onChange={(e) => setC((x) => ({ ...x, note: e.target.value }))}
        />
      </div>

      {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{erro}</p>}

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-ghost btn-sm" disabled={pendente} onClick={() => salvar()}>
          {pendente ? "Salvando…" : "Salvar sem enviar"}
        </button>
        <button
          type="button" className="btn btn-primary btn-sm"
          disabled={pendente || (Boolean(tipo?.requiresDocument) && !temDoc)}
          title={tipo?.requiresDocument && !temDoc ? "Anexe o documento primeiro" : undefined}
          onClick={enviar}
        >
          <Send size={15} /> Enviar ao RH
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onFechar}>Fechar</button>
      </div>

      <p className="soft" style={{ fontSize: "0.75rem", margin: 0 }}>
        Enquanto o RH não aprovar, este lançamento não conta como ausência e não altera
        remuneração variável.
      </p>
    </>
  );
}

function Anexo({
  linha, obrigatorio, temDoc, onMudou, onErro, onAbrir,
}: {
  linha: AbsenteismoRow;
  obrigatorio: boolean;
  temDoc: boolean;
  onMudou: (v: boolean) => void;
  onErro: (m: string) => void;
  onAbrir: (path: string) => void;
}) {
  const [enviando, iniciar] = useTransition();
  const [nome, setNome] = useState(linha.docFilename);
  const router = useRouter();

  const subir = (file: File) => {
    onErro("");
    const fd = new FormData();
    fd.set("id", linha.id);
    fd.set("file", file);
    iniciar(async () => {
      const r = await anexarDocumentoAbsenteismo(fd);
      if (r.error) { onErro(r.error); return; }
      setNome(file.name);
      onMudou(true);
      router.refresh();
    });
  };

  const remover = () => {
    const fd = new FormData();
    fd.set("id", linha.id);
    iniciar(async () => {
      const r = await removerDocumentoAbsenteismo(fd);
      if (r.error) { onErro(r.error); return; }
      onMudou(false);
      router.refresh();
    });
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--mh-radius-lg)", padding: "0.75rem" }}>
      <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.3rem" }}>
        Documento comprobatório
        {obrigatorio
          ? <span style={{ color: "var(--mh-danger)" }}> *</span>
          : <span className="soft" style={{ fontWeight: 400 }}> (opcional)</span>}
      </div>
      <p className="soft" style={{ fontSize: "0.75rem", margin: "0 0 0.6rem" }}>
        O atestado digitalizado ou, no caso de falta, um comprovante como o print da conversa em
        que o colaborador confirma. PDF ou foto, até 10 MB. Fica em área restrita, e só quem pode
        ver este lançamento consegue abrir.
      </p>
      {temDoc && linha.docPath ? (
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAbrir(linha.docPath as string)}>
            <Paperclip size={15} /> {nome ?? "Ver documento"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={enviando} onClick={remover}>
            Remover
          </button>
        </div>
      ) : (
        <input
          type="file" className="input" disabled={enviando}
          accept="application/pdf,image/*"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f); e.target.value = ""; }}
        />
      )}
      {enviando && <p className="soft" style={{ fontSize: "0.75rem", margin: "0.4rem 0 0" }}>Enviando…</p>}
    </div>
  );
}

/** A ficha completa, com a decisão do RH quando for o caso. */
function Ficha({
  linha, podeDecidir, podeCancelarAprovado, podeCancelarProprio, erro, onErro, onAbrirDocumento, onEfetivar, onFechar,
}: {
  linha: AbsenteismoRow;
  podeDecidir: boolean;
  podeCancelarAprovado: boolean;
  podeCancelarProprio: boolean;
  erro: string;
  onErro: (m: string) => void;
  onAbrirDocumento: (path: string) => void;
  /** presente quando o lançamento ainda pode ser efetivado por quem está olhando */
  onEfetivar?: () => void;
  onFechar: () => void;
}) {
  const [medico, setMedico] = useState<AtestadoLido | null>(null);
  const [verMedico, setVerMedico] = useState(false);
  const [motivo, setMotivo] = useState("");
  // separado de `erro` porque o reenvio bem-sucedido é notícia boa, e notícia
  // boa em vermelho faz a pessoa achar que quebrou
  const [avisoEmail, setAvisoEmail] = useState("");
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const abrirMedico = async () => {
    setVerMedico(true);
    if (!medico) setMedico(await getAtestado(linha.id));
  };

  const decidir = (aprovar: boolean) => {
    onErro("");
    const fd = new FormData();
    fd.set("id", linha.id);
    fd.set("aprovar", aprovar ? "1" : "0");
    fd.set("nota", motivo);
    iniciar(async () => {
      const r = await decidirAbsenteismo(fd);
      if (r.error) { onErro(r.error); return; }
      onFechar();
      router.refresh();
    });
  };

  const aprovar = async () => {
    const ok = await confirmDialog({
      title: "Aprovar absenteísmo",
      confirmLabel: "Aprovar",
      message: `Aprovar ${(linha.typeName ?? "a ausência").toLowerCase()} de ${linha.fullName ?? "colaborador"}? A partir daqui ela passa a valer e entra no cálculo da remuneração variável do período.`,
    });
    if (ok) decidir(true);
  };

  const reprovar = () => {
    if (!motivo.trim()) { onErro("Informe o motivo da reprovação."); return; }
    decidir(false);
  };

  const cancelar = async () => {
    if (!motivo.trim()) { onErro("Informe o motivo do cancelamento."); return; }
    const ok = await confirmDialog({
      title: "Cancelar lançamento",
      tone: "danger",
      confirmLabel: "Cancelar o lançamento",
      message: linha.status === "aprovado"
        ? `Cancelar ${(linha.typeName ?? "a ausência").toLowerCase()} de ${linha.fullName ?? "colaborador"}? Ela deixa de contar para a remuneração variável, e o lançamento fica registrado como cancelado.`
        : "O lançamento fica registrado como cancelado. O comunicado já enviado não é apagado.",
    });
    if (!ok) return;
    onErro("");
    const fd = new FormData();
    fd.set("id", linha.id);
    fd.set("nota", motivo);
    iniciar(async () => {
      const r = await cancelarAbsenteismo(fd);
      if (r.error) { onErro(r.error); return; }
      onFechar();
      router.refresh();
    });
  };

  const decidindo = podeDecidir && linha.status === "pendente";
  const cancelandoAprovado = podeCancelarAprovado && linha.status === "aprovado";
  const cancelandoAberto = podeCancelarProprio && (linha.status === "aberto" || linha.status === "reprovado");

  return (
    <>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <Badge tone={ABSENTEISMO_STATUS_TONE[linha.status]}>{ABSENTEISMO_STATUS[linha.status]}</Badge>
        {linha.kind && <Badge tone={ABSENCE_KIND_TONE[linha.kind]}>{ABSENCE_KIND_LABEL[linha.kind]}</Badge>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.6rem 1rem" }}>
        <Campo rotulo="Colaborador" valor={linha.fullName} />
        <Campo rotulo="Matrícula" valor={linha.employeeCode} />
        <Campo rotulo="Setor" valor={linha.departmentName} />
        <Campo rotulo="Subsetor" valor={linha.subdepartmentName} />
        <Campo rotulo="Função" valor={linha.positionName} />
        <Campo rotulo="Gestor imediato" valor={linha.managerName} />
        <Campo rotulo="Unidade" valor={linha.unitName} />
        <Campo rotulo="Faltou em" valor={formatDate(linha.occurredOn)} />
      </div>

      {linha.reasonNote && <Campo rotulo="O que se sabia no lançamento" valor={linha.reasonNote} />}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.6rem 1rem" }}>
        <Campo rotulo="Motivo" valor={linha.typeName} />
        <Campo
          rotulo="Período"
          valor={linha.startDate && linha.endDate ? `${formatDate(linha.startDate)} a ${formatDate(linha.endDate)}` : null}
        />
        <Campo
          rotulo="Desconta remuneração variável"
          valor={linha.discountsRv === null ? null : linha.discountsRv ? "Sim" : "Não"}
        />
      </div>
      {linha.note && <Campo rotulo="Observação" valor={linha.note} />}

      {/* O dado clínico não vem na lista: quem quiser ver pede, e a leitura passa
          pela RPC que confere a alçada. */}
      {linha.requiresMedical && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--mh-radius-lg)", padding: "0.75rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <span style={{ display: "flex", gap: "0.4rem", alignItems: "center", fontSize: "0.85rem", fontWeight: 600 }}>
              <Stethoscope size={15} /> Dados do atestado
            </span>
            {!verMedico && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={abrirMedico}>Mostrar</button>
            )}
          </div>
          {verMedico && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.6rem 1rem", marginTop: "0.7rem" }}>
              <Campo rotulo="CID" valor={medico?.cid ?? null} />
              <Campo rotulo="Descrição" valor={medico?.cidDescricao ?? null} />
              <Campo rotulo="Profissional" valor={medico?.medico ?? null} />
              <Campo rotulo="CRM ou registro" valor={medico?.crm ?? null} />
              <Campo rotulo="Local" valor={medico?.local ?? null} />
              <Campo rotulo="Emitido em" valor={medico?.emitidoEm ? formatDate(medico.emitidoEm) : null} />
              <Campo rotulo="Dias de afastamento" valor={medico?.diasAfastamento?.toString() ?? null} />
            </div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.6rem 1rem" }}>
        <Campo rotulo="Lançado por" valor={linha.createdByName} />
        <Campo rotulo="Enviado ao RH em" valor={linha.submittedAt ? formatDate(linha.submittedAt) : null} />
        <Campo rotulo="Decidido por" valor={linha.decidedByName} />
        <Campo rotulo="Decidido em" valor={linha.decidedAt ? formatDate(linha.decidedAt) : null} />
      </div>
      {linha.decisionNote && <Campo rotulo="Motivo da decisão" valor={linha.decisionNote} />}
      {linha.cancelNote && <Campo rotulo="Motivo do cancelamento" valor={linha.cancelNote} />}

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        {onEfetivar && (
          <button type="button" className="btn btn-primary btn-sm" onClick={onEfetivar}>
            <Pencil size={15} /> Efetivar
          </button>
        )}
        {linha.docPath && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAbrirDocumento(linha.docPath as string)}>
            <Paperclip size={15} /> {linha.docFilename ?? "Documento"}
          </button>
        )}
        {linha.emailStatus && (
          <span className="soft" style={{ fontSize: "0.78rem", display: "inline-flex", gap: "0.3rem", alignItems: "center" }}>
            <Mail size={14} />
            {linha.emailStatus === "sent" && `Comunicado enviado${linha.emailAt ? " em " + formatDate(linha.emailAt) : ""}`}
            {linha.emailStatus === "failed" && "O comunicado não pôde ser enviado"}
            {linha.emailStatus === "skipped" && "Sem destinatário configurado, nenhum comunicado saiu"}
          </span>
        )}
        {/* Sem fila e sem retry automático, reenviar é a única recuperação. */}
        <button
          type="button" className="btn btn-ghost btn-sm" disabled={pendente}
          onClick={() => {
            onErro("");
            setAvisoEmail("");
            const fd = new FormData();
            fd.set("id", linha.id);
            iniciar(async () => {
              const r = await reenviarComunicado(fd);
              if (r.error) { onErro(r.error); return; }
              setAvisoEmail(r.warning ?? r.message ?? "");
              router.refresh();
            });
          }}
        >
          <Mail size={15} /> Reenviar comunicado
        </button>
      </div>
      {avisoEmail && (
        <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>{avisoEmail}</p>
      )}

      {(decidindo || cancelandoAprovado || cancelandoAberto) && (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          <div>
            <label className="label">
              {decidindo ? "Motivo da reprovação" : "Motivo do cancelamento"}
              <span className="soft" style={{ fontWeight: 400 }}> (obrigatório)</span>
            </label>
            <textarea
              className="input" rows={2} value={motivo}
              placeholder={decidindo
                ? "O que o gestor precisa corrigir antes de reenviar."
                : "Por que este lançamento deixou de valer."}
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
            {(cancelandoAprovado || cancelandoAberto) && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={pendente} onClick={cancelar}>
                <Ban size={15} /> Cancelar o lançamento
              </button>
            )}
          </div>
        </div>
      )}

      {erro && !decidindo && !cancelandoAprovado && !cancelandoAberto && (
        <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{erro}</p>
      )}
    </>
  );
}
