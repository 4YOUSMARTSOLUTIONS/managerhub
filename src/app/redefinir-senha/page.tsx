import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { RedefinirSenhaForm } from "@/components/RedefinirSenhaForm";

/**
 * Destino do link enviado por e-mail.
 *
 * A página NÃO valida o token: ela só o entrega ao formulário. Quem valida é a
 * action, no envio. Isso é de propósito — o token é de uso único, e gastá-lo na
 * abertura faria com que qualquer filtro de e-mail corporativo que varre links
 * queimasse o link antes de a pessoa clicar.
 *
 * Rota pública, como `/esqueci-senha`: quem chega aqui, por definição, não
 * consegue entrar. E ela também precisa ficar livre do gate de troca obrigatória
 * de senha (ver `src/lib/supabase/middleware.ts`): quase toda conta do sistema
 * nasce com essa pendência, e sem a isenção quem tem sessão viva no celular
 * cairia em `/trocar-senha`, que pede a senha atual — exatamente a que a pessoa
 * não sabe.
 */
export default async function RedefinirSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const token = (t ?? "").trim();

  if (!token) {
    return (
      <AuthShell
        title="Link inválido"
        subtitle="Este endereço não tem um código de recuperação válido."
        footer={<Link href="/login">Voltar para a tela de acesso</Link>}
      >
        <p className="muted" style={{ margin: 0, fontSize: "0.875rem", lineHeight: 1.55 }}>
          Abra o link direto do e-mail que você recebeu. Se ele já foi usado ou
          expirou, peça outro em{" "}
          <Link href="/esqueci-senha">Recuperar senha</Link>.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Defina sua nova senha"
      subtitle="Escolha uma senha só sua. Ao salvar, você já entra no sistema."
      footer={<Link href="/login">Voltar para a tela de acesso</Link>}
    >
      <RedefinirSenhaForm token={token} />
    </AuthShell>
  );
}
