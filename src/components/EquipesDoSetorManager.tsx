"use client";

/**
 * Configurações > Colaboradores > Equipes do setor (LUIZ, 26/11/2026).
 *
 * A carteira do comercial (RN e promotor por gerente de vendas e por mesa) era
 * uma planilha mensal que o DP pedia e repassava. Agora quem cuida dela ajusta
 * aqui: escolhe as pessoas, o subsetor e/ou o gestor novos e a data em que a
 * mudança vale. As travas estão no banco (`equipe_transferir`): quem tem só a
 * marca mexe no próprio setor, nunca em si mesmo, e o gestor novo é do setor.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { salvarFuncoesDaCarteira, transferirNaEquipe } from "@/lib/actions/equipes";
import { shortName } from "@/lib/format";
import { funcaoBase } from "@/lib/funcao-base";
import { SearchSelect } from "./SearchSelect";

export type PessoaDaEquipe = {
  membershipId: string;
  userId: string;
  nome: string;
  matricula: string | null;
  funcao: string | null;
  setorId: string | null;
  subsetorId: string | null;
  subsetorNome: string | null;
  gestorId: string | null;
  gestorNome: string | null;
  unidades: string[];
};

const canon = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

function hojeSP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/** pela matrícula, como número; sem matrícula vai para o fim */
function ordem(a: PessoaDaEquipe, b: PessoaDaEquipe) {
  const na = a.matricula && /^\d+$/.test(a.matricula) ? Number(a.matricula) : Infinity;
  const nb = b.matricula && /^\d+$/.test(b.matricula) ? Number(b.matricula) : Infinity;
  return na - nb || a.nome.localeCompare(b.nome, "pt-BR");
}

export function EquipesDoSetorManager({
  pessoas,
  setores,
  subsetores,
  regrasSubsetor,
  setorInicial,
  setorFixo,
  meuUserId,
  funcoesDaCarteira,
  podeConfigurar,
}: {
  /** ativos (de um setor só, para quem tem só a marca; de todos, para owner/admin/DP) */
  pessoas: PessoaDaEquipe[];
  /** setores que dá para escolher; com `setorFixo`, não aparece o seletor */
  setores: { id: string; name: string }[];
  subsetores: { id: string; name: string; setorId: string }[];
  regrasSubsetor: { subsetorId: string; unidade: string; gestorId: string }[];
  setorInicial: string | null;
  /** quem tem só a marca: o setor dela, sem escolha */
  setorFixo: boolean;
  meuUserId: string;
  /**
   * as funções da carteira de cada setor (nome base). A lista mostra só quem
   * tem uma delas; setor sem configuração mostra todo mundo (LUIZ, 26/11/2026)
   */
  funcoesDaCarteira: Record<string, string[]>;
  /** owner, admin e DP configuram as funções da carteira */
  podeConfigurar: boolean;
}) {
  const router = useRouter();
  const [setor, setSetor] = useState(setorInicial ?? setores[0]?.id ?? "");
  const [busca, setBusca] = useState("");
  const [filtroSub, setFiltroSub] = useState("");
  const [filtroGestor, setFiltroGestor] = useState("");
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [transferindo, setTransferindo] = useState<PessoaDaEquipe[] | null>(null);

  // o setor inteiro serve de gestor (decisão do LUIZ); a lista mostra só a carteira
  const doSetorTodos = useMemo(() => pessoas.filter((p) => p.setorId === setor).sort(ordem), [pessoas, setor]);
  const carteira = useMemo(() => funcoesDaCarteira[setor] ?? [], [funcoesDaCarteira, setor]);
  const doSetor = useMemo(
    () => (carteira.length ? doSetorTodos.filter((p) => carteira.includes(funcaoBase(p.funcao))) : doSetorTodos),
    [doSetorTodos, carteira],
  );
  const subsDoSetor = useMemo(
    () => subsetores.filter((s) => s.setorId === setor).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [subsetores, setor],
  );
  const gestoresNaLista = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of doSetor) if (p.gestorId) m.set(p.gestorId, p.gestorNome ?? "Sem nome");
    return [...m.entries()].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [doSetor]);

  const q = canon(busca);
  const lista = doSetor.filter((p) =>
    (!q || canon(`${p.nome} ${p.matricula ?? ""} ${p.funcao ?? ""}`).includes(q))
    && (!filtroSub || (filtroSub === "-" ? !p.subsetorId : p.subsetorId === filtroSub))
    && (!filtroGestor || p.gestorId === filtroGestor));
  // quem tem só a marca não mexe na própria equipe (o banco também recusa)
  const podeMarcar = (p: PessoaDaEquipe) => !(setorFixo && p.userId === meuUserId);
  const marcaveis = lista.filter(podeMarcar);
  const todosMarcados = marcaveis.length > 0 && marcaveis.every((p) => marcados.has(p.membershipId));

  function trocarSetor(id: string) {
    setSetor(id); setFiltroSub(""); setFiltroGestor(""); setMarcados(new Set());
  }
  function alternar(id: string) {
    setMarcados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  return (
    <div className="card">
      <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
          Mude o gestor e o subsetor de quem é da carteira do setor, com a data em que a mudança vale. Ela
          entra no histórico de cada pessoa, e o gestor que perde e o que recebe a pessoa são avisados.
        </p>
        {podeConfigurar ? (
          <FuncoesDaCarteira
            key={setor}
            setorId={setor}
            atuais={carteira}
            disponiveis={[...new Set(doSetorTodos.map((p) => funcaoBase(p.funcao)).filter(Boolean))].sort()}
          />
        ) : carteira.length > 0 && (
          <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
            Carteira: {carteira.join(", ")} (em qualquer nível).
          </p>
        )}
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
          {!setorFixo && (
            <select className="select" value={setor} onChange={(e) => trocarSetor(e.target.value)} aria-label="Setor" style={{ width: 200 }}>
              {setores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <input className="input" placeholder="Buscar nome, matrícula ou função…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 260 }} />
          <select className="select" value={filtroSub} onChange={(e) => setFiltroSub(e.target.value)} aria-label="Subsetor" style={{ width: 200 }}>
            <option value="">Todos os subsetores</option>
            <option value="-">Sem subsetor</option>
            {subsDoSetor.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="select" value={filtroGestor} onChange={(e) => setFiltroGestor(e.target.value)} aria-label="Gestor" style={{ width: 220 }}>
            <option value="">Todos os gestores</option>
            {gestoresNaLista.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
          </select>
          <button
            type="button" className="btn btn-primary btn-sm" style={{ marginLeft: "auto" }}
            disabled={marcados.size === 0}
            onClick={() => setTransferindo(doSetor.filter((p) => marcados.has(p.membershipId)))}
          >
            Transferir {marcados.size > 0 ? `(${marcados.size})` : ""}
          </button>
        </div>
      </div>

      <table className="table table-linha">
        <thead>
          <tr>
            <th style={{ width: 30 }}>
              <input
                type="checkbox" aria-label="Marcar todos" checked={todosMarcados} disabled={marcaveis.length === 0}
                onChange={() => setMarcados((s) => {
                  const n = new Set(s);
                  for (const p of marcaveis) { if (todosMarcados) n.delete(p.membershipId); else n.add(p.membershipId); }
                  return n;
                })}
              />
            </th>
            <th>Matrícula</th>
            <th>Colaborador</th>
            <th>Função</th>
            <th>Subsetor</th>
            <th>Gestor</th>
            <th style={{ width: 90 }} />
          </tr>
        </thead>
        <tbody>
          {lista.map((p) => (
            <tr key={p.membershipId}>
              <td>
                <input
                  type="checkbox" aria-label={`Marcar ${p.nome}`} checked={marcados.has(p.membershipId)}
                  disabled={!podeMarcar(p)} onChange={() => alternar(p.membershipId)}
                />
              </td>
              <td>{p.matricula ?? "—"}</td>
              <td><span className="cell-trunc" title={p.nome} style={{ maxWidth: 200 }}>{shortName(p.nome)}</span></td>
              <td><span className="cell-trunc" title={p.funcao ?? ""} style={{ maxWidth: 220 }}>{p.funcao ?? "—"}</span></td>
              <td><span className="cell-trunc" title={p.subsetorNome ?? ""} style={{ maxWidth: 180 }}>{p.subsetorNome ?? "—"}</span></td>
              <td><span className="cell-trunc" title={p.gestorNome ?? ""} style={{ maxWidth: 180 }}>{p.gestorNome ? shortName(p.gestorNome) : "—"}</span></td>
              <td style={{ textAlign: "right" }}>
                {podeMarcar(p) && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTransferindo([p])}>Transferir</button>
                )}
              </td>
            </tr>
          ))}
          {lista.length === 0 && (
            <tr><td colSpan={7} className="soft" style={{ textAlign: "center", padding: "1rem" }}>Ninguém encontrado.</td></tr>
          )}
        </tbody>
      </table>

      {transferindo && (
        <ModalTransferir
          pessoas={transferindo}
          subsetores={subsDoSetor}
          // o gestor novo é alguém do setor (decisão do LUIZ), e nunca quem está sendo movido
          gestores={doSetorTodos
            .filter((g) => !transferindo.some((t) => t.userId === g.userId))
            .map((g) => ({ id: g.userId, name: g.nome }))
            .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))}
          regrasSubsetor={regrasSubsetor}
          onFechar={() => setTransferindo(null)}
          onFeito={() => { setTransferindo(null); setMarcados(new Set()); router.refresh(); }}
        />
      )}
    </div>
  );
}

/** owner, admin e DP escolhem as funções da carteira do setor (nome base) */
function FuncoesDaCarteira({ setorId, atuais, disponiveis }: {
  setorId: string;
  atuais: string[];
  disponiveis: string[];
}) {
  const router = useRouter();
  const [lista, setLista] = useState<string[]>(atuais);
  const [nova, setNova] = useState("");
  const [salvando, setSalvando] = useState(false);
  const mudou = lista.join("|") !== atuais.join("|");

  async function salvar() {
    setSalvando(true);
    const r = await salvarFuncoesDaCarteira(setorId, lista);
    setSalvando(false);
    if (r.error) { toast.error(r.error); return; }
    toast.success(r.message ?? "Salvo.");
    router.refresh();
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap", fontSize: "0.8rem" }}>
      <span className="muted">Funções da carteira:</span>
      {lista.length === 0 && <span className="soft">nenhuma (aparece o setor inteiro)</span>}
      {lista.map((f) => (
        <span key={f} className="badge" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {f}
          <button
            type="button" aria-label={`Tirar ${f}`} disabled={salvando}
            onClick={() => setLista((xs) => xs.filter((x) => x !== f))}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 0, lineHeight: 1 }}
          >
            ×
          </button>
        </span>
      ))}
      <select
        className="select" value={nova} disabled={salvando} aria-label="Acrescentar função à carteira"
        onChange={(e) => { const v = e.target.value; if (v && !lista.includes(v)) setLista((xs) => [...xs, v].sort()); setNova(""); }}
        style={{ width: 230 }}
      >
        <option value="">Acrescentar função…</option>
        {disponiveis.filter((f) => !lista.includes(f)).map((f) => <option key={f} value={f}>{f}</option>)}
      </select>
      {mudou && (
        <button type="button" className="btn btn-primary btn-sm" disabled={salvando} onClick={salvar}>
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      )}
    </div>
  );
}

function ModalTransferir({ pessoas, subsetores, gestores, regrasSubsetor, onFechar, onFeito }: {
  pessoas: PessoaDaEquipe[];
  subsetores: { id: string; name: string }[];
  gestores: { id: string; name: string }[];
  regrasSubsetor: { subsetorId: string; unidade: string; gestorId: string }[];
  onFechar: () => void;
  onFeito: () => void;
}) {
  const hoje = hojeSP();
  const [subsetorId, setSubsetorId] = useState("");
  const [gestorId, setGestorId] = useState("");
  const [gestorTocado, setGestorTocado] = useState(false);
  const [data, setData] = useState(hoje);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const nomeSub = new Map(subsetores.map((s) => [s.id, s.name]));
  const nomeGestor = new Map(gestores.map((g) => [g.id, g.name]));
  // a regra da importação também sugere aqui: o gestor padrão da mesa
  const unidades = [...new Set(pessoas.flatMap((p) => p.unidades))];
  const sugestao = (sub: string) => {
    for (const u of unidades) {
      const r = regrasSubsetor.find((x) => x.subsetorId === sub && canon(x.unidade) === canon(u));
      if (r && nomeGestor.has(r.gestorId)) return r.gestorId;
    }
    return "";
  };

  function trocarSubsetor(id: string) {
    setSubsetorId(id);
    if (!gestorTocado) setGestorId(id ? sugestao(id) : "");
  }

  async function confirmar() {
    setErro("");
    if (!subsetorId && !gestorId) { setErro("Escolha o subsetor novo, o gestor novo ou os dois."); return; }
    if (!data) { setErro("Informe a data da mudança."); return; }
    if (data > hoje) { setErro("A data não pode ser futura."); return; }
    setSalvando(true);
    const r = await transferirNaEquipe({
      membros: pessoas.map((p) => p.membershipId),
      subsetorId: subsetorId || null,
      gestorId: gestorId || null,
      data,
    });
    setSalvando(false);
    if (r.error) { setErro(r.error); return; }
    toast.success(r.message ?? "Equipe atualizada.");
    onFeito();
  }

  const dataBr = data ? data.split("-").reverse().join("/") : "";

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 60, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 620, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>
            Transferir {pessoas.length === 1 ? shortName(pessoas[0].nome) : `${pessoas.length} colaboradores`}
          </h2>
          <button type="button" onClick={onFechar} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>

        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem", fontSize: "0.88rem" }}>
          {pessoas.length > 1 && (
            <ul className="muted" style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.8rem", maxHeight: 120, overflow: "auto" }}>
              {pessoas.map((p) => (
                <li key={p.membershipId} title={p.nome}>
                  {p.matricula ?? "?"} · {shortName(p.nome)} · {p.subsetorNome ?? "sem subsetor"} · {p.gestorNome ? shortName(p.gestorNome) : "sem gestor"}
                </li>
              ))}
            </ul>
          )}
          {pessoas.length === 1 && (
            <p className="muted" style={{ margin: 0, fontSize: "0.82rem" }}>
              Hoje: {pessoas[0].subsetorNome ?? "sem subsetor"} · gestor {pessoas[0].gestorNome ?? "nenhum"}
            </p>
          )}

          <label>
            <span className="label">Subsetor novo</span>
            <select className="select" value={subsetorId} disabled={salvando} onChange={(e) => trocarSubsetor(e.target.value)}>
              <option value="">Manter o atual</option>
              {subsetores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>

          <div>
            <span className="label">Gestor novo</span>
            <SearchSelect
              options={gestores}
              value={gestorId}
              onChange={(v) => { setGestorId(v); setGestorTocado(true); }}
              placeholder="Manter o atual (digite para escolher outro)"
              disabled={salvando}
              maxVisible={gestores.length}
            />
            {subsetorId && !gestorTocado && gestorId && (
              <span className="soft" style={{ fontSize: "0.75rem" }}>Sugerido pela regra do subsetor. Troque se precisar.</span>
            )}
          </div>

          <label>
            <span className="label">A partir de</span>
            <input type="date" className="input" value={data} max={hoje} disabled={salvando} onChange={(e) => setData(e.target.value)} style={{ width: 180 }} />
            <span className="soft" style={{ display: "block", fontSize: "0.75rem", marginTop: 4 }}>
              O primeiro dia na equipe nova. Até o dia anterior, o histórico mantém a situação antiga.
            </span>
          </label>

          {(subsetorId || gestorId) && (
            <div style={{ background: "var(--surface-2)", borderRadius: 8, padding: "0.6rem 0.8rem", fontSize: "0.82rem" }}>
              A partir de {dataBr}: {subsetorId ? `subsetor ${nomeSub.get(subsetorId)}` : "mesmo subsetor"}
              {" e "}{gestorId ? `gestor ${nomeGestor.get(gestorId)}` : "mesmo gestor"}.
            </div>
          )}
          {erro && <p style={{ color: "var(--mh-danger)", margin: 0, fontSize: "0.84rem" }}>{erro}</p>}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" onClick={onFechar} disabled={salvando}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={confirmar} disabled={salvando}>
            {salvando ? "Salvando…" : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
