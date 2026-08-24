"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { PeoplePicker, type Person } from "@/components/PeoplePicker";
import { SearchSelect } from "@/components/SearchSelect";
import { PRIORITY } from "@/lib/constants";
import { hojeYmd, somarDias } from "@/lib/format";
import { criarAcaoDoAcidente, criarAcaoDoRelato } from "@/lib/actions/seguranca";
import type { Enums } from "@/types/database";

export type OpcaoSimples = { id: string; name: string };
export type OpcaoSub = { id: string; name: string; departmentId: string };

type Demanda = { descricao: string; responsaveis: string[] };

/**
 * A ação de tratamento, do relato ou do acidente.
 *
 * Não é o formulário completo de ação: KPI, ferramenta e série de reunião ficam
 * de fora porque não têm papel no fluxo de segurança e só alongariam a tela. O
 * que ficou é o que a equipe decide na hora do caso, e tudo continua editável
 * depois em /acoes, com o vínculo intacto.
 *
 * VÁRIAS DEMANDAS na mesma ação: um acidente sério gera três providências
 * (treinar, comprar o EPI, refazer o procedimento) que são o MESMO caso. Uma
 * ação por providência espalharia três códigos sem nada dizendo que vieram do
 * mesmo fato.
 *
 * Setor, subsetor e unidade vêm preenchidos com o carimbo da época e ficam
 * editáveis: o normal é a ação ser da área onde o fato aconteceu, mas o
 * tratamento às vezes é de outra (acidente no picking, ação da Manutenção).
 *
 * O `alvo` decide o vínculo e a que item do Programa a ação nasce amarrada:
 * relato vai para o 1.2, acidente para o 1.1.
 */
export function SegAcaoDialog({
  open, onClose, alvo, problema, sugestaoResponsaveis, pessoas,
  unitId, departmentId, subdepartmentId, itemPrograma,
  unidades = [], setores = [], subsetores = [], solicitantePadrao,
}: {
  open: boolean;
  onClose: () => void;
  alvo: { tipo: "relato" | "acidente"; id: string };
  problema: string;
  sugestaoResponsaveis: string[];
  pessoas: Person[];
  /** carimbo da época: viram o padrão dos campos, que seguem editáveis */
  unitId: string | null;
  departmentId: string | null;
  subdepartmentId: string | null;
  /** o item do Programa configurado; null quando a empresa não usa */
  itemPrograma: { item: string; bloco: string; secao: string | null; pilar: string | null } | null;
  unidades?: OpcaoSimples[];
  setores?: OpcaoSimples[];
  subsetores?: OpcaoSub[];
  /** quem está registrando; entra como solicitante e pode ser trocado */
  solicitantePadrao: string;
}) {
  const [demandas, setDemandas] = useState<Demanda[]>([
    { descricao: "", responsaveis: sugestaoResponsaveis },
  ]);
  // uma semana é o padrão porque tratamento de segurança não espera o mês virar
  const [prazo, setPrazo] = useState(() => somarDias(hojeYmd(), 7));
  const [prioridade, setPrioridade] = useState<Enums<"priority_level">>("high");
  const [solicitante, setSolicitante] = useState(solicitantePadrao);
  const [cc, setCc] = useState<string[]>([]);
  const [unidade, setUnidade] = useState(unitId ?? "");
  const [setor, setSetor] = useState(departmentId ?? "");
  const [subsetor, setSubsetor] = useState(subdepartmentId ?? "");
  const [vincular, setVincular] = useState(true);
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const subOpts = useMemo(
    () => subsetores.filter((x) => !setor || x.departmentId === setor),
    [subsetores, setor],
  );

  const rotulo = alvo.tipo === "acidente" ? "Acidente" : "Relato";

  const fechar = () => { setErro(""); onClose(); };

  const mudarDemanda = (i: number, campos: Partial<Demanda>) =>
    setDemandas((atual) => atual.map((d, j) => (j === i ? { ...d, ...campos } : d)));

  const salvar = () => {
    setErro("");
    iniciar(async () => {
      const comum = {
        // demanda em branco é linha que a pessoa abriu e desistiu: some sem
        // reclamar, em vez de barrar o envio inteiro
        demandas: demandas
          .filter((d) => d.descricao.trim())
          .map((d) => ({ descricao: d.descricao.trim(), responsaveis: d.responsaveis })),
        prazo,
        prioridade,
        problema,
        solicitante,
        cc,
        unitId: unidade || null,
        departmentId: setor || null,
        subdepartmentId: subsetor || null,
        vincularPrograma: vincular,
      };
      const r = alvo.tipo === "acidente"
        ? await criarAcaoDoAcidente({ acidenteId: alvo.id, ...comum })
        : await criarAcaoDoRelato({ relatoId: alvo.id, ...comum });
      if (r.error) { setErro(r.error); return; }
      if (r.warning) toast.warning(r.warning);
      else toast.success(r.message ?? "Ação criada.");
      setDemandas([{ descricao: "", responsaveis: sugestaoResponsaveis }]);
      onClose();
      router.refresh();
    });
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)",
        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "6vh 1rem", zIndex: 60, overflowY: "auto",
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 620, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>Ação de tratamento</h2>
          <button
            type="button" onClick={fechar} className="muted" aria-label="Fechar"
            style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "1.15rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          <div style={{ background: "var(--surface-2)", borderRadius: "var(--mh-radius-md)", padding: "0.6rem 0.8rem" }}>
            <div className="soft" style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>{rotulo}</div>
            <p style={{ margin: "0.2rem 0 0", fontSize: "0.82rem" }}>{problema}</p>
          </div>

          {demandas.map((d, i) => (
            <div
              key={i}
              style={{
                border: "1px solid var(--border)", borderRadius: "var(--mh-radius-md)",
                padding: "0.75rem 0.85rem", display: "flex", flexDirection: "column", gap: "0.7rem",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="soft" style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {demandas.length === 1 ? "O que deve ser feito" : `Providência ${i + 1}`}
                </span>
                {demandas.length > 1 && (
                  <button
                    type="button" className="btn btn-ghost btn-icon btn-sm" title="Remover"
                    onClick={() => setDemandas((atual) => atual.filter((_, j) => j !== i))}
                  >
                    <X size={14} aria-hidden />
                  </button>
                )}
              </div>

              <div>
                <label className="label">
                  Descrição {i === 0 && <span style={{ color: "var(--mh-danger)" }}>*</span>}
                </label>
                <textarea
                  className="input" rows={2} value={d.descricao}
                  placeholder="Ex.: revisar a sinalização da área de descarga e reforçar a regra na conversa diária."
                  onChange={(e) => mudarDemanda(i, { descricao: e.target.value })}
                />
              </div>

              <div>
                <label className="label">
                  Responsáveis {i === 0 && <span style={{ color: "var(--mh-danger)" }}>*</span>}
                </label>
                <PeoplePicker
                  people={pessoas} selected={d.responsaveis}
                  onChange={(ids) => mudarDemanda(i, { responsaveis: ids })}
                  placeholder="Buscar responsável…"
                />
                {i === 0 && sugestaoResponsaveis.length > 0 && (
                  <p className="soft" style={{ fontSize: "0.73rem", margin: "0.3rem 0 0" }}>
                    Sugerido: o gestor do envolvido na data do {rotulo.toLowerCase()}.
                  </p>
                )}
              </div>
            </div>
          ))}

          <div>
            <button
              type="button" className="btn btn-ghost btn-sm"
              onClick={() => setDemandas((atual) => [...atual, { descricao: "", responsaveis: [] }])}
            >
              <Plus size={14} aria-hidden /> Outra providência
            </button>
            <p className="soft" style={{ fontSize: "0.73rem", margin: "0.3rem 0 0" }}>
              Tudo que o mesmo caso exige fica numa ação só, com um código só.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.8rem" }}>
            <div>
              <label className="label">Prazo <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <input className="input" type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
            </div>
            <div>
              <label className="label">Prioridade</label>
              <select
                className="select" value={prioridade}
                onChange={(e) => setPrioridade(e.target.value as Enums<"priority_level">)}
              >
                {(Object.keys(PRIORITY) as Enums<"priority_level">[]).map((p) => (
                  <option key={p} value={p}>{PRIORITY[p]}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Solicitante</label>
            <PeoplePicker
              people={pessoas} selected={solicitante ? [solicitante] : []}
              onChange={(ids) => setSolicitante(ids[0] ?? "")}
              single placeholder="Buscar solicitante…"
            />
          </div>

          <div>
            <label className="label">Em cópia</label>
            <PeoplePicker
              people={pessoas} selected={cc} onChange={setCc}
              placeholder="Buscar quem acompanha…"
            />
            <p className="soft" style={{ fontSize: "0.73rem", margin: "0.3rem 0 0" }}>
              Acompanham a ação sem serem responsáveis por ela.
            </p>
          </div>

          {/* O recorte da AÇÃO, não o da pessoa: vem do carimbo do caso, mas o
              tratamento às vezes é de outra área, e aí a exportação e os
              relatórios precisam do setor certo. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 170px), 1fr))", gap: "0.8rem" }}>
            {unidades.length > 0 && (
              <div>
                <label className="label">Unidade</label>
                <SearchSelect
                  options={unidades} value={unidade} onChange={setUnidade}
                  placeholder="Buscar unidade…"
                />
              </div>
            )}
            {setores.length > 0 && (
              <>
                <div>
                  <label className="label">Setor</label>
                  <SearchSelect
                    options={setores}
                    value={setor}
                    onChange={(id) => {
                      setSetor(id);
                      // subsetor que não pertence ao setor novo não faz sentido
                      if (subsetor) {
                        const sub = subsetores.find((x) => x.id === subsetor);
                        if (!id || (sub && sub.departmentId !== id)) setSubsetor("");
                      }
                    }}
                    placeholder="Buscar setor…"
                  />
                </div>
                <div>
                  <label className="label">Subsetor</label>
                  <SearchSelect
                    options={subOpts}
                    value={subsetor}
                    onChange={(id) => {
                      setSubsetor(id);
                      // escolher o subsetor primeiro preenche o setor dele
                      if (id) {
                        const sub = subsetores.find((x) => x.id === id);
                        if (sub) setSetor(sub.departmentId);
                      }
                    }}
                    placeholder={setor ? "Buscar subsetor…" : "Escolha o setor primeiro…"}
                    emptyHint="Sem subsetores neste setor"
                  />
                </div>
              </>
            )}
          </div>

          {/* O item do pilar Segurança cobra registro COM ações corretivas e
              preventivas evidenciadas. Nascendo amarrada, a ação vira evidência
              sozinha, sem ninguém garimpar /acoes depois. */}
          {itemPrograma && (
            <label
              style={{
                display: "flex", gap: "0.55rem", alignItems: "flex-start", cursor: "pointer",
                background: "var(--surface-2)", borderRadius: "var(--mh-radius-md)", padding: "0.6rem 0.8rem",
              }}
            >
              <input
                type="checkbox" checked={vincular} style={{ marginTop: 3 }}
                onChange={(e) => setVincular(e.target.checked)}
              />
              <span style={{ fontSize: "0.8rem" }}>
                Vincular ao Programa de Excelência
                <span className="soft" style={{ display: "block", fontSize: "0.75rem" }}>
                  {[itemPrograma.pilar, itemPrograma.secao, itemPrograma.bloco].filter(Boolean).join(" › ")}
                  {" › "}{itemPrograma.item}
                </span>
              </span>
            </label>
          )}

          {alvo.tipo === "relato" && (
            <p className="soft" style={{ fontSize: "0.75rem", margin: 0 }}>
              A ação aparece em Ações para o responsável, sem qualquer referência a quem relatou.
            </p>
          )}

          {erro && (
            <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
              {erro}
            </p>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" disabled={pendente} onClick={fechar}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={pendente} onClick={salvar}>
            {pendente ? "Criando…" : "Criar ação"}
          </button>
        </div>
      </div>
    </div>
  );
}
