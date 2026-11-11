"use client";

import { useMemo, useState } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { ExportButton } from "@/components/ui/ExportButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDate, normalizar, shortName } from "@/lib/format";
import {
  pct, type AderenciaGrupo, type AderenciaPessoa, type BlitzRecorrencia,
} from "@/lib/blitz-aderencia";

// ---------------------------------------------------------------- base

export type Campo = "unidade" | "setor" | "gestor" | "funcao";
/**
 * O filtro das Análises (unidade, setor, gestor, função). Vale para a tela
 * inteira, cartões inclusive (LUIZ, 11/11/2026); o clique nos gráficos liga ele.
 */
export type FiltroPessoa = Partial<Record<Campo, string>>;
// Quem não tem gestor no cadastro hoje são os sucessores (JAIME e MARIANA): a
// observação deixa claro de quem é a barra (LUIZ, 11/11/2026)
export const VAZIO: Record<Campo, string> = { unidade: "Sem unidade", setor: "Sem setor", gestor: "Sem gestor (sucessores)", funcao: "Sem função" };

export const FILTROS_PESSOA: { campo: Campo; rotulo: string }[] = [
  { campo: "unidade", rotulo: "Unidade" },
  { campo: "setor", rotulo: "Setor" },
  { campo: "gestor", rotulo: "Gestor" },
  { campo: "funcao", rotulo: "Função" },
];

type ComCampos = Partial<Record<Campo, string | null | undefined>>;

/** O valor do campo como a tela mostra: vazio vira "Sem …". */
export const valorDoCampo = (o: ComCampos, c: Campo) => o[c] ?? VAZIO[c];

/** Passa no filtro? Campo sem escolha não restringe; `ignorar` deixa um de fora. */
export const passaNoFiltro = (o: ComCampos, f: FiltroPessoa, ignorar?: Campo) =>
  FILTROS_PESSOA.every(({ campo }) => campo === ignorar || !f[campo] || valorDoCampo(o, campo) === f[campo]);

/** Agrupa o público por um campo: quantos são e quantos passaram. */
export function agrupar(pessoas: AderenciaPessoa[], campo: Campo): AderenciaGrupo[] {
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
export const corDaEscala = (t: number) =>
  `color-mix(in oklab, var(--mh-primary-500) ${100 - t}%, var(--mh-info) ${t}%)`;

/**
 * A cor é RELATIVA ao que está na tela: a menor aderência visível fica roxa
 * cheia e a maior, azul cheia (com a escala absoluta, 20% e 54% saíam quase
 * da mesma cor). A legenda mostra os dois valores reais. O comprimento da
 * barra continua absoluto, com eixo do zero até a maior aderência
 * arredondada para cima de 10 em 10.
 */
export function escalaDe(grupos: AderenciaGrupo[]) {
  const ps = grupos.map((g) => pct(g.passaram, g.publico) ?? 0);
  const min = ps.length ? Math.min(...ps) : 0;
  const max = ps.length ? Math.max(...ps) : 0;
  const teto = Math.min(100, Math.max(10, Math.ceil(max / 10) * 10));
  // faixa mínima de 30 pontos: 39% e 41% não podem sair roxo e azul opostos;
  // 20% e 54% continuam com o contraste inteiro
  const faixa = Math.max(max - min, 30);
  let lo = (max + min) / 2 - faixa / 2;
  let hi = lo + faixa;
  if (lo < 0) { hi -= lo; lo = 0; }
  if (hi > 100) { lo -= hi - 100; hi = 100; }
  return {
    min: Math.round(lo), max: Math.round(hi), teto,
    cor: (p: number) => corDaEscala(Math.min(100, Math.max(0, ((p - lo) / (hi - lo)) * 100))),
  };
}

function LegendaEscala({ min, max }: { min: number; max: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.72rem" }} className="soft">
      <span>{min}%</span>
      <span aria-hidden style={{ width: 80, height: 8, borderRadius: 99, background: "linear-gradient(90deg, var(--mh-primary-500), var(--mh-info))" }} />
      <span>{max}%</span>
    </div>
  );
}

// ---------------------------------------------------------------- gráficos

/**
 * Barra ou linha clicável (LUIZ, 11/11/2026: o clique leva para "Faltam
 * passar" já filtrada). Também abre pelo teclado, com Enter ou espaço.
 */
function clicavel(fazer: (() => void) | null, rotulo: string): React.HTMLAttributes<HTMLElement> {
  if (!fazer) return {};
  return {
    role: "button", tabIndex: 0, "aria-label": rotulo, onClick: fazer,
    onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fazer(); } },
  };
}

/** Clique num grupo: o nome e a situação em que a lista do público deve abrir. */
export type OnEscolher = (nome: string, situacao: SituacaoPessoa) => void;

/**
 * Com gente faltando, o clique abre a lista em "Faltam passar"; com todos ok
 * (100%), em "Passaram" (LUIZ, 11/11/2026).
 */
const acaoDoGrupo = (g: AderenciaGrupo, onEscolher?: OnEscolher) =>
  onEscolher && g.publico > 0 ? () => onEscolher(g.nome, g.publico - g.passaram > 0 ? "faltam" : "passaram") : null;

const verQuem = (g: AderenciaGrupo) => (g.publico - g.passaram > 0 ? "Ver quem falta" : "Ver quem passou");
const dicaDoGrupo = (g: AderenciaGrupo) => `Clique para ${verQuem(g).toLowerCase()}`;

/** Barras em pé (setores): valor no topo, nome embaixo, detalhe no hover. */
export function BarrasEmPe({ grupos, onEscolher, rotulo = "Aderência por setor, da maior para a menor" }: {
  grupos: AderenciaGrupo[]; onEscolher?: OnEscolher; rotulo?: string;
}) {
  const [sobre, setSobre] = useState<string | null>(null);
  const ALTURA = 260; // área das barras, sem o rótulo de valor
  const { teto, cor } = escalaDe(grupos);
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: grupos.length * 70, display: "grid", gridTemplateColumns: "34px 1fr", columnGap: 6 }}>
        {/* eixo: 0, metade e o teto */}
        <div aria-hidden style={{ position: "relative", height: ALTURA + 22 }}>
          {[0, 0.5, 1].map((f) => (
            <span key={f} className="soft" style={{ position: "absolute", right: 0, bottom: f * ALTURA - 6, fontSize: "0.66rem" }}>
              {Math.round(teto * f)}%
            </span>
          ))}
        </div>
        <div role="group" aria-label={rotulo} style={{ position: "relative", height: ALTURA + 22 }}>
          {[0.5, 1].map((f) => (
            <div key={f} aria-hidden style={{ position: "absolute", left: 0, right: 0, bottom: f * ALTURA, borderTop: "1px dashed var(--border)" }} />
          ))}
          <div aria-hidden style={{ position: "absolute", left: 0, right: 0, bottom: 0, borderTop: "1px solid var(--border)" }} />
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", gap: 10, padding: "0 6px" }}>
            {grupos.map((g) => {
              const p = pct(g.passaram, g.publico) ?? 0;
              const ativo = sobre === g.nome;
              const fazer = acaoDoGrupo(g, onEscolher);
              return (
                <div key={g.nome} onMouseEnter={() => setSobre(g.nome)} onMouseLeave={() => setSobre(null)}
                  {...clicavel(fazer, `${g.nome}: ${p}%, faltam ${g.publico - g.passaram}. ${verQuem(g)}`)}
                  style={{ position: "relative", flex: "1 1 0", minWidth: 56, height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", cursor: fazer ? "pointer" : "default" }}>
                  <span style={{ fontSize: "0.82rem", fontWeight: 700, marginBottom: 4 }}>{p}%</span>
                  <div style={{
                    width: "78%", maxWidth: 110, height: Math.max((p / teto) * ALTURA, p > 0 ? 3 : 0), borderRadius: "4px 4px 0 0",
                    background: cor(p), opacity: sobre && !ativo ? 0.5 : 1, transition: "opacity 120ms",
                  }} />
                  {ativo && (
                    <div role="tooltip" style={{
                      position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%)", zIndex: 5, pointerEvents: "none",
                      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.35rem 0.6rem",
                      fontSize: "0.76rem", boxShadow: "var(--mh-shadow-e2)", whiteSpace: "nowrap",
                    }}>
                      <strong>{g.nome}</strong>: {g.passaram} de {g.publico} passaram ({p}%), faltam {g.publico - g.passaram}
                      {fazer && <div className="soft" style={{ fontSize: "0.7rem", marginTop: 2 }}>{dicaDoGrupo(g)}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <span />
        {/* nomes embaixo, na mesma grade das barras */}
        <div style={{ display: "flex", gap: 10, padding: "6px 6px 0" }}>
          {grupos.map((g) => (
            <span key={g.nome} className="soft" title={g.nome} style={{
              flex: "1 1 0", minWidth: 56, fontSize: "0.72rem", textAlign: "center", lineHeight: 1.25, height: "2.5em", overflow: "hidden",
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", wordBreak: "break-word",
            }}>{g.nome}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TabelaGrupos({ grupos, rotulo, onEscolher, nomear }: {
  grupos: AderenciaGrupo[]; rotulo: string; onEscolher?: OnEscolher;
  /** como o nome aparece (gente: o nome reduzido, com o inteiro na dica) */
  nomear?: (nome: string) => string;
}) {
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
          {grupos.map((g) => {
            const fazer = acaoDoGrupo(g, onEscolher);
            return (
            <tr key={g.nome} {...clicavel(fazer, `${g.nome}: ${verQuem(g).toLowerCase()}`)} title={fazer ? dicaDoGrupo(g) : undefined}
              style={{ cursor: fazer ? "pointer" : "default" }}>
              <td style={{ fontWeight: 600 }} title={nomear ? g.nome : undefined}>{nomear ? nomear(g.nome) : g.nome}</td>
              <td className="muted" style={{ textAlign: "right" }}>{g.publico}</td>
              <td className="muted" style={{ textAlign: "right" }}>{g.passaram}</td>
              <td className="muted" style={{ textAlign: "right" }}>{g.publico - g.passaram}</td>
              <td style={{ textAlign: "right", fontWeight: 700 }}>{pct(g.passaram, g.publico) ?? 0}%</td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Uma seção do painel: o gráfico é a visão principal, a tabela é a alternativa. */
export function Secao({ titulo, sufixo, grafico, tabela, grupos, dica }: {
  titulo: string; sufixo?: React.ReactNode;
  grafico: React.ReactNode; tabela: React.ReactNode; grupos: AderenciaGrupo[];
  /** uma linha sob o título (ex.: o que o clique faz) */
  dica?: string;
}) {
  const vazio = grupos.length === 0;
  const { min, max } = escalaDe(grupos);
  const [visao, setVisao] = useState<"grafico" | "tabela">("grafico");
  return (
    <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <div>
          <h4 style={{ fontSize: "0.92rem", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            {titulo} {sufixo}
          </h4>
          {dica && !vazio && <p className="soft" style={{ fontSize: "0.74rem", margin: "0.2rem 0 0" }}>{dica}</p>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.7rem", flexWrap: "wrap" }}>
          {visao === "grafico" && !vazio && <LegendaEscala min={min} max={max} />}
          <div role="group" aria-label="Visão" style={{ display: "inline-flex", gap: "0.25rem" }}>
            <button type="button" aria-pressed={visao === "grafico"} title="Gráfico" aria-label="Ver em gráfico"
              className={`btn btn-sm ${visao === "grafico" ? "btn-primary" : "btn-ghost"}`} onClick={() => setVisao("grafico")}>
              <BarChart3 size={15} aria-hidden />
            </button>
            <button type="button" aria-pressed={visao === "tabela"} title="Tabela" aria-label="Ver em tabela"
              className={`btn btn-sm ${visao === "tabela" ? "btn-primary" : "btn-ghost"}`} onClick={() => setVisao("tabela")}>
              <Table2 size={15} aria-hidden />
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

// ---------------------------------------------------------------- listas

export type SituacaoPessoa = "todos" | "faltam" | "passaram";

/**
 * O público do período, pessoa a pessoa (LUIZ, 11/11/2026: uma lista só, com
 * quem passou e quem falta). Chega já filtrada pelo filtro único das Análises;
 * aqui ficam a situação (abre em "Faltam passar", com a contagem), a busca e a
 * exportação. Quem falta vem primeiro.
 */
export function BlitzColaboradoresLista({ pessoas: doFiltro, rotuloPeriodo, chaveArquivo, situacaoInicial = "faltam" }: {
  pessoas: AderenciaPessoa[];
  rotuloPeriodo: string;
  /** pedaço do nome do arquivo exportado (ex.: 2026-11-01_2026-11-30) */
  chaveArquivo: string;
  /** quem usa remonta a lista com `key` quando o clique no gráfico pede outra situação */
  situacaoInicial?: SituacaoPessoa;
}) {
  // quem falta primeiro; dentro de cada grupo, a ordem do banco (nome)
  const pessoas = useMemo(() => [...doFiltro.filter((x) => !x.passou), ...doFiltro.filter((x) => x.passou)], [doFiltro]);
  const [busca, setBusca] = useState("");
  const [situacao, setSituacao] = useState<SituacaoPessoa>(situacaoInicial);
  const termo = normalizar(busca.trim());
  const base = useMemo(() => pessoas.filter((f) =>
    !termo || normalizar([f.nome, f.matricula, f.funcao, f.setor, f.gestor, f.unidade].filter(Boolean).join(" ")).includes(termo),
  ), [pessoas, termo]);
  const conta = { todos: base.length, faltam: base.filter((f) => !f.passou).length, passaram: base.filter((f) => f.passou).length };
  const lista = situacao === "todos" ? base : base.filter((f) => (situacao === "passaram") === f.passou);

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <div>
          <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>Público da blitz em {rotuloPeriodo}</h3>
          <p className="soft" style={{ fontSize: "0.78rem", margin: "0.15rem 0 0" }}>
            Mostrando {lista.length} de {pessoas.length} pessoas. Passou quem fez a blitz pelo menos uma vez no período.
          </p>
        </div>
        <ExportButton
          filename={`blitz-publico-${chaveArquivo}.xlsx`}
          sheetName="Público"
          headers={["Matrícula", "Colaborador", "Função", "Setor", "Gestor", "Unidade", "Situação", "Última blitz"]}
          rows={lista.map((f) => [
            f.matricula ?? "", f.nome ?? "", f.funcao ?? "", f.setor ?? "", f.gestor ?? "", f.unidade ?? "",
            f.passou ? "Passou" : "Falta passar", f.ultima ? formatDate(f.ultima) : "",
          ])}
        />
      </div>
      <div role="group" aria-label="Situação" style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
        {([["todos", "Todos"], ["faltam", "Faltam passar"], ["passaram", "Passaram"]] as [SituacaoPessoa, string][]).map(([v, r]) => (
          <button key={v} type="button" aria-pressed={situacao === v}
            className={`btn btn-sm ${situacao === v ? "btn-primary" : "btn-ghost"}`} onClick={() => setSituacao(v)}>
            {r} ({conta[v]})
          </button>
        ))}
      </div>
      <input className="input" placeholder="Buscar nome ou matrícula…" value={busca}
        onChange={(e) => setBusca(e.target.value)} style={{ width: 260, maxWidth: "100%" }} />
      {pessoas.length === 0 ? (
        <EmptyState title="Sem público no período" description="Ninguém do público da blitz neste recorte." />
      ) : lista.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>
          {situacao === "faltam" && base.length > 0 ? "Ninguém faltando com esses filtros: todos já passaram." : "Ninguém com esses filtros."}
        </p>
      ) : (
        <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                {/* a matrícula na primeira coluna: o nome é curto, ela é que diferencia (LUIZ, 11/11/2026) */}
                <th style={{ width: 90 }}>Matrícula</th>
                <th>Colaborador</th>
                <th className="so-desktop">Função</th>
                <th>Setor</th>
                <th className="so-desktop">Gestor</th>
                <th className="so-desktop">Unidade</th>
                <th style={{ width: 130 }}>Situação</th>
                <th className="so-desktop" style={{ width: 110 }}>Última blitz</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((f) => (
                <tr key={f.user_id}>
                  <td className="muted" style={{ fontSize: "0.82rem", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{f.matricula ?? "—"}</td>
                  <td style={{ fontWeight: 600 }}>{shortName(f.nome)}</td>
                  <td className="so-desktop muted" style={{ fontSize: "0.82rem" }}>{f.funcao ?? "—"}</td>
                  <td className="muted" style={{ fontSize: "0.82rem" }}>{f.setor ?? "—"}</td>
                  <td className="so-desktop muted" style={{ fontSize: "0.82rem" }}>{shortName(f.gestor) || "—"}</td>
                  <td className="so-desktop muted" style={{ fontSize: "0.82rem" }}>{f.unidade ?? "—"}</td>
                  <td>
                    {/* falta passar é o que pede ação: só ela leva a pílula tintada (DESIGN.md) */}
                    {f.passou ? <Badge variant="quiet" tone="green">Passou</Badge> : <Badge tone="amber">Falta passar</Badge>}
                  </td>
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

/** Quem repetiu o "não OK" no período; chega filtrada pelo filtro único das Análises. */
export function BlitzRecorrenciaLista({ recorrencia: todos }: { recorrencia: BlitzRecorrencia[] }) {
  // a busca da aba, como em Colaboradores e Alertas (LUIZ, 11/11/2026)
  const [busca, setBusca] = useState("");
  const termo = normalizar(busca.trim());
  const lista = useMemo(() => todos.filter((r) =>
    !termo || normalizar([r.nome, r.matricula, r.setor, r.gestor, r.unidade].filter(Boolean).join(" ")).includes(termo),
  ), [todos, termo]);

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>Recorrência de não conformidade</h3>
        <p className="soft" style={{ fontSize: "0.78rem", margin: "0.15rem 0 0" }}>
          {/* texto do LUIZ, 11/11/2026 */}
          Quantas vezes cada colaborador esteve não conforme. Setor, gestor e unidade são considerados como os da última
          blitz do colaborador no período.
        </p>
      </div>
      {todos.length > 0 && (
        <input className="input" placeholder="Buscar nome ou matrícula…" value={busca} aria-label="Buscar na recorrência"
          onChange={(e) => setBusca(e.target.value)} style={{ width: 260, maxWidth: "100%" }} />
      )}
      {todos.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Ninguém saiu não conforme no período (com o filtro atual).</p>
      ) : lista.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Ninguém com essa busca.</p>
      ) : (
        <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Matrícula</th>
                <th>Colaborador</th>
                <th className="so-desktop">Setor</th>
                <th className="so-desktop">Gestor</th>
                <th className="so-desktop">Unidade</th>
                <th style={{ width: 120, textAlign: "right" }}>Não conformes</th>
                <th style={{ width: 80, textAlign: "right" }}>Blitz</th>
                {/* quanto das blitz da pessoa saiu não conforme (LUIZ, 11/11/2026) */}
                <th style={{ width: 130, textAlign: "right" }}>% não conforme</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((r) => (
                <tr key={r.user_id}>
                  <td className="muted" style={{ fontSize: "0.82rem", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{r.matricula ?? "—"}</td>
                  <td style={{ fontWeight: 600 }}>{shortName(r.nome)}</td>
                  <td className="so-desktop muted" style={{ fontSize: "0.82rem" }}>{r.setor ?? "—"}</td>
                  <td className="so-desktop muted" style={{ fontSize: "0.82rem" }}>{shortName(r.gestor) || "—"}</td>
                  <td className="so-desktop muted" style={{ fontSize: "0.82rem" }}>{r.unidade ?? "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <Badge tone={r.nao_conformes >= 3 ? "red" : "amber"}>{r.nao_conformes}</Badge>
                  </td>
                  <td className="muted" style={{ textAlign: "right", fontSize: "0.82rem" }}>{r.total}</td>
                  <td style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{pct(r.nao_conformes, r.total) ?? 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
