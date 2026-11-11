"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarDays, Filter, X } from "lucide-react";
import { Tabs } from "@/components/ui/Tabs";
import { Dropdown } from "@/components/ui/Dropdown";
import {
  BlitzColaboradoresLista, BlitzRecorrenciaLista, FILTROS_PESSOA, passaNoFiltro, valorDoCampo,
  type FiltroPessoa, type SituacaoPessoa,
} from "./BlitzAderencia";
import { BlitzAlertasLista, type SituacaoAlerta } from "./BlitzAlertasLista";
import { CartoesAgrupados, PainelDaBlitz } from "./BlitzPainel";
import { getBlitzAnalise } from "@/lib/actions/seguranca";
import { formatDate, normalizar } from "@/lib/format";
import { pct, type BlitzAnaliseDados } from "@/lib/blitz-aderencia";

type Modo = "mes" | "ano" | "periodo";
/** "Minha gestão": quem vê a empresa olhando só a própria cadeia (LUIZ, 11/11/2026) */
type Escopo = "todos" | "minha";

/**
 * O que os dois botões (período e filtros) mandam para a lista de Registros:
 * as datas, o filtro de setor, gestor e função e, em "Minha gestão", as blitz
 * da análise (a cadeia vem do banco; a lista sozinha não sabe quem é de quem).
 */
export type RecorteDosRegistros = {
  de: string; ate: string; filtro: FiltroPessoa; ids: Set<string> | null;
  /** do botão Filtros: o nome do meio e a situação da blitz */
  meio: string; situacao: SituacaoBlitz | "";
};

/** A situação de uma blitz: o que o filtro "Situação" escolhe. */
export type SituacaoBlitz = "conforme" | "desvio" | "bloqueado";
export const SITUACOES_BLITZ: [SituacaoBlitz, string][] = [
  ["conforme", "Conforme"], ["desvio", "Liberado com desvio"], ["bloqueado", "Bloqueado"],
];
export const situacaoDa = (liberado: boolean, conforme: boolean): SituacaoBlitz =>
  !liberado ? "bloqueado" : conforme ? "conforme" : "desvio";

const NOME_MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function fimDoMes(ym: string): string {
  const [a, m] = ym.split("-").map(Number);
  const ultimo = new Date(a, m, 0).getDate();
  return `${ym}-${String(ultimo).padStart(2, "0")}`;
}

function rotulo(modo: Modo, de: string, ate: string): string {
  if (modo === "ano") return de.slice(0, 4);
  if (modo === "mes") return `${NOME_MES[Number(de.slice(5, 7)) - 1]} de ${de.slice(0, 4)}`;
  return `${formatDate(de)} a ${formatDate(ate)}`;
}

/** A blitz passa no filtro de meio e situação do botão Filtros? */
function passaNaBlitz(meio: string | null | undefined, liberado: boolean, conforme: boolean, meioFiltro: string, situacaoFiltro: SituacaoBlitz | "") {
  return (!meioFiltro || meio === meioFiltro) && (!situacaoFiltro || situacaoDa(liberado, conforme) === situacaoFiltro);
}

/** Botões lado a lado, um ativo (o padrão dos filtros da tela). */
function Segmentado<T extends string>({ opcoes, valor, onChange, rotulo: nome, desligado }: {
  opcoes: [T, string][]; valor: T; onChange: (v: T) => void; rotulo: string; desligado?: boolean;
}) {
  return (
    <div role="group" aria-label={nome} style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
      {opcoes.map(([v, r]) => (
        <button key={v} type="button" aria-pressed={valor === v} disabled={desligado}
          className={`btn btn-sm ${valor === v ? "btn-primary" : "btn-ghost"}`} onClick={() => onChange(v)}>
          {r}
        </button>
      ))}
    </div>
  );
}

const ROTULO_DO_MENU: React.CSSProperties = { fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" };

/**
 * Escolha de um valor com busca por digitação (LUIZ, 11/11/2026: gestor e função
 * têm opções demais para rolar). Fechado, mostra o escolhido; ao focar, digitar
 * reduz a lista (sem acento e sem caixa), clique ou Enter escolhe, Esc fecha.
 * A lista abre dentro do painel, logo abaixo do campo.
 */
function ComBusca({ rotulo, valor, opcoes, onChange }: {
  rotulo: string; valor: string; opcoes: string[]; onChange: (v: string) => void;
}) {
  const [texto, setTexto] = useState("");
  const [aberto, setAberto] = useState(false);
  const idDaLista = useId();
  const termo = normalizar(texto.trim());
  const lista = termo ? opcoes.filter((o) => normalizar(o).includes(termo)) : opcoes;
  const escolher = (v: string) => { onChange(v); setAberto(false); setTexto(""); };
  return (
    <div>
      <div style={{ position: "relative" }}>
        <input
          className="input" role="combobox" aria-expanded={aberto} aria-controls={idDaLista} aria-label={rotulo} autoComplete="off"
          placeholder={aberto ? "Digite para buscar…" : `${rotulo}: todos`}
          value={aberto ? texto : valor ? `${rotulo}: ${valor}` : ""}
          onFocus={() => { setAberto(true); setTexto(""); }}
          onBlur={() => setAberto(false)}
          onChange={(e) => { setTexto(e.target.value); setAberto(true); }}
          onKeyDown={(e) => {
            // Esc fecha só a lista, não o painel dos filtros
            if (e.key === "Escape") { e.stopPropagation(); setAberto(false); (e.target as HTMLInputElement).blur(); }
            if (e.key === "Enter" && lista[0]) { e.preventDefault(); escolher(lista[0]); (e.target as HTMLInputElement).blur(); }
          }}
          style={{ paddingRight: valor ? "2rem" : undefined }}
        />
        {valor && !aberto && (
          <button type="button" aria-label={`Tirar o filtro de ${rotulo.toLowerCase()}`} title="Tirar este filtro"
            onClick={() => onChange("")}
            style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--mh-text-2)", display: "grid", placeItems: "center", padding: 4 }}>
            <X size={14} aria-hidden />
          </button>
        )}
      </div>
      {aberto && (
        <div id={idDaLista} role="listbox" aria-label={rotulo} style={{
          marginTop: 4, maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)",
          borderRadius: "var(--mh-radius-sm)", background: "var(--surface)", padding: 4,
        }}>
          {[...(termo ? [] : [""]), ...lista].map((o) => (
            <button key={o || "__todos"} type="button" role="option" aria-selected={o === valor}
              // mousedown antes do blur do campo: sem isso a lista fecha antes do clique
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => escolher(o)}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "0.4rem 0.5rem", border: "none",
                borderRadius: "var(--mh-radius-sm)", font: "inherit", fontSize: "0.82rem", cursor: "pointer",
                background: o === valor ? "var(--mh-primary-soft)" : "none",
                color: o ? "var(--mh-text-1)" : "var(--mh-text-2)",
              }}
              onMouseEnter={(e) => { if (o !== valor) e.currentTarget.style.background = "var(--mh-surface-2)"; }}
              onMouseLeave={(e) => { if (o !== valor) e.currentTarget.style.background = "none"; }}>
              {o || `${rotulo}: todos`}
            </button>
          ))}
          {lista.length === 0 && <div className="soft" style={{ fontSize: "0.8rem", padding: "0.4rem 0.5rem" }}>Nada encontrado.</div>}
        </div>
      )}
    </div>
  );
}

/**
 * Os filtros da página: setor, gestor e função. Unidade fica de fora de
 * propósito: o filtro de unidade é sempre o seletor do topo, ao lado do sino
 * (LUIZ, 11/11/2026), e ele já chega aqui no recorte da análise.
 */
const FILTROS_DA_TELA = FILTROS_PESSOA.filter(({ campo }) => campo !== "unidade");

/** Gestor e função têm muitas opções: ganham a busca por digitação. */
const COM_BUSCA = new Set(["gestor", "funcao"]);

/**
 * A tela da blitz para quem tem alçada (LUIZ, 11/11/2026). Uma linha só de
 * abas: Análises (o painel de aderência), Colaboradores, Recorrência, Alertas
 * e Registros. Os cartões ficam só no topo de Análises; os dois botões (período,
 * com "Minha gestão" para quem vê a empresa e tem equipe, e Filtros) valem para
 * todas, Registros inclusive (LUIZ, 11/11/2026), que soma a busca, o meio e a
 * situação dela.
 *
 * A aba aberta mora em quem usa (o cartão de desvio leva a Registros e o
 * gráfico, a Colaboradores), por isso `aba`/`onAba`.
 */
export function BlitzAnalises({
  inicial, unitIds, hoje, anos, podeEscolherGestao, tratativas, onVerRegistros,
  registros, onPeriodo, novaBlitz, celular, rotuloAnalises, aba, onAba,
}: {
  /** o mês corrente, já calculado no servidor */
  inicial: BlitzAnaliseDados;
  /** recorte do seletor de unidade do topo */
  unitIds: string[] | null;
  /** YYYY-MM-DD de hoje (fuso de São Paulo) */
  hoje: string;
  /** anos que o filtro oferece */
  anos: number[];
  /** vê a empresa inteira e tem equipe: ganha o "Todos | Minha gestão" */
  podeEscolherGestao: boolean;
  /** o bloco das tratativas que o gestor logado deve (no painel de Análises) */
  tratativas?: React.ReactNode;
  /** clique nos cartões de desvio e bloqueio: a situação vai para o filtro e a tela abre Registros */
  onVerRegistros?: () => void;
  /** a lista de Registros, já no recorte dos dois botões */
  registros: (recorte: RecorteDosRegistros) => React.ReactNode;
  /** troca de período: a lista de Registros busca as blitz dele junto com a análise */
  onPeriodo?: (de: string, ate: string) => Promise<void>;
  /** a aba "+ Nova blitz" do celular (só para quem avalia) */
  novaBlitz?: React.ReactNode;
  celular: boolean;
  rotuloAnalises: string;
  aba?: string;
  onAba: (id: string) => void;
}) {
  const [carregando, iniciar] = useTransition();
  const [modo, setModo] = useState<Modo>("mes");
  const [mes, setMes] = useState(inicial.de.slice(0, 7));
  const [ano, setAno] = useState(Number(inicial.de.slice(0, 4)));
  const [de, setDe] = useState(inicial.de);
  const [ate, setAte] = useState(inicial.ate > hoje ? hoje : inicial.ate);
  const [escopo, setEscopo] = useState<Escopo>("todos");
  const [dados, setDados] = useState(inicial);
  const [modoDosDados, setModoDosDados] = useState<Modo>("mes");
  const [escopoDosDados, setEscopoDosDados] = useState<Escopo>("todos");
  // o filtro único (LUIZ, 11/11/2026): unidade, setor, gestor e função valem
  // para a tela inteira, cartões inclusive. Os gráficos e o quadro de
  // pendências ligam ele ao serem clicados
  const [filtro, setFiltro] = useState<FiltroPessoa>({});
  // meio e situação também no botão Filtros (LUIZ, 11/11/2026): valem para tudo
  // que é blitz (qualidade, alertas, recorrência, registros); a cobertura conta pessoas
  const [meioFiltro, setMeioFiltro] = useState("");
  const [situacaoFiltro, setSituacaoFiltro] = useState<SituacaoBlitz | "">("");
  // a situação em que cada lista abre quando chega por um clique; a versão
  // remonta a lista para valer a nova
  const [situacaoLista, setSituacaoLista] = useState<SituacaoPessoa>("faltam");
  const [versaoFaltam, setVersaoFaltam] = useState(0);
  const [situacaoAlertas, setSituacaoAlertas] = useState<SituacaoAlerta>("");
  const [versaoAlertas, setVersaoAlertas] = useState(0);

  const mudarFiltro = (f: FiltroPessoa) => setFiltro((atual) => ({ ...atual, ...f }));

  // o item clicado em "Itens que mais falham": filtra os Alertas (LUIZ, 11/11/2026)
  const [itemAlertas, setItemAlertas] = useState("");
  const verItem = (pergunta: string) => {
    setItemAlertas(pergunta);
    setSituacaoAlertas("");
    setVersaoAlertas((v) => v + 1);
    onAba("alertas");
  };

  const verAlertas = (gestor: string) => {
    setItemAlertas("");
    mudarFiltro({ gestor });
    setSituacaoAlertas("aguardando");
    setVersaoAlertas((v) => v + 1);
    onAba("alertas");
  };

  /** Cartão de desvio ou bloqueio: a situação entra no filtro e a tela abre Registros. */
  const verRegistros = (situacao: SituacaoBlitz) => {
    setSituacaoFiltro(situacao);
    onVerRegistros?.();
    onAba("registros");
  };

  const verFaltam = (f: FiltroPessoa, situacao: SituacaoPessoa) => {
    mudarFiltro(f);
    setSituacaoLista(situacao);
    setVersaoFaltam((v) => v + 1);
    onAba("colaboradores");
  };

  const carregar = (m: Modo, d: string, a: string, esc: Escopo = escopo) => {
    if (!d || !a || a < d) { toast.error("Escolha um período válido."); return; }
    iniciar(async () => {
      // a análise e os registros do período chegam juntos: a tela troca de período de uma vez
      const [r] = await Promise.all([
        getBlitzAnalise({ de: d, ate: a, unitIds, soMinhaGestao: esc === "minha" }),
        onPeriodo?.(d, a),
      ]);
      if (r.error || !r.data) { toast.error(r.error ?? "Não foi possível carregar as análises."); return; }
      setDados(r.data);
      setModoDosDados(m);
      setEscopoDosDados(esc);
    });
  };

  const escolherModo = (m: Modo) => {
    setModo(m);
    if (m === "mes") carregar("mes", `${mes}-01`, fimDoMes(mes));
    if (m === "ano") carregar("ano", `${ano}-01-01`, `${ano}-12-31`);
    // período livre: espera o "Aplicar"
  };

  const escolherEscopo = (esc: Escopo) => {
    setEscopo(esc);
    carregar(modoDosDados, dados.de, dados.ate, esc);
  };

  const ad = dados.aderencia;
  const periodo = rotulo(modoDosDados, dados.de, dados.ate);
  const recorteDosRegistros = useMemo<RecorteDosRegistros>(() => ({
    de: dados.de, ate: dados.ate, filtro, meio: meioFiltro, situacao: situacaoFiltro,
    ids: escopoDosDados === "minha" && dados.blitz ? new Set(dados.blitz.map((b) => b.id)) : null,
  }), [dados.de, dados.ate, dados.blitz, filtro, escopoDosDados, meioFiltro, situacaoFiltro]);
  const filtraBlitz = !!(meioFiltro || situacaoFiltro);

  // tudo passa pelo filtro único; os cartões são refeitos com o que sobrou
  const pessoasTodas = useMemo(
    () => ad.pessoas ?? ad.faltam.map((f) => ({ ...f, passou: false })), [ad.pessoas, ad.faltam]);
  const pessoas = useMemo(() => pessoasTodas.filter((p) => passaNoFiltro(p, filtro)), [pessoasTodas, filtro]);
  const blitz = useMemo(() => dados.blitz?.filter((b) =>
    passaNoFiltro(b, filtro) && passaNaBlitz(b.meio, b.liberado, b.conforme, meioFiltro, situacaoFiltro),
  ), [dados.blitz, filtro, meioFiltro, situacaoFiltro]);
  // alerta só nasce de blitz não conforme: com "Conforme" na situação, não sobra nenhum
  const alertas = useMemo(() => (dados.alertas ?? []).filter((a) =>
    passaNoFiltro(a, filtro) && passaNaBlitz(a.meio, a.liberado, false, meioFiltro, situacaoFiltro),
  ), [dados.alertas, filtro, meioFiltro, situacaoFiltro]);
  const recorrencia = useMemo(() => {
    const doServidor = dados.recorrencia.filter((r) => passaNoFiltro(r, filtro));
    // com meio ou situação ligados, a conta se refaz só com as blitz que passam
    // (nome, matrícula, setor e gestor seguem os do servidor)
    if (!filtraBlitz || !blitz || blitz.some((b) => !b.user_id)) return doServidor;
    const quem = new Map(dados.recorrencia.map((r) => [r.user_id, r]));
    const conta = new Map<string, { nc: number; n: number }>();
    for (const b of blitz) {
      const id = b.user_id as string;
      const c = conta.get(id) ?? { nc: 0, n: 0 };
      c.n += 1;
      if (!b.conforme) c.nc += 1;
      conta.set(id, c);
    }
    return [...conta.entries()].flatMap(([id, c]) => {
      const r = quem.get(id);
      return r && c.nc > 0 ? [{ ...r, nao_conformes: c.nc, total: c.n }] : [];
    }).sort((x, y) => y.nao_conformes - x.nao_conformes || (x.nome ?? "").localeCompare(y.nome ?? "", "pt-BR"));
  }, [dados.recorrencia, filtro, filtraBlitz, blitz]);
  const temFiltro = FILTROS_DA_TELA.some(({ campo }) => filtro[campo]) || filtraBlitz;
  const meiosDoPeriodo = useMemo(() => [...new Set([
    ...(dados.blitz ?? []).map((b) => b.meio), ...(dados.alertas ?? []).map((a) => a.meio),
  ].filter((m): m is string => !!m))].sort((x, y) => x.localeCompare(y, "pt-BR")), [dados.blitz, dados.alertas]);
  // sem a lista de blitz (versão antiga do banco), vale o número do servidor
  const ind = blitz ? {
    total: blitz.length,
    conformes: blitz.filter((b) => b.conforme).length,
    com_desvio: blitz.filter((b) => b.liberado && !b.conforme).length,
    bloqueios: blitz.filter((b) => !b.liberado).length,
    alertas: { enviados: alertas.length, com_tratativa: alertas.filter((a) => a.registrada_em).length },
  } : dados.indicadores;
  const publico = pessoas.length;
  const passaram = pessoas.filter((p) => p.passou).length;
  const conformidade = pct(ind.conformes, ind.total);
  const aderencia = pct(passaram, publico);
  const tratou = pct(ind.alertas.com_tratativa, ind.alertas.enviados);
  // as opções de cada filtro: o que aparece no público e nas blitz do período
  const opcoes = useMemo(() => Object.fromEntries(FILTROS_PESSOA.map(({ campo }) => [campo,
    [...new Set([...pessoasTodas, ...(dados.blitz ?? [])].map((o) => valorDoCampo(o, campo)))]
      .sort((x, y) => x.localeCompare(y, "pt-BR"))])), [pessoasTodas, dados.blitz]);

  // um botão para o período e a visão (LUIZ, 11/11/2026: tela mais limpa)
  const menuDoPeriodo = (
    <Dropdown
      rotulo={carregando ? "Carregando…" : `${periodo}${escopoDosDados === "minha" ? " · Minha gestão" : ""}`}
      icone={<CalendarDays size={15} aria-hidden />}
      alinharDireita={!celular}
      largura={300}
      titulo="Período e visão das análises"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <span className="soft" style={ROTULO_DO_MENU}>Período</span>
        <Segmentado rotulo="Tipo de período" valor={modo} onChange={escolherModo} desligado={carregando}
          opcoes={[["mes", "Mês"], ["ano", "Ano"], ["periodo", "Período"]]} />
        {modo === "mes" && (
          <input type="month" className="input" value={mes} max={hoje.slice(0, 7)} aria-label="Mês"
            onChange={(e) => { const v = e.target.value; if (!v) return; setMes(v); carregar("mes", `${v}-01`, fimDoMes(v)); }} />
        )}
        {modo === "ano" && (
          <select className="select" value={ano} aria-label="Ano"
            onChange={(e) => { const v = Number(e.target.value); setAno(v); carregar("ano", `${v}-01-01`, `${v}-12-31`); }}>
            {anos.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        {modo === "periodo" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
            <input type="date" className="input" value={de} max={hoje} aria-label="De" onChange={(e) => setDe(e.target.value)} />
            <input type="date" className="input" value={ate} max={hoje} aria-label="Até" onChange={(e) => setAte(e.target.value)} />
            <button type="button" className="btn btn-primary btn-sm" style={{ gridColumn: "1 / -1" }} disabled={carregando}
              onClick={() => carregar("periodo", de, ate)}>
              Aplicar
            </button>
          </div>
        )}
      </div>
      {podeEscolherGestao && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", borderTop: "1px solid var(--border)", paddingTop: "0.7rem" }}>
          <span className="soft" style={ROTULO_DO_MENU}>Mostrar</span>
          <Segmentado rotulo="Quem mostrar" valor={escopo} onChange={escolherEscopo} desligado={carregando}
            opcoes={[["todos", "Todos"], ["minha", "Minha gestão"]]} />
        </div>
      )}
    </Dropdown>
  );

  // e outro, ao lado, para os filtros: dentro do período ninguém achava (LUIZ, 11/11/2026)
  const menuDosFiltros = (
    <Dropdown
      rotulo="Filtros"
      icone={<Filter size={15} aria-hidden />}
      alinharDireita={!celular}
      largura={280}
      titulo="Filtrar por setor, gestor, função, meio e situação"
      contador={FILTROS_DA_TELA.filter(({ campo }) => filtro[campo]).length + (meioFiltro ? 1 : 0) + (situacaoFiltro ? 1 : 0)}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
        <span className="soft" style={ROTULO_DO_MENU}>Filtrar por</span>
        {FILTROS_DA_TELA.map(({ campo, rotulo: nome }) => COM_BUSCA.has(campo) ? (
          <ComBusca key={campo} rotulo={nome} valor={filtro[campo] ?? ""} opcoes={opcoes[campo] ?? []}
            onChange={(v) => setFiltro((f) => ({ ...f, [campo]: v }))} />
        ) : (
          <select key={campo} className="select" value={filtro[campo] ?? ""} aria-label={nome}
            onChange={(e) => setFiltro((f) => ({ ...f, [campo]: e.target.value }))}>
            <option value="">{nome}: todos</option>
            {(opcoes[campo] ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        ))}
        <span className="soft" style={{ ...ROTULO_DO_MENU, marginTop: "0.4rem" }}>Da blitz</span>
        <select className="select" value={meioFiltro} aria-label="Meio de transporte" onChange={(e) => setMeioFiltro(e.target.value)}>
          <option value="">Meio: todos</option>
          {meiosDoPeriodo.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className="select" value={situacaoFiltro} aria-label="Situação da blitz"
          onChange={(e) => setSituacaoFiltro(e.target.value as SituacaoBlitz | "")}>
          <option value="">Situação: todas</option>
          {SITUACOES_BLITZ.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
        </select>
        <span className="soft" style={{ fontSize: "0.72rem", lineHeight: 1.35 }}>
          Meio e situação valem para as blitz. A cobertura e a lista de colaboradores contam pessoas e não mudam.
        </span>
        {temFiltro && (
          <button type="button" className="btn btn-ghost btn-sm"
            onClick={() => { setFiltro({}); setMeioFiltro(""); setSituacaoFiltro(""); }}>Limpar filtros</button>
        )}
      </div>
    </Dropdown>
  );

  const controles = (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
      {menuDosFiltros}
      {menuDoPeriodo}
    </div>
  );

  // a conta da aderência vira dica do cartão, sem o mês na frase (LUIZ, 11/11/2026)
  const dicaAderencia = (
    <>
      Do público, quem passou pela blitz pelo menos uma vez no período. Setor, gestor e unidade são os de hoje.
      Fora da conta: {ad.fora.por_funcao} por função, {ad.fora.por_excecao} por exceção e {ad.fora.ausentes} ausentes o período todo.
    </>
  );

  // os cartões do topo, em três grupos; só na aba Análises (LUIZ, 11/11/2026:
  // nas listas eles só empurravam a tabela para baixo)
  const cartoes = (
    <CartoesAgrupados
      aderencia={aderencia} passaram={passaram} publico={publico}
      conformidade={conformidade} total={ind.total} conformes={ind.conformes} desvio={ind.com_desvio} bloqueios={ind.bloqueios}
      tratou={tratou} tratados={ind.alertas.com_tratativa} enviados={ind.alertas.enviados}
      dicaAderencia={dicaAderencia}
      onDesvio={() => verRegistros("desvio")}
      onBloqueio={() => verRegistros("bloqueado")}
    />
  );

  /** Uma aba de análise: (no celular, os botões), os cartões quando pedidos e o conteúdo. Os filtros
   *  ligados aparecem só dentro do botão Filtros, com o contador nele (LUIZ, 11/11/2026: a linha empurrava a tela). */
  const painel = (corpo: React.ReactNode, comCartoes = false) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem", opacity: carregando ? 0.6 : 1 }}>
      {celular && controles}
      {comCartoes && cartoes}
      {corpo}
    </div>
  );

  const abasDeAnalise = [
    {
      id: "analises", label: rotuloAnalises,
      content: painel(
        <PainelDaBlitz pessoas={pessoas} alertas={alertas} recorrencia={recorrencia} blitz={blitz ?? []} tratativas={tratativas}
          onVerFaltam={verFaltam} onVerAlertas={verAlertas} onVerItem={verItem} onVerRecorrencia={() => onAba("recorrencia")} />,
        true,
      ),
    },
    {
      // quem passou e quem falta numa lista só; abre em "Faltam passar"
      id: "colaboradores", label: `Colaboradores (${publico})`,
      content: painel(
        <BlitzColaboradoresLista key={versaoFaltam} pessoas={pessoas} rotuloPeriodo={periodo}
          chaveArquivo={`${dados.de}_${dados.ate}`} situacaoInicial={situacaoLista} />,
      ),
    },
    {
      id: "recorrencia", label: `Recorrência (${recorrencia.length})`,
      content: painel(<BlitzRecorrenciaLista recorrencia={recorrencia} />),
    },
    {
      // quem tratou e quem está devendo
      id: "alertas", label: `Alertas (${alertas.length})`,
      content: painel(
        <BlitzAlertasLista key={versaoAlertas} alertas={alertas} rotuloPeriodo={periodo}
          chaveArquivo={`${dados.de}_${dados.ate}`} situacaoInicial={situacaoAlertas}
          item={itemAlertas} onItem={setItemAlertas} />,
      ),
    },
  ];
  // Registros também obedece aos dois botões (LUIZ, 11/11/2026); no celular eles vão no topo da aba
  const abaRegistros = {
    id: "registros", label: "Registros",
    content: (
      <div style={{ display: "flex", flexDirection: "column", opacity: carregando ? 0.6 : 1 }}>
        {celular && controles}
        {registros(recorteDosRegistros)}
      </div>
    ),
  };
  // computador: as de análise e Registros. Celular: + Nova blitz, Registros e as de análise
  const abas = celular
    ? [...(novaBlitz ? [{ id: "nova", label: "+ Nova blitz", content: novaBlitz }] : []), abaRegistros, ...abasDeAnalise]
    : [...abasDeAnalise, abaRegistros];
  const atual = aba && abas.some((t) => t.id === aba) ? aba : abas[0].id;

  return (
    <Tabs
      key={celular ? "celular" : "computador"}
      tabs={abas}
      active={atual}
      onActiveChange={onAba}
      aside={!celular ? controles : undefined}
    />
  );
}
