// Envio de e-mail transacional via Resend (HTTP API).
// No-op silencioso quando RESEND_API_KEY não está configurada — nunca deve quebrar o fluxo.

import type { IcsMethod } from "./ics";

export const ORGANIZER_EMAIL = "noreply@4yousmartsolutions.com.br";
export const INVITE_FROM = `MANAGER HUB <${ORGANIZER_EMAIL}>`;

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

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: INVITE_FROM,
        to,
        subject: input.subject,
        html: input.html,
        attachments: [
          {
            filename: "invite.ics",
            content: Buffer.from(input.ics, "utf-8").toString("base64"),
            content_type: `text/calendar; charset=utf-8; method=${input.method}`,
          },
        ],
      }),
    });
    if (!resp.ok) {
      console.error("[mailer] Resend falhou:", resp.status, await resp.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[mailer] erro ao enviar convite:", (e as Error).message);
    return false;
  }
}
