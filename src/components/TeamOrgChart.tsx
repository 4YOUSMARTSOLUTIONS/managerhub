"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { normalizar, shortName } from "@/lib/format";
import { montarFaixas, type NoOrg } from "@/lib/organograma";
import type { TeamMember } from "./TeamList";

/**
 * Organograma da equipe: quem responde a quem, desenhado.
 *
 * A tabela ao lado já tem os mesmos dados, mas a coluna "Responde a" é texto: a
 * estrutura só aparece se a pessoa ler linha por linha e montar a árvore de
 * cabeça. Aqui ela está pronta.
 *
 * Uma faixa horizontal por nível hierárquico, posições calculadas e as linhas
 * desenhadas em SVG por cima — sem biblioteca de diagrama.
 *
 * Existiu um segundo modo, vertical indentado, pensado para quando a empresa
 * inteira estiver vinculada: no clássico a largura cresce com o número de FOLHAS.
 * Saiu porque na prática só o clássico é usado. Se a largura incomodar quando a
 * árvore crescer, a saída é recolher por nível, que já está aqui.
 *
 * Nota: `Tabs` desmonta a aba inativa, então ir até a Lista e voltar reinicia a
 * busca e os nós recolhidos.
 */

/** Medidas do desenho, em um lugar só: o CSS, o SVG e o cálculo das posições têm
 *  de concordar. Se a altura do cartão divergisse aqui, a linha encostaria ao
 *  lado da pessoa em vez de nela. */
const MEDIDAS = { cardW: 208, cardH: 52, colW: 224, rowH: 104, gutter: 116 };
const ROW_H = MEDIDAS.rowH;
const GUTTER = MEDIDAS.gutter;

type No = {
  m: TeamMember;
  filhos: No[];
  /** descendentes em todos os níveis */
  total: number;
  /** descendentes ATIVOS: é o número honesto quando inativos estão ocultos */
  totalAtivos: number;
  temAtivoAbaixo: boolean;
};

/** a árvore já podada pelo que está visível (inativos ocultos, nós recolhidos) */
type Vis = { no: No; filhos: Vis[] };

type Motivo = "sem-gestor" | "gestor-de-fora" | "ciclo" | "auto";
const MOTIVO_TEXTO: Record<Motivo, string> = {
  "sem-gestor": "sem gestor definido no cadastro",
  "gestor-de-fora": "responde a alguém que não está na sua equipe",
  ciclo: "cadeia de gestores em ciclo",
  auto: "está cadastrado como gestor de si mesmo",
};

/**
 * Teto de profundidade. É 12, e não 10 como no banco, de propósito: quem trunca
 * primeiro tem de ser a função SQL, para a tela não divergir do que a RLS
 * entrega. Aqui é só rede de segurança contra ciclo, que o banco não proíbe.
 */
const TETO = 12;
/** até quantos nós a árvore abre sozinha ao entrar */
const ABRE_ATE = 60;

export function TeamOrgChart({ members, raiz }: { members: TeamMember[]; raiz: TeamMember }) {
  const [busca, setBusca] = useState("");
  const [ocultarInativos, setOcultarInativos] = useState(true);
  const [indice, setIndice] = useState(0);
  const refs = useRef(new Map<string, HTMLDivElement>());


  const { raizNo, fora } = useMemo(() => {
    const porId = new Map<string, TeamMember>([[raiz.userId, raiz]]);
    for (const m of members) porId.set(m.userId, m);

    const filhosDe = new Map<string, TeamMember[]>();
    const fora: { m: TeamMember; motivo: Motivo }[] = [];
    for (const m of members) {
      if (m.managerId === m.userId) { fora.push({ m, motivo: "auto" }); continue; }
      if (!m.managerId) { fora.push({ m, motivo: "sem-gestor" }); continue; }
      if (!porId.has(m.managerId)) { fora.push({ m, motivo: "gestor-de-fora" }); continue; }
      const arr = filhosDe.get(m.managerId) ?? [];
      arr.push(m);
      filhosDe.set(m.managerId, arr);
    }

    // hierarquia primeiro (menor rank = mais alto), depois ativos, depois nome
    const ordem = (a: TeamMember, b: TeamMember) =>
      (a.hierarchyRank ?? Number.MAX_SAFE_INTEGER) - (b.hierarchyRank ?? Number.MAX_SAFE_INTEGER) ||
      (a.active === b.active ? 0 : a.active ? -1 : 1) ||
      (a.fullName ?? "").localeCompare(b.fullName ?? "", "pt-BR");

    const vistos = new Set<string>();
    const montar = (m: TeamMember, ancestrais: Set<string>, nivel: number): No => {
      vistos.add(m.userId);
      const brutos = filhosDe.get(m.userId) ?? [];
      // `ancestrais` corta a aresta de volta de um ciclo já na descida
      const ok = nivel >= TETO ? [] : brutos.filter((f) => !ancestrais.has(f.userId));
      ancestrais.add(m.userId);
      const filhos = [...ok].sort(ordem).map((f) => montar(f, ancestrais, nivel + 1));
      ancestrais.delete(m.userId);
      return {
        m,
        filhos,
        total: filhos.reduce((s, f) => s + f.total + 1, 0),
        totalAtivos: filhos.reduce((s, f) => s + f.totalAtivos + (f.m.active ? 1 : 0), 0),
        temAtivoAbaixo: filhos.some((f) => f.m.active || f.temAtivoAbaixo),
      };
    };
    const raizNo = montar(raiz, new Set(), 0);

    // ilha de ciclo (A→B→A, nenhum alcançável pela raiz) e quem o teto decepou
    for (const m of members) {
      if (!vistos.has(m.userId) && !fora.some((f) => f.m.userId === m.userId)) {
        fora.push({ m, motivo: "ciclo" });
      }
    }
    return { raizNo, fora };
  }, [members, raiz]);

  /** visível na árvore: inativo sem ninguém ativo abaixo some, o resto fica */
  const visivel = useCallback(
    (no: No) => !ocultarInativos || no.m.active || no.temAtivoAbaixo || no.m.userId === raiz.userId,
    [ocultarInativos, raiz.userId],
  );

  /**
   * O que já vem aberto. Abre nível a nível enquanto o total couber; do primeiro
   * que estourar em diante, recolhido. Com a equipe de hoje abre inteira; com a
   * empresa toda vinculada, abre a raiz e os diretos. Uma regra só.
   */
  const [recolhidos, setRecolhidos] = useState<Set<string>>(() => {
    const fechar = new Set<string>();
    let fila = [raizNo];
    let soma = 1;
    while (fila.length) {
      const proxima: No[] = [];
      const largura = fila.reduce((s, n) => s + n.filhos.length, 0);
      if (soma + largura > ABRE_ATE) {
        for (const n of fila) if (n.filhos.length) fechar.add(n.m.userId);
        break;
      }
      soma += largura;
      for (const n of fila) proxima.push(...n.filhos);
      fila = proxima;
    }
    return fechar;
  });

  const termo = normalizar(busca.trim());
  const { acertos, revelados } = useMemo(() => {
    const acertos: string[] = [];
    const revelados = new Set<string>();
    if (!termo) return { acertos, revelados };
    const anda = (no: No, caminho: string[]) => {
      const casa = [no.m.fullName, no.m.employeeCode, no.m.positionName, no.m.departmentName, no.m.hierarchyName]
        .some((v) => v && normalizar(v).includes(termo));
      if (casa) {
        acertos.push(no.m.userId);
        for (const id of caminho) revelados.add(id);
      }
      for (const f of no.filhos) anda(f, [...caminho, no.m.userId]);
    };
    anda(raizNo, []);
    return { acertos, revelados };
  }, [raizNo, termo]);

  // derivado, e não um segundo estado: nada para sincronizar com `recolhidos`
  const estaRecolhido = (id: string) => recolhidos.has(id) && !revelados.has(id);

  const alternar = (id: string) =>
    setRecolhidos((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id); else novo.add(id);
      return novo;
    });

  const todosComFilho = useMemo(() => {
    const ids: string[] = [];
    const anda = (no: No) => { if (no.filhos.length) ids.push(no.m.userId); no.filhos.forEach(anda); };
    anda(raizNo);
    return ids;
  }, [raizNo]);

  const exibindo = useMemo(() => {
    const conta = (no: No): number => {
      if (!visivel(no)) return 0;
      if (estaRecolhido(no.m.userId)) return 1;
      return 1 + no.filhos.reduce((s, f) => s + conta(f), 0);
    };
    return conta(raizNo);
    // `recolhidos` e `revelados` entram via estaRecolhido
  }, [raizNo, visivel, recolhidos, revelados]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = ocultarInativos ? raizNo.totalAtivos + 1 : raizNo.total + 1;

  const irPara = (passo: number) => {
    if (acertos.length === 0) return;
    const i = (indice + passo + acertos.length) % acertos.length;
    setIndice(i);
    refs.current.get(acertos[i])?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  };

  const registrar = (id: string) => (el: HTMLDivElement | null) => {
    if (el) refs.current.set(id, el); else refs.current.delete(id);
  };

  const inativos = members.filter((m) => !m.active).length;

  /** a árvore como ela aparece: sem inativo escondido, sem filho de nó recolhido */
  const arvoreVisivel = useMemo(() => {
    const montar = (no: No): Vis | null => {
      if (!visivel(no)) return null;
      const filhos = estaRecolhido(no.m.userId)
        ? []
        : no.filhos.map(montar).filter((v): v is Vis => v !== null);
      return { no, filhos };
    };
    return montar(raizNo);
    // `recolhidos` e `revelados` entram por dentro de estaRecolhido
  }, [raizNo, visivel, recolhidos, revelados]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Posição de cada pessoa: uma FAIXA por nível hierárquico.
   *
   * A linha vem do nível hierárquico, não da profundidade na árvore, então todo
   * Auxiliar fica na mesma altura mesmo respondendo a gestores diferentes. É o
   * que um organograma de empresa quer dizer.
   *
   * DUAS REGRAS QUE O DADO EXIGE:
   *
   * - Filho NUNCA fica na mesma faixa do gestor nem acima dele. Se o cadastro
   *   disser que um Coordenador responde a um Auxiliar, a linha desceria de baixo
   *   para cima e leria como se o subordinado mandasse. Nesse caso o filho é
   *   empurrado para a faixa seguinte. Hoje não há nenhum caso assim; com os 987
   *   vínculos a atribuir, vai haver.
   * - Quem está SEM hierarquia entra na faixa logo abaixo do próprio gestor.
   *
   * A coluna sai do algoritmo clássico de árvore: cada folha ocupa a próxima
   * vaga, cada gestor fica no meio dos seus. Como a sub-árvore inteira mora
   * dentro da faixa de vagas dela, dois ramos diferentes nunca se sobrepõem.
   */
  const bandas = useMemo(() => {
    if (!arvoreVisivel) return null;
    const paraOrg = (v: Vis): NoOrg => ({
      id: v.no.m.userId,
      rank: v.no.m.hierarchyRank,
      hierarquia: v.no.m.hierarchyName,
      filhos: v.filhos.map(paraOrg),
    });
    const geometria = montarFaixas(paraOrg(arvoreVisivel), MEDIDAS);
    const porId = new Map<string, No>();
    const indexar = (v: Vis) => { porId.set(v.no.m.userId, v.no); v.filhos.forEach(indexar); };
    indexar(arvoreVisivel);
    return { ...geometria, porId };
  }, [arvoreVisivel]);

  const cartao = (no: No) => {
    const filhosVisiveis = no.filhos.filter(visivel);
    const recolhido = estaRecolhido(no.m.userId);
    const temFilhos = filhosVisiveis.length > 0;
    const quantos = ocultarInativos ? no.totalAtivos : no.total;
    const eu = no.m.userId === raiz.userId;
    return (
      <div
        ref={registrar(no.m.userId)}
        className={`org-card${eu ? " org-card-me" : ""}${no.m.active ? "" : " org-card-off"}${acertos.includes(no.m.userId) ? " org-card-hit" : ""}`}
        title={`${no.m.fullName ?? "—"}${no.m.positionName ? ` · ${no.m.positionName}` : ""}`}
      >
        {temFilhos ? (
          <button
            type="button"
            className="org-toggle"
            aria-expanded={!recolhido}
            title={recolhido ? `Mostrar ${quantos} abaixo` : "Recolher"}
            onClick={() => alternar(no.m.userId)}
          >
            {recolhido ? `▸ ${quantos}` : "▾"}
          </button>
        ) : (
          <span className="org-toggle-void" aria-hidden />
        )}
        <Avatar name={no.m.fullName} userId={no.m.userId} size={30} />
        <div className="org-body">
          <div className="org-name">{shortName(no.m.fullName)}</div>
          <div className="org-sub">{no.m.positionName ?? no.m.hierarchyName ?? "Sem cargo definido"}</div>
        </div>
        {!no.m.active && <Badge tone="red">Inativo</Badge>}
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "center", marginBottom: "0.9rem" }}>
        <input
          className="input"
          placeholder="Localizar pessoa na árvore…"
          value={busca}
          onChange={(e) => { setBusca(e.target.value); setIndice(0); }}
          style={{ width: 260, padding: "0.4rem 0.7rem", fontSize: "0.85rem" }}
        />
        {termo && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", fontSize: "0.8rem" }}>
            <button type="button" className="btn btn-ghost btn-sm" disabled={acertos.length === 0} onClick={() => irPara(-1)} title="Anterior">
              <ChevronLeft size={14} />
            </button>
            <span className="muted">{acertos.length ? `${indice + 1}/${acertos.length}` : "0"}</span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={acertos.length === 0} onClick={() => irPara(1)} title="Próximo">
              <ChevronRight size={14} />
            </button>
          </span>
        )}

        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRecolhidos(new Set())}>
          Expandir tudo ({total})
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRecolhidos(new Set(todosComFilho))}>
          Recolher tudo
        </button>

        {inativos > 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem" }}>
            <input type="checkbox" checked={ocultarInativos} onChange={(e) => setOcultarInativos(e.target.checked)} />
            Ocultar inativos
          </label>
        )}

        <span className="muted" style={{ fontSize: "0.8rem", marginLeft: "auto" }}>
          Exibindo {exibindo} de {total}
        </span>
      </div>

      <div className="org-wrap">
        {bandas && (
          <div className="org-canvas" style={{ width: bandas.largura, height: bandas.altura }}>
            {bandas.faixas.map((f) => (
              <div key={f.i} className="org-banda" style={{ top: f.i * ROW_H, height: ROW_H }}>
                {/* sticky: o nome da faixa acompanha a rolagem lateral, senão
                    some assim que a pessoa anda para o lado do gráfico */}
                <span className="org-banda-nome" style={{ width: GUTTER - 16 }}>{f.nome}</span>
              </div>
            ))}
            <svg className="org-linhas" width={bandas.largura} height={bandas.altura} aria-hidden>
              {bandas.linhas.map((l) => (
                <path
                  key={`${l.de}->${l.para}`}
                  d={`M ${l.x1} ${l.y1} V ${l.y2 - 18} H ${l.x2} V ${l.y2}`}
                  fill="none"
                  stroke="var(--border-strong)"
                  strokeWidth={1}
                />
              ))}
            </svg>
            {bandas.nos.map(({ id, x, y }) => {
              const no = bandas.porId.get(id);
              return no ? (
                <div key={id} className="org-pos" style={{ left: x, top: y }}>{cartao(no)}</div>
              ) : null;
            })}
          </div>
        )}
      </div>

      {ocultarInativos && inativos > 0 && (
        <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.6rem" }}>
          Quem está inativo mas ainda tem gente respondendo a ele continua na árvore, tracejado.
          Escondê-lo apagaria a equipe inteira que está abaixo.
        </p>
      )}

      {fora.length > 0 && (
        <div className="card" style={{ padding: "0.8rem 1rem", marginTop: "0.9rem" }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: "0.5rem" }}>
            {fora.length} pessoa(s) da sua equipe fora do organograma
          </div>
          <p className="muted" style={{ fontSize: "0.78rem", marginTop: 0, marginBottom: "0.6rem" }}>
            Aparecem na lista, mas não há como posicioná-las na árvore. É cadastro a corrigir, não gente a menos.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {fora.map(({ m, motivo }) => (
              <div key={m.userId} className="org-card" style={{ width: 260 }}>
                <Avatar name={m.fullName} userId={m.userId} size={30} />
                <div className="org-body">
                  <div className="org-name">{shortName(m.fullName)}</div>
                  <div className="org-sub">{MOTIVO_TEXTO[motivo]}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
