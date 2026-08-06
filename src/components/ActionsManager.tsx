"use client";

import { useCallback, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, Filter, MessageSquare, User } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { TopProgress } from "@/components/ui/TopProgress";
import { PRIORITY, PRIORITY_TONE, EFF_STATUS_LABEL, effStatus, type EffStatus } from "@/lib/constants";
import { EffStatusBadge } from "@/components/ui/EffStatusBadge";
import { MultiSelect } from "@/components/ui/MultiSelect";
import { MINHA_PAPEIS, MINHA_PADRAO, MINHA_TODAS, PAPEL_LABEL, PAPEL_HINT, type MinhaPapel } from "@/lib/acoes-minhas";
import { formatDate, isOverdue, shortName } from "@/lib/format";
import { deleteAction, getActionFormOptions, type ActionFormOptions } from "@/lib/actions/actions";
import { ConfirmActionButton } from "@/components/ui/ConfirmActionButton";
import { ActionDialog, type Opt } from "./ActionDialog";
import { ImportActionsDialog } from "./ImportActionsDialog";
import { ExportActionsButton } from "./ExportActionsButton";
import { DemandaPanel, type DemandaInfo, type AssigneeState } from "./DemandaPanel";
import type { Enums } from "@/types/database";

export type DemandaCard = {
  id: string;
  description: string;
  status: string;
  dueDate: string | null;
  assigneeNames: string[];
  assigneeIds: string[];
  assigneeStates: AssigneeState[];
  pendingCount: number;
  /** comentários já lançados: indica se a ação está recebendo acompanhamento */
  commentCount: number;
  attachments: { id: string; filename: string; path: string }[];
};

/** Filtros aplicados no banco (vêm da URL). */
/** Campos que aceitam vários valores ao mesmo tempo. */
export type ActionFilters = {
  q: string; sdpo: string; from: string; to: string;
  // sem `priority`: o filtro saiu da tela e o campo sai junto, senão um link
  // antigo com ?prio=alta continuaria recortando a lista sem nada marcado à vista
  status: string[]; programa: string[];
  pilar: string[]; bloco: string[]; item: string[]; kpi: string[]; tool: string[];
  meeting: string[]; requester: string[]; assignee: string[];
  /**
   * "Minhas ações", por PAPEL. Vazio = todas da empresa.
   *
   * Não é um filtro do painel, é o modo de exibição da tela, e por isso fica de
   * fora da contagem do botão Filtros e sobrevive ao "Limpar filtros".
   */
  mine: MinhaPapel[];
};

/** Estado "sem filtro nenhum", usado ao limpar. */
const VAZIO: ActionFilters = {
  q: "", sdpo: "", from: "", to: "",
  status: [], programa: [], pilar: [], bloco: [], item: [], kpi: [], tool: [],
  meeting: [], requester: [], assignee: [],
  mine: [],
};


/** Opções dos selects, extraídas da base inteira (não só da página). */
/**
 * `legacy` marca o que ainda está nas ações mas saiu do cadastro (pilar), do quadro
 * (pessoa) ou da agenda (reunião que não existe mais como série).
 */
export type FilterOption = { nome: string; legacy: boolean };
export type FilterOptions = {
  programas: string[];
  pilares: FilterOption[];
  blocos: FilterOption[];
  itens: FilterOption[];
  kpis: FilterOption[];
  tools: FilterOption[];
  meetings: FilterOption[];
  requesters: FilterOption[];
  assignees: FilterOption[];
};

const PESSOA_LEGADA = "Não está mais ativa na empresa. Continua nas ações antigas.";

/**
 * Botão do seletor de modo, no cabeçalho.
 *
 * Usa `.btn` do sistema, e só troca o TAMANHO (`btn-xs`). A primeira versão
 * desenhou o estilo à mão e custou caro: o selecionado apontava para
 * `var(--mh-primary)`, token que não existe (o certo é `--mh-primary-500`), e
 * ficou sem fundo nenhum. Herdando a classe, cor e canto vêm de um lugar só e
 * não têm como divergir do resto da tela.
 */
function Seg({ on, onClick, title, children }: {
  on: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={on}
      className={`btn btn-xs ${on ? "btn-primary" : "btn-ghost"}`}
    >
      {children}
    </button>
  );
}

/**
 * Os papéis, recolhidos: só o escolhido aparece, o resto abre ao clicar.
 *
 * Não usa o `MultiSelect` do painel de filtros, apesar de ser a mesma ideia:
 * aquele é um campo de formulário com rótulo em cima e altura de `.select`, e
 * traria de volta o peso que este cabeçalho acabou de perder.
 *
 * O painel NÃO fecha ao marcar, porque a escolha é múltipla e fechar a cada
 * clique obrigaria a reabrir para somar o segundo papel.
 */
function PapeisDropdown({ selected, onToggle }: { selected: MinhaPapel[]; onToggle: (p: MinhaPapel) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const fora = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [open]);

  // com dois ou três marcados o nome não cabe, e listar todos anularia o ganho
  const resumo = selected.length === 1 ? PAPEL_LABEL[selected[0]] : `${selected.length} papéis`;

  return (
    <div ref={box} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        className="btn btn-xs btn-primary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={selected.map((p) => PAPEL_LABEL[p]).join(", ")}
      >
        {resumo}
        <ChevronDown size={11} />
      </button>
      {open && (
        <div
          className="card"
          style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 40, padding: "0.25rem", minWidth: 168, boxShadow: "var(--mh-shadow-e3)" }}
        >
          {MINHA_PAPEIS.map((p) => {
            const on = selected.includes(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => onToggle(p)}
                title={PAPEL_HINT[p]}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: "0.45rem", padding: "0.32rem 0.4rem", background: on ? "var(--surface-2)" : "none", border: "none", borderRadius: 6, cursor: "pointer", textAlign: "left", fontSize: "0.78rem", color: "var(--text)" }}
              >
                <span style={{ width: 13, height: 13, flexShrink: 0, borderRadius: 4, border: "1px solid var(--border-strong)", display: "inline-flex", alignItems: "center", justifyContent: "center", background: on ? "var(--mh-primary-500)" : "transparent" }}>
                  {on && <Check size={10} color="#fff" />}
                </span>
                {PAPEL_LABEL[p]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** chave do filtro -> nome do parâmetro na URL */
const PARAM: Record<keyof ActionFilters, string> = {
  q: "q", sdpo: "sdpo", status: "st",
  programa: "prog", pilar: "pilar", bloco: "bloco", item: "item",
  kpi: "kpi", tool: "ferr", meeting: "reuniao",
  requester: "sol", assignee: "resp", from: "de", to: "ate",
  mine: "minhas",
};

export type ActionRow = {
  id: string;
  code: number;
  isSdpo: boolean;
  programaName: string | null;
  pilarName: string | null;
  secaoName: string | null;
  blocoName: string | null;
  itemName: string | null;
  seriesName: string | null;
  occurredOn: string | null;
  kpiName: string | null;
  toolName: string | null;
  unitName: string | null;
  requesterId: string | null;
  requesterName: string | null;
  createdAt: string;
  priority: Enums<"priority_level">;
  dueDate: string | null;
  demandas: DemandaCard[];
  ccNames: string[];
  attachments: { id: string; filename: string; path: string }[];
};

export function ActionsManager({
  actions, currentUserId, isAdmin, isOwner, units, aiEnabled,
  filters, filterOptions, total,
}: {
  actions: ActionRow[];
  filters: ActionFilters;
  filterOptions: FilterOptions;
  total: number;
  currentUserId: string;
  isAdmin: boolean;
  isOwner: boolean;
  units?: Opt[];
  aiEnabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<{ demanda: DemandaInfo; requesterId: string | null } | null>(null);

  /**
   * Catálogos do formulário: pessoas, pilares, seções, blocos, itens, KPIs,
   * ferramentas, reuniões e ocorrências.
   *
   * Antes vinham junto com a página, em toda carga e a cada clique de filtro:
   * ~83 KB de JSON para uma janela que na maioria das vezes nem é aberta. Agora
   * são buscados uma única vez, assim que a tela fica ociosa — então quando o
   * usuário clica em "Nova ação" quase sempre já chegaram.
   */
  const [opcoes, setOpcoes] = useState<ActionFormOptions | null>(null);
  const buscando = useRef(false);
  const garantirOpcoes = useCallback(async () => {
    if (buscando.current) return;
    buscando.current = true;
    try {
      setOpcoes(await getActionFormOptions());
    } catch {
      buscando.current = false; // deixa tentar de novo no próximo clique
    }
  }, []);

  useEffect(() => {
    // requestIdleCallback não existe no Safari; o timer é a rede de segurança
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => void garantirOpcoes());
      return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(() => void garantirOpcoes(), 1500);
    return () => clearTimeout(t);
  }, [garantirOpcoes]);

  const abrirNovaAcao = () => { setOpen(true); void garantirOpcoes(); };

  const openPanel = (d: DemandaCard, a: ActionRow, di: number) => {
    void garantirOpcoes();
    setSelected({
      demanda: {
        id: d.id,
        label: a.demandas.length > 1 ? `#${a.code}.${di + 1}` : `#${a.code}`,
        description: d.description,
        status: d.status as Enums<"action_status">,
        dueDate: d.dueDate,
        priority: a.priority,
        assigneeIds: d.assigneeIds,
        assigneeNames: d.assigneeNames,
        assigneeStates: d.assigneeStates,
        attachments: d.attachments,
        requesterName: a.requesterName,
        ccNames: a.ccNames,
        isSdpo: a.isSdpo,
        pilarName: a.pilarName,
        secaoName: a.secaoName,
        blocoName: a.blocoName,
        itemName: a.itemName,
        kpiName: a.kpiName,
        toolName: a.toolName,
        seriesName: a.seriesName,
        occurredOn: a.occurredOn,
      },
      requesterId: a.requesterId,
    });
  };

  // ---------- Filtros (aplicados no banco, sincronizados pela URL) ----------
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  /**
   * O que o usuário VÊ marcado, que não é o mesmo que o servidor já respondeu.
   *
   * Sem isto o filtro parecia travado: a caixinha reflete a URL, e o
   * `startTransition` mantém a tela antiga de propósito enquanto a nova carrega.
   * Ou seja, a marcação só aparecia DEPOIS da ida ao banco. Aqui ela é imediata,
   * e a barra de progresso no topo conta que o resultado está vindo.
   */
  const [filtrosVistos, marcarOtimista] = useOptimistic(filters);

  const countOf = (v: string | string[]) => (Array.isArray(v) ? (v.length > 0 ? 1 : 0) : v ? 1 : 0);
  // contagem e botão "Limpar" seguem o que o usuário ACABOU de marcar, não o que o
  // servidor já confirmou: é o que faz o clique responder na hora.
  // `mine` fica DE FORA: é o modo da tela, tem controle próprio à vista, e contá-lo
  // faria o painel de filtros abrir sozinho toda vez que alguém entra em Ações.
  const activeCount = Object.entries(filtrosVistos)
    .filter(([k]) => k !== "mine")
    .reduce((n, [, v]) => n + countOf(v), 0);
  const hasFilters = activeCount > 0;

  const minhas = filtrosVistos.mine;
  const minhasLigado = minhas.length > 0;

  const [filtersOpen, setFiltersOpen] = useState(hasFilters);
  const [qDraft, setQDraft] = useState(filters.q);

  const applyFilters = useCallback((patch: Partial<ActionFilters>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      const param = PARAM[key as keyof ActionFilters];
      next.delete(param);
      // multivalor vai como parâmetro repetido (?sol=A&sol=B): aceita qualquer
      // caractere no valor, inclusive vírgula, que é comum em nomes
      if (Array.isArray(value)) value.forEach((v) => { if (v) next.append(param, v); });
      else if (value) next.set(param, value);
    }
    next.delete("p"); // qualquer mudança de filtro volta para a primeira página
    const qs = next.toString();
    startTransition(() => {
      // precisa ser DENTRO da transição: é o que o React exige para casar o
      // estado otimista com a navegação e desfazê-lo sozinho quando ela termina
      marcarOtimista((atual) => ({ ...atual, ...patch }));
      router.push(qs ? `/acoes?${qs}` : "/acoes", { scroll: false });
    });
  }, [router, searchParams, marcarOtimista]);

  /**
   * Troca o modo de exibição. Não passa pelo `applyFilters` porque a URL e o
   * estado divergem aqui: "Todas" é lista vazia no estado, mas precisa de uma
   * sentinela na URL, já que o parâmetro AUSENTE significa o padrão.
   */
  const aplicarMinhas = (papeis: MinhaPapel[]) => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete(PARAM.mine);
    if (papeis.length === 0) next.set(PARAM.mine, MINHA_TODAS);
    else papeis.forEach((p) => next.append(PARAM.mine, p));
    next.delete("p");
    startTransition(() => {
      marcarOtimista((atual) => ({ ...atual, mine: papeis }));
      router.push(`/acoes?${next.toString()}`, { scroll: false });
    });
  };

  /** desmarcar o último papel equivale a pedir "Todas", que é o que a pessoa quis dizer */
  const alternarPapel = (p: MinhaPapel) =>
    aplicarMinhas(minhas.includes(p) ? minhas.filter((x) => x !== p) : [...minhas, p]);

  const clearFilters = () => {
    setQDraft("");
    // "Minhas" não é filtro de painel: limpar os filtros não muda o modo da tela
    const next = new URLSearchParams();
    searchParams.getAll(PARAM.mine).forEach((v) => next.append(PARAM.mine, v));
    const qs = next.toString();
    startTransition(() => {
      marcarOtimista((atual) => ({ ...VAZIO, mine: atual.mine }));
      router.push(qs ? `/acoes?${qs}` : "/acoes", { scroll: false });
    });
  };

  // busca livre: espera o usuário parar de digitar antes de consultar o banco
  useEffect(() => {
    if (qDraft === filters.q) return;
    const t = setTimeout(() => applyFilters({ q: qDraft }), 400);
    return () => clearTimeout(t);
  }, [qDraft, filters.q, applyFilters]);
  useEffect(() => { setQDraft(filters.q); }, [filters.q]);

  const {
    programas: programaOpts, pilares: pilarOpts, blocos: blocoOpts, itens: itemOpts,
    kpis: kpiOpts, tools: toolOpts, meetings: meetingOpts,
    requesters: requesterOpts, assignees: assigneeOpts,
  } = filterOptions;

  // O banco já devolveu só as ações que casam. Aqui resta recortar as DEMANDAS
  // exibidas dentro de cada ação, para refletir os filtros de status/responsável/busca.
  const term = norm(filters.q.trim());
  const filtered = useMemo(() => {
    return actions
      .map((a) => {
        const items = a.demandas.map((d, di) => {
          const finalizada = d.status === "done" || d.status === "cancelled";
          const overdue = !!d.dueDate && !finalizada && isOverdue(d.dueDate);
          const eff = effStatus(d.status as Enums<"action_status">, overdue, d.pendingCount > 0);
          return { d, di, eff };
        });
        return { a, items };
      })
      .map(({ a, items }) => {
        let its = items;
        if (filters.status.length) its = its.filter((x) => filters.status.includes(x.eff));
        if (filters.assignee.length) {
          its = its.filter((x) => x.d.assigneeNames.some((n) => filters.assignee.includes(n)));
        }
        return { a, items: its };
      })
      .filter(({ items }) => items.length > 0)
      // Busca só por ID e descrição. Antes varria pilar, seção, bloco, item,
      // solicitante, KPI, ferramenta e nome de responsável, e o resultado vinha
      // cheio de ação que não tinha o termo em lugar nenhum visível na linha:
      // quem procurava por um nome caía em tudo que aquela pessoa pedia. Cada um
      // desses campos tem filtro próprio ao lado, que faz o recorte sem ambiguidade.
      .map(({ a, items }) => {
        if (!term) return { a, items };
        if (norm(`#${a.code}`).includes(term)) return { a, items };
        return { a, items: items.filter((x) => norm(x.d.description).includes(term)) };
      })
      .filter(({ items }) => items.length > 0);
  }, [actions, term, filters.status, filters.assignee]);

  return (
    <div>
      <TopProgress active={isPending} />
      <PageHeader
        title="Ações"
        subtitle="Abertura e acompanhamento de ações."
        action={
          <div style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center" }}>
            {isOwner && <ImportActionsDialog />}
            {/* o modo "Minhas" entra no recorte exportado, então tem de entrar
                também no aviso do botão: senão ele prometeria a base inteira e
                entregaria só as do usuário */}
            {isOwner && <ExportActionsButton filters={filters} hasFilters={hasFilters || minhasLigado} />}
            <button className="btn btn-primary" onClick={abrirNovaAcao}>+ Nova ação</button>
          </div>
        }
      />

      <Section
        title={`${total} ${total === 1 ? "ação" : "ações"}${hasFilters ? " no filtro" : ""}${isPending ? " · atualizando…" : ""}`}
        padded={false}
        /* a lista esmaece enquanto o novo resultado vem, mas segue legível e
           clicável: o usuário pode marcar o próximo filtro sem esperar este */
        bodyStyle={isPending ? { opacity: 0.55, transition: "opacity 120ms" } : undefined}
        /* MODO DA TELA, colado no contador e não no funil.
           Fica fora do painel de filtros de propósito: é o recorte principal e
           precisa estar à vista. E fica à ESQUERDA porque se lê junto do número:
           "85 ações · Minhas como Responsável" é uma frase só; do outro lado da
           linha, o número e o recorte que o explica ficavam distantes.
           Os dois grupos ficam separados para não lerem como uma escolha única de
           cinco opções, e "Todas" vem antes de "Minhas" para a leitura ir do
           amplo para o estreito. */
        titleExtra={
          <div style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" }}>
            <div style={{ display: "inline-flex", gap: "0.2rem" }}>
              <Seg on={!minhasLigado} onClick={() => { if (minhasLigado) aplicarMinhas([]); }} title="Todas as ações que você alcança">
                Todas
              </Seg>
              <Seg on={minhasLigado} onClick={() => { if (!minhasLigado) aplicarMinhas(MINHA_PADRAO); }} title="Só as ações ligadas a você">
                <User size={11} /> Minhas
              </Seg>
            </div>
            {minhasLigado && (
              <>
                <span className="muted" style={{ fontSize: "0.68rem" }}>como</span>
                <PapeisDropdown selected={minhas} onToggle={alternarPapel} />
              </>
            )}
          </div>
        }
        action={
          <div style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
            {hasFilters && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>Limpar filtros</button>
            )}
            <button
              type="button"
              className={`btn btn-sm ${filtersOpen || hasFilters ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setFiltersOpen((v) => !v)}
              style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
            >
              <Filter size={15} />
              Filtros
              {activeCount > 0 && <Badge tone="blue">{activeCount}</Badge>}
            </button>
          </div>
        }
      >
        {filtersOpen && (
          <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--mh-border)", background: "var(--mh-surface-2)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0.85rem" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <span className="label" style={{ margin: 0 }}>Buscar</span>
                <input className="input" value={qDraft} onChange={(e) => setQDraft(e.target.value)} placeholder="#ID ou descrição…" style={{ width: "100%" }} />
              </label>
              <MultiSelect
                label="Status"
                options={(Object.keys(EFF_STATUS_LABEL) as EffStatus[]).map((k) => ({ value: k, label: EFF_STATUS_LABEL[k] }))}
                selected={filtrosVistos.status}
                onChange={(v) => applyFilters({ status: v })}
              />
              <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <span className="label" style={{ margin: 0 }}>SDPO</span>
                <select className="select" value={filtrosVistos.sdpo} onChange={(e) => applyFilters({ sdpo: e.target.value })}>
                  <option value="">Todos</option>
                  <option value="sim">Sim</option>
                  <option value="nao">Não</option>
                </select>
              </label>
              <MultiSelect
                label="Programa"
                options={programaOpts.map((p) => ({ value: p, label: p }))}
                selected={filtrosVistos.programa}
                onChange={(v) => applyFilters({ programa: v })}
              />
              <MultiSelect
                label="Pilar" searchable
                options={pilarOpts.map((p) => ({ value: p.nome, label: p.nome, legacy: p.legacy }))}
                legacyLabel="Legados"
                legacyHint="Pilar que não está mais no cadastro ou foi desativado. Continua nas ações antigas."
                selected={filtrosVistos.pilar}
                onChange={(v) => applyFilters({ pilar: v })}
              />
              {/* Bloco e Item vêm logo depois de Pilar porque é a cadeia do SDPO
                  (Programa → Pilar → Bloco → Item); KPI e Ferramenta são atributos
                  da própria ação e fecham o grupo antes de Reunião. */}
              <MultiSelect
                label="Bloco" searchable placeholder="Digite o nome do bloco…"
                options={blocoOpts.map((b) => ({ value: b.nome, label: b.nome, legacy: b.legacy }))}
                legacyLabel="Legados"
                legacyHint="Bloco que não está mais no cadastro ou foi desativado. Continua nas ações antigas."
                selected={filtrosVistos.bloco}
                onChange={(v) => applyFilters({ bloco: v })}
              />
              <MultiSelect
                label="Item" searchable placeholder="Digite o nome do item…"
                options={itemOpts.map((i) => ({ value: i.nome, label: i.nome, legacy: i.legacy }))}
                legacyLabel="Legados"
                legacyHint="Item que não está mais no cadastro ou foi desativado. Continua nas ações antigas."
                selected={filtrosVistos.item}
                onChange={(v) => applyFilters({ item: v })}
              />
              <MultiSelect
                label="KPI" searchable placeholder="Digite o nome do KPI…"
                options={kpiOpts.map((k) => ({ value: k.nome, label: k.nome, legacy: k.legacy }))}
                legacyLabel="Legados"
                legacyHint="KPI que não está mais no cadastro ou foi desativado. Continua nas ações antigas."
                selected={filtrosVistos.kpi}
                onChange={(v) => applyFilters({ kpi: v })}
              />
              <MultiSelect
                label="Ferramenta de gestão" searchable allLabel="Todas" placeholder="Digite o nome da ferramenta…"
                options={toolOpts.map((t) => ({ value: t.nome, label: t.nome, legacy: t.legacy }))}
                legacyLabel="Legadas"
                legacyHint="Ferramenta que não está mais no cadastro ou foi desativada. Continua nas ações antigas."
                selected={filtrosVistos.tool}
                onChange={(v) => applyFilters({ tool: v })}
              />
              <MultiSelect
                label="Reunião" searchable allLabel="Todas" placeholder="Digite o nome da reunião…"
                options={meetingOpts.map((m) => ({ value: m.nome, label: m.nome, legacy: m.legacy }))}
                legacyLabel="Legadas"
                legacyHint="Reunião que não existe mais como série ativa na agenda. Continua nas ações antigas."
                selected={filtrosVistos.meeting}
                onChange={(v) => applyFilters({ meeting: v })}
              />
              <MultiSelect
                label="Solicitante" searchable placeholder="Digite o nome…"
                options={requesterOpts.map((p) => ({ value: p.nome, label: p.nome, legacy: p.legacy }))}
                legacyLabel="Legados"
                legacyHint={PESSOA_LEGADA}
                selected={filtrosVistos.requester}
                onChange={(v) => applyFilters({ requester: v })}
              />
              <MultiSelect
                label="Responsável" searchable placeholder="Digite o nome…"
                options={assigneeOpts.map((p) => ({ value: p.nome, label: p.nome, legacy: p.legacy }))}
                legacyLabel="Legados"
                legacyHint={PESSOA_LEGADA}
                selected={filtrosVistos.assignee}
                onChange={(v) => applyFilters({ assignee: v })}
              />
              <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <span className="label" style={{ margin: 0 }}>Criada em</span>
                <input type="date" className="input" value={filtrosVistos.from} onChange={(e) => applyFilters({ from: e.target.value })} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <span className="label" style={{ margin: 0 }}>Criada até</span>
                <input type="date" className="input" value={filtrosVistos.to} onChange={(e) => applyFilters({ to: e.target.value })} />
              </label>
            </div>
          </div>
        )}
        {filtered.length === 0 ? (
          hasFilters
            ? <EmptyState title="Nenhuma ação encontrada" description="Ajuste ou limpe os filtros para ver as ações." />
            : <EmptyState title="Nenhuma ação" description="Crie ações para acompanhar pendências e o Programa de Excelência." />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Ação</th>
                  <th>Prioridade</th>
                  <th>SDPO</th>
                  <th>Programa</th>
                  <th>Pilar</th>
                  <th>Seção</th>
                  <th>Descrição</th>
                  <th>Responsáveis</th>
                  <th>Solicitante</th>
                  <th>Aberta em</th>
                  <th>Status</th>
                  <th title="Comentários lançados na ação" style={{ textAlign: "center" }}>Coment.</th>
                  <th>Prazo</th>
                  <th style={{ textAlign: "right" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.flatMap(({ a, items }, ri) =>
                  items.map(({ d, di, eff }, idx) => {
                    const first = idx === 0;
                    const finalizada = d.status === "done" || d.status === "cancelled";
                    const overdue = !!d.dueDate && !finalizada && isOverdue(d.dueDate);
                    return (
                      <tr key={d.id} style={{ borderTop: first && ri > 0 ? "2px solid var(--border-strong)" : undefined, opacity: d.status === "cancelled" ? 0.55 : 1 }}>
                        <td style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                          <button type="button" className="cell-link cell-link-id" onClick={() => openPanel(d, a, di)} title="Abrir o tratamento da ação">
                            #{a.code}{a.demandas.length > 1 ? `.${di + 1}` : ""}
                          </button>
                        </td>
                        <td>{first && <Badge tone={PRIORITY_TONE[a.priority]}>{PRIORITY[a.priority]}</Badge>}</td>
                        <td>{first && (a.isSdpo ? <Badge tone="purple">Sim</Badge> : <span className="soft">Não</span>)}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{first && (a.programaName ? <Badge tone="blue">{a.programaName}</Badge> : <span className="soft">—</span>)}</td>
                        <td className="muted" style={{ maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.pilarName ?? ""}>{first ? (a.pilarName ?? "—") : ""}</td>
                        <td className="muted" style={{ maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.secaoName ?? ""}>{first ? (a.secaoName ?? "—") : ""}</td>
                        <td style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "help" }} title={d.description}>{d.description}</td>
                        <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.assigneeNames.map(shortName).join(", ")}>
                          {d.assigneeNames.length > 0 ? (
                            <>
                              {shortName(d.assigneeNames[0])}
                              {d.assigneeNames.length > 1 && <span className="soft" style={{ marginLeft: 4 }}>+{d.assigneeNames.length - 1}</span>}
                            </>
                          ) : <span className="soft">—</span>}
                          {d.assigneeStates.length > 1 && (
                            <span className="soft" style={{ marginLeft: 6 }} title="Responsáveis que já concluíram a parte">
                              · {d.assigneeStates.filter((s) => s.completedAt).length}/{d.assigneeStates.length} ✓
                            </span>
                          )}
                          {d.attachments.length > 0 && <span className="soft" style={{ marginLeft: 6 }} title={`${d.attachments.length} anexo(s)`}>📎{d.attachments.length}</span>}
                        </td>
                        <td className="muted" style={{ maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.requesterName ?? ""}>
                          {first ? (a.requesterName ? shortName(a.requesterName) : "—") : ""}
                        </td>
                        <td className="muted" style={{ whiteSpace: "nowrap" }}>{first ? formatDate(a.createdAt) : ""}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <EffStatusBadge eff={eff} overdue={overdue} />
                        </td>
                        {/* sem comentário fica apagado: destaca de longe quem não recebeu follow */}
                        <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                          <button
                            type="button"
                            className={d.commentCount > 0 ? "cell-link" : "cell-link soft"}
                            onClick={() => openPanel(d, a, di)}
                            title={d.commentCount > 0 ? `Abrir e ver os ${d.commentCount} comentário(s)` : "Abrir o tratamento da ação"}
                            style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", fontSize: "0.82rem" }}
                          >
                            <MessageSquare size={13} />
                            {d.commentCount}
                          </button>
                        </td>
                        <td style={{ whiteSpace: "nowrap", color: overdue ? "var(--mh-danger)" : "var(--text-muted)" }}>{d.dueDate ? formatDate(d.dueDate) : "—"}</td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <div style={{ display: "inline-flex", gap: "0.3rem", alignItems: "center", justifyContent: "flex-end" }}>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openPanel(d, a, di)}>Tratar</button>
                            {first && (
                              <ConfirmActionButton
                                action={deleteAction}
                                fields={{ id: a.id }}
                                className="icon-btn icon-btn-danger"
                                buttonTitle="Excluir ação"
                                title="Excluir ação"
                                message="Excluir esta ação e todas as suas demandas?"
                                confirmLabel="Excluir"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                              </ConfirmActionButton>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Os catálogos chegam sob demanda. Na prática a busca antecipada já terminou
          quando o usuário clica; o aviso abaixo é para a primeira interação muito
          rápida, ou uma conexão ruim, e some sozinho. */}
      {opcoes ? (
        <ActionDialog
          open={open}
          onClose={() => setOpen(false)}
          people={opcoes.people}
          pilares={opcoes.pilares}
          secoes={opcoes.secoes}
          blocos={opcoes.blocos}
          itens={opcoes.itens}
          kpis={opcoes.kpis}
          tools={opcoes.tools}
          series={opcoes.series}
          occurrences={opcoes.occurrences}
          units={units}
          aiEnabled={aiEnabled}
        />
      ) : (
        open && <CarregandoFormulario onClose={() => setOpen(false)} />
      )}

      <DemandaPanel
        open={!!selected && !!opcoes}
        onClose={() => setSelected(null)}
        demanda={selected?.demanda ?? null}
        requesterId={selected?.requesterId ?? null}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
        people={opcoes?.people ?? []}
      />
      {selected && !opcoes && <CarregandoFormulario onClose={() => setSelected(null)} />}
    </div>
  );
}

/**
 * Janela de espera, só para o caso raro de o usuário clicar antes de os catálogos
 * do formulário chegarem. Fecha por X ou clique fora não: mesmo padrão dos
 * formulários do sistema, que só fecham por ação explícita.
 */
function CarregandoFormulario({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)",
        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60,
      }}
    >
      <div className="card" style={{ padding: "1.5rem 1.75rem", display: "flex", alignItems: "center", gap: "0.85rem" }}>
        <span
          aria-hidden
          style={{
            width: 18, height: 18, borderRadius: "50%",
            border: "2px solid var(--mh-border)", borderTopColor: "var(--mh-accent-500)",
            animation: "mh-spin 0.7s linear infinite", display: "inline-block",
          }}
        />
        <span className="muted" style={{ fontSize: "0.9rem" }}>Carregando o formulário...</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancelar</button>
      </div>
    </div>
  );
}
