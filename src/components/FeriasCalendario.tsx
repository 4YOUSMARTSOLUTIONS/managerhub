"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { FERIAS_STATUS, FERIAS_STATUS_TONE, WEEKDAYS_PT } from "@/lib/constants";
import { formatDate, shortName } from "@/lib/format";
import {
  corDe, coresDosSetores, STATUS_AGENDA, STATUS_AGENDA_CURTO, useAgendaFerias,
  type AgendaItem, type StatusAgenda,
} from "@/lib/ferias-agenda";

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const pad = (n: number) => String(n).padStart(2, "0");
/** data local para AAAA-MM-DD (as datas daqui são sempre meio-dia local) */
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const diaLocal = (ano: number, mes: number, dia: number) => new Date(ano, mes, dia, 12);

/** o visual de cada situação: a cor é do setor; o preenchimento diz em que pé está */
function estiloDaSituacao(status: StatusAgenda, cor: string): React.CSSProperties {
  if (status === "efetivada") {
    return { background: `color-mix(in srgb, ${cor} 28%, var(--mh-surface-1))`, border: "1px solid transparent" };
  }
  if (status === "aprovada") {
    return { background: `color-mix(in srgb, ${cor} 10%, var(--mh-surface-1))`, border: `1px solid color-mix(in srgb, ${cor} 60%, transparent)` };
  }
  return { background: "var(--mh-surface-1)", border: `1px dashed ${cor}` };
}

type Segmento = { item: AgendaItem; c0: number; c1: number; comeca: boolean; termina: boolean; faixa: number };

/**
 * Calendário mensal de férias: uma faixa por semana, uma barra por pessoa
 * atravessando os dias em que ela está fora, na cor do setor.
 *
 * As barras são empilhadas em faixas sem sobreposição (a primeira faixa livre
 * de cada semana), então ninguém some atrás de outra pessoa. Clicar num dia
 * mostra a lista de quem está de férias nele; clicar numa barra mostra a ficha
 * daquele período.
 */
export function FeriasCalendario({
  setores, unidades, hoje,
}: {
  setores: { id: string; name: string }[];
  unidades: string[] | null;
  hoje: string;
}) {
  const [mes, setMes] = useState(`${hoje.slice(0, 7)}-01`);
  const { de, ate } = gradeDoMes(mes);
  const { itens, erro, carregando } = useAgendaFerias(de, ate, unidades);
  return (
    <CalendarioDeFerias
      mes={mes} onMes={setMes} itens={itens} carregando={carregando} erro={erro}
      setores={setores} hoje={hoje}
    />
  );
}

/** a grade sempre começa no domingo e cobre semanas inteiras */
function gradeDoMes(mes: string) {
  const ano = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7)) - 1;
  const primeiro = diaLocal(ano, m, 1);
  const diasNoMes = new Date(ano, m + 1, 0).getDate();
  const semanas = Math.ceil((primeiro.getDay() + diasNoMes) / 7);
  return {
    ano, m, primeiro, diasNoMes, semanas,
    de: iso(diaLocal(ano, m, 1 - primeiro.getDay())),
    ate: iso(diaLocal(ano, m, 1 - primeiro.getDay() + semanas * 7 - 1)),
  };
}

/** A parte visual do calendário: recebe as férias prontas (separada para poder ser vista sem banco). */
export function CalendarioDeFerias({
  mes, onMes, itens, carregando, erro, setores, hoje,
}: {
  mes: string;
  onMes: (mes: string) => void;
  itens: AgendaItem[];
  carregando: boolean;
  erro: string;
  setores: { id: string; name: string }[];
  hoje: string;
}) {
  const [statusOn, setStatusOn] = useState<Record<StatusAgenda, boolean>>({ efetivada: true, aprovada: true, solicitada: true });
  const [setorFiltro, setSetorFiltro] = useState("");
  const [sel, setSel] = useState<{ tipo: "dia"; dia: string } | { tipo: "item"; item: AgendaItem } | null>(null);

  const { ano, m, primeiro, diasNoMes, semanas } = gradeDoMes(mes);
  const mesIni = iso(primeiro);
  const mesFim = iso(diaLocal(ano, m, diasNoMes));
  const setMes = onMes;

  const cores = useMemo(() => coresDosSetores(setores), [setores]);
  const nomeSetor = useMemo(() => new Map(setores.map((s) => [s.id, s.name])), [setores]);

  const visiveis = useMemo(() => itens.filter((i) =>
    statusOn[i.status]
    && (!setorFiltro || (setorFiltro === "__sem__" ? !i.setorId : i.setorId === setorFiltro))),
  [itens, statusOn, setorFiltro]);

  const noMes = useMemo(() => visiveis.filter((i) => i.inicio <= mesFim && i.fim >= mesIni), [visiveis, mesIni, mesFim]);
  const pessoasNoMes = new Set(noMes.map((i) => i.userId)).size;

  // legenda: os setores com alguém de férias no mês, na ordem do cadastro
  const legenda = useMemo(() => {
    const porSetor = new Map<string, Set<string>>();
    for (const i of noMes) {
      const k = i.setorId ?? "__sem__";
      porSetor.set(k, (porSetor.get(k) ?? new Set()).add(i.userId));
    }
    return [...porSetor.entries()]
      .map(([k, ps]) => ({
        id: k,
        nome: k === "__sem__" ? "Sem setor" : nomeSetor.get(k) ?? "Setor",
        cor: corDe(cores, k === "__sem__" ? null : k),
        pessoas: ps.size,
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [noMes, nomeSetor, cores]);

  const grade = useMemo(() => Array.from({ length: semanas }, (_, w) => {
    const recuo = new Date(ano, m, 1).getDay();
    const dias = Array.from({ length: 7 }, (_, c) => diaLocal(ano, m, 1 - recuo + w * 7 + c));
    const ws = iso(dias[0]);
    const we = iso(dias[6]);
    const col = (d: string) => Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${ws}T12:00:00Z`)) / 86_400_000);
    const segs: Segmento[] = visiveis
      .filter((i) => i.inicio <= we && i.fim >= ws)
      .map((i) => ({
        item: i,
        c0: col(i.inicio > ws ? i.inicio : ws),
        c1: col(i.fim < we ? i.fim : we),
        comeca: i.inicio >= ws,
        termina: i.fim <= we,
        faixa: 0,
      }))
      .sort((a, b) => a.c0 - b.c0 || (b.c1 - b.c0) - (a.c1 - a.c0) || (a.item.nome ?? "").localeCompare(b.item.nome ?? "", "pt-BR"));
    const ocupadaAte: number[] = [];
    for (const s of segs) {
      let f = ocupadaAte.findIndex((fim) => fim < s.c0);
      if (f < 0) { f = ocupadaAte.length; ocupadaAte.push(s.c1); } else ocupadaAte[f] = s.c1;
      s.faixa = f;
    }
    return { dias, segs, faixas: ocupadaAte.length };
  }), [semanas, ano, m, visiveis]);

  const mudarMes = (delta: number) => { setMes(iso(diaLocal(ano, m + delta, 1)).slice(0, 8) + "01"); setSel(null); };
  const naoEhEsteMes = mes.slice(0, 7) !== hoje.slice(0, 7);

  const doDia = sel?.tipo === "dia"
    ? visiveis.filter((i) => i.inicio <= sel.dia && i.fim >= sel.dia)
        .sort((a, b) => (a.setor ?? "").localeCompare(b.setor ?? "", "pt-BR") || (a.nome ?? "").localeCompare(b.nome ?? "", "pt-BR"))
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem", paddingTop: "0.9rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <button type="button" className="icon-btn" onClick={() => mudarMes(-1)} aria-label="Mês anterior"><ChevronLeft size={16} /></button>
          <div style={{ minWidth: 150, textAlign: "center", fontWeight: 700 }}>{MESES[m]} {ano}</div>
          <button type="button" className="icon-btn" onClick={() => mudarMes(1)} aria-label="Próximo mês"><ChevronRight size={16} /></button>
          {naoEhEsteMes && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMes(`${hoje.slice(0, 7)}-01`); setSel(null); }}>Hoje</button>
          )}
        </div>
        <span className="soft" style={{ fontSize: "0.82rem" }}>
          {carregando ? "Carregando…" : `${pessoasNoMes} pessoa(s) de férias no mês`}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
          {STATUS_AGENDA.map((s) => (
            <label key={s} style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.8rem", cursor: "pointer" }}>
              <input type="checkbox" checked={statusOn[s]} onChange={(e) => setStatusOn({ ...statusOn, [s]: e.target.checked })} />
              <span style={{ display: "inline-block", width: 18, height: 10, borderRadius: 3, ...estiloDaSituacao(s, "var(--mh-text-2)") }} />
              {STATUS_AGENDA_CURTO[s]}
            </label>
          ))}
          <select className="input" value={setorFiltro} onChange={(e) => setSetorFiltro(e.target.value)} style={{ maxWidth: 200, fontSize: "0.82rem" }}>
            <option value="">Todos os setores</option>
            {[...setores].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value="__sem__">Sem setor</option>
          </select>
        </div>
      </div>

      {legenda.length > 0 && (
        <div style={{ display: "flex", gap: "0.9rem", flexWrap: "wrap", fontSize: "0.78rem" }}>
          {legenda.map((l) => (
            <span key={l.id} style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: l.cor }} />
              {l.nome} <span className="soft">({l.pessoas})</span>
            </span>
          ))}
        </div>
      )}

      {erro && (
        <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{erro}</p>
      )}

      <div className="card" style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 760 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", borderBottom: "1px solid var(--mh-border)" }}>
            {WEEKDAYS_PT.map((w) => (
              <div key={w} className="soft" style={{ textAlign: "center", padding: "0.4rem 0", fontSize: "0.7rem", fontWeight: 600 }}>{w.slice(0, 3)}</div>
            ))}
          </div>

          {grade.map(({ dias, segs, faixas }, w) => (
            <div
              key={w}
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                gridTemplateRows: `26px repeat(${faixas}, 23px) ${faixas ? 6 : 34}px`,
                borderBottom: w < grade.length - 1 ? "1px solid var(--mh-border)" : undefined,
              }}
            >
              {dias.map((d, c) => {
                const ds = iso(d);
                const fds = c === 0 || c === 6;
                const selecionado = sel?.tipo === "dia" && sel.dia === ds;
                return (
                  <button
                    key={`fundo-${ds}`}
                    type="button"
                    aria-label={`Quem está de férias em ${formatDate(ds)}`}
                    onClick={() => setSel({ tipo: "dia", dia: ds })}
                    style={{
                      gridColumn: c + 1, gridRow: `1 / ${faixas + 3}`,
                      border: "none", borderRight: c < 6 ? "1px solid var(--mh-border)" : "none",
                      background: selecionado
                        ? "var(--mh-primary-soft)"
                        : fds ? "color-mix(in srgb, var(--mh-surface-2) 70%, transparent)" : "transparent",
                      cursor: "pointer", padding: 0,
                    }}
                  />
                );
              })}
              {dias.map((d, c) => {
                const ds = iso(d);
                const doMes = d.getMonth() === m;
                const ehHoje = ds === hoje;
                return (
                  <div key={`num-${ds}`} style={{ gridColumn: c + 1, gridRow: 1, display: "flex", justifyContent: "flex-end", padding: "0.2rem 0.3rem", pointerEvents: "none", zIndex: 1 }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 20, height: 20,
                      borderRadius: 999, fontSize: "0.72rem", fontWeight: 700,
                      background: ehHoje ? "var(--mh-primary-500)" : "transparent",
                      color: ehHoje ? "#fff" : doMes ? "var(--mh-text-1)" : "var(--mh-text-3)",
                    }}>
                      {d.getDate()}
                    </span>
                  </div>
                );
              })}
              {segs.map((s) => {
                const i = s.item;
                const cor = corDe(cores, i.setorId);
                const raio = `${s.comeca ? 4 : 0}px ${s.termina ? 4 : 0}px ${s.termina ? 4 : 0}px ${s.comeca ? 4 : 0}px`;
                return (
                  <button
                    key={`${i.chave}-${w}`}
                    type="button"
                    onClick={() => setSel({ tipo: "item", item: i })}
                    title={`${i.nome ?? ""}\n${i.setor ?? "Sem setor"}\n${formatDate(i.inicio)} a ${formatDate(i.fim)} (${i.dias} dias)\n${FERIAS_STATUS[i.status]}${i.emDobro ? " · em dobro" : ""}`}
                    style={{
                      ...estiloDaSituacao(i.status, cor),
                      ...(s.comeca ? { borderLeft: `3px solid ${cor}` } : {}),
                      gridColumn: `${s.c0 + 1} / ${s.c1 + 2}`, gridRow: s.faixa + 2,
                      margin: `1px ${s.termina ? 3 : 0}px 1px ${s.comeca ? 3 : 0}px`,
                      borderRadius: raio, zIndex: 2, minWidth: 0,
                      display: "block", textAlign: "left", cursor: "pointer",
                      fontSize: "0.68rem", lineHeight: "19px", padding: "0 0.3rem",
                      color: "var(--mh-text-1)", fontWeight: 600,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}
                  >
                    {s.comeca ? "" : "… "}{shortName(i.nome)}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {sel?.tipo === "dia" && (
        <div className="card card-pad">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.6rem" }}>
            <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: 0 }}>
              {formatDate(sel.dia)}: {doDia.length} pessoa(s) de férias
            </h3>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSel(null)}>Fechar</button>
          </div>
          {doDia.length === 0 ? (
            <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Ninguém de férias neste dia com os filtros escolhidos.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th style={{ width: 170 }}>Setor</th>
                    <th style={{ width: 190 }}>Período</th>
                    <th style={{ width: 70, textAlign: "right" }}>Dias</th>
                    <th style={{ width: 180 }}>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {doDia.map((i) => (
                    <tr key={i.chave}>
                      <td style={{ fontWeight: 600 }}>{shortName(i.nome)}</td>
                      <td className="muted" style={{ fontSize: "0.82rem" }}>
                        <span aria-hidden style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: corDe(cores, i.setorId), marginRight: 6 }} />
                        {i.setor ?? "Sem setor"}
                      </td>
                      <td>{formatDate(i.inicio)} a {formatDate(i.fim)}</td>
                      <td className="tabular" style={{ textAlign: "right" }}>{i.dias}</td>
                      <td><Badge tone={FERIAS_STATUS_TONE[i.status]}>{FERIAS_STATUS[i.status]}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {sel?.tipo === "item" && (
        <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
            <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: 0 }}>{sel.item.nome}</h3>
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
              <Badge tone={FERIAS_STATUS_TONE[sel.item.status]}>{FERIAS_STATUS[sel.item.status]}</Badge>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSel(null)}>Fechar</button>
            </div>
          </div>
          <p className="soft" style={{ fontSize: "0.84rem", margin: 0 }}>
            {[sel.item.matricula ? `Matrícula ${sel.item.matricula}` : null, sel.item.setor ?? "Sem setor", sel.item.cargo, sel.item.unidade]
              .filter(Boolean).join(" · ")}
          </p>
          <p style={{ fontSize: "0.86rem", margin: 0 }}>
            {formatDate(sel.item.inicio)} a {formatDate(sel.item.fim)}, {sel.item.dias} dias
            {sel.item.abono > 0 ? ` e ${sel.item.abono} de abono` : ""}
            {sel.item.emDobro ? ". Férias em dobro." : "."}
            {sel.item.reagendamento ? " Reagendamento aguardando o DP." : ""}
            {sel.item.origem === "registro" ? " Registrada direto pelo DP." : ""}
          </p>
        </div>
      )}
    </div>
  );
}
