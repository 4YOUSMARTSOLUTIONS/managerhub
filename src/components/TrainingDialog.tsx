"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { PeoplePicker } from "@/components/PeoplePicker";
import { saveTraining, type RegraPublico, type TrainingForEdit } from "@/lib/actions/trainings";
import { PERIODICIDADE_OPCOES, DELIVERY_LABEL } from "@/lib/training-schedule";
import type { Enums } from "@/types/database";

type Opt = { id: string; name: string };
type SubOpt = { id: string; name: string; departmentId: string };

const grid2: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.8rem",
};
const sectionTitle: React.CSSProperties = {
  fontSize: "0.74rem", fontWeight: 700, textTransform: "uppercase",
  letterSpacing: "0.04em", color: "var(--text-soft)", margin: "0.4rem 0 0",
};

/** rótulo do asterisco: vermelho no obrigatório, nada no facultativo */
function Req() {
  return <span style={{ color: "var(--mh-danger)" }}> *</span>;
}

const KIND_LABEL: Record<RegraPublico["kind"], string> = {
  position: "Cargo",
  department: "Setor",
  subdepartment: "Subsetor",
  unit: "Unidade",
  user: "Colaborador",
};

export function TrainingDialog({
  training, people, departments, subdepartments, positions, pilares, units, onClose,
}: {
  training: TrainingForEdit | null;
  people: Opt[];
  departments: Opt[];
  subdepartments: SubOpt[];
  positions: Opt[];
  pilares: Opt[];
  units: Opt[];
  onClose: () => void;
}) {
  const [name, setName] = useState(training?.name ?? "");
  const [code, setCode] = useState(training?.code ?? "");
  const [description, setDescription] = useState(training?.description ?? "");
  const [horas, setHoras] = useState(training ? String(Math.floor(training.workload_minutes / 60)) : "");
  const [minutos, setMinutos] = useState(training ? String(training.workload_minutes % 60) : "");
  const [delivery, setDelivery] = useState<Enums<"training_delivery">>(training?.delivery ?? "auto_instrucional");
  const [validade, setValidade] = useState<string>(training?.validade_meses != null ? String(training.validade_meses) : "");
  const [antecipacao, setAntecipacao] = useState(String(training?.antecipacao_dias ?? 60));
  const [prazo, setPrazo] = useState(training?.prazo_dias != null ? String(training.prazo_dias) : "");
  const [unitId, setUnitId] = useState(training?.unit_id ?? "");
  const [deptId, setDeptId] = useState(training?.department_id ?? "");
  const [subId, setSubId] = useState(training?.subdepartment_id ?? "");
  const [pilarId, setPilarId] = useState(training?.pilar_id ?? "");
  const [active, setActive] = useState(training?.active ?? true);
  const [ownerIds, setOwnerIds] = useState<string[]>(training?.ownerIds ?? []);
  const [regras, setRegras] = useState<RegraPublico[]>(training?.regras ?? []);

  const [erro, setErro] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const subsDoSetor = deptId ? subdepartments.filter((s) => s.departmentId === deptId) : subdepartments;

  const addRegra = (kind: RegraPublico["kind"], refId: string) => {
    if (!refId) return;
    if (regras.some((r) => r.kind === kind && r.refId === refId)) return;
    setRegras([...regras, { kind, refId, mandatory: true }]);
  };
  const nomeDaRegra = (r: RegraPublico): string => {
    const lista = r.kind === "position" ? positions
      : r.kind === "department" ? departments
      : r.kind === "subdepartment" ? subdepartments
      : r.kind === "unit" ? units
      : people;
    return lista.find((o) => o.id === r.refId)?.name ?? "—";
  };

  const salvar = () => {
    setErro("");
    const carga = (Number(horas) || 0) * 60 + (Number(minutos) || 0);
    start(async () => {
      const r = await saveTraining({
        id: training?.id,
        name, description, code,
        workload_minutes: carga,
        delivery,
        validade_meses: validade === "" ? null : Number(validade),
        antecipacao_dias: Number(antecipacao) || 60,
        prazo_dias: prazo === "" ? null : Number(prazo),
        unit_id: unitId || null,
        department_id: deptId || null,
        subdepartment_id: subId || null,
        pilar_id: pilarId || null,
        active,
        ownerIds,
        regras,
      });
      if (r.error) { setErro(r.error); return; }
      router.refresh();
      onClose();
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "4vh 1rem", zIndex: 70, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 780, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)", gap: "0.75rem" }}>
          <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>
            {training ? "Editar treinamento" : "Novo treinamento"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>

        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          <div style={grid2}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="label">Nome<Req /></label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="NR-35 Trabalho em Altura" />
            </div>
          </div>

          <div>
            <label className="label">Descrição</label>
            <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="O que é tratado no treinamento, conteúdo programático…" />
          </div>

          <div style={grid2}>
            <div>
              <label className="label">Código</label>
              <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="NR35" />
            </div>
            <div>
              <label className="label">Carga horária<Req /></label>
              <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                <input type="number" min={0} className="input" value={horas} onChange={(e) => setHoras(e.target.value)} placeholder="8" style={{ width: 80 }} />
                <span className="soft" style={{ fontSize: "0.85rem" }}>h</span>
                <input type="number" min={0} max={59} className="input" value={minutos} onChange={(e) => setMinutos(e.target.value)} placeholder="0" style={{ width: 80 }} />
                <span className="soft" style={{ fontSize: "0.85rem" }}>min</span>
              </div>
            </div>
            <div>
              <label className="label">Como é realizado<Req /></label>
              <select className="select" value={delivery} onChange={(e) => setDelivery(e.target.value as Enums<"training_delivery">)}>
                {(Object.keys(DELIVERY_LABEL) as Enums<"training_delivery">[]).map((d) => (
                  <option key={d} value={d}>{DELIVERY_LABEL[d]}</option>
                ))}
              </select>
            </div>
          </div>

          <p style={sectionTitle}>Periodicidade e prazo</p>
          <div style={grid2}>
            <div>
              <label className="label">Reciclagem</label>
              <select className="select" value={validade} onChange={(e) => setValidade(e.target.value)}>
                {PERIODICIDADE_OPCOES.map(([v, l]) => (
                  <option key={String(v)} value={v == null ? "" : String(v)}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Pode reciclar a partir de</label>
              <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                <input type="number" min={0} className="input" value={antecipacao} onChange={(e) => setAntecipacao(e.target.value)} style={{ width: 90 }} />
                <span className="soft" style={{ fontSize: "0.8rem" }}>dias antes do vencimento</span>
              </div>
            </div>
            <div>
              <label className="label">Prazo para concluir</label>
              <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                <input type="number" min={0} className="input" value={prazo} onChange={(e) => setPrazo(e.target.value)} placeholder="30" style={{ width: 90 }} />
                <span className="soft" style={{ fontSize: "0.8rem" }}>dias após ser atribuído</span>
              </div>
            </div>
          </div>
          {validade !== "" && (
            <p className="soft" style={{ fontSize: "0.76rem", margin: 0 }}>
              A validade conta sempre a partir do vencimento anterior, então adiantar a reciclagem
              não encurta o próximo prazo.
            </p>
          )}

          <p style={sectionTitle}>Onde se aplica</p>
          <div style={grid2}>
            <div>
              <label className="label">Unidade</label>
              <select className="select" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                <option value="">Todas</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Setor</label>
              <select className="select" value={deptId} onChange={(e) => { setDeptId(e.target.value); setSubId(""); }}>
                <option value="">Todos</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Subsetor</label>
              <select className="select" value={subId} onChange={(e) => setSubId(e.target.value)}>
                <option value="">Todos</option>
                {subsDoSetor.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Pilar</label>
              <select className="select" value={pilarId} onChange={(e) => setPilarId(e.target.value)}>
                <option value="">—</option>
                {pilares.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>

          <p style={sectionTitle}>Responsáveis<Req /></p>
          <PeoplePicker people={people} selected={ownerIds} onChange={setOwnerIds} placeholder="Buscar responsável…" />

          <p style={sectionTitle}>Quem deve fazer</p>
          <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
            A regra acompanha a estrutura: quem entra no cargo passa a dever o treinamento, e quem sai
            deixa de ser cobrado sem perder o que já fez.
          </p>
          <div style={grid2}>
            <div>
              <label className="label">Por cargo</label>
              <select className="select" value="" onChange={(e) => addRegra("position", e.target.value)}>
                <option value="">Adicionar cargo…</option>
                {positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Por setor</label>
              <select className="select" value="" onChange={(e) => addRegra("department", e.target.value)}>
                <option value="">Adicionar setor…</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Por subsetor</label>
              <select className="select" value="" onChange={(e) => addRegra("subdepartment", e.target.value)}>
                <option value="">Adicionar subsetor…</option>
                {subdepartments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Por unidade</label>
              <select className="select" value="" onChange={(e) => addRegra("unit", e.target.value)}>
                <option value="">Adicionar unidade…</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>

          {regras.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {regras.map((r, i) => (
                <div key={`${r.kind}-${r.refId}`} style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.45rem 0.7rem", border: "1px solid var(--border)", borderRadius: 8, background: "var(--mh-surface-1)" }}>
                  <span className="soft" style={{ fontSize: "0.74rem", minWidth: 74 }}>{KIND_LABEL[r.kind]}</span>
                  <span style={{ fontSize: "0.86rem", fontWeight: 600, flex: 1 }}>{nomeDaRegra(r)}</span>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.8rem" }}>
                    <input
                      type="checkbox"
                      checked={r.mandatory}
                      onChange={(e) => setRegras(regras.map((x, j) => j === i ? { ...x, mandatory: e.target.checked } : x))}
                    />
                    Obrigatório
                  </label>
                  <button type="button" className="icon-btn" title="Remover" onClick={() => setRegras(regras.filter((_, j) => j !== i))}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem" }}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Treinamento ativo
          </label>

          {erro && (
            <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>{erro}</p>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={salvar}>
            {pending ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
