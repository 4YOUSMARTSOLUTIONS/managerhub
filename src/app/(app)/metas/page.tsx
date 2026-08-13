import { requireContext, getMembers, effectiveUnitFilter } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { kindsComRedutor, type RegraRedutor } from "@/lib/rv-redutores";
import { PageHeader } from "@/components/ui/PageHeader";
import { Tabs, type Tab } from "@/components/ui/Tabs";
import { IndividualGoalsFarol, type GoalRow, type GoalEntryLite, type GoalEvidenceLite, type RvDiasRow, type RvCongeladoRow } from "@/components/IndividualGoalsFarol";
import { AreaGoalsFarol, type AreaGoalRow, type AreaEntryLite } from "@/components/AreaGoalsFarol";
import { moduleGate } from "@/lib/module-gate";

export default async function GoalsPage() {
  const gate = await moduleGate("metas");
  if (gate) return gate;

  const { tenant, user, role, unitScope } = await requireContext();
  const isAdmin = role === "owner" || role === "admin";
  const supabase = await createClient();

  // ---------- ONDA 1: tudo o que nao depende de nada ----------
  //
  // Antes esta tela fazia 7 idas ao banco EM FILA, e so 3 eram dependencias de
  // verdade. As metas da area, os setores, os subsetores e a lista de pessoas nao
  // precisavam de nada e mesmo assim esperavam a vez.
  //
  // `departments` e `subdepartments` eram consultados DUAS vezes cada, com a query
  // identica: uma para o filtro das metas individuais, outra para as da area. Agora
  // e uma leitura so, usada pelas duas.
  // A equipe passa a ser lida para TODO MUNDO, admin inclusive: agora ela não serve
  // só de permissão, serve de escopo padrão da tela. Antes o admin nem consultava,
  // porque abria a empresa inteira de uma vez.
  const reportsP = supabase.rpc("my_managed_memberships").eq("tenant_id", tenant.id);
  // quem pode ampliar o escopo para fora da própria cadeia. É o mesmo conjunto que a
  // policy individual_goals_select passou a aceitar.
  const podeAmpliar = isAdmin || role === "manager";

  // Meta individual não tem unidade própria: quem tem é o DONO dela. Para o
  // seletor do topo valer aqui, o recorte é pela unidade do dono. Só custa uma
  // consulta quando há unidade escolhida; em "Todas" nem sai.
  const unidadesDoEscopo = effectiveUnitFilter(unitScope);
  // duas leituras em vez de um embed: `membership_units` não tem relação
  // declarada em `src/types/database.ts` (mantido à mão), então o embed não
  // compila. Juntar na memória custa o mesmo e não depende do gerador de tipos.
  const donosP = unidadesDoEscopo
    ? Promise.all([
        supabase.from("memberships").select("id, user_id").eq("tenant_id", tenant.id),
        supabase.from("membership_units").select("membership_id, unit_id").limit(20000),
      ])
    : Promise.resolve(null);

  const [{ data: reports }, { data: areaGoals }, { data: deps }, { data: subs }, { data: cargos }, { data: unidadesTodas }, todosMembros, donos] = await Promise.all([
    reportsP,
    supabase
      .from("area_goals")
      .select("id, name, description, unit, kind, direction, consolidation, department_id, subdepartment_id, unit_id, parent_id, owner_id, created_by, dept:departments(name), sub:subdepartments(name), orgUnit:units(name), owner:profiles!area_goals_owner_id_fkey(full_name)")
      .eq("tenant_id", tenant.id)
      .order("sort")
      .order("name"),
    supabase.from("departments").select("id, name").eq("tenant_id", tenant.id).order("name"),
    supabase.from("subdepartments").select("id, name, department_id").eq("tenant_id", tenant.id).order("name"),
    // cargos e unidades só para dar nome ao vínculo carimbado nos retratos de RV
    supabase.from("positions").select("id, name").eq("tenant_id", tenant.id),
    supabase.from("units").select("id, name").eq("tenant_id", tenant.id),
    getMembers(tenant.id),
    donosP,
  ]);

  // Dono sem NENHUMA unidade continua aparecendo em qualquer recorte, igual ao
  // que /acoes e /checklists fazem com registro sem unidade: sumir sem erro é
  // pior que aparecer demais.
  let donosVisiveis: Set<string> | null = null;
  if (donos && unidadesDoEscopo) {
    const [{ data: vinculos }, { data: vinculoUnidades }] = donos;
    const unidadesPorVinculo = new Map<string, string[]>();
    for (const vu of vinculoUnidades ?? []) {
      const arr = unidadesPorVinculo.get(vu.membership_id) ?? [];
      arr.push(vu.unit_id);
      unidadesPorVinculo.set(vu.membership_id, arr);
    }
    donosVisiveis = new Set<string>();
    for (const v of vinculos ?? []) {
      const us = unidadesPorVinculo.get(v.id) ?? [];
      if (us.length === 0 || us.some((id) => unidadesDoEscopo.includes(id))) donosVisiveis.add(v.user_id);
    }
  }

  // a CADEIA inteira abaixo (recursiva). É a base de PERMISSÃO: quem eu posso
  // editar, fechar e apurar. Não confundir com o escopo padrão de exibição.
  const reportIds: string[] = (reports ?? []).map((r) => r.user_id);
  // Cadastram metas individuais: admin/owner, quem tem subordinados e, por
  // exceção, o Gerencial — que passa a cadastrar as PRÓPRIAS metas mesmo sem
  // equipe (antes dependia de um admin para as metas dele). A RLS aplica o
  // mesmo recorte: para si, não para terceiros.
  const canCreateGoals = isAdmin || reportIds.length > 0 || role === "manager";
  // Ve metas de mais de um colaborador. Desacoplado de canCreateGoals de propósito:
  // um Gerencial sem equipe não cadastra meta, mas acompanha a empresa inteira, e
  // sem isto a coluna Colaborador sumiria justamente da tela dele.
  const canSeeMultiple = canCreateGoals || podeAmpliar;

  // ---------- ONDA 2: o que depende da onda 1 ----------
  // Sem recorte por dono: o teto passa a ser a RLS, e só ela. São 25 metas no total,
  // então carregar tudo o que a policy entrega e recortar em memória é mais barato
  // que uma ida ao servidor por troca de escopo. Se um dia forem milhares, isto vira
  // filtro no banco, como já é em /acoes.
  const goalsQuery = supabase
    .from("individual_goals")
    .select("id, name, description, unit, direction, partial_pct, evidence_required, owner_id, owner:profiles!owner_id(full_name)")
    .eq("tenant_id", tenant.id);

  // `manager_id` entra para o escopo padrão (subordinados DIRETOS). Quem não tem
  // equipe nem pode ampliar lê só a própria linha, que a aba de metas da área
  // precisa para saber o setor/subsetor padrão.
  let memQuery = supabase
    .from("memberships")
    .select("user_id, manager_id, department_id, subdepartment_id")
    .eq("tenant_id", tenant.id);
  if (!canSeeMultiple) memQuery = memQuery.eq("user_id", user.id);

  const areaIds = (areaGoals ?? []).map((g) => g.id);

  const [{ data: goals }, { data: mems }, { data: areaEntries }] = await Promise.all([
    goalsQuery.order("name"),
    memQuery,
    areaIds.length
      ? supabase
          .from("area_goal_entries")
          .select("area_goal_id, unit_id, period, target_value, actual_value, numerator_value, denominator_value")
          .in("area_goal_id", areaIds)
      : Promise.resolve({ data: [] as { area_goal_id: string; unit_id: string | null; period: string; target_value: number | null; actual_value: number | null; numerator_value: number | null; denominator_value: number | null }[] }),
  ]);

  // ---------- ONDA 3: o que depende da onda 2 ----------
  // o recorte por unidade entra ANTES de buscar lançamentos e RV: não adianta
  // carregar o histórico de metas que não vão aparecer
  const goalsNoEscopo = donosVisiveis ? (goals ?? []).filter((g) => donosVisiveis.has(g.owner_id)) : (goals ?? []);
  const goalIds = goalsNoEscopo.map((g) => g.id);
  const ownerIds = [...new Set(goalsNoEscopo.map((g) => g.owner_id))];
  const admin = ownerIds.length ? createServiceClient() : null;

  const [{ data: entries }, { data: rvCfgs }, { data: ownerMems }, { data: ausencias },
         { data: sancoes }, { data: regrasRaw }, { data: faixasRaw },
         { data: cadeados }, { data: retratos }] = await Promise.all([
    goalIds.length
      ? supabase
          .from("individual_goal_entries")
          .select("id, goal_id, period, target_value, actual_value, weight, note, partial_value, rv_value, approval_status, approved_at, reproval_note")
          .in("goal_id", goalIds)
      : Promise.resolve({ data: [] as { id: string; goal_id: string; period: string; target_value: number; actual_value: number | null; weight: number; note: string | null; partial_value: number | null; rv_value: number | null; approval_status: "aberta" | "aprovada" | "reprovada"; approved_at: string | null; reproval_note: string | null }[] }),
    // RV configurada em Configuracoes (vigencias por funcao/colaborador). Leitura via
    // service client (a RLS da config e owner/admin) - escopo restrito aos owners visiveis.
    admin
      ? admin.from("individual_rv_config").select("scope, position_id, user_id, effective_from, value").eq("tenant_id", tenant.id)
      : Promise.resolve({ data: [] as { scope: string; position_id: string | null; user_id: string | null; effective_from: string; value: number }[] }),
    // admissao/desligamento entram junto: quem trabalhou meio mês recebe meio mês,
    // e a data do vínculo é o mesmo tipo de recorte que as férias
    admin
      ? admin.from("memberships").select("user_id, position_id, admission_date, dismissed_at").eq("tenant_id", tenant.id).in("user_id", ownerIds)
      : Promise.resolve({ data: [] as { user_id: string; position_id: string | null; admission_date: string | null; dismissed_at: string | null }[] }),
    // Férias e afastamentos que descontam. Pelo service client, como a RV: a RLS
    // da tabela é owner/admin, mas o GESTOR precisa do fator para entender o valor
    // da equipe dele. O que chega aqui é só o intervalo, já recortado aos donos
    // visíveis, e o que chega ao navegador é a contagem de dias.
    //
    // Vêm TODAS, e não só as que descontam: o `discounts_rv` governa o
    // proporcional, mas o redutor por faixa (atestado, falta) precisa contar os
    // dias mesmo com a marcação desligada — que é justamente como esses dois
    // tipos nascem.
    admin
      ? admin.from("employee_absences").select("user_id, kind, start_date, end_date, discounts_rv, waived").eq("tenant_id", tenant.id).in("user_id", ownerIds)
      : Promise.resolve({ data: [] as { user_id: string; kind: string; start_date: string; end_date: string; discounts_rv: boolean; waived: boolean }[] }),
    // Punições: service client pelo mesmo motivo das ausências, e o que chega ao
    // NAVEGADOR é só a contagem por mês dentro do fator. A lista de punições, com
    // tipo e observação, não sai daqui.
    admin
      ? admin.from("employee_sanctions").select("user_id, sanction_type_id, occurred_on").eq("tenant_id", tenant.id).in("user_id", ownerIds)
      : Promise.resolve({ data: [] as { user_id: string; sanction_type_id: string; occurred_on: string }[] }),
    // Regras e faixas são configuração: leitura de membro, então cliente normal.
    supabase.from("rv_reducer_rules").select("id, name, source, absence_kind, sanction_type_id").eq("tenant_id", tenant.id).eq("active", true).order("sort"),
    supabase.from("rv_reducer_bands").select("rule_id, min_qtd, max_qtd, reduction_pct").eq("tenant_id", tenant.id).order("min_qtd"),
    // Competências fechadas e o retrato de cada uma. Leitura de membro nas duas,
    // de propósito: se só o administrador enxergasse o cadeado, o colaborador
    // veria o valor recalculado ao vivo e o chefe veria o congelado, cada um com
    // um número na mão e ninguém sabendo qual vale.
    supabase.from("rv_period_locks").select("period, locked_at").eq("tenant_id", tenant.id),
    ownerIds.length
      ? supabase.from("rv_period_snapshots").select("period, user_id, rv_full, prop_factor, reducer_pct, detail, department_id, position_id, manager_id, unit_ids").eq("tenant_id", tenant.id).in("user_id", ownerIds)
      : Promise.resolve({ data: [] as { period: string; user_id: string; rv_full: number; prop_factor: number; reducer_pct: number; detail: unknown; department_id: string | null; position_id: string | null; manager_id: string | null; unit_ids: string[] }[] }),
  ]);

  // evidências: uma consulta só para todos os lançamentos em vista, e não uma por
  // linha. A RLS da tabela de anexos espelha a do lançamento, então o recorte de
  // quem pode ver já vem pronto do banco.
  const entryIds = (entries ?? []).map((e) => e.id);
  const { data: anexos } = entryIds.length
    ? await supabase
        .from("individual_goal_entry_attachments")
        .select("id, entry_id, path, filename, size, created_at")
        .in("entry_id", entryIds)
        .order("created_at")
    : { data: [] as { id: string; entry_id: string; path: string; filename: string; size: number | null; created_at: string }[] };

  const anexosPorEntry = new Map<string, GoalEvidenceLite[]>();
  for (const a of anexos ?? []) {
    const arr = anexosPorEntry.get(a.entry_id) ?? [];
    arr.push({ id: a.id, path: a.path, filename: a.filename, size: a.size });
    anexosPorEntry.set(a.entry_id, arr);
  }

  const entriesByGoal = new Map<string, GoalEntryLite[]>();
  for (const e of entries ?? []) {
    const arr = entriesByGoal.get(e.goal_id) ?? [];
    arr.push({ period: e.period, target: e.target_value, actual: e.actual_value, weight: e.weight, note: e.note, partial: e.partial_value, status: e.approval_status, approvedAt: e.approved_at, reprovalNote: e.reproval_note, evidences: anexosPorEntry.get(e.id) ?? [] });
    entriesByGoal.set(e.goal_id, arr);
  }

  const rvTimelines: { ownerId: string; from: string; value: number }[] = [];
  {
    const posByOwner = new Map((ownerMems ?? []).map((m) => [m.user_id, m.position_id]));
    const cfgs = rvCfgs ?? [];
    for (const ownerId of ownerIds) {
      const posId = posByOwner.get(ownerId) ?? null;
      const userCfgs = cfgs.filter((c) => c.scope === "user" && c.user_id === ownerId);
      const posCfgs = posId ? cfgs.filter((c) => c.scope === "position" && c.position_id === posId) : [];
      if (userCfgs.length === 0 && posCfgs.length === 0) continue;
      // resolve a linha do tempo: em cada breakpoint vale o override do colaborador
      // (ultima vigencia <= ponto); sem override, vale o da funcao
      const latest = (list: typeof cfgs, at: string) => {
        let best: (typeof cfgs)[number] | null = null;
        for (const c of list) if (c.effective_from <= at && (!best || c.effective_from > best.effective_from)) best = c;
        return best;
      };
      const breakpoints = [...new Set([...userCfgs, ...posCfgs].map((c) => c.effective_from))].sort();
      for (const bp of breakpoints) {
        const u = latest(userCfgs, bp);
        const pcfg = latest(posCfgs, bp);
        const value = u ? u.value : pcfg ? pcfg.value : 0;
        rvTimelines.push({ ownerId, from: bp, value });
      }
    }
  }

  // Regras de redução configuradas pela empresa, já com as faixas penduradas.
  // Sem regra ativa a lista fica vazia, `redutoresDoMes` devolve fator 1 e o
  // valor pago é exatamente o de antes desta funcionalidade existir.
  const faixasPorRegra = new Map<string, { min: number; max: number | null; pct: number }[]>();
  for (const b of faixasRaw ?? []) {
    const arr = faixasPorRegra.get(b.rule_id) ?? [];
    arr.push({ min: b.min_qtd, max: b.max_qtd, pct: Number(b.reduction_pct) });
    faixasPorRegra.set(b.rule_id, arr);
  }
  const regrasRedutor: RegraRedutor[] = (regrasRaw ?? [])
    .map((r) => ({
      id: r.id, nome: r.name, fonte: r.source as "absence" | "sanction",
      absenceKind: r.absence_kind, sanctionTypeId: r.sanction_type_id,
      faixas: faixasPorRegra.get(r.id) ?? [],
    }))
    .filter((r) => r.faixas.length > 0); // motivo sem faixa não corta nada

  const kindsPorFaixa = kindsComRedutor(regrasRedutor);

  // Dias que NÃO contam na RV de cada dono: férias/afastamentos que descontam,
  // mais o que estiver fora do vínculo (antes da admissão, depois do
  // desligamento). Quem não tem nada aqui fica de fora do mapa e o fator é 1.
  //
  // O `kind` viaja junto porque `fatorRv` precisa dele para pular os tipos que já
  // são cobrados por faixa. E o filtro de `discounts_rv` saiu do banco para cá:
  // o proporcional continua olhando só quem desconta, e o redutor olha o tipo.
  const rvDias: RvDiasRow[] = ownerIds
    .map((ownerId) => {
      const m = (ownerMems ?? []).find((x) => x.user_id === ownerId);
      const minhas = (ausencias ?? []).filter((a) => a.user_id === ownerId);
      return {
        ownerId,
        ausencias: minhas
          // abonada não pesa nem na proporcionalidade nem na faixa: é isso que
          // "abonar" quer dizer
          .filter((a) => !a.waived)
          .filter((a) => a.discounts_rv || kindsPorFaixa.has(a.kind))
          .map((a) => ({ inicio: a.start_date, fim: a.end_date, kind: a.kind })),
        sancoes: (sancoes ?? [])
          .filter((x) => x.user_id === ownerId)
          .map((x) => ({ tipoId: x.sanction_type_id, data: x.occurred_on })),
        vinculo: { admissao: m?.admission_date ?? null, desligamento: m?.dismissed_at ?? null },
      };
    })
    .filter((r) => r.ausencias.length > 0 || r.sancoes.length > 0 || r.vinculo.admissao || r.vinculo.desligamento);

  // ---------------------------------------------------------- congelamento
  // Competência fechada não recalcula: o pote, o proporcional e o corte vêm do
  // retrato tirado no fechamento, e um lançamento retroativo de férias, atestado
  // ou punição deixa de mexer no que já foi pago.
  //
  // O atingimento continua vivo, porque ele tem o próprio fechamento por
  // lançamento. Aqui se trava o dinheiro; lá se trava o desempenho.
  const periodosFechados = (cadeados ?? []).map((c) => c.period);
  // nomes do vínculo carimbado no fechamento; retrato antigo (sem carimbo) fica sem
  const nomeSetor = new Map((deps ?? []).map((d) => [d.id, d.name]));
  const nomeCargo = new Map((cargos ?? []).map((c) => [c.id, c.name]));
  const nomeUnidade = new Map((unidadesTodas ?? []).map((u) => [u.id, u.name]));
  const nomeMembro = new Map<string, string>();
  for (const m of todosMembros) {
    if (m.profile?.id) nomeMembro.set(m.profile.id, m.profile.full_name ?? "");
  }
  const rvCongelados: RvCongeladoRow[] = (retratos ?? []).map((r) => ({
    period: r.period,
    ownerId: r.user_id,
    cheio: Number(r.rv_full),
    fator: Number(r.prop_factor),
    pctTotal: Number(r.reducer_pct),
    motivos: Array.isArray(r.detail)
      ? (r.detail as { motivo?: string; quantidade?: number; pct?: number }[]).map((d) => ({
          nome: String(d.motivo ?? ""), quantidade: Number(d.quantidade ?? 0), pct: Number(d.pct ?? 0),
        }))
      : [],
    vinculo: r.department_id || r.position_id || r.manager_id || (r.unit_ids ?? []).length
      ? {
          setor: r.department_id ? nomeSetor.get(r.department_id) ?? null : null,
          funcao: r.position_id ? nomeCargo.get(r.position_id) ?? null : null,
          gestor: r.manager_id ? nomeMembro.get(r.manager_id) || null : null,
          unidades: (r.unit_ids ?? []).map((u) => nomeUnidade.get(u)).filter((x): x is string => !!x),
        }
      : null,
  }));

  // mapa dono -> setor/subsetor + opcoes de filtro (so p/ quem ve multiplos colaboradores)
  const deptByUser = new Map<string, { dept: string | null; sub: string | null }>();
  for (const m of mems ?? []) deptByUser.set(m.user_id, { dept: m.department_id, sub: m.subdepartment_id });

  // a lista completa de pessoas e montada UMA vez e reaproveitada pelas duas abas;
  // antes ia duas vezes no envio ao navegador, identica, para quem e admin
  const todos = todosMembros
    .map((m) => ({ id: m.profile?.id ?? "", name: m.profile?.full_name ?? m.profile?.email ?? "-" }))
    .filter((m) => m.id)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  let departments: { id: string; name: string }[] = [];
  let subdepartments: { id: string; name: string; departmentId: string }[] = [];
  let members: { id: string; name: string }[] = [];
  if (canSeeMultiple) {
    // setor e subsetor deixam de ser recortados pelo time: com o escopo ampliável,
    // as metas em vista podem ser de qualquer setor. São catálogos pequenos e o
    // filtro é em memória.
    departments = (deps ?? []).map((d) => ({ id: d.id, name: d.name }));
    subdepartments = (subs ?? []).map((s) => ({ id: s.id, name: s.name, departmentId: s.department_id }));
    // Já a lista de quem pode RECEBER uma meta nova continua a CADEIA, porque é o
    // que canManageOwner (lib/actions/individual-goals.ts) vai aceitar. Oferecer
    // alguém que o servidor recusa é a definição de tela quebrada.
    const naCadeia = new Set([user.id, ...reportIds]);
    members = isAdmin ? todos : todos.filter((m) => naCadeia.has(m.id));
  }

  // setor/subsetor do próprio usuário: é o recorte com que a aba de metas da área
  // abre. Subsetor quando tem; setor quando não tem.
  const minhaLinha = (mems ?? []).find((m) => m.user_id === user.id);
  const deptPadrao = minhaLinha?.department_id ?? "";
  const subPadrao = minhaLinha?.subdepartment_id ?? "";

  const goalRows: GoalRow[] = goalsNoEscopo.map((g) => {
    const ds = deptByUser.get(g.owner_id) ?? { dept: null, sub: null };
    return {
      id: g.id,
      name: g.name,
      description: g.description,
      unit: g.unit,
      direction: g.direction,
      partialPct: g.partial_pct,
      evidenceRequired: g.evidence_required,
      ownerId: g.owner_id,
      ownerName: (g.owner as unknown as { full_name: string | null } | null)?.full_name ?? "—",
      deptId: ds.dept,
      subdeptId: ds.sub,
      entries: entriesByGoal.get(g.id) ?? [],
    };
  });

  const areaEntriesByGoal = new Map<string, AreaEntryLite[]>();
  for (const e of areaEntries ?? []) {
    const arr = areaEntriesByGoal.get(e.area_goal_id) ?? [];
    arr.push({ unitId: e.unit_id, period: e.period, target: e.target_value, actual: e.actual_value, numerator: e.numerator_value, denominator: e.denominator_value });
    areaEntriesByGoal.set(e.area_goal_id, arr);
  }

  const areaRows: AreaGoalRow[] = (areaGoals ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    unit: g.unit,
    kind: g.kind,
    direction: g.direction,
    consolidation: g.consolidation,
    departmentId: g.department_id,
    departmentName: (g.dept as unknown as { name: string } | null)?.name ?? null,
    subdepartmentId: g.subdepartment_id,
    subdepartmentName: (g.sub as unknown as { name: string } | null)?.name ?? null,
    unitId: g.unit_id,
    unitName: (g.orgUnit as unknown as { name: string } | null)?.name ?? null,
    parentId: g.parent_id,
createdById: g.created_by,
    ownerId: g.owner_id,
    ownerName: (g.owner as unknown as { full_name: string | null } | null)?.full_name ?? null,
    entries: areaEntriesByGoal.get(g.id) ?? [],
  }));

  // As metas da área usam os mesmos setores/subsetores lidos na onda 1, sem repetir
  // a consulta. A antiga leitura de `units` daqui era descartada: quem alimenta o
  // seletor de unidade é o `unitScope` do requireContext, logo abaixo.
  // UNIDADES QUE A PESSOA ALCANÇA POR RESPONSABILIDADE, e só em Metas da área.
  //
  // O Financeiro é centralizado na Matriz e responde por metas da Filial. O
  // seletor do topo não resolve: ele vale para o sistema inteiro, e alargar lá
  // daria acesso à Filial em chamados, ações e reuniões também.
  //
  // Então a autorização sai do próprio cadastro da meta: se a meta da Filial está
  // no seu nome, você alcança a Filial nesta tela. Nada para marcar em lugar
  // nenhum — cadastrou no nome da pessoa, ela passa a poder; tirou, ela deixa de
  // poder. E o alcance é só o que ela responde, não a Filial inteira.
  const unidadesExtras = (() => {
    const m = new Map<string, string>();
    for (const g of areaGoals ?? []) {
      if (g.owner_id !== user.id || !g.unit_id) continue;
      if (unitScope.allowedUnitIds.includes(g.unit_id)) continue;
      m.set(g.unit_id, (g.orgUnit as unknown as { name: string } | null)?.name ?? "Outra unidade");
    }
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  })();

  const areaDepartments = (deps ?? []).map((d) => ({ id: d.id, name: d.name }));
  const areaSubdepartments = (subs ?? []).map((s) => ({ id: s.id, name: s.name, departmentId: s.department_id }));
  const areaMembers = todos;

  const tabs: Tab[] = [
    {
      id: "individual",
      label: "Metas individuais",
      content: (
        <IndividualGoalsFarol
          goals={goalRows}
          canManageOthers={canSeeMultiple}
          canCreateGoals={canCreateGoals}
          isAdmin={isAdmin}
          podeMetaPropria={role === "manager"}
          reportIds={reportIds}
          currentUserId={user.id}
          members={members}
          departments={departments}
          subdepartments={subdepartments}
          rvTimelines={rvTimelines}
          rvDias={rvDias}
          regrasRedutor={regrasRedutor}
          periodosFechados={periodosFechados}
          rvCongelados={rvCongelados}
          canLockPeriod={isAdmin}
        />
      ),
    },
    {
      id: "area",
      label: "Metas da área",
      content: (
        <AreaGoalsFarol
          goals={areaRows}
          departments={areaDepartments}
          subdepartments={areaSubdepartments}
          units={unitScope.units}
          members={areaMembers}
          isAdmin={isAdmin}
          // metas da ÁREA: quem lidera também CADASTRA (Gerencial e Gestor), e
          // edita ou exclui o que cadastrou. Mexer no indicador dos outros
          // continua sendo da administração, como diz a RLS.
          podeCriarIndicador={isAdmin || role === "manager" || role === "team_lead"}
          currentUserId={user.id}
          scopedUnitId={unitScope.activeUnitId}
          unidadesExtras={unidadesExtras}
          deptPadrao={deptPadrao}
          subPadrao={subPadrao}
        />
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Metas" subtitle="Acompanhe o farol de metas individuais e da área." />
      <Tabs tabs={tabs} />
    </div>
  );
}
