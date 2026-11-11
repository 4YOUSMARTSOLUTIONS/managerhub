"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarDays, Filter, X } from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { Tabs } from "@/components/ui/Tabs";
import { Dropdown } from "@/components/ui/Dropdown";
import {
  BlitzAderenciaDetalhe, BlitzColaboradoresLista, BlitzRecorrenciaLista, FILTROS_PESSOA, passaNoFiltro, valorDoCampo,
  type FiltroPessoa, type SituacaoPessoa,
} from "./BlitzAderencia";
import { BlitzAlertasLista, TratativasPendentesPorGestor, type SituacaoAlerta } from "./BlitzAlertasLista";
import { getBlitzAnalise } from "@/lib/actions/seguranca";
import { formatDate, normalizar } from "@/lib/format";
import { pct, type BlitzAnaliseDados } from "@/lib/blitz-aderencia";

type Modo = "mes" | "ano" | "periodo";
/** "Minha gestão": quem vê a empresa olhando só a própria cadeia (LUIZ, 11/11/2026) */
type Escopo = "todos" | "minha";

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
 * e Registros. Nas quatro de análise os cartões ficam sempre no topo, e um
 * botão só (período e, para quem vê a empresa e tem equipe, "Minha gestão")
 * vale para todas. Registros tem os filtros dela e não leva o botão.
 *
 * A aba aberta mora em quem usa (o cartão de desvio leva a Registros e o
 * gráfico, a Colaboradores), por isso `aba`/`onAba`.
 */
export function BlitzAnalises({
  inicial, unitIds, hoje, anos, podeEscolherGestao, tratativas, onVerRegistros,
  registros, novaBlitz, celular, rotuloAnalises, aba, onAba,
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
  /** clique nos cartões de desvio e bloqueio: a lista de Registros filtrada no período */
  onVerRegistros?: (situacao: "desvio" | "bloqueado", recorte: { de: string; ate: string; rotulo: string; filtro: FiltroPessoa }) => void;
  registros: React.ReactNode;
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
  // a situação em que cada lista abre quando chega por um clique; a versão
  // remonta a lista para valer a nova
  const [situacaoLista, setSituacaoLista] = useState<SituacaoPessoa>("faltam");
  const [versaoFaltam, setVersaoFaltam] = useState(0);
  const [situacaoAlertas, setSituacaoAlertas] = useState<SituacaoAlerta>("");
  const [versaoAlertas, setVersaoAlertas] = useState(0);

  const mudarFiltro = (f: FiltroPessoa) => setFiltro((atual) => ({ ...atual, ...f }));

  const verAlertas = (gestor: string) => {
    mudarFiltro({ gestor });
    setSituacaoAlertas("aguardando");
    setVersaoAlertas((v) => v + 1);
    onAba("alertas");
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
      const r = await getBlitzAnalise({ de: d, ate: a, unitIds, soMinhaGestao: esc === "minha" });
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

  // tudo passa pelo filtro único; os cartões são refeitos com o que sobrou
  const pessoasTodas = useMemo(
    () => ad.pessoas ?? ad.faltam.map((f) => ({ ...f, passou: false })), [ad.pessoas, ad.faltam]);
  const pessoas = useMemo(() => pessoasTodas.filter((p) => passaNoFiltro(p, filtro)), [pessoasTodas, filtro]);
  const alertas = useMemo(() => (dados.alertas ?? []).filter((a) => passaNoFiltro(a, filtro)), [dados.alertas, filtro]);
  const recorrencia = useMemo(() => dados.recorrencia.filter((r) => passaNoFiltro(r, filtro)), [dados.recorrencia, filtro]);
  const blitz = useMemo(() => dados.blitz?.filter((b) => passaNoFiltro(b, filtro)), [dados.blitz, filtro]);
  const temFiltro = FILTROS_DA_TELA.some(({ campo }) => filtro[campo]);
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
      titulo="Filtrar por unidade, setor, gestor e função"
      contador={FILTROS_DA_TELA.filter(({ campo }) => filtro[campo]).length}
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
        {temFiltro && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFiltro({})}>Limpar filtros</button>
        )}
      </div>
    </Dropdown>
  );

  // cartões sempre no topo das abas de análise (LUIZ, 11/11/2026)
  const cartoes = (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))", gap: "0.8rem" }}>
      {/* aderência primeiro, depois conformidade (LUIZ, 11/11/2026) */}
      <StatCard
        label="Aderência"
        value={aderencia === null ? "—" : `${aderencia}%`}
        tone={aderencia === null ? "blue" : aderencia >= 90 ? "green" : aderencia >= 70 ? "amber" : "red"}
        hint={`${passaram} de ${publico} do público passaram`}
      />
      <StatCard
        label="Conformidade"
        value={conformidade === null ? "—" : `${conformidade}%`}
        tone={conformidade === null ? "blue" : conformidade >= 80 ? "green" : conformidade >= 50 ? "amber" : "red"}
        hint={ind.total ? `${ind.conformes} de ${ind.total} blitz conformes` : "Nenhuma blitz no período"}
      />
      <StatCard label="Faltam passar" value={publico - passaram} hint="do público do período" />
      {/* desvio e bloqueio pintados para chamar atenção; sem ocorrência, cartão neutro */}
      <StatCard label="Liberadas com desvio" value={ind.com_desvio} tone={ind.com_desvio > 0 ? "amber" : "green"}
        destaque={ind.com_desvio > 0 ? "amber" : undefined}
        onClick={onVerRegistros && ind.com_desvio > 0 ? () => onVerRegistros("desvio", { de: dados.de, ate: dados.ate, rotulo: periodo, filtro }) : undefined}
        acao="Ver as blitz liberadas com desvio" />
      <StatCard label="Bloqueios" value={ind.bloqueios} tone={ind.bloqueios > 0 ? "red" : "green"}
        destaque={ind.bloqueios > 0 ? "red" : undefined}
        onClick={onVerRegistros && ind.bloqueios > 0 ? () => onVerRegistros("bloqueado", { de: dados.de, ate: dados.ate, rotulo: periodo, filtro }) : undefined}
        acao="Ver as blitz bloqueadas" />
      {/* o % tratado em destaque; o total de alertas já se lê nos dois cartões ao lado */}
      <StatCard
        label="Alertas com tratativa"
        value={tratou === null ? "—" : `${tratou}%`}
        hint={ind.alertas.enviados ? `${ind.alertas.com_tratativa} de ${ind.alertas.enviados} ${ind.alertas.enviados === 1 ? "alerta tratado" : "alertas tratados"}` : "Nenhum alerta no período"}
      />
    </div>
  );

  const controles = (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
      {menuDosFiltros}
      {menuDoPeriodo}
    </div>
  );

  /** Uma aba de análise: (no celular, os botões), os cartões e o conteúdo. Os filtros ligados
   *  aparecem só dentro do botão Filtros, com o contador nele (LUIZ, 11/11/2026: a linha empurrava a tela). */
  const painel = (corpo: React.ReactNode) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem", opacity: carregando ? 0.6 : 1 }}>
      {celular && controles}
      {cartoes}
      {corpo}
    </div>
  );

  const abasDeAnalise = [
    {
      id: "analises", label: rotuloAnalises,
      content: painel(
        <>
          {tratativas}
          <BlitzAderenciaDetalhe pessoas={pessoas} fora={ad.fora}
            rotuloPeriodo={periodo} onVerFaltam={verFaltam}
            pendencias={alertas.some((a) => !a.registrada_em)
              ? <TratativasPendentesPorGestor alertas={alertas} rotuloPeriodo={periodo} onVer={verAlertas} />
              : null} />
        </>,
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
      content: painel(<BlitzRecorrenciaLista recorrencia={recorrencia} rotuloPeriodo={periodo} />),
    },
    {
      // quem tratou e quem está devendo
      id: "alertas", label: `Alertas (${alertas.length})`,
      content: painel(
        <BlitzAlertasLista key={versaoAlertas} alertas={alertas} rotuloPeriodo={periodo}
          chaveArquivo={`${dados.de}_${dados.ate}`} situacaoInicial={situacaoAlertas}
          gestorAtivo={filtro.gestor} onGestor={(g) => mudarFiltro({ gestor: g })} />,
      ),
    },
  ];
  const abaRegistros = { id: "registros", label: "Registros", content: registros };
  // computador: as de análise e Registros. Celular: + Nova blitz, Registros e as de análise
  const abas = celular
    ? [...(novaBlitz ? [{ id: "nova", label: "+ Nova blitz", content: novaBlitz }] : []), abaRegistros, ...abasDeAnalise]
    : [...abasDeAnalise, abaRegistros];
  const atual = aba && abas.some((t) => t.id === aba) ? aba : abas[0].id;
  const ehDeAnalise = abasDeAnalise.some((t) => t.id === atual);

  return (
    <Tabs
      key={celular ? "celular" : "computador"}
      tabs={abas}
      active={atual}
      onActiveChange={onAba}
      aside={!celular && ehDeAnalise ? controles : undefined}
    />
  );
}
