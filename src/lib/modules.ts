/**
 * Catálogo de módulos do sistema (fonte única da estrutura do menu).
 *
 * AO CRIAR UMA PÁGINA NOVA:
 *  1. adicione a key em `ModuleKey` e a entrada em `MODULES` (e em `NAV_ORDER` se for de topo);
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
  | "agenda_diario" | "agendas" | "agenda_equipe" | "agenda_historico" | "tempos_movimentos"
  | "chamados"
  | "metas" | "feedbacks" | "treinamentos"
  | "gapa" | "gop" | "dto" | "relatos_anomalia" | "checklists" | "formularios" | "swot" | "pdca"
  | "pnr" | "sustentabilidade" | "central_sdpo" | "sonho"
  | "cinco_s" | "padroes"
  | "portaria" | "multas_avarias"
  | "seg_piramide" | "seg_acidentes" | "seg_relatos" | "seg_epis";

export type GroupKey = "g_reunioes" | "g_rotina" | "g_pessoas" | "g_ferramentas" | "g_sdpo" | "g_seguranca";

/** Espelha o enum `unit_module_state` no banco. */
export type ModuleState = "on" | "locked" | "hidden";

export type ModuleDef = {
  key: ModuleKey;
  label: string;
  href: string;
  group: GroupKey | null; // null = item de topo
  core?: true; // sempre "on", não aparece na lista de venda
  minRole?: "team_lead" | "manager" | "admin" | "super"; // restrição por papel (independente da venda)
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
  { key: "acoes", label: "Ações", href: "/acoes", group: "g_reunioes" },
  { key: "salas", label: "Salas de reunião", href: "/salas", group: "g_reunioes" },

  { key: "agenda_diario", label: "Diário de bordo", href: "/agenda", group: "g_rotina" },
  { key: "agendas", label: "Agendas", href: "/agendas", group: "g_rotina" },
  { key: "agenda_equipe", label: "Equipe", href: "/agenda-equipe", group: "g_rotina" },
  { key: "agenda_historico", label: "Histórico", href: "/agenda-historico", group: "g_rotina" },
  { key: "tempos_movimentos", label: "Tempos e movimentos", href: "/tempos-movimentos", group: "g_rotina" },

  { key: "chamados", label: "Chamados", href: "/chamados", group: null },

  // Não é módulo vendável: é a tela que dá sentido ao perfil Gestor, então nasce
  // `core` (sempre ligada) e some do menu de quem não lidera equipe, por minRole.
  { key: "minha_equipe", label: "Minha equipe", href: "/minha-equipe", group: "g_pessoas", core: true, minRole: "team_lead" },
  { key: "metas", label: "Metas", href: "/metas", group: "g_pessoas" },
  { key: "feedbacks", label: "Feedbacks", href: "/feedbacks", group: "g_pessoas" },
  { key: "treinamentos", label: "Treinamentos", href: "/treinamentos", group: "g_pessoas" },

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

  { key: "auditoria", label: "Logs do sistema", href: "/auditoria", group: null, core: true, minRole: "manager" },
  { key: "configuracoes", label: "Configurações", href: "/configuracoes", group: null, core: true, minRole: "admin" },
  { key: "admin", label: "Painel ADM", href: "/admin", group: null, core: true, minRole: "super" },
];

/** Ordem exata do menu (mistura itens de topo e grupos). */
export const NAV_ORDER: ({ type: "module"; key: ModuleKey } | { type: "group"; key: GroupKey })[] = [
  { type: "module", key: "dashboard" },
  { type: "group", key: "g_reunioes" },
  { type: "group", key: "g_rotina" },
  { type: "module", key: "chamados" },
  { type: "group", key: "g_pessoas" },
  { type: "group", key: "g_ferramentas" },
  { type: "group", key: "g_sdpo" },
  { type: "module", key: "portaria" },
  { type: "module", key: "multas_avarias" },
  { type: "module", key: "cinco_s" },
  { type: "module", key: "padroes" },
  { type: "group", key: "g_seguranca" },
  { type: "module", key: "auditoria" },
  { type: "module", key: "configuracoes" },
  { type: "module", key: "admin" },
];

export const MODULE_BY_KEY = Object.fromEntries(MODULES.map((m) => [m.key, m])) as Record<ModuleKey, ModuleDef>;
export const modulesInGroup = (g: GroupKey) => MODULES.filter((m) => m.group === g);
export const SELLABLE_MODULES = MODULES.filter((m) => !m.core);
export const SELLABLE_KEYS = SELLABLE_MODULES.map((m) => m.key);
