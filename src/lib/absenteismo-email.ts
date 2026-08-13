import { createServiceClient } from "@/lib/supabase/admin";
import { getPlatformResend } from "@/lib/platform-integrations";
import { sendMail } from "@/lib/mailer";

/**
 * O comunicado de absenteísmo.
 *
 * ESTE ARQUIVO NÃO TEM "use server", e isso é deliberado, pelo mesmo motivo que
 * `src/lib/invites.ts` documenta: exportar estas funções de um arquivo
 * `"use server"` as publicaria como endpoint chamável por qualquer usuário
 * logado, e esta abre service client, aceita um id qualquer e manda e-mail para
 * terceiros. Aqui ela é função interna de servidor, alcançável só por quem já
 * passou pelas actions de `src/lib/actions/absenteismos.ts`.
 *
 * O QUE O E-MAIL NUNCA LEVA: CID, descrição do CID, nome ou registro do
 * profissional, hospital, data de emissão, o anexo, CPF, salário. E-mail sai da
 * empresa (portaria, contabilidade, terceirizada), fica em caixa postal alheia e
 * é encaminhado sem controle: é o pior lugar possível para dado de saúde.
 *
 * Para que isso seja impossível e não apenas evitado, a montagem do HTML lê
 * SOMENTE de `absenteismo_lancamentos` e nunca recebe o registro de
 * `absenteismo_atestados` como parâmetro.
 */

export type EventoComunicado = "aberto" | "confirmado" | "aprovado" | "reprovado" | "reenvio";

export type ResultadoComunicado = {
  status: "sent" | "failed" | "skipped";
  destinatarios: number;
  error?: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** dd/mm/aaaa a partir de "aaaa-mm-dd", sem passar por Date (fuso não interessa aqui). */
function dataBr(iso: string | null): string {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return d && m && a ? `${d}/${m}/${a}` : iso;
}

type Linha = {
  id: string;
  tenant_id: string;
  status: string;
  occurred_on: string;
  reason_note: string | null;
  snap_type_name: string | null;
  start_date: string | null;
  end_date: string | null;
  snap_full_name: string | null;
  snap_employee_code: string | null;
  snap_department_name: string | null;
  snap_subdepartment_name: string | null;
  snap_position_name: string | null;
  snap_manager_name: string | null;
  snap_unit_id: string | null;
  snap_unit_name: string | null;
  created_by: string;
  decision_note: string | null;
};

function assunto(evento: EventoComunicado, l: Linha): string {
  const quem = l.snap_full_name ?? "Colaborador";
  const dia = dataBr(l.occurred_on);
  if (evento === "aprovado") return `Absenteísmo aprovado: ${quem} em ${dia}`;
  if (evento === "reprovado") return `Absenteísmo reprovado: ${quem} em ${dia}`;
  if (evento === "confirmado") return `Motivo confirmado: ${quem} em ${dia}`;
  return `Não comparecimento: ${quem} em ${dia}`;
}

function corpo(evento: EventoComunicado, l: Linha, empresa: string, autor: string, appUrl: string): string {
  const linhas: [string, string][] = [
    ["Colaborador", l.snap_full_name ?? "-"],
    ["Matrícula", l.snap_employee_code ?? "-"],
    ["Setor", [l.snap_department_name, l.snap_subdepartment_name].filter(Boolean).join(" / ") || "-"],
    ["Função", l.snap_position_name ?? "-"],
    ["Gestor imediato", l.snap_manager_name ?? "-"],
    ["Unidade", l.snap_unit_name ?? "-"],
    ["Dia do não comparecimento", dataBr(l.occurred_on)],
  ];

  if (evento !== "aberto") {
    linhas.push(["Motivo informado", l.snap_type_name ?? "-"]);
    if (l.start_date && l.end_date) {
      linhas.push(["Período", `${dataBr(l.start_date)} a ${dataBr(l.end_date)}`]);
    }
  }
  linhas.push(["Lançado por", autor]);

  const situacao =
    evento === "aberto"
      ? "Situação ainda não confirmada. O motivo será informado quando o gestor confirmar o lançamento."
      : evento === "confirmado"
        ? "O gestor confirmou o motivo e enviou o lançamento para aprovação do RH. Ainda não vale como ausência."
        : evento === "aprovado"
          ? "O RH aprovou o lançamento, que passa a valer como ausência registrada."
          : "O RH reprovou o lançamento, que não vale como ausência.";

  const nota = evento === "reprovado" && l.decision_note
    ? `<p style="margin:0 0 12px"><strong>Motivo da reprovação:</strong> ${escapeHtml(l.decision_note)}</p>`
    : "";

  const observacao = evento === "aberto" && l.reason_note
    ? `<p style="margin:0 0 12px"><strong>Observação do gestor:</strong> ${escapeHtml(l.reason_note)}</p>`
    : "";

  const celulas = linhas
    .map(([r, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#555;white-space:nowrap">${escapeHtml(r)}</td><td style="padding:4px 0"><strong>${escapeHtml(v)}</strong></td></tr>`)
    .join("");

  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;line-height:1.5">
  <p style="margin:0 0 4px;font-size:16px;font-weight:bold">${escapeHtml(empresa)}</p>
  <p style="margin:0 0 16px;color:#555">${escapeHtml(assunto(evento, l))}</p>
  <table style="border-collapse:collapse;margin:0 0 16px">${celulas}</table>
  <p style="margin:0 0 12px">${escapeHtml(situacao)}</p>
  ${observacao}
  ${nota}
  <p style="margin:0 0 12px"><a href="${escapeHtml(appUrl)}/absenteismos">Abrir no MANAGER HUB</a></p>
  <p style="margin:16px 0 0;color:#777;font-size:12px">Comunicação automática do MANAGER HUB. Dados de atestado, quando houver, ficam apenas no sistema.</p>
</div>`;
}

/**
 * Dispara o comunicado e registra a tentativa.
 *
 * Nunca lança: o lançamento já foi gravado, e o e-mail é acessório. O retorno
 * serve para a action decidir se põe um `warning` na tela.
 */
export async function dispatchComunicadoAbsenteismo(
  lancamentoId: string,
  evento: EventoComunicado,
  atorId?: string,
): Promise<ResultadoComunicado> {
  const admin = createServiceClient();

  const registrar = async (
    tenantId: string,
    status: "sent" | "failed" | "skipped",
    destinatarios: string[],
    error?: string,
  ) => {
    await admin.from("absenteismo_emails").insert({
      tenant_id: tenantId,
      lancamento_id: lancamentoId,
      event: evento,
      to_emails: destinatarios,
      status,
      error: error ?? null,
      sent_by: atorId ?? null,
    });
    await admin
      .from("absenteismo_lancamentos")
      .update({ email_status: status, email_at: new Date().toISOString() })
      .eq("id", lancamentoId);
  };

  try {
    const { data: l } = await admin
      .from("absenteismo_lancamentos")
      .select("*")
      .eq("id", lancamentoId)
      .maybeSingle();
    if (!l) return { status: "skipped", destinatarios: 0, error: "lançamento não encontrado" };

    const linha = l as unknown as Linha;

    const [{ data: destinos }, { data: empresa }, { data: autor }, { apiKey }] = await Promise.all([
      admin
        .from("absenteismo_email_recipients")
        .select("email, unit_id")
        .eq("tenant_id", linha.tenant_id)
        .eq("active", true),
      admin.from("tenants").select("name").eq("id", linha.tenant_id).maybeSingle(),
      admin.from("profiles").select("full_name, email").eq("id", linha.created_by).maybeSingle(),
      getPlatformResend(),
    ]);

    // Sem unidade cadastrada, recebe de todas; com unidade, só o que bate com a
    // unidade CARIMBADA no lançamento.
    const emails = [...new Set(
      (destinos ?? [])
        .filter((d) => !d.unit_id || d.unit_id === linha.snap_unit_id)
        .map((d) => d.email.trim().toLowerCase()),
    )];

    if (!apiKey) {
      await registrar(linha.tenant_id, "skipped", emails, "integração de e-mail não configurada");
      return { status: "skipped", destinatarios: emails.length, error: "integração de e-mail não configurada" };
    }
    if (emails.length === 0) {
      await registrar(linha.tenant_id, "skipped", [], "nenhum destinatário cadastrado");
      return { status: "skipped", destinatarios: 0, error: "nenhum destinatário cadastrado" };
    }

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://managerhub.app").replace(/\/+$/, "");
    const r = await sendMail({
      apiKey,
      to: emails,
      subject: assunto(evento, linha),
      html: corpo(evento, linha, empresa?.name ?? "MANAGER HUB", autor?.full_name ?? "gestor", appUrl),
      replyTo: autor?.email ?? undefined,
    });

    await registrar(linha.tenant_id, r.ok ? "sent" : "failed", emails, r.error);
    return { status: r.ok ? "sent" : "failed", destinatarios: emails.length, error: r.error };
  } catch (e) {
    console.error("[absenteismo-email] falhou:", (e as Error).message);
    return { status: "failed", destinatarios: 0, error: (e as Error).message };
  }
}
