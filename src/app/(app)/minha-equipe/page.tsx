import { requireContext } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { minhaEquipe } from "@/lib/team";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Tabs, type Tab } from "@/components/ui/Tabs";
import { TeamList, type TeamMember } from "@/components/TeamList";
import { TeamOrgChart } from "@/components/TeamOrgChart";

/**
 * "Minha equipe": a ficha de quem está abaixo do Gestor no organograma.
 *
 * Existe porque Colaboradores mora em Configurações, que é `minRole: "admin"`, e
 * o Gestor não alcança. Aqui ele vê o mesmo recorte que a RLS já lhe concede nas
 * demais telas, com nome, função, setor, admissão e situação.
 *
 * Módulo `core`, então NÃO passa por `moduleGate` (que recusa módulo base). A
 * guarda de papel é feita aqui, no mesmo formato de /auditoria.
 *
 * CPF, telefone e nascimento ficam DE FORA. Não é decisão de tela: essas colunas
 * foram revogadas de `authenticated` por privilégio de coluna (ver AGENTS.md), e
 * um `.select("cpf")` aqui quebraria na compilação, que é o efeito pretendido.
 */
export default async function MinhaEquipePage() {
  const { tenant, role, user } = await requireContext();
  const podeVer = role === "owner" || role === "admin" || role === "manager" || role === "team_lead";

  if (!podeVer) {
    return (
      <div>
        <PageHeader title="Minha equipe" />
        <EmptyState title="Acesso restrito" description="Apenas quem tem perfil de Gestor ou superior acompanha uma equipe por aqui." />
      </div>
    );
  }

  const supabase = await createClient();
  const equipe = await minhaEquipe(supabase, tenant.id);

  if (equipe.length === 0) {
    return (
      <div>
        <PageHeader title="Minha equipe" subtitle={tenant.name} />
        <EmptyState
          title="Ninguém responde a você ainda"
          description="Assim que colaboradores forem vinculados a você como gestor, eles aparecem aqui. O vínculo é definido no cadastro do colaborador, em Configurações."
        />
      </div>
    );
  }

  const setor = new Set(equipe);

  // Sem `.in("user_id", equipe)` de propósito: um gestor de topo pode ter
  // centenas de liderados, e a lista de UUIDs na URL estoura o limite do
  // PostgREST (vira HTTP 400). A leitura da empresa é a mesma que a tela de
  // Colaboradores já faz, e o recorte acontece aqui em memória.
  //
  // O hint `!memberships_user_id_fkey` é obrigatório: memberships tem DUAS
  // chaves para profiles (user_id e manager_id) e sem ele a consulta falha.
  // Catálogos vêm como mapas por id, e não como embed, porque `memberships` não
  // declara essas relações no PostgREST. É o mesmo caminho que a tela de
  // Colaboradores já usa, então não invento um segundo jeito de fazer o mesmo.
  const [{ data: vinculos }, { data: deps }, { data: subs }, { data: cargos }, { data: niveis }, { data: hierarquias }, { data: perfis }] =
    await Promise.all([
      supabase
        .from("memberships")
        .select("user_id, employee_code, admission_date, is_active, manager_id, role, department_id, subdepartment_id, position_id, position_level_id, hierarchy_level_id")
        .eq("tenant_id", tenant.id),
      supabase.from("departments").select("id, name").eq("tenant_id", tenant.id),
      supabase.from("subdepartments").select("id, name").eq("tenant_id", tenant.id),
      supabase.from("positions").select("id, name").eq("tenant_id", tenant.id),
      supabase.from("position_levels").select("id, name").eq("tenant_id", tenant.id),
      // o `rank` entra por causa do organograma: é ele que ordena os irmãos por
      // senioridade (menor = mais alto), em vez de alfabeticamente
      supabase.from("hierarchy_levels").select("id, name, rank").eq("tenant_id", tenant.id),
      // só as colunas que `authenticated` tem privilégio de ler (ver AGENTS.md)
      supabase.from("profiles").select("id, full_name, email, avatar_url"),
    ]);

  const nome = new Map((deps ?? []).map((d) => [d.id, d.name]));
  const nomeSub = new Map((subs ?? []).map((s) => [s.id, s.name]));
  const nomeCargo = new Map((cargos ?? []).map((p) => [p.id, p.name]));
  const nomeNivel = new Map((niveis ?? []).map((l) => [l.id, l.name]));
  const nomeHier = new Map((hierarquias ?? []).map((h) => [h.id, h.name]));
  const rankHier = new Map((hierarquias ?? []).map((h) => [h.id, h.rank]));
  const perfilPorId = new Map((perfis ?? []).map((p) => [p.id, p]));

  type Vinculo = NonNullable<typeof vinculos>[number];
  const paraMembro = (v: Vinculo): TeamMember => ({
    userId: v.user_id,
    fullName: perfilPorId.get(v.user_id)?.full_name ?? null,
    email: perfilPorId.get(v.user_id)?.email ?? null,
    avatarUrl: perfilPorId.get(v.user_id)?.avatar_url ?? null,
    employeeCode: v.employee_code,
    admissionDate: v.admission_date,
    active: v.is_active,
    role: v.role,
    departmentName: v.department_id ? nome.get(v.department_id) ?? null : null,
    subdepartmentName: v.subdepartment_id ? nomeSub.get(v.subdepartment_id) ?? null : null,
    positionName: v.position_id ? nomeCargo.get(v.position_id) ?? null : null,
    levelName: v.position_level_id ? nomeNivel.get(v.position_level_id) ?? null : null,
    hierarchyName: v.hierarchy_level_id ? nomeHier.get(v.hierarchy_level_id) ?? null : null,
    hierarchyRank: v.hierarchy_level_id ? rankHier.get(v.hierarchy_level_id) ?? null : null,
    // quem é o chefe direto: com a cadeia inteira à vista, sem isso não dá
    // para saber se a pessoa responde ao Gestor ou a alguém no meio
    managerName: v.manager_id ? perfilPorId.get(v.manager_id)?.full_name ?? null : null,
    managerId: v.manager_id,
  });

  const membros: TeamMember[] = (vinculos ?? [])
    .filter((v) => setor.has(v.user_id))
    .map(paraMembro)
    .sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? "", "pt-BR"));

  // A RAIZ do organograma é quem está olhando.
  //
  // `minhaEquipe()` devolve só quem está ABAIXO, então o próprio usuário fica de
  // fora de `membros` — e tem de continuar fora, senão a tabela passaria a listar
  // a si mesmo e o contador do cabeçalho mudaria. Vem do mesmo array já em
  // memória, sem consulta nova.
  //
  // O ramo de fallback cobre o super admin operando numa empresa onde ele não
  // tem vínculo: sem ele a árvore ficaria sem raiz e a aba abriria vazia.
  const meuVinculo = (vinculos ?? []).find((v) => v.user_id === user.id);
  const raiz: TeamMember = meuVinculo
    ? paraMembro(meuVinculo)
    : {
        userId: user.id,
        fullName: perfilPorId.get(user.id)?.full_name ?? user.email ?? null,
        email: user.email ?? null,
        avatarUrl: perfilPorId.get(user.id)?.avatar_url ?? null,
        employeeCode: null,
        admissionDate: null,
        active: true,
        role,
        departmentName: null,
        subdepartmentName: null,
        positionName: null,
        levelName: null,
        hierarchyName: null,
        hierarchyRank: null,
        managerName: null,
        managerId: null,
      };

  // Organograma em primeiro: é a leitura que a tela promete ("quem responde a
  // quem"), e `Tabs` sem `initialId` abre a primeira. A Lista fica ao lado, para
  // quem precisa da ficha cadastral. `Tabs` só monta a aba ativa, então quem
  // ficar no organograma nem carrega a tabela.
  const abas: Tab[] = [
    { id: "organograma", label: "Organograma", content: <TeamOrgChart members={membros} raiz={raiz} /> },
    { id: "lista", label: "Lista", content: <TeamList members={membros} /> },
  ];

  return (
    <div>
      <PageHeader title="Minha equipe" subtitle={`${membros.length} pessoa(s) sob sua gestão, incluindo níveis indiretos`} />
      <Tabs tabs={abas} />
    </div>
  );
}
