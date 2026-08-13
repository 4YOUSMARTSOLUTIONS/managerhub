"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Power, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { confirmDialog } from "@/components/ui/confirm";
import { normalizar } from "@/lib/format";
import {
  deleteEmailRecipient, saveEmailRecipient, setEmailRecipientActive,
} from "@/lib/actions/absenteismos";

export type DestinatarioRow = {
  id: string;
  email: string;
  name: string | null;
  unitId: string | null;
  unitName: string | null;
  active: boolean;
};

type Rascunho = { id?: string; email: string; name: string; unitId: string };

const vazio: Rascunho = { email: "", name: "", unitId: "" };

/**
 * Quem recebe o comunicado de não comparecimento.
 *
 * A lista guarda e-mail, e não colaborador do sistema, porque quem precisa
 * saber que alguém não apareceu costuma estar fora do organograma: portaria,
 * contabilidade, transporte, a empresa que faz a folha.
 *
 * Sem ninguém aqui, o lançamento continua funcionando e nenhum e-mail sai. A
 * tela avisa, porque um silêncio desses é indistinguível de falha.
 */
export function AbsenteismoRecipientsManager({
  rows, unidades, canEdit, temChaveDeEmail,
}: {
  rows: DestinatarioRow[];
  unidades: { id: string; name: string }[];
  canEdit: boolean;
  /** integração de e-mail configurada na plataforma */
  temChaveDeEmail: boolean;
}) {
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const lista = useMemo(() => {
    const q = normalizar(busca.trim());
    if (!q) return rows;
    return rows.filter((r) =>
      [r.email, r.name, r.unitName].some((v) => v && normalizar(v).includes(q)));
  }, [rows, busca]);

  const ativos = rows.filter((r) => r.active).length;

  const salvar = () => {
    if (!rascunho) return;
    setErro("");
    iniciar(async () => {
      const r = await saveEmailRecipient({
        id: rascunho.id, email: rascunho.email, name: rascunho.name, unitId: rascunho.unitId,
      });
      if (r.error) { setErro(r.error); return; }
      setRascunho(null);
      router.refresh();
    });
  };

  const excluir = async (d: DestinatarioRow) => {
    const ok = await confirmDialog({
      title: "Remover destinatário",
      tone: "danger",
      confirmLabel: "Remover",
      message: `Remover ${d.email} da lista? Ele deixa de receber os comunicados de não comparecimento.`,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("id", d.id);
    iniciar(async () => { await deleteEmailRecipient(fd); router.refresh(); });
  };

  const alternar = (d: DestinatarioRow) => {
    const fd = new FormData();
    fd.set("id", d.id);
    fd.set("active", d.active ? "0" : "1");
    iniciar(async () => { await setEmailRecipientActive(fd); router.refresh(); });
  };

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: "0 0 0.2rem" }}>Comunicado por e-mail</h3>
        <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
          Quem é avisado assim que um gestor lança um não comparecimento, e depois quando o motivo
          é confirmado e quando o RH decide. Sem unidade, a pessoa recebe de todas; com unidade,
          só dos lançamentos daquela unidade. Dados do atestado nunca vão por e-mail.
        </p>
      </div>

      {!temChaveDeEmail && (
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--mh-warning)", background: "var(--mh-warning-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
          A integração de e-mail ainda não foi configurada na plataforma, então nenhum comunicado
          será enviado. Os lançamentos continuam sendo registrados normalmente.
        </p>
      )}
      {temChaveDeEmail && ativos === 0 && (
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--mh-warning)", background: "var(--mh-warning-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
          Nenhum destinatário ativo. Os lançamentos serão registrados, mas ninguém receberá o
          comunicado.
        </p>
      )}

      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input" placeholder="Buscar por e-mail, nome ou unidade…"
          value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 320 }}
        />
        {canEdit && (
          <button
            type="button" className="btn btn-primary btn-sm" style={{ marginLeft: "auto" }}
            onClick={() => { setErro(""); setRascunho({ ...vazio }); }}
          >
            + Novo destinatário
          </button>
        )}
      </div>

      {rascunho && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--mh-radius-lg)", background: "var(--surface-2)", padding: "0.9rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0.8rem" }}>
            <div style={{ gridColumn: "span 2", minWidth: 0 }}>
              <label className="label">E-mail <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <input
                className="input" type="email" value={rascunho.email} placeholder="rh@empresa.com.br"
                onChange={(e) => setRascunho((r) => (r ? { ...r, email: e.target.value } : r))}
              />
            </div>
            <div>
              <label className="label">Nome</label>
              <input
                className="input" value={rascunho.name} placeholder="Departamento pessoal"
                onChange={(e) => setRascunho((r) => (r ? { ...r, name: e.target.value } : r))}
              />
            </div>
            <div>
              <label className="label">Unidade</label>
              <select
                className="select" value={rascunho.unitId}
                onChange={(e) => setRascunho((r) => (r ? { ...r, unitId: e.target.value } : r))}
              >
                <option value="">Todas as unidades</option>
                {unidades.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.9rem", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={pendente} onClick={salvar}>
              {pendente ? "Salvando…" : "Salvar"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRascunho(null)}>Cancelar</button>
            {erro && <span style={{ color: "var(--mh-danger)", fontSize: "0.8rem" }}>{erro}</span>}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>
          Nenhum destinatário cadastrado ainda.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>E-mail</th>
              <th style={{ width: 200 }}>Nome</th>
              <th style={{ width: 160 }}>Unidade</th>
              <th style={{ width: 110 }}>Situação</th>
              {canEdit && <th style={{ textAlign: "right" }}></th>}
            </tr>
          </thead>
          <tbody>
            {lista.map((d) => (
              <tr key={d.id} style={{ opacity: d.active ? 1 : 0.6 }}>
                <td style={{ fontWeight: 600 }}>{d.email}</td>
                <td className="muted">{d.name ?? "–"}</td>
                <td className="muted">{d.unitName ?? "Todas"}</td>
                <td><Badge tone={d.active ? "green" : "gray"}>{d.active ? "Ativo" : "Inativo"}</Badge></td>
                {canEdit && (
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-flex", gap: "0.3rem" }}>
                      <button
                        type="button" className="icon-btn" title="Editar"
                        onClick={() => {
                          setErro("");
                          setRascunho({ id: d.id, email: d.email, name: d.name ?? "", unitId: d.unitId ?? "" });
                        }}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button" className="icon-btn" disabled={pendente}
                        title={d.active ? "Desativar" : "Reativar"} onClick={() => alternar(d)}
                      >
                        {d.active ? <Power size={15} /> : <RotateCcw size={15} />}
                      </button>
                      <button type="button" className="icon-btn icon-btn-danger" title="Remover" disabled={pendente} onClick={() => excluir(d)}>
                        <Trash2 size={15} />
                      </button>
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
