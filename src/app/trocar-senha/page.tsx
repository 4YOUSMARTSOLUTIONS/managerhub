import { redirect } from "next/navigation";
import { getAuthUser, trocaDeSenhaPendente } from "@/lib/auth-cache";
import { signOut } from "@/lib/actions/auth";
import { AuthShell } from "@/components/AuthShell";
import { TrocaObrigatoriaForm } from "@/components/TrocaObrigatoriaForm";

/**
 * Troca obrigatória da senha cadastrada pela administração.
 *
 * Rota própria, fora do grupo `(app)`, como `/suspenso` e `/onboarding`: um
 * modal exigiria renderizar o layout autenticado, que pode desviar para outra
 * tela antes de o modal aparecer, e ainda mostraria por trás justamente o
 * sistema que a pessoa ainda não deveria estar usando.
 *
 * A regra que evita laço de redirect está no `||` abaixo: a tela só devolve o
 * usuário ao sistema quando as DUAS leituras concordam que não há pendência. A
 * claim do token pode estar velha (ela vale por um TTL) e o banco pode ter sido
 * marcado agora; em qualquer discordância, o formulário fica. Como o proxy e o
 * layout só sabem empurrar PARA cá, e daqui só se sai com tudo limpo, não existe
 * ciclo possível.
 */
export default async function TrocarSenhaPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const pendente = user.trocaPendente || (await trocaDeSenhaPendente());
  if (!pendente) redirect("/dashboard");

  return (
    <AuthShell
      title="Defina sua senha"
      subtitle="Sua senha atual foi cadastrada pela administração. Escolha uma senha só sua para continuar."
    >
      <TrocaObrigatoriaForm />
      <form action={signOut} style={{ marginTop: "0.9rem" }}>
        <button className="btn btn-ghost" type="submit" style={{ width: "100%" }}>
          Sair
        </button>
      </form>
    </AuthShell>
  );
}
