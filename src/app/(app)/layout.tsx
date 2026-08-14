import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireContext } from "@/lib/tenant";
import { checkSuperAdmin } from "@/lib/platform";
import { getTheme } from "@/lib/theme";
import { getModuleAccess } from "@/lib/module-access";
import { getAvatarMap } from "@/lib/avatars";
import { getAuthUser, getOwnIdentity, trocaDeSenhaPendente } from "@/lib/auth-cache";
import { getConversas, getPreferencias } from "@/lib/actions/chat";
import { AppShell } from "@/components/AppShell";
import { MODULES, type ModuleKey, type ModuleState } from "@/lib/modules";

// moduleState só-core (usado apenas no shell reduzido, quando não há empresa)
const CORE_ONLY_STATE = Object.fromEntries(
  MODULES.map((m) => [m.key, m.core ? "on" : "hidden"]),
) as Record<ModuleKey, ModuleState>;

/**
 * O próprio usuário SEMPRE entra no mapa de fotos.
 *
 * `getAvatarMap` monta o mapa a partir das `memberships` da empresa, e quem não
 * é membro dela fica de fora: é o caso do owner de plataforma, que administra o
 * sistema sem pertencer a nenhuma empresa. Ele via a própria foto sumir do menu
 * e caía nas iniciais, sem erro nenhum na tela, porque a ausência no mapa é
 * indistinguível de "não tem foto".
 */
const proprioAvatar = (userId: string, path: string | null | undefined): Record<string, string> =>
  path ? { [userId]: path } : {};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 1º estágio: identidade, tema e papel de plataforma, tudo junto. Antes eram três
  // esperas em fila, e o getUser/is_super_admin ainda se repetiam dentro do
  // requireContext logo abaixo (agora compartilhados por auth-cache).
  const [user, theme, isSuperAdmin, trocaPendente] = await Promise.all([
    getAuthUser(),
    getTheme(),
    checkSuperAdmin(),
    trocaDeSenhaPendente(),
  ]);
  if (!user) redirect("/login");

  /**
   * Senha ainda é a que a administração cadastrou: nenhuma tela antes da troca.
   *
   * Fica AQUI, acima do ramo do super admin sem empresa e do requireContext,
   * porque os dois saem cedo: uma guarda mais abaixo deixaria o super admin
   * passar. A leitura é autoritativa (vai ao banco, em paralelo com o
   * checkSuperAdmin que já era uma RPC), então pega inclusive o reset que um
   * administrador acabou de fazer, sem esperar o token expirar.
   */
  if (trocaPendente) redirect("/trocar-senha");

  // Super admin sem NENHUMA empresa no sistema: shell reduzido, só o Painel ADM.
  if (isSuperAdmin) {
    // createClient só lê cookies, não vai à rede; fica no ramo que precisa dele
    const supabase = await createClient();
    const { data: activeId } = await supabase.rpc("my_active_tenant");
    if (!activeId) {
      const perfil = await getOwnIdentity(user.id);
      return (
        <AppShell
          role="owner"
          isSuperAdmin
          tenantName="Plataforma"
          userName={perfil?.full_name?.trim() || user.email?.split("@")[0] || "Owner"}
          unitScope={{ units: [], allowedUnitIds: [], unrestricted: true, activeUnitId: null, locked: false }}
          theme={theme}
          moduleState={CORE_ONLY_STATE}
          construction={[]}
          platformOnly
          avatars={proprioAvatar(user.id, perfil?.avatar_url)}
          currentUserId={user.id}
        >
          {children}
        </AppShell>
      );
    }
  }

  // 2º estágio: o contexto da empresa, do qual o resto depende.
  const ctx = await requireContext();

  // 3º estágio: o que depende só do tenant/usuário, tudo junto.
  const [{ state: moduleState, construction }, avatars, perfil, prefsChat] = await Promise.all([
    getModuleAccess(),
    getAvatarMap(ctx.tenant.id),
    getOwnIdentity(user.id),
    getPreferencias(),
  ]);

  /**
   * O chat inteiro (presença, tempo real e o balão do canto) vive no shell, e
   * não só na tela dele: quem está em outra tela continua conectado para os
   * colegas, o menu mostra o próprio status e a mensagem nova chega em
   * qualquer lugar do sistema. Por isso a lista de conversas é carregada aqui,
   * na mesma leva das outras consultas do layout.
   */
  const chatLigado = moduleState.chat === "on";
  const chatConversas = chatLigado ? await getConversas() : [];

  // o nome real vem do cadastro; o prefixo do e-mail é só a reserva de quem ainda
  // não tem full_name (e rende uma inicial só: "luiz.nobre" vira "l")
  const userName = perfil?.full_name?.trim() || user.email?.split("@")[0] || "Usuário";

  return (
    <AppShell
      role={ctx.role}
      isSuperAdmin={ctx.isSuperAdmin}
      tenantName={ctx.tenant.name}
      userName={userName}
      unitScope={ctx.unitScope}
      theme={theme}
      moduleState={moduleState}
      construction={[...construction]}
      companyScope={ctx.companyScope}
      // o próprio por último: o super admin administra uma empresa da qual não
      // é membro, e sem isto some do mapa e perde a própria foto no menu
      avatars={{ ...avatars, ...proprioAvatar(user.id, perfil?.avatar_url) }}
      currentUserId={user.id}
      chatTenantId={chatLigado ? ctx.tenant.id : null}
      chatStatus={prefsChat.status}
      chatConversas={chatConversas}
      chatNotificacoes={prefsChat.notificacoes}
      chatSom={prefsChat.som}
    >
      {children}
    </AppShell>
  );
}
