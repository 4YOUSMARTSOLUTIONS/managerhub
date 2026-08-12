"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { PeoplePicker } from "@/components/PeoplePicker";
import { MultiSelect } from "@/components/ui/MultiSelect";
import {
  saveTraining,
  type EscopoTreinamento, type RegraPublico, type ResponsavelTreinamento, type TrainingForEdit,
} from "@/lib/actions/trainings";
import { PERIODICIDADE_OPCOES, DELIVERY_LABEL } from "@/lib/training-schedule";
import type { Enums } from "@/types/database";

import type { PersonOpt } from "@/components/TrainingsManager";

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
  people: PersonOpt[];
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
  // escopo por tipo: lista vazia = "todos" daquele tipo
  const doTipo = (k: EscopoTreinamento["kind"]) =>
    (training?.escopos ?? []).filter((e) => e.kind === k).map((e) => e.refId);
  const [unitIds, setUnitIds] = useState<string[]>(doTipo("unit"));
  const [deptIds, setDeptIds] = useState<string[]>(doTipo("department"));
  const [subIds, setSubIds] = useState<string[]>(doTipo("subdepartment"));
  const [pilarIds, setPilarIds] = useState<string[]>(doTipo("pilar"));
  const [active, setActive] = useState(training?.active ?? true);
  /**
   * Responsáveis em dois modos, e não os dois ao mesmo tempo.
   *
   * O caso comum é o mesmo dono em todas as unidades, e mostrar um campo por
   * unidade só para isso enchia a tela de campos vazios. O modo por unidade
   * existe porque cada filial costuma ter quem responde por ela; ele aparece
   * quando é pedido, não por padrão.
   */
  const [mesmoResponsavel, setMesmoResponsavel] = useState(
    // ao reabrir, o modo é o que já está gravado
    !(training?.owners ?? []).some((o) => o.unitId),
  );
  const [ownersGerais, setOwnersGerais] = useState<string[]>(
    (training?.owners ?? []).filter((o) => !o.unitId).map((o) => o.userId),
  );
  const [ownersPorUnidade, setOwnersPorUnidade] = useState<Record<string, string[]>>(() => {
    const m: Record<string, string[]> = {};
    for (const o of training?.owners ?? []) {
      if (o.unitId) m[o.unitId] = [...(m[o.unitId] ?? []), o.userId];
    }
    return m;
  });
  const [regras, setRegras] = useState<RegraPublico[]>(training?.regras ?? []);

  const [erro, setErro] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  // subsetor segue os setores marcados: oferecer subsetor de outra área só
  // produziria combinação que não descreve ninguém
  const subsDoSetor = deptIds.length > 0
    ? subdepartments.filter((s) => deptIds.includes(s.departmentId))
    : subdepartments;

  // as unidades que pedem responsável próprio: as marcadas, ou todas quando o
  // treinamento vale para a empresa inteira
  const unidadesDoEscopo = unitIds.length > 0 ? units.filter((u) => unitIds.includes(u.id)) : units;

  /**
   * Quem o escopo alcança.
   *
   * "Quem deve fazer" só pode oferecer o que existe dentro do escopo: um
   * treinamento do Armazém não deveria aceitar o cargo de Auxiliar Financeiro,
   * e aceitar hoje significa uma matrícula indevida que só aparece meses depois
   * num relatório de conformidade errado.
   *
   * Lista vazia num tipo de escopo significa "todos", então ela não filtra nada.
   */
  const pessoasNoEscopo = useMemo(() => people.filter((p) => {
    if (unitIds.length > 0 && !p.unitIds.some((u) => unitIds.includes(u))) return false;
    if (deptIds.length > 0 && !(p.deptId && deptIds.includes(p.deptId))) return false;
    if (subIds.length > 0 && !(p.subId && subIds.includes(p.subId))) return false;
    return true;
  }), [people, unitIds, deptIds, subIds]);

  const temEscopo = unitIds.length > 0 || deptIds.length > 0 || subIds.length > 0;

  // cargos que de fato existem no escopo, e não o catálogo inteiro
  const cargosNoEscopo = useMemo(() => {
    if (!temEscopo) return positions;
    const ids = new Set(pessoasNoEscopo.map((p) => p.positionId).filter(Boolean) as string[]);
    return positions.filter((c) => ids.has(c.id));
  }, [positions, pessoasNoEscopo, temEscopo]);

  const setoresNoEscopo = deptIds.length > 0 ? departments.filter((d) => deptIds.includes(d.id)) : departments;
  const subsNoEscopo = subIds.length > 0 ? subdepartments.filter((x) => subIds.includes(x.id)) : subsDoSetor;
  const unidadesParaPublico = unidadesDoEscopo;

  /**
   * Regra que saiu do escopo é removida na hora, com aviso.
   *
   * Deixar a regra órfã cadastrada seria pior: ela continuaria matriculando
   * gente de fora na próxima materialização, sem nada na tela explicando por quê.
   */
  const [avisoEscopo, setAvisoEscopo] = useState("");
  useEffect(() => {
    const valida = (r: RegraPublico) => {
      if (r.kind === "position") return cargosNoEscopo.some((c) => c.id === r.refId);
      if (r.kind === "department") return setoresNoEscopo.some((d) => d.id === r.refId);
      if (r.kind === "subdepartment") return subsNoEscopo.some((x) => x.id === r.refId);
      if (r.kind === "unit") return unidadesParaPublico.some((u) => u.id === r.refId);
      return pessoasNoEscopo.some((p) => p.id === r.refId);
    };
    const mantidas = regras.filter(valida);
    if (mantidas.length !== regras.length) {
      const fora = regras.length - mantidas.length;
      setRegras(mantidas);
      setAvisoEscopo(
        `${fora} ${fora === 1 ? "item saiu" : "itens saíram"} de "quem deve fazer" por ficar fora do escopo.`,
      );
    }
    // roda quando o ESCOPO muda; `regras` fica de fora para o aviso não se
    // reprocessar a cada item adicionado à mão
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargosNoEscopo, setoresNoEscopo, subsNoEscopo, unidadesParaPublico, pessoasNoEscopo]);

  /** o que já está marcado de um tipo, para o seletor mostrar o check */
  const marcados = (kind: RegraPublico["kind"]) =>
    regras.filter((r) => r.kind === kind).map((r) => r.refId);

  /**
   * Troca de uma vez o conjunto de um tipo, preservando o "Obrigatório" de quem
   * já estava na lista: desmarcar e remarcar um cargo não pode zerar a escolha
   * que a pessoa fez ao lado.
   */
  const sincronizar = (kind: RegraPublico["kind"], ids: string[]) => {
    const antigas = new Map(regras.filter((r) => r.kind === kind).map((r) => [r.refId, r.mandatory]));
    setRegras([
      ...regras.filter((r) => r.kind !== kind),
      ...ids.map((refId) => ({ kind, refId, mandatory: antigas.get(refId) ?? true })),
    ]);
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
      const escopos: EscopoTreinamento[] = [
        ...unitIds.map((id) => ({ kind: "unit" as const, refId: id })),
        ...deptIds.map((id) => ({ kind: "department" as const, refId: id })),
        ...subIds.map((id) => ({ kind: "subdepartment" as const, refId: id })),
        ...pilarIds.map((id) => ({ kind: "pilar" as const, refId: id })),
      ];
      // grava só o modo ativo: o outro fica no formulário, não no banco
      const owners: ResponsavelTreinamento[] = mesmoResponsavel || unidadesDoEscopo.length <= 1
        ? ownersGerais.map((userId) => ({ userId, unitId: null }))
        : unidadesDoEscopo.flatMap((u) =>
            (ownersPorUnidade[u.id] ?? []).map((userId) => ({ userId, unitId: u.id })));
      const r = await saveTraining({
        id: training?.id,
        name, description, code,
        workload_minutes: carga,
        delivery,
        validade_meses: validade === "" ? null : Number(validade),
        antecipacao_dias: Number(antecipacao) || 60,
        prazo_dias: prazo === "" ? null : Number(prazo),
        escopos,
        active,
        owners,
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
          <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
            Deixar um campo em branco vale para todos: não é preciso marcar tudo para dizer o óbvio.
          </p>
          {/* sem <label> em volta: o MultiSelect já escreve o próprio rótulo */}
          <div style={grid2}>
            <MultiSelect
              label="Unidades"
              allLabel="Todas as unidades"
              options={units.map((u) => ({ value: u.id, label: u.name }))}
              selected={unitIds}
              onChange={setUnitIds}
            />
            <MultiSelect
              label="Setores"
              allLabel="Todos os setores"
              searchable
              options={departments.map((d) => ({ value: d.id, label: d.name }))}
              selected={deptIds}
              onChange={(v) => {
                setDeptIds(v);
                // subsetor de setor que saiu deixa de fazer sentido
                setSubIds(subIds.filter((id) =>
                  v.length === 0 || v.includes(subdepartments.find((s) => s.id === id)?.departmentId ?? "")));
              }}
            />
            <MultiSelect
              label="Subsetores"
              allLabel="Todos os subsetores"
              searchable
              options={subsDoSetor.map((s) => ({ value: s.id, label: s.name }))}
              selected={subIds}
              onChange={setSubIds}
            />
            <MultiSelect
              label="Pilares"
              allLabel="Nenhum pilar"
              searchable
              options={pilares.map((p) => ({ value: p.id, label: p.name }))}
              selected={pilarIds}
              onChange={setPilarIds}
            />
          </div>

          <p style={sectionTitle}>Responsáveis<Req /></p>
          {unidadesDoEscopo.length > 1 && (
            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem" }}>
              <input
                type="checkbox"
                checked={mesmoResponsavel}
                onChange={(e) => setMesmoResponsavel(e.target.checked)}
              />
              Mesmo responsável para todas as unidades
            </label>
          )}

          {mesmoResponsavel || unidadesDoEscopo.length <= 1 ? (
            <PeoplePicker people={people} selected={ownersGerais} onChange={setOwnersGerais} placeholder="Buscar responsável…" />
          ) : (
            unidadesDoEscopo.map((u) => (
              <div key={u.id}>
                <label className="label">{u.name}</label>
                <PeoplePicker
                  people={people}
                  selected={ownersPorUnidade[u.id] ?? []}
                  onChange={(ids) => setOwnersPorUnidade({ ...ownersPorUnidade, [u.id]: ids })}
                  placeholder={`Buscar responsável em ${u.name}…`}
                />
              </div>
            ))
          )}

          <p style={sectionTitle}>Quem deve fazer</p>
          <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
            A regra acompanha a estrutura: quem entra no cargo passa a dever o treinamento, e quem sai
            deixa de ser cobrado sem perder o que já fez.
            {temEscopo && " As opções abaixo são só as que existem dentro do escopo escolhido acima."}
          </p>
          {avisoEscopo && (
            <p style={{ fontSize: "0.8rem", margin: 0, color: "var(--mh-warning, var(--text))", background: "var(--mh-surface-1)", border: "1px solid var(--border)", padding: "0.45rem 0.7rem", borderRadius: 8 }}>
              {avisoEscopo}
            </p>
          )}
          <div>
            <label className="label">Por colaborador</label>
            <PeoplePicker
              people={pessoasNoEscopo}
              selected={regras.filter((r) => r.kind === "user").map((r) => r.refId)}
              onChange={(ids) => setRegras([
                ...regras.filter((r) => r.kind !== "user"),
                ...ids.map((id) => ({
                  kind: "user" as const,
                  refId: id,
                  // mantém o que já estava marcado ao reabrir a lista
                  mandatory: regras.find((r) => r.kind === "user" && r.refId === id)?.mandatory ?? true,
                })),
              ])}
              placeholder="Buscar colaborador…"
            />
            <p className="soft" style={{ fontSize: "0.72rem", margin: "0.3rem 0 0" }}>
              Para quem deve fazer independentemente do cargo. Diferente de matricular avulso:
              a regra continua valendo nos próximos ciclos.
            </p>
          </div>

          <div style={grid2}>
            {/* MultiSelect e não <select>: ele marca com um check o que já foi
                escolhido e tem busca, que é o que salva uma lista de 197 cargos */}
            <MultiSelect
              label="Por cargo"
              searchable
              allLabel={cargosNoEscopo.length > 0 ? "Nenhum cargo" : "Nenhum cargo no escopo"}
              options={cargosNoEscopo.map((p) => ({ value: p.id, label: p.name }))}
              selected={marcados("position")}
              onChange={(ids) => sincronizar("position", ids)}
            />
            <MultiSelect
              label="Por setor"
              searchable
              allLabel="Nenhum setor"
              options={setoresNoEscopo.map((d) => ({ value: d.id, label: d.name }))}
              selected={marcados("department")}
              onChange={(ids) => sincronizar("department", ids)}
            />
            <MultiSelect
              label="Por subsetor"
              searchable
              allLabel="Nenhum subsetor"
              options={subsNoEscopo.map((x) => ({ value: x.id, label: x.name }))}
              selected={marcados("subdepartment")}
              onChange={(ids) => sincronizar("subdepartment", ids)}
            />
            <MultiSelect
              label="Por unidade"
              allLabel="Nenhuma unidade"
              options={unidadesParaPublico.map((u) => ({ value: u.id, label: u.name }))}
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
