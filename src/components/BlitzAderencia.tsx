"use client";

import { useMemo, useState } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { ExportButton } from "@/components/ui/ExportButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDate, normalizar, shortName } from "@/lib/format";
import {
  pct, type AderenciaDados, type AderenciaGrupo, type AderenciaPessoa, type BlitzRecorrencia,
} from "@/lib/blitz-aderencia";

// ---------------------------------------------------------------- base

type Campo = "unidade" | "setor" | "gestor" | "funcao";
const VAZIO: Record<Campo, string> = { unidade: "Sem unidade", setor: "Sem setor", gestor: "Sem gestor", funcao: "Sem função" };

/** Agrupa o público por um campo: quantos são e quantos passaram. */
function agrupar(pessoas: AderenciaPessoa[], campo: Campo): AderenciaGrupo[] {
  const m = new Map<string, AderenciaGrupo>();
  for (const p of pessoas) {
    const nome = p[campo] ?? VAZIO[campo];
    const g = m.get(nome) ?? { nome, publico: 0, passaram: 0 };
    g.publico += 1;
    if (p.passou) g.passaram += 1;
    m.set(nome, g);
  }
  return ordenar([...m.values()]);
}

/** Da maior aderência para a menor (LUIZ, 11/11/2026); empate vai pelo nome. */
function ordenar(grupos: AderenciaGrupo[]) {
  return [...grupos].sort((a, b) =>
    (pct(b.passaram, b.publico) ?? 0) - (pct(a.passaram, a.publico) ?? 0) || a.nome.localeCompare(b.nome, "pt-BR"));
}

/**
 * A escala pedida (LUIZ, 11/11/2026): roxo é pior, azul é melhor. A mistura
 * é em OKLab entre o roxo da marca e o azul de informação do tema, então
 * acompanha o claro e o escuro sem cor fixa.
 */
const corDaEscala = (p: number) =>
  `color-mix(in oklab, var(--mh-primary-500) ${100 - p}%, var(--mh-info) ${p}%)`;

function LegendaEscala() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.72rem" }} className="soft">
      <span>0%</span>
      <span aria-hidden style={{ width: 90, height: 8, borderRadius: 99, background: "linear-gradient(90deg, var(--mh-primary-500), var(--mh-info))" }} />
      <span>100%</span>
    </div>
  );
}

const valoresDe = (lista: (string | null | undefined)[], vazio: string) =>
  [...new Set(lista.map((v) => v ?? vazio))].sort((a, b) => a.localeCompare(b, "pt-BR"));

/** Linha de filtros das listas: um select por campo e "Limpar". */
function Filtros({ campos, valores, opcoes, onChange }: {
  campos: { campo: Campo; rotulo: string }[];
  valores: Partial<Record<Campo, string>>;
  opcoes: Partial<Record<Campo, string[]>>;
  onChange: (campo: Campo, valor: string) => void;
}) {
  const algum = campos.some((c) => valores[c.campo]);
  return (
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
      {campos.map((c) => (
        <select key={c.campo} className="select" value={valores[c.campo] ?? ""} aria-label={c.rotulo}
          onChange={(e) => onChange(c.campo, e.target.value)} style={{ width: "auto", maxWidth: 220 }}>
          <option value="">{c.rotulo}: todos</option>
          {(opcoes[c.campo] ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      ))}
      {algum && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => campos.forEach((c) => onChange(c.campo, ""))}>
          Limpar filtros
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- gráficos

/** Barras em pé (setores): valor no topo, nome embaixo, detalhe no hover. */
function BarrasEmPe({ grupos }: { grupos: AderenciaGrupo[] }) {
  const [sobre, setSobre] = useState<string | null>(null);
  const ALTURA = 200;
  return (
    <div style={{ overflowX: "auto" }}>
      <div
        role="img" aria-label="Aderência por setor, da maior para a menor"
        style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 8, minWidth: grupos.length * 64, padding: "1.4rem 0 0" }}
      >
        {grupos.map((g) => {
          const p = pct(g.passaram, g.publico) ?? 0;
          const ativo = sobre === g.nome;
          return (
            <div key={g.nome} onMouseEnter={() => setSobre(g.nome)} onMouseLeave={() => setSobre(null)}
              style={{ position: "relative", flex: "1 1 0", minWidth: 56, display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span style={{ fontSize: "0.78rem", fontWeight: 700, marginBottom: 4 }}>{p}%</span>
              {/* linha de referência discreta em 50%, desenhada no fundo de cada coluna */}
              <div style={{
                width: "100%", maxWidth: 64, height: ALTURA, display: "flex", alignItems: "flex-end", borderBottom: "1px solid var(--border)",
                backgroundImage: "linear-gradient(to top, transparent calc(50% - 0.5px), var(--border) calc(50% - 0.5px), var(--border) calc(50% + 0.5px), transparent calc(50% + 0.5px))",
              }}>
                <div style={{
                  width: "100%", height: `${Math.max(p, p > 0 ? 1.5 : 0)}%`, borderRadius: "4px 4px 0 0",
                  background: corDaEscala(p), opacity: sobre && !ativo ? 0.55 : 1, transition: "opacity 120ms",
                }} />
              </div>
              <span className="soft" title={g.nome} style={{
                marginTop: 6, fontSize: "0.72rem", textAlign: "center", lineHeight: 1.25, height: "2.5em", overflow: "hidden",
                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", wordBreak: "break-word",
              }}>{g.nome}</span>
              {ativo && (
                <div role="tooltip" style={{
                  position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%)", zIndex: 5, pointerEvents: "none",
                  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.35rem 0.6rem",
                  fontSize: "0.76rem", boxShadow: "var(--mh-shadow-e2)", whiteSpace: "nowrap",
                }}>
                  <strong>{g.nome}</strong>: {g.passaram} de {g.publico} passaram ({p}%), faltam {g.publico - g.passaram}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Barras deitadas (gestores, que são muitos e têm nomes longos). */
function BarrasDeitadas({ grupos, rotulo }: { grupos: AderenciaGrupo[]; rotulo: string }) {
  const [sobre, setSobre] = useState<string | null>(null);
  return (
    <div role="img" aria-label={`Aderência por ${rotulo.toLowerCase()}, da maior para a menor`} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {grupos.map((g) => {
        const p = pct(g.passaram, g.publico) ?? 0;
        const ativo = sobre === g.nome;
        return (
          <div key={g.nome} onMouseEnter={() => setSobre(g.nome)} onMouseLeave={() => setSobre(null)}
            style={{ position: "relative", display: "grid", gridTemplateColumns: "minmax(110px, 30%) 1fr 44px", alignItems: "center", gap: "0.6rem", padding: "3px 0" }}>
            <span className="soft" title={g.nome} style={{ fontSize: "0.76rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.nome}</span>
            <div style={{ height: 14, borderLeft: "1px solid var(--border)" }}>
              <div style={{
                width: `${p}%`, minWidth: p > 0 ? 3 : 0, height: "100%", borderRadius: "0 4px 4px 0",
                background: corDaEscala(p), opacity: sobre && !ativo ? 0.55 : 1, transition: "opacity 120ms",
              }} />
            </div>
            <span style={{ fontSize: "0.78rem", fontWeight: 700, textAlign: "right" }}>{p}%</span>
            {ativo && (
              <div role="tooltip" style={{
                position: "absolute", left: "30%", bottom: "100%", zIndex: 5, pointerEvents: "none",
                background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.35rem 0.6rem",
                fontSize: "0.76rem", boxShadow: "var(--mh-shadow-e2)", whiteSpace: "nowrap",
              }}>
                <strong>{g.nome}</strong>: {g.passaram} de {g.publico} passaram ({p}%), faltam {g.publico - g.passaram}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TabelaGrupos({ grupos, rotulo }: { grupos: AderenciaGrupo[]; rotulo: string }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="table">
        <thead>
          <tr>
            <th>{rotulo}</th>
            <th style={{ textAlign: "right", width: 80 }}>Público</th>
            <th style={{ textAlign: "right", width: 85 }}>Passaram</th>
            <th style={{ textAlign: "right", width: 70 }}>Faltam</th>
            <th style={{ textAlign: "right", width: 90 }}>Aderência</th>
          </tr>
        </thead>
        <tbody>
          {grupos.map((g) => (
            <tr key={g.nome}>
              <td style={{ fontWeight: 600 }}>{g.nome}</td>
              <td className="muted" style={{ textAlign: "right" }}>{g.publico}</td>
              <td className="muted" style={{ textAlign: "right" }}>{g.passaram}</td>
              <td className="muted" style={{ textAlign: "right" }}>{g.publico - g.passaram}</td>
              <td style={{ textAlign: "right", fontWeight: 700 }}>{pct(g.passaram, g.publico) ?? 0}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Uma seção do painel: o gráfico é a visão principal, a tabela é a alternativa. */
function Secao({ numero, titulo, sufixo, grafico, tabela, vazio }: {
  numero: number; titulo: string; sufixo?: React.ReactNode;
  grafico: React.ReactNode; tabela: React.ReactNode; vazio: boolean;
}) {
  const [visao, setVisao] = useState<"grafico" | "tabela">("grafico");
  return (
    <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <h4 style={{ fontSize: "0.92rem", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <span className="soft" style={{ fontWeight: 600 }}>{numero}.</span> {titulo} {sufixo}
        </h4>
        <div style={{ display: "flex", alignItems: "center", gap: "0.7rem", flexWrap: "wrap" }}>
          {visao === "grafico" && !vazio && <LegendaEscala />}
          <div role="group" aria-label="Visão" style={{ display: "inline-flex", gap: "0.25rem" }}>
            <button type="button" aria-pressed={visao === "grafico"} title="Gráfico"
              className={`btn btn-sm ${visao === "grafico" ? "btn-primary" : "btn-ghost"}`} onClick={() => setVisao("grafico")}>
              <BarChart3 size={14} /> Gráfico
            </button>
            <button type="button" aria-pressed={visao === "tabela"} title="Tabela"
              className={`btn btn-sm ${visao === "tabela" ? "btn-primary" : "btn-ghost"}`} onClick={() => setVisao("tabela")}>
              <Table2 size={14} /> Tabela
            </button>
          </div>
        </div>
      </div>
      {vazio
        ? <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Sem público neste período.</p>
        : visao === "grafico" ? grafico : tabela}
    </section>
  );
}

// ---------------------------------------------------------------- aderência

/**
 * O painel de aderência do período (LUIZ, 11/11/2026), em três passos:
 *   1. cada unidade (Matriz, Filial), que também é o filtro dos próximos;
 *   2. por setor, em barras em pé;
 *   3. por gestor.
 * Gráfico é a visão principal; a tabela fica a um clique. Tudo calculado aqui a
 * partir do público pessoa a pessoa, sem voltar ao banco.
 */
export function BlitzAderenciaDetalhe({ dados, rotuloPeriodo }: {
  dados: AderenciaDados;
  /** "novembro de 2026", "2026", "01/11/2026 a 11/11/2026" */
  rotuloPeriodo: string;
}) {
  const [unidade, setUnidade] = useState("");
  const pessoas = useMemo(() => dados.pessoas ?? [], [dados.pessoas]);
  const unidades = useMemo(() => agrupar(pessoas, "unidade"), [pessoas]);
  const daUnidade = useMemo(() => pessoas.filter((p) => !unidade || (p.unidade ?? VAZIO.unidade) === unidade), [pessoas, unidade]);
  const setores = useMemo(() => agrupar(daUnidade, "setor"), [daUnidade]);
  const gestores = useMemo(() => agrupar(daUnidade, "gestor"), [daUnidade]);

  const sufixo = unidade ? (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
      <Badge variant="quiet" tone="blue">{unidade}</Badge>
      <button type="button" className="btn btn-ghost btn-xs" onClick={() => setUnidade("")}>Ver todas</button>
    </span>
  ) : <span className="soft" style={{ fontWeight: 500, fontSize: "0.8rem" }}>todas as unidades</span>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
        Aderência em {rotuloPeriodo}: do público, quem passou pela blitz pelo menos uma vez. Setor, gestor e unidade são os de hoje.
        Fora da conta: {dados.fora.por_funcao} por função, {dados.fora.por_excecao} por exceção e {dados.fora.ausentes} ausentes o período todo.
      </p>

      {/* 1. cada unidade; clicar filtra os próximos */}
      <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
          <h4 style={{ fontSize: "0.92rem", fontWeight: 700, margin: 0 }}><span className="soft" style={{ fontWeight: 600 }}>1.</span> Aderência por unidade</h4>
          <span className="soft" style={{ fontSize: "0.76rem" }}>Clique numa unidade para ver setores e gestores só dela.</span>
        </div>
        {unidades.length === 0 ? (
          <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Sem público neste período.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: "0.8rem" }}>
            {unidades.map((u) => {
              const p = pct(u.passaram, u.publico) ?? 0;
              const escolhida = unidade === u.nome;
              return (
                <button key={u.nome} type="button" aria-pressed={escolhida} onClick={() => setUnidade(escolhida ? "" : u.nome)}
                  style={{
                    textAlign: "left", cursor: "pointer", borderRadius: "var(--mh-radius-lg)", padding: "0.9rem 1rem",
                    background: "var(--surface-2)", color: "var(--mh-text-1)",
                    border: `1px solid ${escolhida ? "var(--mh-primary-500)" : "var(--border)"}`,
                    boxShadow: escolhida ? "0 0 0 1px var(--mh-primary-500)" : "none",
                    opacity: unidade && !escolhida ? 0.6 : 1,
                  }}>
                  <div className="soft" style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>{u.nome}</div>
                  <div style={{ fontSize: "1.8rem", fontWeight: 800, lineHeight: 1.2, margin: "0.2rem 0" }}>{p}%</div>
                  <div style={{ height: 8, borderRadius: 99, background: "var(--border)", overflow: "hidden" }}>
                    <div style={{ width: `${p}%`, height: "100%", background: corDaEscala(p), borderRadius: 99 }} />
                  </div>
                  <div className="soft" style={{ fontSize: "0.76rem", marginTop: "0.4rem" }}>
                    {u.passaram} de {u.publico} passaram, faltam {u.publico - u.passaram}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <Secao numero={2} titulo="Aderência por setor" sufixo={sufixo} vazio={setores.length === 0}
        grafico={<BarrasEmPe grupos={setores} />} tabela={<TabelaGrupos grupos={setores} rotulo="Setor" />} />

      <Secao numero={3} titulo="Aderência por gestor" sufixo={sufixo} vazio={gestores.length === 0}
        grafico={<BarrasDeitadas grupos={gestores} rotulo="Gestor" />} tabela={<TabelaGrupos grupos={gestores} rotulo="Gestor" />} />
    </div>
  );
}

// ---------------------------------------------------------------- listas

const FILTROS_PESSOA: { campo: Campo; rotulo: string }[] = [
  { campo: "unidade", rotulo: "Unidade" },
  { campo: "setor", rotulo: "Setor" },
  { campo: "gestor", rotulo: "Gestor" },
  { campo: "funcao", rotulo: "Função" },
];

/**
 * Quem do público ainda não passou no período: a lista que a portaria usa no
 * dia a dia, com filtros (unidade, setor, gestor, função), busca e exportação.
 */
export function BlitzFaltamPassar({ dados, rotuloPeriodo, chaveArquivo }: {
  dados: AderenciaDados;
  rotuloPeriodo: string;
  /** pedaço do nome do arquivo exportado (ex.: 2026-11-01_2026-11-30) */
  chaveArquivo: string;
}) {
  const faltam = useMemo(
    () => (dados.pessoas ? dados.pessoas.filter((p) => !p.passou) : dados.faltam.map((f) => ({ ...f, passou: false }))),
    [dados],
  );
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Partial<Record<Campo, string>>>({});
  const opcoes = useMemo(() => Object.fromEntries(FILTROS_PESSOA.map((c) => [c.campo, valoresDe(faltam.map((f) => f[c.campo]), VAZIO[c.campo])])), [faltam]);
  const termo = normalizar(busca.trim());
  const lista = useMemo(() => faltam.filter((f) =>
    FILTROS_PESSOA.every((c) => !filtro[c.campo] || (f[c.campo] ?? VAZIO[c.campo]) === filtro[c.campo])
    && (!termo || normalizar([f.nome, f.matricula, f.funcao, f.setor, f.gestor, f.unidade].filter(Boolean).join(" ")).includes(termo)),
  ), [faltam, filtro, termo]);

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <div>
          <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>Faltam passar em {rotuloPeriodo}</h3>
          <p className="soft" style={{ fontSize: "0.78rem", margin: "0.15rem 0 0" }}>
            Mostrando {lista.length} de {faltam.length} pessoas do público que ainda não passaram pela blitz no período.
          </p>
        </div>
        <ExportButton
          filename={`blitz-faltam-${chaveArquivo}.xlsx`}
          sheetName="Faltam passar"
          headers={["Matrícula", "Colaborador", "Função", "Setor", "Gestor", "Unidade", "Última blitz"]}
          rows={lista.map((f) => [f.matricula ?? "", f.nome ?? "", f.funcao ?? "", f.setor ?? "", f.gestor ?? "", f.unidade ?? "", f.ultima ? formatDate(f.ultima) : ""])}
        />
      </div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <input className="input" placeholder="Buscar nome ou matrícula…" value={busca}
          onChange={(e) => setBusca(e.target.value)} style={{ width: 220, maxWidth: "100%" }} />
        <Filtros campos={FILTROS_PESSOA} valores={filtro} opcoes={opcoes} onChange={(c, v) => setFiltro((f) => ({ ...f, [c]: v }))} />
      </div>
      {faltam.length === 0 ? (
        <EmptyState title="Ninguém faltando" description="Todo o público do período já passou pela blitz." />
      ) : lista.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Ninguém com esses filtros.</p>
      ) : (
        <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th className="so-desktop">Função</th>
                <th>Setor</th>
                <th className="so-desktop">Gestor</th>
                <th className="so-desktop">Unidade</th>
                <th className="so-desktop" style={{ width: 110 }}>Última blitz</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((f) => (
                <tr key={f.user_id}>
                  <td style={{ fontWeight: 600 }}>
                    {shortName(f.nome)}
                    {f.matricula && <span className="soft" style={{ fontWeight: 400, fontSize: "0.76rem" }}> · {f.matricula}</span>}
                  </td>
                  <td className="so-desktop muted" style={{ fontSize: "0.82rem" }}>{f.funcao ?? "—"}</td>
                  <td className="muted" style={{ fontSize: "0.82rem" }}>{f.setor ?? "—"}</td>
                  <td className="so-desktop muted" style={{ fontSize: "0.82rem" }}>{shortName(f.gestor) || "—"}</td>
                  <td className="so-desktop muted" style={{ fontSize: "0.82rem" }}>{f.unidade ?? "—"}</td>
                  <td className="so-desktop muted" style={{ fontSize: "0.82rem" }}>{f.ultima ? formatDate(f.ultima) : "Nunca"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Quem repetiu o "não OK" no período, com os mesmos filtros da lista de quem falta. */
export function BlitzRecorrenciaLista({ recorrencia, rotuloPeriodo }: { recorrencia: BlitzRecorrencia[]; rotuloPeriodo: string }) {
  const [filtro, setFiltro] = useState<Partial<Record<Campo, string>>>({});
  const opcoes = useMemo(
    () => Object.fromEntries(FILTROS_PESSOA.map((c) => [c.campo, valoresDe(recorrencia.map((r) => r[c.campo]), VAZIO[c.campo])])),
    [recorrencia],
  );
  const lista = useMemo(() => recorrencia.filter((r) =>
    FILTROS_PESSOA.every((c) => !filtro[c.campo] || (r[c.campo] ?? VAZIO[c.campo]) === filtro[c.campo])), [recorrencia, filtro]);

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>Recorrência de não conformidade</h3>
        <p className="soft" style={{ fontSize: "0.78rem", margin: "0.15rem 0 0" }}>
          Quantas vezes cada colaborador saiu não conforme em {rotuloPeriodo}. Recorrência é conversa de gestor, não de multa.
          Setor, gestor e unidade são os da última blitz da pessoa no período.
        </p>
      </div>
      {recorrencia.length > 0 && (
        <Filtros campos={FILTROS_PESSOA} valores={filtro} opcoes={opcoes} onChange={(c, v) => setFiltro((f) => ({ ...f, [c]: v }))} />
      )}
      {recorrencia.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Ninguém saiu não conforme no período.</p>
      ) : lista.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Ninguém com esses filtros.</p>
      ) : (
        <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th className="so-desktop">Setor</th>
                <th className="so-desktop">Gestor</th>
                <th className="so-desktop">Unidade</th>
                <th style={{ width: 120, textAlign: "right" }}>Não conformes</th>
                <th style={{ width: 80, textAlign: "right" }}>Blitzes</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((r) => (
                <tr key={r.user_id}>
                  <td style={{ fontWeight: 600 }}>{shortName(r.nome)}</td>
                  <td className="so-desktop muted" style={{ fontSize: "0.82rem" }}>{r.setor ?? "—"}</td>
                  <td className="so-desktop muted" style={{ fontSize: "0.82rem" }}>{shortName(r.gestor) || "—"}</td>
                  <td className="so-desktop muted" style={{ fontSize: "0.82rem" }}>{r.unidade ?? "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <Badge tone={r.nao_conformes >= 3 ? "red" : "amber"}>{r.nao_conformes}</Badge>
                  </td>
                  <td className="muted" style={{ textAlign: "right", fontSize: "0.82rem" }}>{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
