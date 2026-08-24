/**
 * Catálogo de módulos do sistema (fonte única da estrutura do menu).
 *
 * AO CRIAR UMA PÁGINA NOVA:
 *  1. adicione a key em `ModuleKey` e a entrada em `MODULES` (`group: null` = item de topo;
 *     a ordem do menu é derivada e alfabética, ninguém edita `NAV_ORDER` à mão);
 *  2. chame `moduleGate("<key>")` na primeira linha da page, antes de qualquer query.
 * Sem isso o módulo fica sem venda e sem bloqueio. A key é o identificador no banco
 * (`unit_modules.module_key`): NUNCA renomeie uma key existente sem migrar os dados.
 *
 * Só dados aqui (sem JSX): este arquivo é importado no servidor e no cliente.
 */

export type ModuleKey =
  // base: sempre liberados, fora da venda
  | "dashboard" | "auditoria" | "configuracoes" | "admin" | "minha_equipe"
  // vendáveis
  | "reunioes" | "acoes" | "salas"
  | "agenda_diario" | "agendas" | "agenda_equipe" | "agenda_historico" | "tempos_movimentos" | "planner"
  | "chamados" | "venda_interna" | "chat"
  | "metas" | "feedbacks" | "punicoes" | "absenteismos" | "ferias" | "treinamentos"
  | "gapa" | "gop" | "dto" | "relatos_anomalia" | "checklists" | "formularios" | "swot" | "pdca"
  | "pnr" | "sustentabilidade" | "central_sdpo" | "sonho"
  | "cinco_s" | "padroes"
  | "portaria" | "multas_avarias"
  | "seg_piramide" | "seg_acidentes" | "seg_relatos" | "seg_epis"
  | "seg_blitz" | "seg_gabaritos";

export type GroupKey = "g_reunioes" | "g_rotina" | "g_pessoas" | "g_ferramentas" | "g_sdpo" | "g_seguranca";

/** Espelha o enum `unit_module_state` no banco. */
export type ModuleState = "on" | "locked" | "hidden";

export type ModuleDef = {
  key: ModuleKey;
  label: string;
  href: string;
  group: GroupKey | null; // null = item de topo
  core?: true; // sempre "on", não aparece na lista de venda
  // Restrição por papel (independente da venda). `team_lead_hr` é "quem lidera
  // equipe, MAIS o RH": nasceu com Punições, onde o gestor lança e o RH aprova.
  // Nenhum dos tokens antigos servia: `team_lead` esconderia o módulo de quem
  // aprova, e `manager` esconderia de quem lança.
  minRole?: "team_lead" | "team_lead_hr" | "manager" | "admin" | "owner" | "super";
};

export const MODULE_GROUPS: { key: GroupKey; label: string }[] = [
  { key: "g_reunioes", label: "Gestão de reuniões" },
  { key: "g_rotina", label: "Gestão da rotina" },
  { key: "g_pessoas", label: "Gestão de pessoas" },
  { key: "g_ferramentas", label: "Ferramentas de Gestão" },
  { key: "g_sdpo", label: "SDPO" },
  { key: "g_seguranca", label: "Segurança" },
];

export const MODULES: ModuleDef[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", group: null, core: true },

  { key: "reunioes", label: "Reuniões", href: "/reunioes", group: "g_reunioes" },
  // Item de topo, e não mais filho de "Gestão de reuniões": ação nasce de
  // reunião, de relato de segurança, de acidente, de checklist... prender o
  // módulo ao grupo de reuniões escondia isso de quem procura.
  { key: "acoes", label: "Ações", href: "/acoes", group: null },
  { key: "salas", label: "Salas de reunião", href: "/salas", group: "g_reunioes" },

  { key: "agenda_diario", label: "Diário de bordo", href: "/agenda", group: "g_rotina" },
  { key: "agendas", label: "Agendas", href: "/agendas", group: "g_rotina" },
  { key: "agenda_equipe", label: "Equipe", href: "/agenda-equipe", group: "g_rotina" },
  { key: "agenda_historico", label: "Histórico", href: "/agenda-historico", group: "g_rotina" },
  { key: "tempos_movimentos", label: "Tempos e movimentos", href: "/tempos-movimentos", group: "g_rotina" },
  // kanban de atividades (quadros livres) + visão kanban das Ações
  { key: "planner", label: "Planner", href: "/planner", group: "g_rotina" },

  { key: "chamados", label: "Chamados", href: "/chamados", group: null },

  { key: "chat", label: "Chat interno", href: "/chat", group: null },

  { key: "venda_interna", label: "Venda Interna", href: "/venda-interna", group: null },

  // Não é módulo vendável: é a tela que dá sentido ao perfil Gestor, então nasce
  // `core` (sempre ligada) e some do menu de quem não lidera equipe, por minRole.
  { key: "minha_equipe", label: "Minha equipe", href: "/minha-equipe", group: "g_pessoas", core: true, minRole: "team_lead" },
  { key: "metas", label: "Metas", href: "/metas", group: "g_pessoas" },
  // SEM minRole de propósito: o colaborador comum solicita as próprias férias,
  // então precisa do item de menu. A autorização fina (quem aprova, quem
  // efetiva, quem nem solicita) é decidida dentro da page e das RPCs.
  { key: "ferias", label: "Férias", href: "/ferias", group: "g_pessoas" },
  { key: "feedbacks", label: "Feedbacks", href: "/feedbacks", group: "g_pessoas" },
  // Quem lança é o gestor da pessoa; quem aprova é o RH. Daí o minRole próprio:
  // a tela não faz sentido para quem não faz nem uma coisa nem outra.
  { key: "punicoes", label: "Punições", href: "/punicoes", group: "g_pessoas", minRole: "team_lead_hr" },
  // Mesmo arranjo de Punições: o gestor lança o não comparecimento e o RH
  // aprova, então nenhum dos dois pode ficar sem o item de menu.
  { key: "absenteismos", label: "Absenteísmos", href: "/absenteismos", group: "g_pessoas", minRole: "team_lead_hr" },

  // Módulo próprio, e não mais um item de Gestão de pessoas: ele vai crescer
  // com estrutura de trilhas, turmas e presença, que não cabe dentro de um
  // grupo com metas e feedbacks. A key não muda, então o que já foi vendido
  // por unidade (`unit_modules.module_key`) continua valendo.
  { key: "treinamentos", label: "Treinamentos", href: "/treinamentos", group: null },

  { key: "gapa", label: "GAPA", href: "/ferramentas-gestao/gapa", group: "g_ferramentas" },
  { key: "gop", label: "GOP", href: "/ferramentas-gestao/gop", group: "g_ferramentas" },
  { key: "dto", label: "DTO", href: "/ferramentas-gestao/dto", group: "g_ferramentas" },
  { key: "relatos_anomalia", label: "Relatos de anomalia", href: "/ferramentas-gestao/relatos-anomalia", group: "g_ferramentas" },
  { key: "checklists", label: "Checklists", href: "/checklists", group: "g_ferramentas" },
  { key: "formularios", label: "Formulários", href: "/formularios", group: "g_ferramentas" },
  { key: "swot", label: "SWOT", href: "/ferramentas-gestao/swot", group: "g_ferramentas" },
  { key: "pdca", label: "PDCA", href: "/ferramentas-gestao/pdca", group: "g_ferramentas" },

  { key: "pnr", label: "PNR", href: "/pnr", group: "g_sdpo" },
  { key: "sustentabilidade", label: "KPIs de Sustentabilidade", href: "/sustentabilidade", group: "g_sdpo" },
  { key: "central_sdpo", label: "Central SDPO", href: "/central-sdpo", group: "g_sdpo" },
  { key: "sonho", label: "Sonho", href: "/sonho", group: "g_sdpo" },

  { key: "portaria", label: "Portaria", href: "/portaria", group: null },
  { key: "multas_avarias", label: "Multas e Avarias", href: "/multas-avarias", group: null },
  { key: "cinco_s", label: "5S", href: "/cinco-s", group: null },
  { key: "padroes", label: "Padrões", href: "/padroes", group: null },

  { key: "seg_piramide", label: "Pirâmide", href: "/seguranca/piramide", group: "g_seguranca" },
  { key: "seg_acidentes", label: "Acidentes", href: "/seguranca/acidentes", group: "g_seguranca" },
  { key: "seg_relatos", label: "Relatos", href: "/seguranca/relatos", group: "g_seguranca" },
  { key: "seg_epis", label: "Gestão de EPIs", href: "/seguranca/epis", group: "g_seguranca" },
  { key: "seg_blitz", label: "Blitz de trajeto", href: "/seguranca/blitz", group: "g_seguranca" },
  { key: "seg_gabaritos", label: "Gabaritos de segurança", href: "/seguranca/gabaritos", group: "g_seguranca" },

  // só o proprietário por enquanto: o log mostra o de→para de toda alteração da
  // empresa, inclusive salário, CPF e remuneração variável de quem o leitor não
  // gerencia. Enquanto não houver recorte por escopo dentro da tela, fica fechado.
  { key: "auditoria", label: "Logs do sistema", href: "/auditoria", group: null, core: true, minRole: "owner" },
  // Gerencial entra, mas só para LER: a tela inteira sai em modo consulta para
  // ele (ver `canEdit` em src/app/(app)/configuracoes/page.tsx). O menu não
  // distingue ver de mexer, então o corte de escrita não mora aqui.
  { key: "configuracoes", label: "Configurações", href: "/configuracoes", group: null, core: true, minRole: "manager" },
  { key: "admin", label: "Painel ADM", href: "/admin", group: null, core: true, minRole: "super" },
];

/** Compara rótulos como um leitor brasileiro leria: acento e caixa não separam. */
const porNome = (a: string, b: string) => a.localeCompare(b, "pt-BR", { sensitivity: "base" });

/**
 * O menu é alfabético, com duas âncoras que a ordem alfabética não deve mexer:
 * o Dashboard abre a lista (é a porta de entrada do sistema) e o bloco de
 * administração fecha (Configurações, Logs do sistema e Painel ADM não são
 * trabalho do dia a dia). Entre eles, grupos e itens soltos se misturam e são
 * ordenados pelo rótulo, que é o que a pessoa lê.
 */
const NAV_TOPO: ModuleKey[] = ["dashboard"];
const NAV_RODAPE: ModuleKey[] = ["configuracoes", "auditoria", "admin"];

/** Ordem exata do menu (mistura itens de topo e grupos), derivada dos rótulos. */
export const NAV_ORDER: ({ type: "module"; key: ModuleKey } | { type: "group"; key: GroupKey })[] = (() => {
  const ancoras = new Set<ModuleKey>([...NAV_TOPO, ...NAV_RODAPE]);
  const miolo = [
    ...MODULE_GROUPS.map((g) => ({ type: "group" as const, key: g.key, label: g.label })),
    ...MODULES
      .filter((m) => m.group === null && !ancoras.has(m.key))
      .map((m) => ({ type: "module" as const, key: m.key, label: m.label })),
  ].sort((a, b) => porNome(a.label, b.label));

  return [
    ...NAV_TOPO.map((key) => ({ type: "module" as const, key })),
    ...miolo.map(({ type, key }) => (type === "group"
      ? { type: "group" as const, key: key as GroupKey }
      : { type: "module" as const, key: key as ModuleKey })),
    ...NAV_RODAPE.map((key) => ({ type: "module" as const, key })),
  ];
})();

export const MODULE_BY_KEY = Object.fromEntries(MODULES.map((m) => [m.key, m])) as Record<ModuleKey, ModuleDef>;
export const modulesInGroup = (g: GroupKey) =>
  MODULES.filter((m) => m.group === g).sort((a, b) => porNome(a.label, b.label));
export const SELLABLE_MODULES = MODULES.filter((m) => !m.core);
export const SELLABLE_KEYS = SELLABLE_MODULES.map((m) => m.key);
