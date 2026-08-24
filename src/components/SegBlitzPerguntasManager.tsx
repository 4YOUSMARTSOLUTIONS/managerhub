"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Power, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { ExportButton } from "@/components/ui/ExportButton";
import { confirmDialog } from "@/components/ui/confirm";
import { normalizar } from "@/lib/format";
import { deleteSegCatalogo, saveBlitzPergunta, setSegCatalogoAtivo } from "@/lib/actions/seguranca";

export type BlitzPerguntaRow = {
  id: string;
  name: string;
  active: boolean;
  /** vazio = vale para todos os meios (regra da cascata) */
  meioIds: string[];
};

type Opcao = { id: string; name: string };

type Rascunho = { id?: string; name: string; meioIds: string[] };

/**
 * As perguntas da blitz de trajeto.
 *
 * A pergunta é amarrada aos meios de transporte em que faz sentido, pela mesma
 * regra do módulo inteiro: SEM VÍNCULO = VALE PARA TODOS. A pergunta do
 * capacete amarra em Motocicleta; a do "saiu com tempo para dirigir sem
 * pressa" não amarra em nada e aparece para todo mundo.
 *
 * O texto respondido é CARIMBADO na resposta: editar a pergunta aqui muda as
 * blitzes futuras, nunca o que já foi respondido.
 */
export function SegBlitzPerguntasManager({
  rows, meios, canEdit,
}: {
  rows: BlitzPerguntaRow[];
  meios: Opcao[];
  canEdit: boolean;
}) {
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const nomeMeio = useMemo(() => new Map(meios.map((m) => [m.id, m.name])), [meios]);

  const lista = useMemo(() => {
    const q = normalizar(busca.trim());
    if (!q) return rows;
    return rows.filter((r) => normalizar(r.name).includes(q));
  }, [rows, busca]);

  const salvar = () => {
    if (!rascunho) return;
    setErro("");
    iniciar(async () => {
      const r = await saveBlitzPergunta({ id: rascunho.id, name: rascunho.name, meioIds: rascunho.meioIds });
      if (r.error) { setErro(r.error); return; }
      setRascunho(null);
      router.refresh();
    });
  };

  const excluir = async (i: BlitzPerguntaRow) => {
    const ok = await confirmDialog({
      title: "Excluir pergunta",
      tone: "danger",
      confirmLabel: "Excluir",
      message: `Excluir "${i.name}"? Se já houver blitz respondida com ela, será apenas desativada; as respostas antigas guardam o texto da época.`,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("tabela", "seg_blitz_perguntas");
    fd.set("id", i.id);
    iniciar(async () => { await deleteSegCatalogo(fd); router.refresh(); });
  };

  const alternar = (i: BlitzPerguntaRow) => {
    const fd = new FormData();
    fd.set("tabela", "seg_blitz_perguntas");
    fd.set("id", i.id);
    fd.set("active", i.active ? "0" : "1");
    iniciar(async () => { await setSegCatalogoAtivo(fd); router.refresh(); });
  };

  const alternarMeio = (id: string) =>
    setRascunho((r) => r && {
      ...r,
      meioIds: r.meioIds.includes(id) ? r.meioIds.filter((x) => x !== id) : [...r.meioIds, id],
    });

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: "0 0 0.2rem" }}>Perguntas da blitz</h3>
        <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
          O que o avaliador confere em cada meio de transporte. Pergunta sem vínculo vale para
          todos; a resposta guarda o texto da época, então editar aqui não reescreve o histórico.
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input" placeholder="Buscar…" value={busca}
          onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 300 }}
        />
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginLeft: "auto", flexWrap: "wrap" }}>
          <ExportButton
            filename="perguntas-da-blitz.xlsx"
            sheetName="Perguntas"
            headers={["Pergunta", "Meios", "Situação"]}
            rows={lista.map((i) => [
              i.name,
              i.meioIds.length === 0 ? "Todos" : i.meioIds.map((id) => nomeMeio.get(id) ?? "").filter(Boolean).join("; "),
              i.active ? "Ativa" : "Inativa",
            ])}
          />
          {canEdit && (
            <button
              type="button" className="btn btn-primary btn-sm"
              onClick={() => { setErro(""); setRascunho({ name: "", meioIds: [] }); }}
            >
              + Nova pergunta
            </button>
          )}
        </div>
      </div>

      {rascunho && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--mh-radius-lg)", background: "var(--surface-2)", padding: "0.9rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
          <div>
            <label className="label">Pergunta <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <textarea
              className="input" rows={2} value={rascunho.name}
              placeholder="Os pneus estão em boas condições de uso?"
              onChange={(e) => setRascunho((r) => (r ? { ...r, name: e.target.value } : r))}
            />
          </div>

          <div>
            <label className="label">Aparece em quais meios</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
              {meios.map((m) => {
                const on = rascunho.meioIds.includes(m.id);
                return (
                  <button
                    key={m.id} type="button" onClick={() => alternarMeio(m.id)} aria-pressed={on}
                    style={{
                      padding: "0.25rem 0.6rem", fontSize: "0.76rem", cursor: "pointer",
                      background: on ? "var(--mh-primary-soft)" : "var(--surface-1)",
                      border: "1px solid " + (on ? "var(--mh-primary-500)" : "var(--border)"),
                      borderRadius: 999, color: "var(--mh-text-1)", fontWeight: on ? 600 : 400,
                    }}
                  >
                    {m.name}
                  </button>
                );
              })}
            </div>
            <p className="soft" style={{ fontSize: "0.72rem", margin: "0.3rem 0 0" }}>
              {rascunho.meioIds.length === 0
                ? "Nenhum selecionado: a pergunta vale para TODOS os meios."
                : `Aparece só em ${rascunho.meioIds.length} selecionado(s).`}
            </p>
          </div>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={pendente} onClick={salvar}>
              {pendente ? "Salvando…" : "Salvar"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRascunho(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.8rem", margin: 0 }}>{erro}</p>}

      {rows.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>
          Nenhuma pergunta cadastrada. Sem elas a blitz vira só liberado/bloqueado, sem o porquê.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Pergunta</th>
              <th style={{ width: 260 }}>Meios</th>
              <th style={{ width: 100 }}>Situação</th>
              {canEdit && <th style={{ textAlign: "right" }}></th>}
            </tr>
          </thead>
          <tbody>
            {lista.map((i) => (
              <tr key={i.id} style={{ opacity: i.active ? 1 : 0.6 }}>
                <td style={{ fontWeight: 600 }}>{i.name}</td>
                <td className="soft" style={{ fontSize: "0.8rem" }}>
                  {i.meioIds.length === 0
                    ? "Todos"
                    : i.meioIds.map((id) => nomeMeio.get(id)).filter(Boolean).join(" · ")}
                </td>
                <td><Badge variant="quiet" tone={i.active ? "green" : "gray"}>{i.active ? "Ativa" : "Inativa"}</Badge></td>
                {canEdit && (
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-flex", gap: "0.3rem" }}>
                      <button
                        type="button" className="icon-btn" title="Editar"
                        onClick={() => { setErro(""); setRascunho({ id: i.id, name: i.name, meioIds: i.meioIds }); }}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button" className="icon-btn" disabled={pendente}
                        title={i.active ? "Desativar" : "Reativar"} onClick={() => alternar(i)}
                      >
                        {i.active ? <Power size={15} /> : <RotateCcw size={15} />}
                      </button>
                      <button
                        type="button" className="icon-btn icon-btn-danger" title="Excluir"
                        disabled={pendente} onClick={() => excluir(i)}
                      >
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
