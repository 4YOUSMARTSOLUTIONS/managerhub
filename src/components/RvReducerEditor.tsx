"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge";
import { ConfirmActionButton } from "@/components/ui/ConfirmActionButton";
import { confirmDialog } from "@/components/ui/confirm";
import { ABSENCE_KIND_LABEL } from "@/lib/constants";
import {
  createReducerRule, toggleReducerRule, deleteReducerRule,
  addReducerBand, deleteReducerBand, updateReducerRuleKinds,
} from "@/lib/actions/rv-redutores";
import type { Enums } from "@/types/database";

/**
 * Redutores da remuneração variável.
 *
 * O que esta tela edita são DADOS, não código: as regras da empresa (falta zera,
 * atestado corta por faixa, punição zera) são só uma configuração possível, e
 * outra empresa corta de outro jeito sem ninguém tocar no sistema.
 *
 * Duas regras de composição valem aqui e estão escritas na tela para quem
 * configura não precisar adivinhar:
 *
 *   - dentro de um motivo vale UMA faixa, a que a quantidade alcança;
 *   - motivos diferentes SOMAM, com teto de 100%.
 */

export type FaixaRow = { id: string; min: number; max: number | null; pct: number };
export type RegraRow = {
  id: string;
  nome: string;
  fonte: Enums<"rv_reducer_source">;
  absenceKind: Enums<"absence_kind"> | null;
  /** todos os tipos cujos dias somam no motivo (inclui o principal) */
  absenceKinds: Enums<"absence_kind">[];
  sanctionTypeId: string | null;
  ativa: boolean;
  faixas: FaixaRow[];
};
type TipoPunicao = { id: string; name: string };

const KINDS: Enums<"absence_kind">[] = ["atestado", "afastamento", "licenca", "falta", "ferias"];

/** "atestado, afastamento e licença" */
const listaDeTipos = (kinds: Enums<"absence_kind">[]) => {
  const nomes = kinds.map((k) => (ABSENCE_KIND_LABEL[k] ?? k).toLowerCase());
  return nomes.length <= 1 ? nomes.join("") : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
};

/**
 * Os tipos cujos dias somam no motivo (LUIZ, 16/11/2026): 3 dias de atestado +
 * 2 de afastamento no mês são 5 dias, uma faixa só. Um tipo só pode estar em um
 * motivo; o banco recusa o repetido.
 */
function TiposDoMotivo({ valor, onChange, disabled }: {
  valor: Enums<"absence_kind">[];
  onChange: (v: Enums<"absence_kind">[]) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem 0.9rem" }}>
      {KINDS.map((k) => (
        <label key={k} style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center", fontSize: "0.84rem", cursor: disabled ? "default" : "pointer" }}>
          <input
            type="checkbox" disabled={disabled} checked={valor.includes(k)}
            onChange={(e) => onChange(e.target.checked ? [...valor, k] : valor.filter((x) => x !== k))}
          />
          {ABSENCE_KIND_LABEL[k]}
        </label>
      ))}
    </div>
  );
}

export function RvReducerEditor({
  regras, tiposPunicao, canEdit = true,
}: {
  regras: RegraRow[];
  tiposPunicao: TipoPunicao[];
  canEdit?: boolean;
}) {
  const [pending, start] = useTransition();
  const [novoAberto, setNovoAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [fonte, setFonte] = useState<Enums<"rv_reducer_source">>("absence");
  const [kinds, setKinds] = useState<Enums<"absence_kind">[]>(["atestado"]);
  const [tipoId, setTipoId] = useState("");
  const [erro, setErro] = useState("");

  const criar = () => {
    setErro("");
    start(async () => {
      const r = await createReducerRule({
        name: nome,
        source: fonte,
        absence_kinds: fonte === "absence" ? kinds : null,
        sanction_type_id: fonte === "sanction" ? (tipoId || null) : null,
      });
      if (r.error) { setErro(r.error); return; }
      setNovoAberto(false); setNome(""); setTipoId("");
    });
  };

  const nomeTipo = (id: string | null) =>
    id == null ? "qualquer punição" : (tiposPunicao.find((t) => t.id === id)?.name ?? "tipo removido");

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: "0 0 0.2rem" }}>Redutores da remuneração variável</h3>
        <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
          Cortes por conduta no mês, aplicados sobre o valor da RV depois do cálculo de atingimento.
          Dentro de um motivo vale <strong>uma faixa só</strong>, a que a quantidade alcança.
          Motivos diferentes <strong>somam</strong>, com teto de 100%.
          Sem motivo cadastrado nada é descontado.
        </p>
      </div>

      {canEdit && (
        <div>
          {!novoAberto ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNovoAberto(true)}>
              <Plus size={14} /> Novo motivo
            </button>
          ) : (
            <div style={{ border: "1px solid var(--mh-border)", borderRadius: "var(--mh-radius-md)", background: "var(--surface-2)", padding: "0.9rem", display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "flex-end" }}>
              <div style={{ flex: "1 1 200px" }}>
                <label className="label">Nome do motivo</label>
                <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Atestado" />
              </div>
              <div>
                <label className="label">Contado a partir de</label>
                <select className="select" value={fonte} onChange={(e) => setFonte(e.target.value as Enums<"rv_reducer_source">)} style={{ width: "auto" }}>
                  <option value="absence">Dias de ausência</option>
                  <option value="sanction">Ocorrências de punição</option>
                </select>
              </div>
              {fonte === "absence" ? (
                <div>
                  <label className="label">Soma os dias de</label>
                  <TiposDoMotivo valor={kinds} onChange={setKinds} />
                </div>
              ) : (
                <div>
                  <label className="label">Tipo de punição</label>
                  <select className="select" value={tipoId} onChange={(e) => setTipoId(e.target.value)} style={{ width: "auto", maxWidth: 220 }}>
                    <option value="">Qualquer punição</option>
                    {tiposPunicao.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              )}
              <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={criar}>Criar motivo</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setNovoAberto(false); setErro(""); }}>Cancelar</button>
              {erro && <span style={{ color: "var(--mh-danger)", fontSize: "0.8rem" }}>{erro}</span>}
            </div>
          )}
        </div>
      )}

      {regras.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>
          Nenhum motivo cadastrado. A remuneração variável não sofre nenhum corte por conduta.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {regras.map((r) => (
            <Motivo
              key={r.id}
              regra={r}
              origem={r.fonte === "absence"
                ? `Dias de ${listaDeTipos(r.absenceKinds)} no mês${r.absenceKinds.length > 1 ? ", somados numa faixa só" : ""}`
                : `Ocorrências de ${nomeTipo(r.sanctionTypeId)} no mês`}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Motivo({ regra, origem, canEdit }: { regra: RegraRow; origem: string; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [min, setMin] = useState("1");
  const [max, setMax] = useState("");
  const [pct, setPct] = useState("");
  const [erro, setErro] = useState("");
  const [tipos, setTipos] = useState<Enums<"absence_kind">[]>(regra.absenceKinds);
  const tiposMudaram = [...tipos].sort().join() !== [...regra.absenceKinds].sort().join();

  const salvarTipos = () => {
    setErro("");
    start(async () => {
      const r = await updateReducerRuleKinds(regra.id, tipos);
      if (r.error) { setErro(r.error); return; }
      toast.success("Tipos do motivo atualizados.");
    });
  };

  const somar = () => {
    setErro("");
    start(async () => {
      const r = await addReducerBand({
        rule_id: regra.id,
        min_qtd: Number(min),
        max_qtd: max.trim() === "" ? null : Number(max),
        reduction_pct: Number(pct),
      });
      if (r.error) { setErro(r.error); return; }
      setMin(""); setMax(""); setPct("");
    });
  };

  const remover = async (id: string) => {
    if (!(await confirmDialog({ tone: "danger", confirmLabel: "Excluir", message: "Excluir esta faixa?" }))) return;
    start(async () => {
      const r = await deleteReducerBand(id);
      if (r.error) toast.error(r.error); else router.refresh();
    });
  };

  return (
    <div style={{ border: "1px solid var(--mh-border)", borderRadius: "var(--mh-radius-md)", opacity: regra.ativa ? 1 : 0.55 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.6rem", padding: "0.7rem 0.95rem", borderBottom: "1px solid var(--mh-border)", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <strong style={{ fontSize: "0.9rem" }}>{regra.nome}</strong>
          <div className="soft" style={{ fontSize: "0.76rem" }}>{origem}</div>
        </div>
        <div style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }}>
          <Badge tone={regra.ativa ? "green" : "gray"}>{regra.ativa ? "Ativo" : "Inativo"}</Badge>
          {canEdit && (
            <>
              <form action={toggleReducerRule} style={{ display: "inline-flex" }}>
                <input type="hidden" name="id" value={regra.id} />
                <input type="hidden" name="active" value={regra.ativa ? "0" : "1"} />
                <button className="btn btn-ghost btn-sm" type="submit">{regra.ativa ? "Desativar" : "Reativar"}</button>
              </form>
              <ConfirmActionButton
                action={deleteReducerRule}
                fields={{ id: regra.id }}
                className="icon-btn icon-btn-danger"
                buttonTitle="Excluir motivo"
                title="Excluir motivo"
                message={<>Excluir <strong>{regra.nome}</strong> e todas as suas faixas? A RV deixa de ser cortada por este motivo.</>}
                confirmLabel="Excluir"
              >
                <Trash2 size={14} />
              </ConfirmActionButton>
            </>
          )}
        </div>
      </div>

      <div style={{ padding: "0.7rem 0.95rem" }}>
        {regra.fonte === "absence" && canEdit && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem 0.9rem", alignItems: "center", marginBottom: "0.7rem" }}>
            <span className="label" style={{ margin: 0 }}>Soma os dias de</span>
            <TiposDoMotivo valor={tipos} onChange={setTipos} disabled={pending} />
            {tiposMudaram && (
              <>
                <button type="button" className="btn btn-primary btn-sm" disabled={pending || tipos.length === 0} onClick={salvarTipos}>Salvar tipos</button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => setTipos(regra.absenceKinds)}>Desfazer</button>
              </>
            )}
          </div>
        )}
        {regra.faixas.length === 0 ? (
          <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
            Sem faixas: este motivo não corta nada até você definir pelo menos uma.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Faixa</th>
                <th style={{ textAlign: "right" }}>Redução</th>
                {canEdit && <th style={{ textAlign: "right" }}></th>}
              </tr>
            </thead>
            <tbody>
              {regra.faixas.map((f) => (
                <tr key={f.id}>
                  <td>
                    {f.min}{f.max == null ? " ou mais" : ` a ${f.max}`}{" "}
                    <span className="soft">{regra.fonte === "absence" ? "dias" : "ocorrências"}</span>
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>
                    {f.pct >= 100 ? <span style={{ color: "var(--mh-danger)" }}>zera a RV</span> : `${f.pct}%`}
                  </td>
                  {canEdit && (
                    <td style={{ textAlign: "right" }}>
                      <button type="button" className="icon-btn icon-btn-danger" title="Excluir faixa" disabled={pending} onClick={() => remover(f.id)}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {canEdit && (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end", marginTop: "0.6rem" }}>
            <div>
              <label className="label">De</label>
              <input type="number" min={1} className="input" value={min} onChange={(e) => setMin(e.target.value)} style={{ width: 78 }} />
            </div>
            <div>
              <label className="label">Até</label>
              <input type="number" min={1} className="input" value={max} onChange={(e) => setMax(e.target.value)} placeholder="sem teto" style={{ width: 92 }} />
            </div>
            <div>
              <label className="label">Reduz (%)</label>
              <input type="number" min={0} max={100} className="input" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="20" style={{ width: 90 }} />
            </div>
            <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={somar}>Adicionar faixa</button>
            {erro && <span style={{ color: "var(--mh-danger)", fontSize: "0.8rem" }}>{erro}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
