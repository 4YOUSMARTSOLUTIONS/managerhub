"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Power, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { ExportButton } from "@/components/ui/ExportButton";
import { confirmDialog } from "@/components/ui/confirm";
import { ABSENCE_KIND_LABEL, ABSENCE_KIND_TONE } from "@/lib/constants";
import { normalizar } from "@/lib/format";
import {
  deleteAbsenceType, saveAbsenceType, setAbsenceTypeActive,
} from "@/lib/actions/absenteismos";
import type { Enums } from "@/types/database";

export type TipoAbsenteismoRow = {
  id: string;
  name: string;
  description: string | null;
  kind: Enums<"absence_kind">;
  requiresDocument: boolean;
  requiresMedical: boolean;
  discountsRvDefault: boolean;
  countsAsAbsenteeism: boolean;
  active: boolean;
};

type Rascunho = {
  id?: string;
  name: string;
  description: string;
  kind: Enums<"absence_kind">;
  requiresDocument: boolean;
  requiresMedical: boolean;
  discountsRvDefault: boolean;
  countsAsAbsenteeism: boolean;
};

const vazio: Rascunho = {
  name: "", description: "", kind: "atestado",
  requiresDocument: true, requiresMedical: true,
  discountsRvDefault: false, countsAsAbsenteeism: true,
};

/**
 * Tipos de absenteísmo.
 *
 * O campo que governa tudo é "Comportamento": ele diz a qual dos cinco tipos
 * base o tipo novo se comporta igual, e é o tipo base que as regras de redutor
 * da remuneração variável observam. Assim a empresa pode ter quantos nomes
 * quiser sem que ninguém precise mexer em Remuneração variável.
 */
export function AbsenceTypesManager({
  rows, canEdit, kindsComRedutor = [],
}: {
  rows: TipoAbsenteismoRow[];
  canEdit: boolean;
  /**
   * Comportamentos que já têm faixa de redutor ativa em Remuneração variável ›
   * Redutores (a "punição" por dias de atestado ou falta). O formulário avisa
   * quando o tipo cai num deles, porque o efeito do desconto por dia muda.
   */
  kindsComRedutor?: Enums<"absence_kind">[];
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
      [r.name, r.description, ABSENCE_KIND_LABEL[r.kind]]
        .some((v) => v && normalizar(v).includes(q)));
  }, [rows, busca]);

  const salvar = () => {
    if (!rascunho) return;
    setErro("");
    iniciar(async () => {
      const r = await saveAbsenceType({
        id: rascunho.id,
        name: rascunho.name,
        description: rascunho.description,
        kind: rascunho.kind,
        requiresDocument: rascunho.requiresDocument,
        requiresMedical: rascunho.requiresMedical,
        discountsRvDefault: rascunho.discountsRvDefault,
        countsAsAbsenteeism: rascunho.countsAsAbsenteeism,
      });
      if (r.error) { setErro(r.error); return; }
      setRascunho(null);
      router.refresh();
    });
  };

  const excluir = async (t: TipoAbsenteismoRow) => {
    const ok = await confirmDialog({
      title: "Excluir tipo",
      tone: "danger",
      confirmLabel: "Excluir",
      message: `Excluir "${t.name}"? Se ele já foi usado em algum lançamento, será apenas desativado, para o registro antigo continuar dizendo o que aconteceu.`,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("id", t.id);
    iniciar(async () => { await deleteAbsenceType(fd); router.refresh(); });
  };

  const alternar = (t: TipoAbsenteismoRow) => {
    const fd = new FormData();
    fd.set("id", t.id);
    fd.set("active", t.active ? "0" : "1");
    iniciar(async () => { await setAbsenceTypeActive(fd); router.refresh(); });
  };

  // Dito em termos de OBRIGAÇÃO, porque anexar sempre é possível: o que o
  // catálogo decide é se dá para enviar ao RH sem o documento.
  const exigencias = (t: TipoAbsenteismoRow) => {
    if (t.requiresMedical) return "Anexo e dados do atestado obrigatórios";
    if (t.requiresDocument) return "Anexo obrigatório";
    return "Anexo opcional";
  };

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: "0 0 0.2rem" }}>Tipos de absenteísmo</h3>
        <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
          O que o gestor pode escolher ao confirmar um não comparecimento. Cada tipo se comporta
          como um dos cinco tipos base, e é o comportamento que decide o efeito na remuneração
          variável: assim dá para ter Atestado médico e Atestado odontológico separados sem criar
          duas regras de redutor.
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input" placeholder="Buscar tipo…"
          value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 300 }}
        />
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginLeft: "auto", flexWrap: "wrap" }}>
          <ExportButton
            filename="tipos-de-absenteismo.xlsx"
            sheetName="Tipos"
            headers={["Tipo", "Comportamento", "Documentação", "Desconta RV", "Conta no indicador", "Situação"]}
            rows={lista.map((t) => [
              t.name, ABSENCE_KIND_LABEL[t.kind], exigencias(t),
              t.discountsRvDefault ? "Sim" : "Não",
              t.countsAsAbsenteeism ? "Sim" : "Não",
              t.active ? "Ativo" : "Inativo",
            ])}
          />
          {canEdit && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { setErro(""); setRascunho({ ...vazio }); }}>
              + Novo tipo
            </button>
          )}
        </div>
      </div>

      {rascunho && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--mh-radius-lg)", background: "var(--surface-2)", padding: "0.9rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.8rem" }}>
            <div style={{ gridColumn: "span 2", minWidth: 0 }}>
              <label className="label">Nome <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <input
                className="input" value={rascunho.name} placeholder="Atestado médico"
                onChange={(e) => setRascunho((r) => (r ? { ...r, name: e.target.value } : r))}
              />
            </div>
            <div>
              <label className="label">Comportamento <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <select
                className="select" value={rascunho.kind}
                onChange={(e) => setRascunho((r) => (r ? { ...r, kind: e.target.value as Enums<"absence_kind"> } : r))}
              >
                {(Object.keys(ABSENCE_KIND_LABEL) as Enums<"absence_kind">[]).map((k) => (
                  <option key={k} value={k}>{ABSENCE_KIND_LABEL[k]}</option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="label">Descrição</label>
              <textarea
                className="input" rows={2} value={rascunho.description}
                placeholder="Quando o gestor deve usar este tipo."
                onChange={(e) => setRascunho((r) => (r ? { ...r, description: e.target.value } : r))}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: "1.2rem", flexWrap: "wrap", marginTop: "0.9rem" }}>
            <label style={{ display: "flex", gap: "0.4rem", alignItems: "center", fontSize: "0.82rem" }}>
              <input
                type="checkbox" checked={rascunho.requiresDocument}
                disabled={rascunho.requiresMedical}
                onChange={(e) => setRascunho((r) => (r ? { ...r, requiresDocument: e.target.checked } : r))}
              />
              Exige documento anexado
            </label>
            <label style={{ display: "flex", gap: "0.4rem", alignItems: "center", fontSize: "0.82rem" }}>
              <input
                type="checkbox" checked={rascunho.requiresMedical}
                onChange={(e) => setRascunho((r) => (r ? {
                  ...r, requiresMedical: e.target.checked,
                  // quem pede CID pede o papel junto: sem o atestado anexado o
                  // RH não tem como conferir o que foi digitado
                  requiresDocument: e.target.checked ? true : r.requiresDocument,
                } : r))}
              />
              Exige dados do atestado (CID, médico, local)
            </label>
            <label style={{ display: "flex", gap: "0.4rem", alignItems: "center", fontSize: "0.82rem" }}>
              <input
                type="checkbox" checked={rascunho.discountsRvDefault}
                onChange={(e) => setRascunho((r) => (r ? { ...r, discountsRvDefault: e.target.checked } : r))}
              />
              Desconta remuneração variável por dia
            </label>
            <label style={{ display: "flex", gap: "0.4rem", alignItems: "center", fontSize: "0.82rem" }}>
              <input
                type="checkbox" checked={rascunho.countsAsAbsenteeism}
                onChange={(e) => setRascunho((r) => (r ? { ...r, countsAsAbsenteeism: e.target.checked } : r))}
              />
              Conta como absenteísmo no indicador
            </label>
          </div>

          {kindsComRedutor.includes(rascunho.kind) ? (
            <p style={{ fontSize: "0.78rem", margin: "0.6rem 0 0", color: "var(--mh-warning)", background: "var(--mh-warning-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
              O comportamento {ABSENCE_KIND_LABEL[rascunho.kind]} já reduz a remuneração variável
              pela faixa de redutor configurada em Remuneração variável › Redutores. Para o mesmo
              dia não ser cortado duas vezes, o cálculo ignora o desconto por dia nesses períodos
              enquanto a regra estiver ativa: a faixa prevalece.
            </p>
          ) : (
            <p className="soft" style={{ fontSize: "0.74rem", margin: "0.6rem 0 0" }}>
              Atestado e falta costumam ficar SEM o desconto por dia, porque quem cuida deles é a
              faixa de redutor em Remuneração variável, e descontar nos dois lugares puniria duas
              vezes o mesmo dia.
            </p>
          )}

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
          Nenhum tipo cadastrado. Sem eles o gestor não consegue confirmar um não comparecimento.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Tipo</th>
              <th style={{ width: 150 }}>Comportamento</th>
              <th style={{ width: 210 }}>Documentação</th>
              <th style={{ width: 110 }}>Situação</th>
              {canEdit && <th style={{ textAlign: "right" }}></th>}
            </tr>
          </thead>
          <tbody>
            {lista.map((t) => (
              <tr key={t.id} style={{ opacity: t.active ? 1 : 0.6 }}>
                <td>
                  <span style={{ fontWeight: 600 }}>{t.name}</span>
                  {t.description && (
                    <div className="soft" style={{ fontSize: "0.74rem" }}>{t.description}</div>
                  )}
                </td>
                <td><Badge tone={ABSENCE_KIND_TONE[t.kind]}>{ABSENCE_KIND_LABEL[t.kind]}</Badge></td>
                <td className="muted" style={{ fontSize: "0.78rem" }}>{exigencias(t)}</td>
                <td><Badge tone={t.active ? "green" : "gray"}>{t.active ? "Ativo" : "Inativo"}</Badge></td>
                {canEdit && (
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-flex", gap: "0.3rem" }}>
                      <button
                        type="button" className="icon-btn" title="Editar"
                        onClick={() => {
                          setErro("");
                          setRascunho({
                            id: t.id, name: t.name, description: t.description ?? "",
                            kind: t.kind, requiresDocument: t.requiresDocument,
                            requiresMedical: t.requiresMedical,
                            discountsRvDefault: t.discountsRvDefault,
                            countsAsAbsenteeism: t.countsAsAbsenteeism,
                          });
                        }}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button" className="icon-btn" disabled={pendente}
                        title={t.active ? "Desativar" : "Reativar"} onClick={() => alternar(t)}
                      >
                        {t.active ? <Power size={15} /> : <RotateCcw size={15} />}
                      </button>
                      <button type="button" className="icon-btn icon-btn-danger" title="Excluir" disabled={pendente} onClick={() => excluir(t)}>
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
