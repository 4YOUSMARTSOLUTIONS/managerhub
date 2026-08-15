"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { PeoplePicker, type Person } from "@/components/PeoplePicker";
import { SEG_ACIDENTE_CLASS_AJUDA, SEG_ACIDENTE_CLASS_LONGO, SEG_ACIDENTE_CLASS_TONE } from "@/lib/constants";
import { hojeYmd } from "@/lib/format";
import { buscarCid } from "@/lib/actions/absenteismos";
import { salvarAcidente } from "@/lib/actions/seguranca";
import type { AcidenteRow } from "@/components/SegAcidentesManager";
import type { Enums } from "@/types/database";

const CLASSES: Enums<"seg_acidente_class">[] = ["fai", "mti", "mdi", "lti", "sif"];

/**
 * O formulário do acidente.
 *
 * A CLASSE vem primeiro porque ela muda o resto: LTI exige dias de afastamento
 * (o banco recusa sem), e a tela diz isso antes de a pessoa preencher o
 * formulário inteiro para levar erro no fim.
 *
 * O CID não é digitado. Quem digita descrição de doença erra, e o registro
 * legal fica divergente do laudo; a busca é na tabela oficial do DATASUS, a
 * mesma do módulo de absenteísmo, e o que se grava é o par código+descrição.
 */
export function SegAcidenteDialog({
  onClose, editando, pessoas, locais, areas, causas,
}: {
  onClose: () => void;
  /** null = novo registro. O pai monta este componente com `key`, então cada
   *  abertura começa limpa sem precisar de efeito de reset. */
  editando: AcidenteRow | null;
  pessoas: Person[];
  locais: { id: string; name: string; active: boolean }[];
  areas: { id: string; name: string; localId: string | null; active: boolean }[];
  causas: { id: string; name: string; active: boolean }[];
}) {
  const [pessoa, setPessoa] = useState<string[]>(editando ? [editando.userId] : []);
  // `hojeYmd` e não `toISOString`: o segundo é UTC e abriria o formulário com
  // a data de amanhã depois das 21h
  const [data, setData] = useState(() => editando?.occurredOn ?? hojeYmd());
  const [hora, setHora] = useState(editando?.occurredAt?.slice(0, 5) ?? "");
  const [turno, setTurno] = useState(editando?.turno ?? "");
  const [classe, setClasse] = useState<Enums<"seg_acidente_class">>(editando?.classe ?? "fai");
  const [localId, setLocalId] = useState(editando?.localId ?? "");
  const [areaId, setAreaId] = useState(editando?.areaId ?? "");
  const [descricao, setDescricao] = useState(editando?.descricao ?? "");
  const [testemunhas, setTestemunhas] = useState(editando?.testemunhas ?? "");
  const [parteCorpo, setParteCorpo] = useState(editando?.parteCorpo ?? "");
  const [agente, setAgente] = useState(editando?.agenteCausador ?? "");
  const [natureza, setNatureza] = useState(editando?.naturezaLesao ?? "");
  const [analise, setAnalise] = useState(editando?.analiseCausa ?? "");
  const [causa, setCausa] = useState(editando?.causaId ?? "");
  const [catNumero, setCatNumero] = useState(editando?.catNumero ?? "");
  const [catData, setCatData] = useState(editando?.catEmitidaEm ?? "");
  const [cid, setCid] = useState<{ code: string; description: string } | null>(
    editando?.cidCode ? { code: editando.cidCode, description: editando.cidDescricao ?? "" } : null,
  );
  const [buscaCid, setBuscaCid] = useState("");
  const [resultadosCid, setResultadosCid] = useState<{ code: string; description: string }[]>([]);
  const [dias, setDias] = useState(editando?.diasAfastamento != null ? String(editando.diasAfastamento) : "");
  const [afastamentoDe, setAfastamentoDe] = useState(editando?.afastamentoDe ?? "");
  const [retorno, setRetorno] = useState(editando?.retornoEm ?? "");
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const areasVisiveis = useMemo(
    () => areas.filter((a) => a.active && (!a.localId || a.localId === localId)),
    [areas, localId],
  );

  const procurarCid = () => {
    iniciar(async () => {
      const r = await buscarCid(buscaCid);
      setResultadosCid(r);
    });
  };

  const salvar = () => {
    setErro("");
    if (pessoa.length === 0) { setErro("Informe quem se acidentou."); return; }
    if (!descricao.trim()) { setErro("Descreva o acidente."); return; }
    if (classe === "lti" && (!dias || Number(dias) <= 0)) {
      setErro("LTI é acidente com afastamento: informe quantos dias.");
      return;
    }
    iniciar(async () => {
      const r = await salvarAcidente({
        id: editando?.id,
        userId: pessoa[0],
        occurredOn: data,
        occurredAt: hora || null,
        turno: turno || null,
        classe,
        // a unidade não é escolhida: vem do vínculo do acidentado, carimbada
        // pelo trigger `stamp_seg_acidente`
        localId: localId || null,
        areaId: areaId || null,
        descricao,
        testemunhas,
        parteCorpo,
        agenteCausador: agente,
        naturezaLesao: natureza,
        analiseCausa: analise,
        causaId: causa || null,
        catNumero,
        catEmitidaEm: catData || null,
        cidCode: cid?.code ?? null,
        cidDescricao: cid?.description ?? null,
        diasAfastamento: dias ? Number(dias) : null,
        afastamentoDe: afastamentoDe || null,
        retornoEm: retorno || null,
      });
      if (r.error) { setErro(r.error); return; }
      toast.success(r.message ?? "Acidente salvo.");
      onClose();
      router.refresh();
    });
  };

  const exigeAfastamento = classe === "lti";

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)",
        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "4vh 1rem", zIndex: 50, overflowY: "auto",
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 760, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>
            {editando ? "Editar acidente" : "Registrar acidente"}
          </h2>
          <button
            type="button" onClick={onClose} className="muted" aria-label="Fechar"
            style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1.1rem" }}>
          <div>
            <label className="label">Classificação <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.5rem" }}>
              {CLASSES.map((c) => (
                <button
                  key={c} type="button" onClick={() => setClasse(c)} aria-pressed={classe === c}
                  style={{
                    padding: "0.55rem 0.6rem", cursor: "pointer", textAlign: "left",
                    background: classe === c ? "var(--mh-primary-soft)" : "var(--surface-2)",
                    border: "1px solid " + (classe === c ? "var(--mh-primary-500)" : "var(--border)"),
                    borderRadius: "var(--mh-radius-md)", color: "var(--mh-text-1)",
                    fontSize: "0.78rem", fontWeight: classe === c ? 600 : 500,
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                    <span
                      aria-hidden
                      style={{
                        width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                        background: `var(--mh-${SEG_ACIDENTE_CLASS_TONE[c] === "dark" ? "text-1" : SEG_ACIDENTE_CLASS_TONE[c] === "blue" ? "info" : SEG_ACIDENTE_CLASS_TONE[c] === "amber" ? "warning" : "danger"})`,
                      }}
                    />
                    {SEG_ACIDENTE_CLASS_LONGO[c]}
                  </span>
                </button>
              ))}
            </div>
            <p className="soft" style={{ fontSize: "0.74rem", margin: "0.4rem 0 0" }}>{SEG_ACIDENTE_CLASS_AJUDA[classe]}</p>
          </div>

          <div>
            <label className="label">Colaborador acidentado <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            {editando ? (
              <p style={{ margin: 0, fontSize: "0.88rem", fontWeight: 600 }}>
                {editando.pessoa ?? "—"}
                <span className="soft" style={{ fontWeight: 400, fontSize: "0.76rem" }}>
                  {" "}· a pessoa não muda na edição, o vínculo já foi carimbado
                </span>
              </p>
            ) : (
              <>
                <PeoplePicker people={pessoas} selected={pessoa} onChange={setPessoa} single placeholder="Buscar colaborador…" />
                <p className="soft" style={{ fontSize: "0.74rem", margin: "0.35rem 0 0" }}>
                  Setor, função, gestor e unidade são carimbados do vínculo dele na data do acidente.
                </p>
              </>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.8rem" }}>
            <div>
              <label className="label">Data <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <input className="input" type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </div>
            <div>
              <label className="label">Hora</label>
              <input className="input" type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
            </div>
            <div>
              <label className="label">Turno</label>
              <input className="input" value={turno} placeholder="1º turno" onChange={(e) => setTurno(e.target.value)} />
            </div>
            <div>
              <label className="label">Local</label>
              <select
                className="select" value={localId}
                onChange={(e) => { setLocalId(e.target.value); setAreaId(""); }}
              >
                <option value="">Não informar</option>
                {locais.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Área</label>
              <select className="select" value={areaId} onChange={(e) => setAreaId(e.target.value)}>
                <option value="">Não informar</option>
                {areasVisiveis.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="label">O que aconteceu <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <textarea
              className="input" rows={3} value={descricao}
              placeholder="Descreva o acidente: o que a pessoa fazia, o que houve e o que aconteceu em seguida."
              onChange={(e) => setDescricao(e.target.value)}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.8rem" }}>
            <div>
              <label className="label">Parte do corpo atingida</label>
              <input className="input" value={parteCorpo} placeholder="Mão direita" onChange={(e) => setParteCorpo(e.target.value)} />
            </div>
            <div>
              <label className="label">Agente causador</label>
              <input className="input" value={agente} placeholder="Empilhadeira" onChange={(e) => setAgente(e.target.value)} />
            </div>
            <div>
              <label className="label">Natureza da lesão</label>
              <input className="input" value={natureza} placeholder="Corte" onChange={(e) => setNatureza(e.target.value)} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="label">Testemunhas</label>
              <input className="input" value={testemunhas} placeholder="Nomes de quem presenciou" onChange={(e) => setTestemunhas(e.target.value)} />
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.9rem" }}>
            <h3 style={{ fontSize: "0.85rem", fontWeight: 700, margin: "0 0 0.6rem" }}>Registro legal</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.8rem" }}>
              <div>
                <label className="label">Número da CAT</label>
                <input className="input" value={catNumero} onChange={(e) => setCatNumero(e.target.value)} />
              </div>
              <div>
                <label className="label">CAT emitida em</label>
                <input className="input" type="date" value={catData} onChange={(e) => setCatData(e.target.value)} />
              </div>
            </div>

            <div style={{ marginTop: "0.8rem" }}>
              <label className="label">CID-10</label>
              {cid ? (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span className="badge badge-purple">{cid.code}</span>
                  <span style={{ fontSize: "0.83rem" }}>{cid.description}</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCid(null)}>Trocar</button>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <input
                      className="input" value={buscaCid}
                      placeholder="Buscar por código ou descrição…"
                      onChange={(e) => setBuscaCid(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); procurarCid(); } }}
                    />
                    <button type="button" className="btn btn-ghost btn-sm" disabled={pendente} onClick={procurarCid}>
                      <Search size={15} /> Buscar
                    </button>
                  </div>
                  {resultadosCid.length > 0 && (
                    <div style={{ marginTop: "0.4rem", maxHeight: 160, overflowY: "auto", border: "1px solid var(--border)", borderRadius: "var(--mh-radius-md)" }}>
                      {resultadosCid.map((c) => (
                        <button
                          key={c.code} type="button"
                          onClick={() => { setCid(c); setResultadosCid([]); setBuscaCid(""); }}
                          style={{
                            display: "block", width: "100%", textAlign: "left", padding: "0.4rem 0.6rem",
                            background: "none", border: "none", cursor: "pointer", fontSize: "0.8rem",
                            color: "var(--mh-text-1)",
                          }}
                        >
                          <strong>{c.code}</strong> {c.description}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.8rem", marginTop: "0.8rem" }}>
              <div>
                <label className="label">
                  Dias de afastamento {exigeAfastamento && <span style={{ color: "var(--mh-danger)" }}>*</span>}
                </label>
                <input className="input" type="number" min={0} value={dias} onChange={(e) => setDias(e.target.value)} />
              </div>
              <div>
                <label className="label">Afastado desde</label>
                <input className="input" type="date" value={afastamentoDe} onChange={(e) => setAfastamentoDe(e.target.value)} />
              </div>
              <div>
                <label className="label">Retorno ao trabalho</label>
                <input className="input" type="date" value={retorno} onChange={(e) => setRetorno(e.target.value)} />
              </div>
            </div>
          </div>

          <div>
            {/* a causa do catálogo é o que empilha em gráfico; o texto abaixo é
                a análise por extenso, que serve ao laudo mas não à tendência */}
            <label className="label">Causa-raiz</label>
            <select className="select" value={causa} onChange={(e) => setCausa(e.target.value)}>
              <option value="">Ainda não apontada</option>
              {causas.filter((c) => c.active || c.id === editando?.causaId).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Análise da causa</label>
            <textarea
              className="input" rows={2} value={analise}
              placeholder="Pode ser preenchida depois, quando a apuração terminar."
              onChange={(e) => setAnalise(e.target.value)}
            />
          </div>

          {erro && (
            <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
              {erro}
            </p>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" disabled={pendente} onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={pendente} onClick={salvar}>
            {pendente ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
