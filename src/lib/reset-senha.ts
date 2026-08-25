/**
 * A recuperação de senha, do pedido ao e-mail.
 *
 * Este módulo NÃO tem "use server", e é deliberado, pelo mesmo motivo que
 * `src/lib/invites.ts` e `src/lib/auth-throttle.ts` documentam: exportar estas
 * funções de um arquivo "use server" as publicaria como ENDPOINT chamável por
 * qualquer um. E esta abre service client, resolve identidade de terceiro e
 * dispara e-mail. Aqui é função interna de servidor, alcançável só por quem
 * passou pela action de `src/lib/actions/recuperacao.ts`.
 *
 * DOIS E-MAILS DIFERENTES, e confundi-los é o modo de falha central daqui:
 *   `authEmail` -> a chave de autenticação (`auth.users.email`). É o que o
 *                  `generateLink` exige, e para 21% do quadro é um endereço
 *                  fabricado (`<cpf>@cpf.managerhub.local`) que não existe.
 *   `destino`   -> para onde a mensagem vai de fato. Quem decide é a RPC
 *                  `destino_de_recuperacao`, porque a regra depende de colunas
 *                  que a chave pública não alcança.
 *
 * O TOKEN é do GoTrue, não nosso. `generateLink` devolve um `hashed_token` que o
 * `verifyOtp` consome uma vez só. A alternativa (tabela de token própria) exigiria
 * uma função pré-login capaz de reescrever a senha de qualquer usuário — a coisa
 * mais perigosa que caberia em `public`, e exatamente o que a primeira seção do
 * AGENTS.md existe para impedir.
 */

import { createServiceClient } from "@/lib/supabase/admin";
import { getPlatformResend } from "@/lib/platform-integrations";
import { sendMail } from "@/lib/mailer";
import { appUrl } from "@/lib/app-url";
import { chaveIdentificador } from "@/lib/auth-throttle";

type Destino = {
  achou: boolean;
  user_id?: string | null;
  auth_email?: string | null;
  destino?: string | null;
  nome?: string | null;
  tenant_id?: string | null;
};

/**
 * A chave do balde de recuperação.
 *
 * Normaliza o CPF ANTES do HMAC: sem isso "123.456.789-00" e "12345678900" caem
 * em baldes diferentes e o freio é evadível só colocando pontos. Feito aqui, e
 * não dentro de `chaveIdentificador`, para não mexer no caminho do login (que
 * tem a mesma fraqueza, registrada à parte) nem zerar os contadores vivos.
 */
export function chaveDeRecuperacao(identificador: string): string {
  const id = identificador.trim().toLowerCase();
  return chaveIdentificador(id.includes("@") ? id : id.replace(/\D/g, ""));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Primeiro nome, para o e-mail não soar com um formulário. */
function primeiroNome(nome: string | null | undefined): string {
  const p = (nome ?? "").trim().split(/\s+/)[0];
  return p ? p.charAt(0) + p.slice(1).toLowerCase() : "";
}

function corpo(nome: string | null | undefined, link: string): string {
  const ola = primeiroNome(nome) ? `Olá, ${escapeHtml(primeiroNome(nome))}.` : "Olá.";
  return `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;line-height:1.6">
  <p style="margin:0 0 1rem">${ola}</p>
  <p style="margin:0 0 1rem">
    Recebemos um pedido para redefinir a sua senha do <strong>MANAGER HUB</strong>.
    Clique no botão abaixo para escolher uma senha nova.
  </p>
  <p style="margin:0 0 1.4rem">
    <a href="${escapeHtml(link)}"
       style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;
              padding:12px 22px;border-radius:8px;font-weight:bold">
      Redefinir minha senha
    </a>
  </p>
  <p style="margin:0 0 1rem;color:#4b5563">
    O link vale por <strong>1 hora</strong> e pode ser usado uma única vez.
    Se você pedir outro link, este deixa de valer.
  </p>
  <p style="margin:0 0 1rem;color:#4b5563">
    Se não foi você quem pediu, ignore esta mensagem: a sua senha continua a mesma.
  </p>
  <p style="margin:1.5rem 0 0;font-size:12px;color:#6b7280">
    Se o botão não funcionar, copie e cole este endereço no navegador:<br />
    <span style="word-break:break-all">${escapeHtml(link)}</span>
  </p>
</div>`.trim();
}

/**
 * Resolve, gera o link e envia. NUNCA lança e NUNCA devolve nada.
 *
 * O retorno `void` é intencional: se a action pudesse ramificar em cima do
 * resultado, a resposta da tela deixaria de ser igual para todos os casos e
 * viraria um oráculo de quem existe na base.
 */
export async function dispararRecuperacao(identificador: string): Promise<void> {
  try {
    const admin = createServiceClient();

    const { data, error } = await admin.rpc("destino_de_recuperacao", {
      p_identificador: identificador,
    });
    if (error) {
      console.error("[reset-senha] destino_de_recuperacao falhou:", error.message);
      return;
    }

    const d = (data ?? null) as Destino | null;
    if (!d?.achou || !d.user_id || !d.auth_email) return;

    // Existe, está ativo, e não tem para onde receber: o departamento pessoal
    // precisa saber, senão a pessoa fica esperando um e-mail que nunca vem e
    // ninguém fica sabendo (a tela responde igual para todo mundo, de propósito).
    if (!d.destino) {
      if (d.tenant_id) {
        await admin.rpc("recuperacao_avisar_dp", { p_user: d.user_id, p_tenant: d.tenant_id });
      }
      return;
    }

    const { data: gerado, error: erroLink } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: d.auth_email,
    });
    const token = gerado?.properties?.hashed_token;
    if (erroLink || !token) {
      console.error("[reset-senha] generateLink falhou:", erroLink?.message ?? "sem token");
      return;
    }

    // O link é NOSSO: aponta para o domínio do app com o token na query. Usar o
    // `action_link` do Supabase levaria a pessoa ao domínio dele, dependeria da
    // allowlist de redirect do painel e devolveria a sessão no fragmento da URL,
    // que o servidor não lê. O `email_otp` (código de 6 dígitos) fica de fora de
    // propósito: seria uma segunda credencial, mais fraca, pela mesma hora.
    const link = `${appUrl()}/redefinir-senha?t=${encodeURIComponent(token)}`;

    const { apiKey } = await getPlatformResend();
    const enviado = await sendMail({
      apiKey,
      to: [d.destino],
      subject: "Redefinição de senha — MANAGER HUB",
      html: corpo(d.nome, link),
    });
    if (!enviado.ok) {
      console.error("[reset-senha] envio falhou:", enviado.error);
    }
  } catch (e) {
    // Falhar aqui não pode virar erro na tela: a resposta ao usuário já saiu, e
    // qualquer diferença de comportamento denunciaria quais contas existem.
    console.error("[reset-senha] erro inesperado:", (e as Error).message);
  }
}
