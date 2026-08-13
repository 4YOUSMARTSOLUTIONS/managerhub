// Envio de e-mail transacional via Resend (HTTP API).
// No-op silencioso quando a chave não está configurada — nunca deve quebrar o fluxo.

import type { IcsMethod } from "./ics";

export const ORGANIZER_EMAIL = "noreply@4yousmartsolutions.com.br";
export const INVITE_FROM = `MANAGER HUB <${ORGANIZER_EMAIL}>`;

type Anexo = { filename: string; content: string; content_type: string };

/**
 * A ida ao Resend, num lugar só.
 *
 * Devolve o erro em texto em vez de só um booleano porque quem chama agora
 * guarda esse motivo: sem fila, sem retry e sem retorno de bounce, o registro do
 * que deu errado é a única pista que sobra quando alguém disser "não recebi".
 */
async function postResend(
  apiKey: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const corpo = await resp.text().catch(() => "");
      console.error("[mailer] Resend falhou:", resp.status, corpo);
      return { ok: false, error: `${resp.status} ${corpo}`.trim().slice(0, 300) };
    }
    return { ok: true };
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[mailer] erro ao enviar:", msg);
    return { ok: false, error: msg.slice(0, 300) };
  }
}

export type SendInviteInput = {
  apiKey: string;
  to: string[];
  subject: string;
  html: string;
  ics: string;
  method: IcsMethod;
};

/** Envia o convite (.ics) por e-mail via Resend. Retorna true se enviou, false se pulou/falhou. */
export async function sendInvite(input: SendInviteInput): Promise<boolean> {
  const apiKey = input.apiKey?.trim();
  if (!apiKey) return false; // e-mail não configurado — segue sem enviar
  const to = input.to.filter((e) => e && e.includes("@"));
  if (to.length === 0) return false;

  const anexos: Anexo[] = [
    {
      filename: "invite.ics",
      content: Buffer.from(input.ics, "utf-8").toString("base64"),
      content_type: `text/calendar; charset=utf-8; method=${input.method}`,
    },
  ];

  const { ok } = await postResend(apiKey, {
    from: INVITE_FROM,
    to,
    subject: input.subject,
    html: input.html,
    attachments: anexos,
  });
  return ok;
}

export type SendMailInput = {
  apiKey: string;
  to: string[];
  subject: string;
  html: string;
  /** para quem responder: sem isto a resposta cai em `noreply@` e morre */
  replyTo?: string;
};

/**
 * E-mail simples, sem anexo de calendário.
 *
 * `sendInvite` sempre anexa um `.ics`, e um comunicado de não comparecimento com
 * anexo de calendário é lixo na caixa de quem recebe. Daí a segunda porta, em
 * vez de tornar o anexo opcional lá: convite e comunicado têm exigências
 * diferentes, e misturá-las faria a assinatura mentir sobre as duas.
 */
export async function sendMail(input: SendMailInput): Promise<{ ok: boolean; error?: string }> {
  const apiKey = input.apiKey?.trim();
  if (!apiKey) return { ok: false, error: "integração de e-mail não configurada" };
  const to = [...new Set(input.to.map((e) => e.trim().toLowerCase()))].filter((e) => e && e.includes("@"));
  if (to.length === 0) return { ok: false, error: "sem destinatário" };

  return postResend(apiKey, {
    from: INVITE_FROM,
    to,
    subject: input.subject,
    html: input.html,
    ...(input.replyTo ? { reply_to: input.replyTo } : {}),
  });
}
