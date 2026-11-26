/**
 * Equipes do setor para quem tem SÓ a marca "Ajusta equipes do setor"
 * (LUIZ, 26/11/2026). Essa pessoa entra em Configurações por um caminho
 * próprio, como a Área de Gente: aqui ela vê apenas a subaba de equipes, do
 * próprio setor. Nenhuma consulta das outras abas sai para ela: nada de
 * cadastro nem de dados pessoais.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Tabs } from "@/components/ui/Tabs";
import { EquipesDoSetorManager, type PessoaDaEquipe } from "@/components/EquipesDoSetorManager";
import { fetchAll } from "@/lib/supabase/fetch-all";

export async function EquipesDoSetorSoMarca({ supabase, tenantId, userId }: {
  supabase: SupabaseClient<Database>;
  tenantId: string;
  userId: string;
}) {
  const { data: eu } = await supabase
    .from("memberships").select("department_id")
    .eq("tenant_id", tenantId).eq("user_id", userId).eq("is_active", true).maybeSingle();
  const setorId = eu?.department_id ?? null;
  if (!setorId) {
    return (
      <div>
        <PageHeader title="Configurações" />
        <EmptyState title="Seu cadastro não tem setor" description="Peça ao departamento pessoal para completar a sua ficha: as equipes que você ajusta são as do seu setor." />
      </div>
    );
  }

  const [{ data: mems }, { data: setor }, { data: subs }, { data: cargos }, { data: unidades }, { data: regras }, { data: config }] = await Promise.all([
    fetchAll(() => supabase
      .from("memberships")
      .select("id, user_id, employee_code, department_id, subdepartment_id, position_id, manager_id, profiles!memberships_user_id_fkey(full_name)")
      .eq("tenant_id", tenantId).eq("department_id", setorId).eq("is_active", true)
      .order("id")),
    supabase.from("departments").select("id, name").eq("id", setorId).maybeSingle(),
    supabase.from("subdepartments").select("id, name, department_id, active").eq("tenant_id", tenantId).eq("department_id", setorId),
    supabase.from("positions").select("id, name").eq("tenant_id", tenantId),
    supabase.from("units").select("id, name").eq("tenant_id", tenantId),
    supabase.from("regra_subsetor_gestor").select("subdepartment_id, unit_id, manager_id").eq("tenant_id", tenantId),
    supabase.from("equipe_setor_config").select("funcoes").eq("tenant_id", tenantId).eq("department_id", setorId).maybeSingle(),
  ]);

  const lista = mems ?? [];
  // o gestor pode estar fora do setor (ex.: a diretoria): o nome vem à parte,
  // junto das unidades de cada vínculo (o setor tem dezenas de pessoas, não centenas)
  const gestorIds = [...new Set(lista.map((m) => m.manager_id).filter((x): x is string => !!x))];
  const [{ data: gestores }, { data: vinculosUnidades }] = await Promise.all([
    gestorIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", gestorIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    lista.length
      ? supabase.from("membership_units").select("membership_id, unit_id").in("membership_id", lista.map((m) => m.id))
      : Promise.resolve({ data: [] as { membership_id: string; unit_id: string }[] }),
  ]);
  const unidadesDoVinculo = new Map<string, string[]>();
  for (const v of vinculosUnidades ?? []) {
    unidadesDoVinculo.set(v.membership_id, [...(unidadesDoVinculo.get(v.membership_id) ?? []), v.unit_id]);
  }

  const nomeGestor = new Map((gestores ?? []).map((g) => [g.id, g.full_name]));
  const nomeCargo = new Map((cargos ?? []).map((c) => [c.id, c.name]));
  const nomeSub = new Map((subs ?? []).map((s) => [s.id, s.name]));
  const nomeUnidade = new Map((unidades ?? []).map((u) => [u.id, u.name]));

  const pessoas: PessoaDaEquipe[] = lista.map((m) => {
    const perfil = m.profiles as unknown as { full_name: string | null } | null;
    return {
      membershipId: m.id,
      userId: m.user_id,
      nome: perfil?.full_name ?? "Sem nome",
      matricula: m.employee_code,
      funcao: m.position_id ? nomeCargo.get(m.position_id) ?? null : null,
      setorId: m.department_id,
      subsetorId: m.subdepartment_id,
      subsetorNome: m.subdepartment_id ? nomeSub.get(m.subdepartment_id) ?? null : null,
      gestorId: m.manager_id,
      gestorNome: m.manager_id ? nomeGestor.get(m.manager_id) ?? null : null,
      unidades: (unidadesDoVinculo.get(m.id) ?? []).map((u) => nomeUnidade.get(u)).filter((x): x is string => !!x),
    };
  });

  return (
    <div>
      <PageHeader title="Configurações" subtitle={`Equipes do setor ${setor?.name ?? ""}`.trim()} />
      <Tabs
        variant="sub"
        tabs={[{
          id: "equipes",
          label: "Equipes do setor",
          content: (
            <EquipesDoSetorManager
              pessoas={pessoas}
              setores={setor ? [{ id: setor.id, name: setor.name }] : []}
              subsetores={(subs ?? []).filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, setorId: s.department_id }))}
              regrasSubsetor={(regras ?? []).map((r) => ({ subsetorId: r.subdepartment_id, unidade: nomeUnidade.get(r.unit_id) ?? "", gestorId: r.manager_id }))}
              setorInicial={setorId}
              setorFixo
              meuUserId={userId}
              funcoesDaCarteira={{ [setorId]: config?.funcoes ?? [] }}
              podeConfigurar={false}
            />
          ),
        }]}
      />
    </div>
  );
}
