"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { MultiSelect } from "@/components/ui/MultiSelect";
import { PeoplePicker } from "@/components/PeoplePicker";
import { saveTrilha, type RegraTrilha, type TrilhaForEdit } from "@/lib/actions/training-paths";
import type { Opt, PersonOpt, SubOpt, TrainingRow } from "@/components/TrainingsManager";

const KIND_LABEL: Record<RegraTrilha["kind"], string> = {
  user: "Colaborador",
  position: "Cargo",
  department: "Setor",
  subdepartment: "Subsetor",
  unit: "Unidade",
};

const grid2: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "0.8rem",
};
const sectionTitle: React.CSSProperties = {
  fontSize: "0.78rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  margin: "0.4rem 0 0",
  color: "var(--text-muted)",
};

const Req = () => <span style={{ color: "var(--mh-danger)" }}> *</span>;

export function TrainingPathDialog({
  trilha, trainings, people, departments, subdepartments, positions, units, onClose,
}: {
  trilha: TrilhaForEdit | null;
  trainings: TrainingRow[];
  people: PersonOpt[];
  departments: Opt[];
  subdepartments: SubOpt[];
  positions: Opt[];
  units: Opt[];
  onClose: () => void;
}) {
  const [name, setName] = useState(trilha?.name ?? "");
  const [description, setDescription] = useState(trilha?.description ?? "");
  const [prazo, setPrazo] = useState(trilha?.prazoDias ? String(trilha.prazoDias) : "30");
  const [semPrazo, setSemPrazo] = useState(trilha ? trilha.prazoDias === null : false);
  const [active, setActive] = useState(trilha?.active ?? true);
  const [passos, setPassos] = useState(trilha?.passos ?? []);
  const [regras, setRegras] = useState<RegraTrilha[]>(trilha?.regras ?? []);
  const [aAdicionar, setAAdicionar] = useState("");
  const [erro, setErro] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const cursoPorId = useMemo(() => new Map(trainings.map((t) => [t.id, t])), [trainings]);
  const disponiveis = trainings.filter(
    (t) => t.active && !passos.some((p) => p.trainingId === t.id),
  );

  /** Troca com o vizinho: a ordem da tela é a ordem que vai para o banco. */
  const mover = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= passos.length) return;
    const copia = [...passos];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    setPassos(copia);
  };

  const marcados = (kind: RegraTrilha["kind"]) =>
    regras.filter((r) => r.kind === kind).map((r) => r.refId);

  const sincronizar = (kind: RegraTrilha["kind"], ids: string[]) =>
    setRegras([
      ...regras.filter((r) => r.kind !== kind),
      ...ids.map((id) => ({
        kind,
        refId: id,
        // preserva o que já estava marcado ao reabrir a lista
        mandatory: regras.find((r) => r.kind === kind && r.refId === id)?.mandatory ?? true,
      })),
    ]);

  const nomeDaRegra = (r: RegraTrilha) => {
    const fonte =
      r.kind === "user" ? people
        : r.kind === "position" ? positions
        : r.kind === "department" ? departments
        : r.kind === "subdepartment" ? subdepartments
        : units;
    return fonte.find((x) => x.id === r.refId)?.name ?? "Removido";
  };

  const salvar = () => {
    setErro("");
    if (!name.trim()) { setErro("Informe o nome da trilha."); return; }
    if (passos.length < 2) {
      setErro("Uma trilha precisa de pelo menos dois treinamentos. Com um só, use o treinamento avulso.");
      return;
    }
    start(async () => {
      const r = await saveTrilha({
        id: trilha?.id,
        name,
        description,
        prazoDias: semPrazo ? null : Math.max(1, Number(prazo) || 30),
        active,
        passos,
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
            {trilha ? "Editar trilha" : "Nova trilha"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>

        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          <div>
            <label className="label">Nome<Req /></label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Integração de novos colaboradores" />
          </div>

          <div>
            <label className="label">Descrição</label>
            <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="O que este programa forma e quando ele se aplica." />
          </div>

          <div style={grid2}>
            <div>
              <label className="label">Prazo do programa</label>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <input
                  type="number" min={1} className="input" style={{ maxWidth: 100 }}
                  value={semPrazo ? "" : prazo} disabled={semPrazo}
                  onChange={(e) => setPrazo(e.target.value)}
                />
                <span className="soft" style={{ fontSize: "0.85rem" }}>dias</span>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.74rem", marginTop: "0.3rem" }} className="soft">
                <input type="checkbox" checked={semPrazo} onChange={(e) => setSemPrazo(e.target.checked)} />
                Usar o prazo de cada treinamento
              </label>
              <p className="soft" style={{ fontSize: "0.72rem", margin: "0.3rem 0 0" }}>
                Todos os passos vencem na mesma data, contada da atribuição. É a data que a empresa
                cobra: o programa inteiro concluído.
              </p>
            </div>
          </div>

          <p style={sectionTitle}>Passos<Req /></p>
          <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
            A ordem aqui é a ordem que o colaborador vai seguir. Um passo obrigatório só libera o
            seguinte depois de concluído.
          </p>

          {passos.length === 0 ? (
            <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>
              Nenhum treinamento adicionado ainda.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {passos.map((p, i) => (
                <div key={p.trainingId} style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.45rem 0.7rem", border: "1px solid var(--border)", borderRadius: 8, background: "var(--mh-surface-1)" }}>
                  <span className="soft" style={{ fontSize: "0.78rem", fontWeight: 700, minWidth: 18 }}>{i + 1}</span>
                  <span style={{ fontSize: "0.86rem", fontWeight: 600, flex: 1, minWidth: 0 }}>
                    {cursoPorId.get(p.trainingId)?.name ?? "Treinamento removido"}
                  </span>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.8rem" }}>
                    <input
                      type="checkbox"
                      checked={p.required}
                      onChange={(e) => setPassos(passos.map((x, j) => j === i ? { ...x, required: e.target.checked } : x))}
                    />
                    Obrigatório
                  </label>
                  <button type="button" className="icon-btn" title="Subir" disabled={i === 0} onClick={() => mover(i, -1)}>
                    <ArrowUp size={14} />
                  </button>
                  <button type="button" className="icon-btn" title="Descer" disabled={i === passos.length - 1} onClick={() => mover(i, 1)}>
                    <ArrowDown size={14} />
                  </button>
                  <button type="button" className="icon-btn" title="Remover" onClick={() => setPassos(passos.filter((_, j) => j !== i))}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label className="label">Adicionar treinamento</label>
              <select className="select" value={aAdicionar} onChange={(e) => setAAdicionar(e.target.value)}>
                <option value="">Selecione…</option>
                {disponiveis.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!aAdicionar}
              onClick={() => {
                setPassos([...passos, { trainingId: aAdicionar, required: true }]);
                setAAdicionar("");
              }}
            >
              <Plus size={14} style={{ marginRight: "0.3rem" }} /> Adicionar
            </button>
          </div>

          <p style={sectionTitle}>Quem deve cumprir</p>
          <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
            A regra acompanha a estrutura: quem entra no cargo passa a dever o programa inteiro, e
            quem sai deixa de ser cobrado sem perder o que já fez.
          </p>

          <div>
            <label className="label">Por colaborador</label>
            <PeoplePicker
              people={people}
              selected={marcados("user")}
              onChange={(ids) => sincronizar("user", ids)}
              placeholder="Buscar colaborador…"
            />
          </div>

          <div style={grid2}>
            <MultiSelect
              label="Por cargo"
              searchable
              allLabel="Nenhum cargo"
              options={positions.map((p) => ({ value: p.id, label: p.name }))}
              selected={marcados("position")}
              onChange={(ids) => sincronizar("position", ids)}
            />
            <MultiSelect
              label="Por setor"
              searchable
              allLabel="Nenhum setor"
              options={departments.map((d) => ({ value: d.id, label: d.name }))}
              selected={marcados("department")}
              onChange={(ids) => sincronizar("department", ids)}
            />
            <MultiSelect
              label="Por subsetor"
              searchable
              allLabel="Nenhum subsetor"
              options={subdepartments.map((s) => ({ value: s.id, label: s.name }))}
              selected={marcados("subdepartment")}
              onChange={(ids) => sincronizar("subdepartment", ids)}
            />
            <MultiSelect
              label="Por unidade"
              allLabel="Nenhuma unidade"
              options={units.map((u) => ({ value: u.id, label: u.name }))}
              selected={marcados("unit")}
              onChange={(ids) => sincronizar("unit", ids)}
            />
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
            Trilha ativa
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
