"use client";

import { useMemo, useState } from "react";
import { InfoHint } from "@/components/ui/InfoHint";
import { shortName } from "@/lib/format";
import {
  pct, type AderenciaGrupo, type AderenciaPessoa, type BlitzAlertaAnalise, type BlitzItem, type BlitzRecorrencia,
} from "@/lib/blitz-aderencia";
import {
  agrupar, corDaEscala, escalaDe, valorDoCampo, BarrasEmPe, TabelaGrupos, Secao, VAZIO,
  type FiltroPessoa, type SituacaoPessoa,
} from "./BlitzAderencia";

/*
 * O painel das Análises da blitz (aprovado pelo LUIZ em 11/11/2026), em três
 * seções: Cobertura (quem passou), Qualidade (o que falha) e Tratativas (quem
 * está devendo), com os cartões do topo agrupados do mesmo jeito. Grade de 12
 * colunas pela largura do bloco (globals.css, .painel-grade) e um padrão só de
 * barra, com trilho cinza de fundo.
 *
 * Cor: a paleta do sistema (roxo é pior, azul é melhor) em tudo que é
 * quantidade; vermelho e amarelo só onde a cor é o próprio status (bloqueio e
 * desvio). Gente aparece pelo nome reduzido, com o nome inteiro na dica.
 */

/** Status: translúcido com a borda cheia, amarelo para desvio e vermelho para bloqueio. */
const COR = {
  desvio: { fundo: "color-mix(in srgb, var(--mh-warning) 55%, transparent)", borda: "var(--mh-warning)" },
  bloqueio: { fundo: "color-mix(in srgb, var(--mh-danger) 55%, transparent)", borda: "var(--mh-danger)" },
} as const;
const VERDE = { fundo: "color-mix(in srgb, var(--mh-success) 55%, transparent)", borda: "var(--mh-success)" };
const AZUL = { fundo: "color-mix(in srgb, var(--mh-info) 60%, transparent)", borda: "var(--mh-info)" };

/**
 * Contagem na paleta do sistema, em degradê (LUIZ, 11/11/2026): a maior sai
 * roxa cheia e as menores puxam para o azul, na proporção da barra. Barras do
 * mesmo tamanho têm a mesma cor.
 */
const corDaContagem = (max: number) => (n: number) => corDaEscala(100 - (max > 0 ? (n / max) * 100 : 0));

/** O nome reduzido (LUIZ, 11/11/2026); "Sem gestor (sucessores)" não é nome de gente e fica inteiro. */
const nomeCurto = (nome: string) => (nome === VAZIO.gestor ? nome : shortName(nome));

// ---------------------------------------------------------------- contas

type Linha = { nome: string; n: number; detalhe: string; dica: string };

/**
 * As três contas das falhas, do recorte que chegar: itens com "não" (e em que
 * parte das vezes em que foram perguntados, sem os "não se aplica"), motivos
 * de bloqueio e não conformidade por meio de transporte.
 */
function resumoDeFalhas(blitz: BlitzItem[]): { perguntas: Linha[]; motivos: Linha[]; meios: Linha[] } {
  const mp = new Map<string, { nao: number; perguntada: number }>();
  const de = (p: string) => { const e = mp.get(p) ?? { nao: 0, perguntada: 0 }; mp.set(p, e); return e; };
  for (const b of blitz) {
    for (const p of b.perguntadas ?? []) de(p).perguntada += 1;
    for (const p of b.nao ?? []) de(p).nao += 1;
  }
  const perguntas = [...mp.entries()].filter(([, e]) => e.nao > 0)
    .map(([nome, e]) => {
      const p = pct(e.nao, e.perguntada) ?? 0;
      return { nome, n: e.nao, detalhe: `· ${p}% das vezes`, dica: `${nome}: "não" em ${e.nao} de ${e.perguntada} vezes em que foi perguntado (${p}%)`, p };
    })
    .sort((x, y) => y.n - x.n || y.p - x.p || x.nome.localeCompare(y.nome, "pt-BR"));

  const mm = new Map<string, number>();
  const bloqueios = blitz.filter((b) => !b.liberado);
  for (const b of bloqueios) { const k = b.motivo ?? "Sem motivo registrado"; mm.set(k, (mm.get(k) ?? 0) + 1); }
  const motivos = [...mm.entries()]
    .map(([nome, n]) => ({ nome, n, detalhe: `· ${pct(n, bloqueios.length) ?? 0}%`, dica: `${nome}: ${n} de ${bloqueios.length} bloqueios` }))
    .sort((x, y) => y.n - x.n || x.nome.localeCompare(y.nome, "pt-BR"));

  const mi = new Map<string, { total: number; nc: number }>();
  for (const b of blitz) {
    const k = b.meio ?? "Sem meio";
    const e = mi.get(k) ?? { total: 0, nc: 0 };
    e.total += 1;
    if (!b.conforme) e.nc += 1;
    mi.set(k, e);
  }
  const meios = [...mi.entries()].filter(([, e]) => e.nc > 0)
    .map(([nome, e]) => {
      const p = pct(e.nc, e.total) ?? 0;
      return { nome, n: e.nc, detalhe: `de ${e.total} · ${p}%`, dica: `${nome}: ${e.nc} de ${e.total} blitz não conformes (${p}%)` };
    })
    .sort((x, y) => y.n - x.n || x.nome.localeCompare(y.nome, "pt-BR"));

  return { perguntas, motivos, meios };
}

/** Quem está devendo tratativa, separando bloqueio de desvio; do que mais deve para o que menos deve. */
function pendenciasPorGestor(alertas: BlitzAlertaAnalise[]) {
  const m = new Map<string, { gestor: string; pendentes: number; bloqueio: number; desvio: number; total: number }>();
  for (const a of alertas) {
    const g = valorDoCampo(a, "gestor");
    const l = m.get(g) ?? { gestor: g, pendentes: 0, bloqueio: 0, desvio: 0, total: 0 };
    l.total += 1;
    if (!a.registrada_em) {
      l.pendentes += 1;
      if (a.liberado) l.desvio += 1; else l.bloqueio += 1;
    }
    m.set(g, l);
  }
  return [...m.values()].filter((l) => l.pendentes > 0)
    .sort((x, y) => y.pendentes - x.pendentes || x.gestor.localeCompare(y.gestor, "pt-BR"));
}

// ---------------------------------------------------------------- peças

type Segmento = { valor: number; fundo: string; borda?: string };

/** Barra com trilho: os segmentos ocupam a fração do total, com 2px entre eles. */
function BarraComTrilho({ segmentos, total, altura = 10 }: { segmentos: Segmento[]; total: number; altura?: number }) {
  return (
    <span className="lista-barras-trilho" style={{ height: altura, display: "flex", gap: 2 }}>
      {segmentos.filter((s) => s.valor > 0).map((s, i) => (
        <span key={i} style={{
          width: `${total ? (s.valor / total) * 100 : 0}%`, height: "100%", background: s.fundo,
          border: s.borda ? `1px solid ${s.borda}` : undefined, borderRadius: 3,
        }} />
      ))}
    </span>
  );
}

type ItemDeBarra = { chave: string; nome: React.ReactNode; titulo: string; segmentos: Segmento[]; texto: React.ReactNode };

/**
 * A lista de barras deitadas do painel: nome, trilho com a barra, número.
 * Linha clicável vira botão (abre a visão filtrada). `duasColunas` divide a
 * lista em duas colunas na tela larga, para listas compridas (gestores);
 * `empilhado` põe o nome em cima da barra, para cartão estreito ou nome comprido.
 */
function ListaDeBarras({ itens, max, larguraNome = "44%", onEscolher, duasColunas, empilhado, primeiras }: {
  itens: ItemDeBarra[];
  max: number;
  larguraNome?: string;
  onEscolher?: (chave: string) => void;
  duasColunas?: boolean;
  empilhado?: boolean;
  primeiras?: number;
}) {
  const [todas, setTodas] = useState(false);
  const vistas = primeiras && !todas ? itens.slice(0, primeiras) : itens;
  const estilo = { ["--largura-nome" as string]: larguraNome } as React.CSSProperties;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
      <div className={["lista-barras", duasColunas && "duas-colunas", empilhado && "empilhado"].filter(Boolean).join(" ")}>
        {vistas.map((it) => {
          const soma = it.segmentos.reduce((n, s) => n + s.valor, 0);
          const conteudo = (
            <>
              <span className="lista-barras-nome">{it.nome}</span>
              <span className="lista-barras-trilho" style={{ display: "block" }}>
                <span style={{ display: "flex", gap: 2, height: "100%", width: `${max ? Math.min(100, (soma / max) * 100) : 0}%` }}>
                  {it.segmentos.filter((s) => s.valor > 0).map((s, i) => (
                    <span key={i} style={{
                      flex: s.valor, minWidth: 3, height: "100%", background: s.fundo,
                      border: s.borda ? `1px solid ${s.borda}` : undefined, borderRadius: 3,
                    }} />
                  ))}
                </span>
              </span>
              <span className="lista-barras-valor">{it.texto}</span>
            </>
          );
          return onEscolher ? (
            <button key={it.chave} type="button" className="lista-barras-linha clicavel" title={it.titulo} style={estilo}
              onClick={() => onEscolher(it.chave)}>
              {conteudo}
            </button>
          ) : (
            <div key={it.chave} className="lista-barras-linha" title={it.titulo} style={estilo}>{conteudo}</div>
          );
        })}
      </div>
      {primeiras && itens.length > primeiras ? (
        <button type="button" className="btn btn-ghost btn-xs" style={{ alignSelf: "flex-start" }} onClick={() => setTodas((v) => !v)}>
          {todas ? "Ver menos" : `Ver todos (${itens.length})`}
        </button>
      ) : null}
    </div>
  );
}

function Cartao({ titulo, dica, direita, children }: {
  titulo: string; dica?: React.ReactNode; direita?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="card card-pad painel-cartao">
      {/* 26px: a altura do cabeçalho com os botões gráfico/tabela, para os títulos lado a lado alinharem */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", minHeight: 26 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <h4 style={{ fontSize: "0.92rem", fontWeight: 700, margin: 0 }}>{titulo}</h4>
          {dica && <InfoHint label={`Sobre ${titulo.toLowerCase()}`} size={13}>{dica}</InfoHint>}
        </div>
        {direita}
      </div>
      {children}
    </section>
  );
}

const vazio = (texto: string) => <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>{texto}</p>;

function Legenda({ itens }: { itens: { rotulo: string; fundo: string; borda: string }[] }) {
  return (
    <div style={{ display: "flex", gap: "0.8rem", fontSize: "0.72rem", color: "var(--mh-text-2)" }}>
      {itens.map((i) => (
        <span key={i.rotulo} style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", whiteSpace: "nowrap" }}>
          <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: i.fundo, border: `1px solid ${i.borda}` }} />
          {i.rotulo}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- cartões do topo

function Numero({ valor, rotulo, cor, onClick, acao }: {
  valor: React.ReactNode; rotulo: string; cor?: string; onClick?: () => void; acao?: string;
}) {
  const corpo = (
    <>
      <span className="tabular" style={{ display: "block", fontSize: "1.7rem", fontWeight: 800, lineHeight: 1.1, color: cor ?? "var(--mh-text-1)" }}>{valor}</span>
      <span style={{ display: "block", fontSize: "0.74rem", color: "var(--mh-text-2)", marginTop: 2 }}>{rotulo}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} title={acao} aria-label={`${rotulo}: ${acao ?? ""}`} className="painel-numero clicavel"
      style={{ background: "none", border: "none", padding: "2px 6px", margin: "-2px -6px", borderRadius: 8, textAlign: "left", font: "inherit", cursor: "pointer" }}>
      {corpo}
    </button>
  ) : <div>{corpo}</div>;
}

function CartaoDoTopo({ rotulo, dica, children, rodape }: { rotulo: string; dica?: React.ReactNode; children: React.ReactNode; rodape: React.ReactNode }) {
  return (
    <section className="card card-pad painel-cartao" style={{ gap: "0.7rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
        <span className="soft" style={{ fontSize: "0.69rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{rotulo}</span>
        {dica && <InfoHint label={`Sobre ${rotulo.toLowerCase()}`} size={13}>{dica}</InfoHint>}
      </div>
      <div style={{ display: "flex", gap: "1.6rem", alignItems: "flex-end", flexWrap: "wrap" }}>{children}</div>
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "0.35rem" }}>{rodape}</div>
    </section>
  );
}

/**
 * Os cartões do topo das abas de análise, em três grupos (LUIZ, 11/11/2026):
 * cobertura, qualidade e tratativas. Desvio e bloqueio levam à lista de
 * Registros filtrada.
 */
export function CartoesAgrupados({
  aderencia, passaram, publico, conformidade, total, conformes, desvio, bloqueios, tratou, tratados, enviados,
  dicaAderencia, onDesvio, onBloqueio,
}: {
  aderencia: number | null; passaram: number; publico: number;
  conformidade: number | null; total: number; conformes: number; desvio: number; bloqueios: number;
  tratou: number | null; tratados: number; enviados: number;
  dicaAderencia?: React.ReactNode;
  onDesvio?: () => void; onBloqueio?: () => void;
}) {
  const legendaFina = (t: string) => <span className="soft" style={{ fontSize: "0.74rem" }}>{t}</span>;
  return (
    <div className="painel-envoltorio">
      <div className="painel-grade">
        <div className="k-cob">
          <CartaoDoTopo rotulo="Cobertura" dica={dicaAderencia}
            rodape={<><BarraComTrilho total={publico} segmentos={[{ valor: passaram, ...AZUL }]} />{legendaFina(`${passaram} de ${publico} do público passaram`)}</>}>
            <Numero valor={aderencia === null ? "—" : `${aderencia}%`} rotulo="aderência" />
            <Numero valor={publico - passaram} rotulo="faltam passar" />
          </CartaoDoTopo>
        </div>
        <div className="k-qual">
          <CartaoDoTopo rotulo="Qualidade"
            rodape={<>
              <BarraComTrilho total={total} segmentos={[
                { valor: conformes, ...VERDE },
                { valor: desvio, ...COR.desvio },
                { valor: bloqueios, ...COR.bloqueio },
              ]} />
              {legendaFina(total ? `${conformes} de ${total} blitz conformes` : "Nenhuma blitz no período")}
            </>}>
            <Numero valor={conformidade === null ? "—" : `${conformidade}%`} rotulo="conformes" />
            <Numero valor={desvio} rotulo="liberadas com desvio" cor={desvio ? "var(--mh-warning)" : undefined}
              onClick={desvio ? onDesvio : undefined} acao="Ver as blitz liberadas com desvio" />
            <Numero valor={bloqueios} rotulo="bloqueios" cor={bloqueios ? "var(--mh-danger)" : undefined}
              onClick={bloqueios ? onBloqueio : undefined} acao="Ver as blitz bloqueadas" />
          </CartaoDoTopo>
        </div>
        <div className="k-trat">
          <CartaoDoTopo rotulo="Tratativas"
            rodape={<><BarraComTrilho total={enviados} segmentos={[{ valor: tratados, ...VERDE }]} />{legendaFina(enviados ? `${tratados} de ${enviados} alertas tratados` : "Nenhum alerta no período")}</>}>
            <Numero valor={tratou === null ? "—" : `${tratou}%`} rotulo="tratadas" />
            <Numero valor={enviados - tratados} rotulo="pendentes" cor={enviados - tratados ? "var(--mh-warning)" : undefined} />
          </CartaoDoTopo>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- o painel

/** Aderência por gestor em duas colunas: a lista comprida pela metade da altura. */
function GestoresEmDuasColunas({ grupos, onEscolher }: { grupos: AderenciaGrupo[]; onEscolher?: (nome: string, situacao: SituacaoPessoa) => void }) {
  const { teto, cor } = escalaDe(grupos);
  const porNome = new Map(grupos.map((g) => [g.nome, g]));
  return (
    <ListaDeBarras duasColunas max={teto} larguraNome="32%"
      onEscolher={onEscolher ? (nome) => {
        const g = porNome.get(nome);
        if (g && g.publico > 0) onEscolher(nome, g.publico - g.passaram > 0 ? "faltam" : "passaram");
      } : undefined}
      itens={grupos.map((g) => {
        const p = pct(g.passaram, g.publico) ?? 0;
        return {
          chave: g.nome, nome: nomeCurto(g.nome),
          titulo: `${g.nome}: ${g.passaram} de ${g.publico} passaram (${p}%), faltam ${g.publico - g.passaram}`,
          segmentos: [{ valor: p, fundo: cor(p) }],
          texto: <strong>{p}%</strong>,
        };
      })} />
  );
}

/**
 * A aba Análises da blitz: as três seções do painel, do recorte que a tela
 * mandar (período, unidade do topo e o filtro único).
 */
export function PainelDaBlitz({
  pessoas, alertas, recorrencia, blitz, tratativas, onVerFaltam, onVerAlertas, onVerItem, onVerRecorrencia,
}: {
  pessoas: AderenciaPessoa[];
  alertas: BlitzAlertaAnalise[];
  recorrencia: BlitzRecorrencia[];
  blitz: BlitzItem[];
  /** o bloco das tratativas que o gestor logado deve */
  tratativas?: React.ReactNode;
  onVerFaltam: (filtro: FiltroPessoa, situacao: SituacaoPessoa) => void;
  onVerAlertas: (gestor: string) => void;
  onVerItem: (pergunta: string) => void;
  onVerRecorrencia: () => void;
}) {
  const unidades = useMemo(() => agrupar(pessoas, "unidade"), [pessoas]);
  const setores = useMemo(() => agrupar(pessoas, "setor"), [pessoas]);
  const gestores = useMemo(() => agrupar(pessoas, "gestor"), [pessoas]);
  const falhas = useMemo(() => resumoDeFalhas(blitz), [blitz]);
  const pendentes = useMemo(() => pendenciasPorGestor(alertas), [alertas]);
  const repetem = useMemo(() => [...recorrencia]
    .sort((a, b) => b.nao_conformes - a.nao_conformes || (pct(b.nao_conformes, b.total) ?? 0) - (pct(a.nao_conformes, a.total) ?? 0))
    // tantas linhas quanto o cartão de pendentes ao lado (5 a 10), para fecharem juntos
    .slice(0, Math.min(10, Math.max(5, pendentes.length))), [recorrencia, pendentes.length]);
  const escolher = (campo: "setor" | "gestor") => (nome: string, situacao: SituacaoPessoa) => onVerFaltam({ [campo]: nome }, situacao);
  const maiorDe = (l: { n: number }[]) => Math.max(1, ...l.map((x) => x.n));
  const maiorRepete = Math.max(1, ...repetem.map((r) => r.nao_conformes));
  const corDoMeio = corDaContagem(maiorDe(falhas.meios));
  const corDoItem = corDaContagem(maiorDe(falhas.perguntas));
  const corDeQuemRepete = corDaContagem(maiorRepete);

  return (
    <div className="painel-envoltorio">
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {tratativas}

        <div className="painel-secao">Cobertura · quem passou pela blitz</div>
        <div className="painel-grade">
          <div className="p-uni">
            <Cartao titulo="Por unidade">
              {/* o mesmo gráfico do setor ao lado: mesma altura, mesma leitura.
                  Sem clique: a unidade se escolhe só no seletor do topo. */}
              {unidades.length === 0 ? vazio("Sem público no período.") : (
                <BarrasEmPe grupos={unidades} rotulo="Aderência por unidade, da maior para a menor" />
              )}
            </Cartao>
          </div>
          <div className="p-setor">
            <Secao titulo="Por setor" grupos={setores}
              grafico={<BarrasEmPe grupos={setores} onEscolher={escolher("setor")} />}
              tabela={<TabelaGrupos grupos={setores} rotulo="Setor" onEscolher={escolher("setor")} />} />
          </div>
          <div className="p-gestor">
            <Secao titulo="Por gestor" grupos={gestores}
              grafico={<GestoresEmDuasColunas grupos={gestores} onEscolher={escolher("gestor")} />}
              tabela={<TabelaGrupos grupos={gestores} rotulo="Gestor" nomear={nomeCurto} onEscolher={escolher("gestor")} />} />
          </div>
        </div>

        {/* a ordem pedida (LUIZ, 11/11/2026): meio de transporte, motivos de bloqueio, itens */}
        <div className="painel-secao">Qualidade · o que está falhando</div>
        <div className="painel-grade">
          <div className="p-meio">
            <Cartao titulo="Por meio de transporte" dica="Quantas blitz de cada meio saíram com desvio ou bloqueio.">
              {falhas.meios.length === 0 ? vazio("Nenhuma blitz não conforme no período.") : (
                <ListaDeBarras empilhado primeiras={6} max={maiorDe(falhas.meios)}
                  itens={falhas.meios.map((l) => ({
                    chave: l.nome, nome: l.nome, titulo: l.dica,
                    segmentos: [{ valor: l.n, fundo: corDoMeio(l.n) }],
                    texto: <><strong>{l.n}</strong> <span className="soft">{l.detalhe}</span></>,
                  }))} />
              )}
            </Cartao>
          </div>
          <div className="p-motivos">
            {/* bloqueio é status: este fica no vermelho */}
            <Cartao titulo="Motivos de bloqueio" dica="Por que as pessoas foram bloqueadas, e quanto cada motivo pesa nos bloqueios.">
              {falhas.motivos.length === 0 ? vazio("Nenhum bloqueio no período.") : (
                <ListaDeBarras empilhado primeiras={6} max={maiorDe(falhas.motivos)}
                  itens={falhas.motivos.map((l) => ({
                    chave: l.nome, nome: l.nome, titulo: l.dica,
                    segmentos: [{ valor: l.n, ...COR.bloqueio }],
                    texto: <><strong>{l.n}</strong> <span className="soft">{l.detalhe}</span></>,
                  }))} />
              )}
            </Cartao>
          </div>
          <div className="p-itens">
            <Cartao titulo="Itens que mais falham"
              dica={'Quantas vezes cada pergunta teve "não" no período, e em que parte das vezes em que foi feita. Clique num item para ver os alertas com ele.'}>
              {falhas.perguntas.length === 0 ? vazio("Nenhum item com \"não\" no período.") : (
                <ListaDeBarras empilhado primeiras={8} max={maiorDe(falhas.perguntas)} onEscolher={onVerItem}
                  itens={falhas.perguntas.map((l) => ({
                    chave: l.nome, nome: l.nome, titulo: `${l.dica}. Clique para ver os alertas com este item`,
                    segmentos: [{ valor: l.n, fundo: corDoItem(l.n) }],
                    texto: <><strong>{l.n}</strong> <span className="soft">{l.detalhe}</span></>,
                  }))} />
              )}
            </Cartao>
          </div>
        </div>

        <div className="painel-secao">Tratativas · quem está devendo</div>
        <div className="painel-grade">
          <div className="p-pend">
            <Cartao titulo="Pendentes por gestor" dica="Alertas sem tratativa registrada, por gestor. Clique num gestor para ver os alertas dele."
              direita={<Legenda itens={[
                { rotulo: "Bloqueio", ...COR.bloqueio },
                { rotulo: "Com desvio", ...COR.desvio },
              ]} />}>
              {pendentes.length === 0 ? vazio("Nenhuma tratativa pendente.") : (
                <ListaDeBarras larguraNome="34%" max={Math.max(1, ...pendentes.map((l) => l.pendentes))} onEscolher={onVerAlertas}
                  itens={pendentes.map((l) => ({
                    chave: l.gestor, nome: nomeCurto(l.gestor),
                    titulo: `${l.gestor}: ${l.bloqueio} bloqueio(s) e ${l.desvio} com desvio sem tratativa. Clique para ver os alertas`,
                    segmentos: [
                      { valor: l.bloqueio, ...COR.bloqueio },
                      { valor: l.desvio, ...COR.desvio },
                    ],
                    texto: <><strong>{l.pendentes}</strong> <span className="soft">de {l.total}</span></>,
                  }))} />
              )}
            </Cartao>
          </div>
          <div className="p-repete">
            <Cartao titulo="Quem mais repete" dica="Os colaboradores com mais blitz não conformes no período."
              direita={recorrencia.length > 0 ? (
                <button type="button" className="btn btn-ghost btn-xs" onClick={onVerRecorrencia}>Ver todos ({recorrencia.length})</button>
              ) : undefined}>
              {repetem.length === 0 ? vazio("Ninguém saiu não conforme no período.") : (
                <ListaDeBarras larguraNome="38%" max={maiorRepete}
                  itens={repetem.map((r) => ({
                    chave: r.user_id,
                    nome: <><span className="soft" style={{ fontVariantNumeric: "tabular-nums" }}>{r.matricula ?? "—"}</span> {shortName(r.nome)}</>,
                    titulo: `${r.nome ?? ""}: ${r.nao_conformes} de ${r.total} blitz não conformes`,
                    segmentos: [{ valor: r.nao_conformes, fundo: corDeQuemRepete(r.nao_conformes) }],
                    texto: <><strong>{r.nao_conformes}</strong> <span className="soft">de {r.total} · {pct(r.nao_conformes, r.total) ?? 0}%</span></>,
                  }))} />
              )}
            </Cartao>
          </div>
        </div>
      </div>
    </div>
  );
}
