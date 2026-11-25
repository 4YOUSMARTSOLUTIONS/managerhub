import { Suspense } from "react";
import { requireContext, effectiveUnitFilter } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { ActionsManager, type ActionRow } from "@/components/ActionsManager";
// de um módulo neutro, NÃO de ActionsManager: constante exportada de arquivo
// "use client" chega aqui como proxy de referência, e `.includes` estoura
import { MINHA_PARAM, resolverMinhas } from "@/lib/acoes-minhas";
import { resolverStatus } from "@/lib/acoes-status";
import { ORDEM_PARAM, SENTIDO_PARAM, ehOrdemPadrao, resolverOrdem } from "@/lib/acoes-ordem";
import { Pager } from "@/components/ui/Pager";
import { SkeletonPage } from "@/components/ui/Skeleton";
import { moduleGate } from "@/lib/module-gate";
import { getPlatformIntegrationFlags } from "@/lib/platform-integrations";
import { ABRIR_DEMANDA } from "@/lib/notificacao-destino";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PAGE_SIZE = 50;

/** Multivalor chega como parâmetro repetido (?sol=A&sol=B) e vira string[]. */
type SP = {
  p?: string; q?: string; sdpo?: string; de?: string; ate?: string;
  st?: string | string[]; prog?: string | string[];
  pilar?: string | string[]; bloco?: string | string[]; item?: string | string[];
  kpi?: string | string[]; ferr?: string | string[]; reuniao?: string | string[];
  sol?: string | string[]; resp?: string | string[];
  setor?: string | string[]; sub?: string | string[];
  minhas?: string | string[];
  /** classificação: ausente = Data de criação, a mais nova primeiro */
  ord?: string; dir?: string;
  /** demanda aberta pelo aviso do sino */
  [ABRIR_DEMANDA]?: string;
};

/** A linha como `acoes_da_pagina` devolve: a unidade resolve aqui, pelo escopo de quem vê. */
type LinhaDaPagina = Omit<ActionRow, "unitName"> & { unitId: string | null; legacyUnit: string | null };

const asList = (v: string | string[] | undefined): string[] =>
  v == null ? [] : Array.isArray(v) ? v.filter(Boolean) : v ? [v] : [];

export default async function ActionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const gate = await moduleGate("acoes");
  if (gate) return gate;

  // O esqueleto aparece ao ENTRAR em Ações (LUIZ, 23/11/2026). Ao trocar de filtro
  // a fronteira já está revelada e a navegação é transição, então a lista atual
  // fica na tela, esmaecida, em vez de piscar para o cinza.
  return (
    <Suspense fallback={<SkeletonPage />}>
      <ListaDeAcoes searchParams={searchParams} />
    </Suspense>
  );
}

async function ListaDeAcoes({ searchParams }: { searchParams: Promise<SP> }) {
  const { user, role, unitScope } = await requireContext();
  const supabase = await createClient();
  const isAdmin = role === "owner" || role === "admin";
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.p) || 1);
  const from = (page - 1) * PAGE_SIZE;

  /**
   * "Minhas ações": o PADRÃO da tela, e não um filtro que a pessoa precisa achar.
   *
   * Parâmetro AUSENTE vale `resp`, porque quem entra em Ações quase sempre quer o
   * que está no colo dele. Desligar é explícito (`?minhas=todas`), senão não teria
   * como distinguir "abri a tela agora" de "pedi para ver tudo".
   *
   * Isto é EXIBIÇÃO, não permissão: quem alcançava as 7.522 ações continua
   * alcançando, a um clique em "Todas". A regra de quem vê o quê segue no banco.
   */
  const mine = resolverMinhas(asList(sp.minhas));

  // filtros vivem na URL: a busca é feita no banco, sobre a base inteira
  const filters = {
    q: sp.q ?? "", sdpo: sp.sdpo ?? "", from: sp.de ?? "", to: sp.ate ?? "",
    // sem `st` na URL a tela abre no que ainda pede ação; `?st=todos` tira o recorte
    status: resolverStatus(asList(sp.st)), programa: asList(sp.prog),
    pilar: asList(sp.pilar), bloco: asList(sp.bloco), item: asList(sp.item),
    kpi: asList(sp.kpi), tool: asList(sp.ferr), meeting: asList(sp.reuniao),
    requester: asList(sp.sol), assignee: asList(sp.resp),
    dept: asList(sp.setor), sub: asList(sp.sub),
    mine,
  };

  // classificação: decidida no banco, senão só a página aberta sairia na ordem
  const ordem = resolverOrdem(sp.ord, sp.dir);

  const unitIds = effectiveUnitFilter(unitScope);
  const unitById = new Map(unitScope.units.map((u) => [u.id, u.name]));

  // Duas idas ao banco: os ids da página e as linhas prontas. Catálogos, nomes e
  // opções de filtro não vêm mais aqui: as linhas já trazem os nomes, e as opções
  // chegam quando o painel de filtros abre.
  const flagsP = getPlatformIntegrationFlags();

  // A ação do aviso do sino vem à parte, em paralelo com a página: pode estar em
  // outra página, fora dos filtros ou de outra unidade. A leitura é a de quem
  // clicou (RLS na demanda, a regra de visibilidade em `acoes_da_pagina`).
  const pedido = sp[ABRIR_DEMANDA];
  const abrirP = (async (): Promise<LinhaDaPagina | null> => {
    if (!pedido || !UUID.test(pedido)) return null;
    const { data: dem } = await supabase.from("action_demandas").select("action_id").eq("id", pedido).maybeSingle();
    if (!dem) return null;
    const { data } = await supabase.rpc("acoes_da_pagina", { p_ids: [dem.action_id] });
    return ((data ?? []) as unknown as LinhaDaPagina[])[0] ?? null;
  })();

  const { data: search, error: erroBusca } = await supabase.rpc("search_action_ids", {
    p_filters: { ...filters, units: unitIds ?? null, ord: ordem.por, dir: ordem.dir },
    p_limit: PAGE_SIZE,
    p_offset: from,
  });
  // sem isto uma falha do banco apareceria como "Nenhuma ação"
  if (erroBusca) throw new Error("Não foi possível carregar as ações.");
  const { ids: pageIds, total: actionsTotal } = (search ?? { ids: [], total: 0 }) as { ids: string[]; total: number };

  const [{ data: linhas, error: erroLinhas }, flags, linhaPedida] = await Promise.all([
    pageIds.length
      ? supabase.rpc("acoes_da_pagina", { p_ids: pageIds })
      : Promise.resolve({ data: [], error: null }),
    flagsP,
    abrirP,
  ]);
  if (erroLinhas) throw new Error("Não foi possível carregar as ações.");

  const paraLinha = ({ unitId, legacyUnit, ...linha }: LinhaDaPagina): ActionRow => ({
    ...linha,
    unitName: (unitId ? unitById.get(unitId) ?? null : null) ?? legacyUnit ?? null,
  });
  const rows: ActionRow[] = ((linhas ?? []) as unknown as LinhaDaPagina[]).map(paraLinha);

  // mantém os filtros ao trocar de página (multivalor vira parâmetro repetido)
  const pagerQuery = new URLSearchParams();
  for (const [k, v] of Object.entries({ q: sp.q, sdpo: sp.sdpo, de: sp.de, ate: sp.ate })) {
    if (v) pagerQuery.set(k, v as string);
  }
  // `minhas` entra aqui como veio da URL, e não resolvido: trocar de página não
  // pode transformar um "Todas" explícito no padrão de novo
  for (const [k, v] of Object.entries({ st: sp.st, prog: sp.prog, pilar: sp.pilar, bloco: sp.bloco, item: sp.item, setor: sp.setor, sub: sp.sub, kpi: sp.kpi, ferr: sp.ferr, reuniao: sp.reuniao, sol: sp.sol, resp: sp.resp, [MINHA_PARAM]: sp.minhas })) {
    asList(v).forEach((x) => pagerQuery.append(k, x));
  }
  // trocar de página mantém a classificação
  if (!ehOrdemPadrao(ordem)) {
    pagerQuery.set(ORDEM_PARAM, ordem.por);
    pagerQuery.set(SENTIDO_PARAM, ordem.dir);
  }

  return (
    <>
      <ActionsManager
        actions={rows}
        currentUserId={user.id}
        isAdmin={isAdmin}
        isOwner={role === "owner"}
        units={unitScope.units}
        aiEnabled={flags.hasOpenAI}
        filters={filters}
        ordem={ordem}
        total={actionsTotal}
        abrir={linhaPedida ? paraLinha(linhaPedida) : null}
      />
      <Pager basePath="/acoes" param="p" page={page} pageSize={PAGE_SIZE} total={actionsTotal} extra={pagerQuery} />
    </>
  );
}
