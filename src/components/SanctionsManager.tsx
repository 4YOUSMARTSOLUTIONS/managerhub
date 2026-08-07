"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { PeoplePicker } from "@/components/PeoplePicker";
import { confirmDialog } from "@/components/ui/confirm";
import { upsertSanction, deleteSanction } from "@/lib/actions/rv-redutores";
import { formatDate, normalizar } from "@/lib/format";

/**
 * Punições aplicadas ao colaborador.
 *
 * Mesmo molde de `AbsencesManager`, e pelo mesmo motivo: é cadastro de RH que
 * alimenta o cálculo da remuneração variável, então o formulário fica em linha,
 * acima da lista, e a lista serve de referência do que já foi lançado.
 *
 * O que uma punição corta não se decide aqui: quem decide é o motivo cadastrado
 * em Configurações → Remuneração variável → Redutores. Sem motivo apontando para
 * punição, registrar aqui não muda valor nenhum, e isso é dito na tela.
 */

export type SanctionRow = {
  id: string;
  userId: string;
  typeId: string;
  typeName: string;
  occurredOn: string;
  note: string | null;
};

type Rascunho = { id?: string; userId: string; typeId: string; occurredOn: string; note: string };

const hoje = () => new Date().toISOString().slice(0, 10);

export function SanctionsManager({
  members, types, sanctions, cortaRv, canEdit = true,
}: {
  members: { id: string; name: string }[];
  types: { id: string; name: string; active: boolean }[];
  sanctions: SanctionRow[];
  /** existe motivo ativo apontando para punição? Se não, o registro não corta nada. */
  cortaRv: boolean;
  canEdit?: boolean;
}) {
  const [busca, setBusca] = useState("");
  const [ano, setAno] = useState("");
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const nomePorId = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);
  const anos = useMemo(() => [...new Set(sanctions.map((s) => s.occurredOn.slice(0, 4)))].sort((a, b) => b.localeCompare(a)), [sanctions]);

  const termo = normalizar(busca.trim());
  const lista = useMemo(() => sanctions
    .filter((s) => !termo || normalizar(nomePorId.get(s.userId) ?? "").includes(termo))
    .filter((s) => !ano || s.occurredOn.slice(0, 4) === ano)
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn)), [sanctions, termo, ano, nomePorId]);

  const ativos = types.filter((t) => t.active);

  const abrirNovo = () => {
    setErro("");
    setRascunho({ userId: "", typeId: ativos[0]?.id ?? "", occurredOn: hoje(), note: "" });
  };
  const abrirEdicao = (s: SanctionRow) => {
    setErro("");
    setRascunho({ id: s.id, userId: s.userId, typeId: s.typeId, occurredOn: s.occurredOn, note: s.note ?? "" });
  };

  const salvar = () => {
    if (!rascunho) return;
    setErro("");
    iniciar(async () => {
      const res = await upsertSanction({
        id: rascunho.id,
        user_id: rascunho.userId,
        sanction_type_id: rascunho.typeId,
        occurred_on: rascunho.occurredOn,
        note: rascunho.note,
      });
      if (res.error) { setErro(res.error); return; }
      setRascunho(null);
      router.refresh();
    });
  };

  const remover = async (s: SanctionRow) => {
    const quem = nomePorId.get(s.userId) ?? "este colaborador";
    const ok = await confirmDialog({
      tone: "danger",
      confirmLabel: "Excluir",
      message: `Excluir a ${s.typeName.toLowerCase()} de ${quem}? A remuneração variável do mês volta ao valor sem este corte.`,
    });
    if (!ok) return;
    iniciar(async () => { await deleteSanction(s.id); router.refresh(); });
  };

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: "0 0 0.2rem" }}>Punições</h3>
        <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
          Advertências, suspensões e demais sanções previstas nas regras da empresa.
          {cortaRv
            ? " Quanto cada uma reduz da remuneração variável do mês está em Remuneração variável › Redutores."
            : " Nenhum motivo de redução aponta para punição hoje, então registrar aqui não altera valor nenhum."}
        </p>
      </div>

      {ativos.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>
          Cadastre os tipos de punição primeiro, em Remuneração variável › Tipos de punição.
        </p>
      ) : (
        <>
          <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
            <input className="input" placeholder="Buscar colaborador…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 300 }} />
            <select className="select" value={ano} onChange={(e) => setAno(e.target.value)} style={{ maxWidth: 150 }}>
              <option value="">Todos os anos</option>
              {anos.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            {canEdit && (
              <button type="button" className="btn btn-primary btn-sm" style={{ marginLeft: "auto" }} onClick={abrirNovo}>
                + Registrar punição
              </button>
            )}
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
                  <select className="select" value={rascunho.typeId} onChange={(e) => setRascunho((r) => (r ? { ...r, typeId: e.target.value } : r))}>
                    {ativos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Data</label>
                  <input type="date" className="input" value={rascunho.occurredOn} onChange={(e) => setRascunho((r) => (r ? { ...r, occurredOn: e.target.value } : r))} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label className="label">Observação (opcional)</label>
                  <input className="input" value={rascunho.note} onChange={(e) => setRascunho((r) => (r ? { ...r, note: e.target.value } : r))} placeholder="Ex.: nº do documento" />
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.9rem", flexWrap: "wrap" }}>
                <button type="button" className="btn btn-primary btn-sm" disabled={pendente} onClick={salvar}>{pendente ? "Salvando…" : "Salvar"}</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRascunho(null)}>Cancelar</button>
                {erro && <span style={{ color: "var(--mh-danger)", fontSize: "0.8rem" }}>{erro}</span>}
              </div>
            </div>
          )}

          <table className="table">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th>Tipo</th>
                <th>Data</th>
                {canEdit && <th style={{ textAlign: "right" }}></th>}
              </tr>
            </thead>
            <tbody>
              {lista.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 4 : 3} className="soft" style={{ textAlign: "center", padding: "1rem" }}>
                    {sanctions.length === 0 ? "Nenhuma punição registrada." : "Nenhuma punição com esse filtro."}
                  </td>
                </tr>
              ) : lista.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>
                    {nomePorId.get(s.userId) ?? "—"}
                    {s.note && <div className="soft" style={{ fontSize: "0.72rem", fontWeight: 400 }}>{s.note}</div>}
                  </td>
                  <td className="muted">{s.typeName}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{formatDate(s.occurredOn)}</td>
                  {canEdit && (
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button type="button" className="icon-btn" title="Editar" disabled={pendente} onClick={() => abrirEdicao(s)}><Pencil size={14} /></button>
                      <button type="button" className="icon-btn icon-btn-danger" title="Excluir" disabled={pendente} onClick={() => remover(s)}><Trash2 size={14} /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
