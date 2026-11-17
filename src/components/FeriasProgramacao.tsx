"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconExport } from "@/components/ui/ImpExpIcons";
import { FERIAS_STATUS, FERIAS_STATUS_TONE } from "@/lib/constants";
import { formatDate, shortName, somarDias } from "@/lib/format";
import { downloadSheets } from "@/lib/export-xlsx";
import { corDe, coresDosSetores, diasNoPeriodo, useAgendaFerias, type AgendaItem } from "@/lib/ferias-agenda";
import {
  aplicarFiltros, BarraFiltrosFerias, periodoValido, TODOS_OS_STATUS, type FiltrosFerias,
} from "@/components/FeriasFiltros";

type Pessoa = {
  userId: string;
  nome: string | null;
  matricula: string | null;
  setorId: string | null;
  setor: string | null;
  subsetor: string | null;
  cargo: string | null;
  unidade: string | null;
  periodos: AgendaItem[];
  dias: number;
  /** dias dos períodos que caem dentro do intervalo buscado */
  noPeriodo: number;
  abono: number;
};

/** até onde a busca vai quando o período segue as últimas férias (o teto do ferias_agenda) */
const TETO_DA_BUSCA = 800;

/**
 * A programação de férias por colaborador: quem tem férias marcadas no
 * período, quando e quantos dias, somando os períodos de cada pessoa. A
 * planilha sai com duas abas: uma linha por período e o resumo por pessoa.
 *
 * Desde 12/11/2026 (LUIZ) é também o antigo Acompanhamento ("quem está fora
 * num período"): os atalhos curtos (hoje, 7 dias), a contagem por situação e
 * os dias que caem dentro do período, numa aba só em vez de duas parecidas.
 *
 * Desde 17/11/2026 (LUIZ) o período abre de hoje até as últimas férias
 * programadas, no mínimo 12 meses: as férias do ITALO, lançadas para dez/2027,
 * sumiam da janela fixa de 12 meses. A busca vai até o teto do `ferias_agenda`
 * e o "Até" encosta na última férias que veio; mexer no período desliga isso, e
 * o atalho "Até as últimas férias" religa.
 */
export function FeriasProgramacao({
  setores, unidades, hoje, soUsuarios = null,
}: {
  setores: { id: string; name: string }[];
  unidades: string[] | null;
  hoje: string;
  /** "Minha equipe" do topo da tela de férias (null = todos que a RLS mostra) */
  soUsuarios?: Set<string> | null;
}) {
  const [filtros, setFiltros] = useState<FiltrosFerias>({
    de: hoje, ate: somarDias(hoje, 364), status: TODOS_OS_STATUS, setor: "", busca: "",
  });
  const [buscado, setBuscado] = useState({ de: filtros.de, ate: filtros.ate });
  const [nasUltimas, setNasUltimas] = useState(true);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [gerando, setGerando] = useState(false);

  const teto = somarDias(hoje, TETO_DA_BUSCA);
  const { itens, erro, carregando } = useAgendaFerias(
    nasUltimas ? hoje : buscado.de, nasUltimas ? teto : buscado.ate, unidades, soUsuarios,
  );
  // a última férias que veio da busca larga, nunca menos de 12 meses
  const ateUltimas = useMemo(() => {
    let ate = somarDias(hoje, 364);
    for (const i of itens) if (i.fim > ate) ate = i.fim;
    return ate > teto ? teto : ate;
  }, [itens, hoje, teto]);

  // o período que vale na tela: até as últimas férias ou o que a pessoa escolheu
  const de = nasUltimas ? hoje : buscado.de;
  const ate = nasUltimas ? ateUltimas : buscado.ate;
  const filtrosNaTela = nasUltimas ? { ...filtros, de, ate } : filtros;
  const invalido = nasUltimas ? null : periodoValido(filtros);
  const mudar = (f: FiltrosFerias) => {
    // busca, setor e situação não mexem no período
    if (nasUltimas && f.de === de && f.ate === ate) { setFiltros(f); return; }
    setNasUltimas(false);
    setFiltros(f);
    if (!periodoValido(f)) setBuscado({ de: f.de, ate: f.ate });
  };

  const cores = useMemo(() => coresDosSetores(setores), [setores]);

  const pessoas = useMemo(() => {
    const porPessoa = new Map<string, Pessoa>();
    for (const i of aplicarFiltros(itens, filtros)) {
      const p = porPessoa.get(i.userId) ?? {
        userId: i.userId, nome: i.nome, matricula: i.matricula, setorId: i.setorId, setor: i.setor,
        subsetor: i.subsetor, cargo: i.cargo, unidade: i.unidade, periodos: [], dias: 0, noPeriodo: 0, abono: 0,
      };
      p.periodos.push(i);
      p.dias += i.dias;
      p.noPeriodo += diasNoPeriodo(i, de, ate);
      p.abono += i.abono;
      porPessoa.set(i.userId, p);
    }
    return [...porPessoa.values()]
      .map((p) => ({ ...p, periodos: p.periodos.sort((a, b) => a.inicio.localeCompare(b.inicio)) }))
      .sort((a, b) => (a.nome ?? "").localeCompare(b.nome ?? "", "pt-BR"));
  }, [itens, filtros, de, ate]);

  // quantas pessoas em cada situação (o que era o Acompanhamento)
  const porSituacao = (status: AgendaItem["status"]) =>
    pessoas.filter((p) => p.periodos.some((i) => i.status === status)).length;

  const totalPeriodos = pessoas.reduce((s, p) => s + p.periodos.length, 0);
  const totalDias = pessoas.reduce((s, p) => s + p.dias, 0);

  // expandir ou recolher todos de uma vez (LUIZ, 12/11/2026)
  const todosAbertos = pessoas.length > 0 && pessoas.every((p) => abertos.has(p.userId));
  const alternarTodos = () => setAbertos(todosAbertos ? new Set() : new Set(pessoas.map((p) => p.userId)));

  const alternar = (id: string) => setAbertos((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const baixar = async () => {
    setGerando(true);
    try {
      await downloadSheets(`programacao_de_ferias_${de}_a_${ate}.xlsx`, [
        {
          name: "Períodos",
          headers: ["Colaborador", "Matrícula", "Setor", "Subsetor", "Cargo", "Unidade", "Início", "Término", "Dias", "Dias no período", "Abono", "Situação", "Em dobro", "Origem"],
          rows: pessoas.flatMap((p) => p.periodos.map((i) => [
            i.nome, i.matricula, i.setor, i.subsetor, i.cargo, i.unidade,
            formatDate(i.inicio), formatDate(i.fim), i.dias, diasNoPeriodo(i, de, ate), i.abono,
            FERIAS_STATUS[i.status], i.emDobro ? "Sim" : "Não",
            i.origem === "registro" ? "Registro direto" : "Módulo Férias",
          ])),
        },
        {
          name: "Por colaborador",
          headers: ["Colaborador", "Matrícula", "Setor", "Subsetor", "Cargo", "Unidade", "Períodos", "Dias de férias", "Dias no período", "Dias de abono", "Primeiro início", "Último término"],
          rows: pessoas.map((p) => [
            p.nome, p.matricula, p.setor, p.subsetor, p.cargo, p.unidade,
            p.periodos.length, p.dias, p.noPeriodo, p.abono,
            formatDate(p.periodos[0].inicio), formatDate(p.periodos[p.periodos.length - 1].fim),
          ]),
        },
      ]);
    } finally {
      setGerando(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem", paddingTop: "0.9rem" }}>
      <BarraFiltrosFerias
        filtros={filtrosNaTela} onChange={mudar} setores={setores} hoje={hoje} itens={itens}
        atalhos={["hoje", "7d", "30d", "mes", "proximoMes", "12m", "ano"]}
        ultimas={{ ate: ateUltimas, ativo: nasUltimas, onEscolher: () => setNasUltimas(true) }}
      />
      {invalido && <p style={{ color: "var(--mh-danger)", fontSize: "0.82rem", margin: 0 }}>{invalido}</p>}
      {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{erro}</p>}

      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <span className="soft" style={{ fontSize: "0.8rem" }}>
          {carregando
            ? "Carregando…"
            : `${pessoas.length} colaborador(es) com ${totalPeriodos} período(s), ${totalDias} dias de férias entre ${formatDate(de)} e ${formatDate(ate)}`}
          {!carregando && pessoas.length > 0 && (
            <>
              <br />
              {porSituacao("efetivada")} com férias efetivadas, {porSituacao("aprovada")} aguardando efetivação
              e {porSituacao("solicitada")} aguardando aprovação do gestor
            </>
          )}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={pessoas.length === 0 || carregando} onClick={alternarTodos}>
            {todosAbertos
              ? <><ChevronsDownUp size={14} aria-hidden /> Recolher tudo</>
              : <><ChevronsUpDown size={14} aria-hidden /> Expandir tudo</>}
          </button>
          <button
            type="button" className="btn btn-ghost btn-sm"
            disabled={pessoas.length === 0 || gerando || carregando} onClick={baixar}
          >
            <IconExport /> {gerando ? "Gerando..." : "Baixar programação"}
          </button>
        </div>
      </div>

      {!carregando && pessoas.length === 0 ? (
        <EmptyState title="Nenhuma férias programada no período" description="Ajuste o período ou os filtros para ver outras datas." />
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 32 }} aria-label="Abrir" />
                <th>Colaborador</th>
                <th style={{ width: 90 }}>Matrícula</th>
                <th style={{ width: 160 }}>Setor</th>
                <th style={{ width: 110 }}>Unidade</th>
                <th style={{ width: 80, textAlign: "right" }}>Períodos</th>
                <th style={{ width: 70, textAlign: "right" }}>Dias</th>
                <th style={{ width: 96, textAlign: "right" }} title="Dias que caem dentro do período buscado">No período</th>
                <th style={{ width: 200 }}>Primeiro período</th>
              </tr>
            </thead>
            <tbody>
              {pessoas.map((p) => {
                const aberto = abertos.has(p.userId);
                const primeiro = p.periodos[0];
                return (
                  <Fragment key={p.userId}>
                    <tr style={{ cursor: "pointer" }} onClick={() => alternar(p.userId)}>
                      <td className="muted">{aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                      <td style={{ fontWeight: 600 }} title={p.nome ?? ""}>{shortName(p.nome)}</td>
                      <td className="tabular muted" style={{ fontSize: "0.82rem" }}>{p.matricula ?? "—"}</td>
                      <td className="muted" style={{ fontSize: "0.82rem" }}>
                        <span aria-hidden style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: corDe(cores, p.setorId), marginRight: 6 }} />
                        {p.setor ?? "Sem setor"}
                      </td>
                      <td className="muted" style={{ fontSize: "0.82rem" }}>{p.unidade ?? "—"}</td>
                      <td className="tabular" style={{ textAlign: "right" }}>{p.periodos.length}</td>
                      <td className="tabular" style={{ textAlign: "right" }}>{p.dias}</td>
                      <td className="tabular" style={{ textAlign: "right" }}>{p.noPeriodo}</td>
                      <td>{formatDate(primeiro.inicio)} a {formatDate(primeiro.fim)}</td>
                    </tr>
                    {aberto && p.periodos.map((i) => (
                      <tr key={i.chave} style={{ background: "var(--mh-surface-2)" }}>
                        <td />
                        <td colSpan={3} className="soft" style={{ fontSize: "0.82rem", paddingLeft: "1.2rem" }}>
                          {formatDate(i.inicio)} a {formatDate(i.fim)}
                          {i.abono > 0 ? `, mais ${i.abono} de abono` : ""}
                          {i.emDobro ? ", em dobro" : ""}
                        </td>
                        <td />
                        <td />
                        <td className="tabular" style={{ textAlign: "right", fontSize: "0.82rem" }}>{i.dias}</td>
                        <td className="tabular" style={{ textAlign: "right", fontSize: "0.82rem" }}>{diasNoPeriodo(i, de, ate)}</td>
                        <td><Badge tone={FERIAS_STATUS_TONE[i.status]}>{FERIAS_STATUS[i.status]}</Badge></td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
