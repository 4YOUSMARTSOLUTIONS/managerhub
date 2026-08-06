"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { PeoplePicker } from "@/components/PeoplePicker";
import { Badge } from "@/components/ui/Badge";
import { ExportButton } from "@/components/ui/ExportButton";
import { ImportAbsencesDialog } from "@/components/ImportAbsencesDialog";
import { confirmDialog } from "@/components/ui/confirm";
import { upsertAbsence, deleteAbsence } from "@/lib/actions/absences";
import { ABSENCE_KIND_LABEL, ABSENCE_KIND_TONE, ABSENCE_DESCONTA_PADRAO } from "@/lib/constants";
import { formatDate, normalizar } from "@/lib/format";
import { contarDias } from "@/lib/rv-proporcional";
import type { Enums } from "@/types/database";

/**
 * Férias e afastamentos, em Configurações.
 *
 * Não é só cadastro de RH: é daqui que sai o recorte de dias que torna a
 * remuneração variável do mês proporcional. Por isso o formulário mostra, em
 * texto, quantos dias o período cobre, e a lista deixa explícito quais
 * lançamentos descontam.
 *
 * Painel em linha em vez de modal, no mesmo espírito de `RvConfigEditor`: o
 * formulário é curto e a lista atrás dele é a referência de quem já tem período
 * lançado.
 */

export type AbsenceRow = {
  id: string;
  userId: string;
  kind: Enums<"absence_kind">;
  startDate: string;
  endDate: string;
  discountsRv: boolean;
  note: string | null;
};

const TIPOS: Enums<"absence_kind">[] = ["ferias", "licenca", "afastamento", "atestado"];
const hoje = () => new Date().toISOString().slice(0, 10);

type Rascunho = {
  id?: string;
  userId: string;
  kind: Enums<"absence_kind">;
  startDate: string;
  endDate: string;
  discountsRv: boolean;
  note: string;
};

const novo = (): Rascunho => ({
  userId: "",
  kind: "ferias",
  startDate: hoje(),
  endDate: hoje(),
  discountsRv: ABSENCE_DESCONTA_PADRAO.ferias,
  note: "",
});

export function AbsencesManager({ members, absences }: { members: { id: string; name: string }[]; absences: AbsenceRow[] }) {
  const [busca, setBusca] = useState("");
  const [ano, setAno] = useState("");
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const nomePorId = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);

  // anos com lançamento: um período de dezembro a janeiro aparece nos dois
  const anos = useMemo(() => {
    const s = new Set<string>();
    for (const a of absences) { s.add(a.startDate.slice(0, 4)); s.add(a.endDate.slice(0, 4)); }
    return [...s].sort((x, y) => y.localeCompare(x));
  }, [absences]);

  const termo = normalizar(busca.trim());
  const lista = useMemo(() => {
    return absences
      .filter((a) => !termo || normalizar(nomePorId.get(a.userId) ?? "").includes(termo))
      .filter((a) => !ano || a.startDate.slice(0, 4) === ano || a.endDate.slice(0, 4) === ano)
      .sort((a, b) => b.startDate.localeCompare(a.startDate) || (nomePorId.get(a.userId) ?? "").localeCompare(nomePorId.get(b.userId) ?? "", "pt-BR"));
  }, [absences, termo, ano, nomePorId]);

  const abrirNovo = () => { setErro(""); setRascunho(novo()); };
  const abrirEdicao = (a: AbsenceRow) => {
    setErro("");
    setRascunho({ id: a.id, userId: a.userId, kind: a.kind, startDate: a.startDate, endDate: a.endDate, discountsRv: a.discountsRv, note: a.note ?? "" });
  };

  // trocar o tipo reposiciona a marcação no padrão daquele tipo, e ela continua
  // editável: quem quiser um atestado que desconte só desmarca de volta
  const trocarTipo = (kind: Enums<"absence_kind">) =>
    setRascunho((r) => (r ? { ...r, kind, discountsRv: ABSENCE_DESCONTA_PADRAO[kind] } : r));

  const salvar = () => {
    if (!rascunho) return;
    setErro("");
    if (!rascunho.userId) { setErro("Escolha o colaborador."); return; }
    if (!rascunho.startDate || !rascunho.endDate) { setErro("Informe as datas de início e de fim."); return; }
    if (rascunho.endDate < rascunho.startDate) { setErro("A data de fim não pode ser anterior à de início."); return; }
    iniciar(async () => {
      const res = await upsertAbsence({
        id: rascunho.id,
        user_id: rascunho.userId,
        kind: rascunho.kind,
        start_date: rascunho.startDate,
        end_date: rascunho.endDate,
        discounts_rv: rascunho.discountsRv,
        note: rascunho.note,
      });
      if (res.error) { setErro(res.error); return; }
      setRascunho(null);
      router.refresh();
    });
  };

  const remover = async (a: AbsenceRow) => {
    const quem = nomePorId.get(a.userId) ?? "este colaborador";
    const ok = await confirmDialog({
      tone: "danger",
      confirmLabel: "Excluir",
      message: `Excluir o período de ${ABSENCE_KIND_LABEL[a.kind].toLowerCase()} de ${quem}? A remuneração variável dos meses afetados volta ao valor cheio.`,
    });
    if (!ok) return;
    iniciar(async () => { await deleteAbsence(a.id); router.refresh(); });
  };

  const dias = rascunho ? contarDias(rascunho.startDate, rascunho.endDate) : 0;

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: "0 0 0.2rem" }}>Férias e afastamentos</h3>
        <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
          Períodos em que o colaborador não trabalhou. Quando o lançamento <strong>desconta</strong>, a remuneração
          variável dos meses atingidos passa a ser proporcional aos dias trabalhados, em dias corridos. Julho tem 31
          dias: quem saiu de férias no dia 16 recebe 15/31 do valor.
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <input className="input" placeholder="Buscar colaborador…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 300 }} />
        <select className="select" value={ano} onChange={(e) => setAno(e.target.value)} style={{ maxWidth: 150 }}>
          <option value="">Todos os anos</option>
          {anos.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginLeft: "auto", flexWrap: "wrap" }}>
          <ImportAbsencesDialog members={members} />
          {/* exporta o que está EM VISTA, e no mesmo formato que a importação lê:
              dá para exportar, corrigir na planilha e reimportar por cima */}
          <ExportButton
            filename="ferias_e_afastamentos.xlsx"
            sheetName="Ausências"
            headers={["Colaborador", "Tipo", "Início", "Fim", "Desconta RV", "Observação"]}
            rows={lista.map((a) => [
              nomePorId.get(a.userId) ?? "",
              ABSENCE_KIND_LABEL[a.kind],
              formatDate(a.startDate),
              formatDate(a.endDate),
              a.discountsRv ? "Sim" : "Não",
              a.note ?? "",
            ])}
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={abrirNovo}>
            + Lançar período
          </button>
        </div>
      </div>

      {rascunho && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--mh-radius-lg)", background: "var(--surface-2)", padding: "0.9rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0.8rem" }}>
            <div style={{ gridColumn: "1 / -1", maxWidth: 380 }}>
              <label className="label">Colaborador</label>
              <PeoplePicker
                people={members}
                selected={rascunho.userId ? [rascunho.userId] : []}
                onChange={(ids) => setRascunho((r) => (r ? { ...r, userId: ids[0] ?? "" } : r))}
                single
                placeholder="Buscar colaborador…"
              />
            </div>
            <div>
              <label className="label">Tipo</label>
              <select className="select" value={rascunho.kind} onChange={(e) => trocarTipo(e.target.value as Enums<"absence_kind">)}>
                {TIPOS.map((t) => <option key={t} value={t}>{ABSENCE_KIND_LABEL[t]}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Início</label>
              <input type="date" className="input" value={rascunho.startDate} onChange={(e) => setRascunho((r) => (r ? { ...r, startDate: e.target.value } : r))} />
            </div>
            <div>
              <label className="label">Fim</label>
              <input type="date" className="input" value={rascunho.endDate} onChange={(e) => setRascunho((r) => (r ? { ...r, endDate: e.target.value } : r))} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="label">Observação (opcional)</label>
              <input className="input" value={rascunho.note} onChange={(e) => setRascunho((r) => (r ? { ...r, note: e.target.value } : r))} placeholder="Ex.: 1º período aquisitivo" />
            </div>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.8rem", fontSize: "0.85rem" }}>
            <input type="checkbox" checked={rascunho.discountsRv} onChange={(e) => setRascunho((r) => (r ? { ...r, discountsRv: e.target.checked } : r))} />
            Desconta da remuneração variável
          </label>

          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.9rem", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={pendente} onClick={salvar}>{pendente ? "Salvando…" : "Salvar"}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRascunho(null)}>Cancelar</button>
            {dias > 0 && <span className="soft" style={{ fontSize: "0.78rem" }}>{dias} dia(s) no período</span>}
            {erro && <span style={{ color: "var(--mh-danger)", fontSize: "0.8rem" }}>{erro}</span>}
          </div>
        </div>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Colaborador</th>
            <th>Tipo</th>
            <th>Período</th>
            <th style={{ textAlign: "right" }}>Dias</th>
            <th>Remuneração variável</th>
            <th style={{ textAlign: "right" }}></th>
          </tr>
        </thead>
        <tbody>
          {lista.length === 0 ? (
            <tr>
              <td colSpan={6} className="soft" style={{ textAlign: "center", padding: "1rem" }}>
                {absences.length === 0 ? "Nenhum período lançado ainda." : "Nenhum período com esse filtro."}
              </td>
            </tr>
          ) : lista.map((a) => (
            <tr key={a.id}>
              <td style={{ fontWeight: 600 }}>
                {nomePorId.get(a.userId) ?? "—"}
                {a.note && <div className="soft" style={{ fontSize: "0.72rem", fontWeight: 400 }}>{a.note}</div>}
              </td>
              <td><Badge tone={ABSENCE_KIND_TONE[a.kind]}>{ABSENCE_KIND_LABEL[a.kind]}</Badge></td>
              <td style={{ whiteSpace: "nowrap" }}>{formatDate(a.startDate)} a {formatDate(a.endDate)}</td>
              <td style={{ textAlign: "right" }}>{contarDias(a.startDate, a.endDate)}</td>
              <td>
                {a.discountsRv
                  ? <span style={{ fontSize: "0.8rem" }}>Proporcional aos dias trabalhados</span>
                  : <span className="soft" style={{ fontSize: "0.8rem" }}>Valor cheio, sem desconto</span>}
              </td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <button type="button" className="icon-btn" title="Editar" disabled={pendente} onClick={() => abrirEdicao(a)}>
                  <Pencil size={14} />
                </button>
                <button type="button" className="icon-btn icon-btn-danger" title="Excluir" disabled={pendente} onClick={() => remover(a)}>
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
