import { createServiceClient } from "@/lib/supabase/admin";
import { appUrl as origemDoApp } from "@/lib/app-url";
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
 * `absenteismo_atestados` como parâmetro. O alerta de INSS chega como um número
 * (a soma de dias): a RPC olha a categoria do CID por dentro e não a devolve
 * para cá.
 */

/**
 * `direto`: lançado já com o motivo e enviado ao RH de uma vez, sem o aviso de
 * abertura antes (LUIZ, 11/11/2026). Quem decide é o próprio envio: um
 * "confirmado" sem aviso de abertura registrado vira `direto`.
 *
 * `cancelado`: o lançamento em aberto foi cancelado (a pessoa chegou depois
 * das primeiras horas) e o RH precisa desconsiderar o comunicado anterior
 * (LUIZ, 12/11/2026). Só sai quando um comunicado já tinha saído.
 *
 * `continua`: o lançamento em aberto ganhou mais um dia sem comparecer ("Continua
 * ausente", LUIZ, 17/11/2026). Os dias se acumulam no mesmo lançamento.
 */
export type EventoComunicado = "aberto" | "confirmado" | "aprovado" | "reprovado" | "reenvio" | "direto" | "cancelado" | "continua";

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
  hours_start: string | null;
  hours_end: string | null;
  /** trabalhou parte do dia, com ou sem horário ainda */
  partial_day: boolean | null;
  /** primeiro dia do atestado: integral, trabalhou (o dia todo) ou parcial (horas) */
  primeiro_dia: string | null;
  /** primeiro dia inteiro de ausência, calculado no banco */
  ausencia_inicio: string | null;
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
  cancel_note: string | null;
  user_id: string;
  /** comportamento do motivo (atestado, falta...); nulo antes do Efetivar */
  snap_kind: string | null;
  /** médico | odontológico (atestado) ou médico | perícia INSS (afastamento): o tipo do documento, nada do conteúdo */
  certificate_kind: string | null;
  work_accident: boolean | null;
  /** último dia sem comparecer registrado pelo "Continua ausente"; nulo = só occurred_on */
  ausente_ate: string | null;
};

/** Os dias sem comparecer do lançamento em aberto, quando passam de um. */
function diasSemComparecer(l: Linha): { texto: string; dias: number } | null {
  if (!l.ausente_ate || l.ausente_ate <= l.occurred_on) return null;
  const dias = diasEntre(l.occurred_on, l.ausente_ate);
  return { texto: `${dataBr(l.occurred_on)} a ${dataBr(l.ausente_ate)} (${dias} dias)`, dias };
}

/** O dia seguinte a uma data ISO, em dd/mm/aaaa (o retorno previsto). */
function diaSeguinte(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return dataBr(d.toISOString());
}

/** "09:00 às 11:00", ou vazio quando o lançamento não é de horas. */
function faixaDeHoras(l: Linha): string {
  if (!l.hours_start || !l.partial_day) return "";
  return `${l.hours_start.slice(0, 5)} às ${l.hours_end?.slice(0, 5) ?? "?"}`;
}

/** Dias corridos entre duas datas ISO, contando as duas pontas. */
function diasEntre(inicio: string, fim: string): number {
  return Math.round((Date.parse(fim) - Date.parse(inicio)) / 86400000) + 1;
}

function assunto(evento: EventoComunicado, l: Linha): string {
  const quem = l.snap_full_name ?? "Colaborador";
  const dia = dataBr(l.occurred_on);
  if (evento === "cancelado") return `Desconsiderar o comunicado: ${quem} em ${dia}`;
  if (evento === "aprovado") return `Absenteísmo aprovado: ${quem} em ${dia}`;
  if (evento === "reprovado") return `Absenteísmo reprovado: ${quem} em ${dia}`;
  if (evento === "confirmado") return `Motivo confirmado: ${quem} em ${dia}`;
  if (evento === "continua") {
    const s = diasSemComparecer(l);
    return `Continua ausente: ${quem} em ${dataBr(l.ausente_ate ?? l.occurred_on)}${s ? ` (${s.dias}º dia)` : ""}`;
  }
  // Quem saiu duas horas não "não compareceu". O assunto é o que o RH lê na
  // caixa de entrada antes de abrir, então a diferença precisa estar ali.
  const horas = faixaDeHoras(l);
  const parcial = Boolean(l.partial_day);
  if (evento === "direto") {
    const motivo = l.snap_type_name ? ` (${l.snap_type_name})` : "";
    return parcial
      ? `Ausência parcial lançada: ${quem} em ${dia}${horas ? `, ${horas}` : ""}${motivo}`
      : `Ausência lançada: ${quem} em ${dia}${motivo}`;
  }
  // parcial: o horário entra no assunto só quando já foi informado (LUIZ, 12/11/2026)
  if (parcial) return `Ausência parcial: ${quem} em ${dia}${horas ? `, ${horas}` : ""}`;
  return `Não comparecimento: ${quem} em ${dia}`;
}

/** `inssDias`: a soma de dias de atestado quando passou de 15; nulo quando não passou. */
function corpo(
  evento: EventoComunicado, l: Linha, empresa: string, autor: string, appUrl: string,
  quemCancelou?: string, inssDias?: number | null,
): string {
  const linhas: [string, string][] = [
    ["Colaborador", l.snap_full_name ?? "-"],
    ["Matrícula", l.snap_employee_code ?? "-"],
    ["Setor", [l.snap_department_name, l.snap_subdepartment_name].filter(Boolean).join(" / ") || "-"],
    ["Função", l.snap_position_name ?? "-"],
    ["Gestor imediato", l.snap_manager_name ?? "-"],
    ["Unidade", l.snap_unit_name ?? "-"],
    ["Dia da ausência", dataBr(l.occurred_on)],
  ];
  // em aberto com "Continua ausente": os dias acumulados no mesmo lançamento
  const semComparecer = evento === "aberto" || evento === "continua" ? diasSemComparecer(l) : null;
  if (semComparecer) linhas.push(["Dias sem comparecer", semComparecer.texto]);

  const horas = faixaDeHoras(l);
  const parcial = Boolean(l.partial_day);
  if (horas) linhas.push(["Horário", horas]);
  else if (parcial) linhas.push(["Horário", "a confirmar"]);

  // cancelado em aberto: nunca houve motivo nem período informado
  if (evento !== "aberto" && evento !== "cancelado" && evento !== "continua") {
    linhas.push(["Motivo informado", l.snap_type_name ?? "-"]);
    if (l.start_date && l.end_date) {
      const primeiro = l.primeiro_dia === "trabalhou" || l.primeiro_dia === "parcial" ? l.primeiro_dia : null;
      // Primeiro dia trabalhado (LUIZ, 12/11/2026): o período é o do documento,
      // e a ausência que vale vem logo abaixo, para o RH não descontar a mais.
      linhas.push([primeiro ? "Período do atestado" : "Período", `${dataBr(l.start_date)} a ${dataBr(l.end_date)}`]);
      if (primeiro && l.ausencia_inicio) {
        const dias = diasEntre(l.ausencia_inicio, l.end_date);
        const inteiros = `${dataBr(l.ausencia_inicio)} a ${dataBr(l.end_date)} (${dias} dia${dias === 1 ? "" : "s"})`;
        const faixa = l.hours_start ? `das ${l.hours_start.slice(0, 5)} às ${l.hours_end?.slice(0, 5) ?? "?"}` : "horário a confirmar";
        if (primeiro === "trabalhou") {
          linhas.push(["Primeiro dia", `Trabalhou normalmente em ${dataBr(l.start_date)} (consulta depois do expediente)`]);
          linhas.push(["Ausência considerada", inteiros]);
        } else {
          linhas.push(["Primeiro dia", `Trabalhou parte de ${dataBr(l.start_date)}, ausente ${faixa}`]);
          linhas.push(["Ausência considerada", `${dataBr(l.start_date)} ${faixa} e ${inteiros}`]);
        }
      }
    }
    // O e-mail de motivo informado leva o que o RH precisa para agir (LUIZ,
    // 17/11/2026): dias, retorno, tipo do documento, acidente de trabalho e o
    // alerta de INSS. O CID ficou de fora por decisão dele: vai para dezenas de
    // pessoas.
    if (evento === "confirmado" || evento === "direto") {
      const doAtestado = l.snap_kind === "atestado";
      // a ausência de horas não tem dias nem retorno
      if (doAtestado && l.start_date && l.end_date && !parcial) {
        // com o primeiro dia trabalhado, os dias já estão na "Ausência considerada"
        if (l.primeiro_dia !== "trabalhou" && l.primeiro_dia !== "parcial") {
          const dias = diasEntre(l.ausencia_inicio ?? l.start_date, l.end_date);
          linhas.push(["Dias de atestado", `${dias} dia${dias === 1 ? "" : "s"}`]);
        }
        linhas.push(["Retorno previsto", diaSeguinte(l.end_date)]);
      }
      if (doAtestado && (l.certificate_kind === "medico" || l.certificate_kind === "odontologico")) {
        linhas.push(["Tipo de atestado", l.certificate_kind === "medico" ? "Médico" : "Odontológico"]);
      }
      // afastamento: documento médico ou da perícia do INSS (LUIZ, 17/11/2026)
      if (l.snap_kind === "afastamento" && (l.certificate_kind === "medico" || l.certificate_kind === "pericia_inss")) {
        linhas.push(["Tipo de documento", l.certificate_kind === "medico" ? "Médico" : "Perícia INSS"]);
      }
      if (l.work_accident) linhas.push(["Acidente de trabalho", "Sim"]);
      if (inssDias != null) {
        linhas.push(["Alerta INSS", `Soma ${inssDias} dias de atestado. Do 16º dia em diante o pagamento é do INSS: encaminhe a perícia.`]);
      }
    }
  }
  linhas.push(["Lançado por", autor]);
  if (evento === "cancelado") {
    linhas.push(["Cancelado por", quemCancelou ?? autor]);
    if (l.cancel_note) linhas.push(["Motivo do cancelamento", l.cancel_note]);
  }

  const situacao =
    evento === "cancelado"
      ? "Desconsidere o comunicado anterior sobre esta ausência: o lançamento foi cancelado, porque a ausência não se confirmou."
      : evento === "aberto"
      ? parcial
        ? "Ausência parcial: o colaborador trabalhou no restante do dia. Situação ainda não confirmada, e o motivo será informado quando o gestor confirmar o lançamento."
        : "Situação ainda não confirmada. O motivo será informado quando o gestor confirmar o lançamento."
      : evento === "continua"
        ? "O colaborador continua sem comparecer e sem informar o motivo. Situação ainda não confirmada: o motivo será informado quando o gestor confirmar o lançamento."
      : evento === "confirmado"
        ? "O gestor confirmou o motivo e enviou o lançamento para aprovação do RH."
      : evento === "direto"
        ? parcial
          ? "Ausência parcial lançada pelo gestor já com o motivo e enviada para aprovação do RH."
          : "O gestor lançou a ausência já com o motivo e enviou para aprovação do RH."
        : evento === "aprovado"
          ? "O RH aprovou o lançamento, que passa a valer como ausência registrada."
          : "O RH reprovou o lançamento, que não vale como ausência.";

  const nota = evento === "reprovado" && l.decision_note
    ? `<p style="margin:0 0 12px"><strong>Motivo da reprovação:</strong> ${escapeHtml(l.decision_note)}</p>`
    : "";

  const observacao = (evento === "aberto" || evento === "continua") && l.reason_note
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
  eventoPedido: EventoComunicado,
  atorId?: string,
): Promise<ResultadoComunicado> {
  const admin = createServiceClient();
  // "confirmado" sem aviso de abertura antes = lançado direto com o motivo: o RH
  // não sabe da ausência, então o texto não pode falar em "motivo confirmado"
  const evento: EventoComunicado = eventoPedido === "confirmado" && !(await avisouAbertura(lancamentoId))
    ? "direto"
    : eventoPedido;

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
    // o lançamento cancelado é imutável (guarda do banco): o envio fica só no log
    if (evento !== "cancelado") {
      await admin
        .from("absenteismo_lancamentos")
        .update({ email_status: status, email_at: new Date().toISOString() })
        .eq("id", lancamentoId);
    }
  };

  try {
    const { data: l } = await admin
      .from("absenteismo_lancamentos")
      .select("*")
      .eq("id", lancamentoId)
      .maybeSingle();
    if (!l) return { status: "skipped", destinatarios: 0, error: "lançamento não encontrado" };

    const linha = l as unknown as Linha;
    // Reenvio (LUIZ, 17/11/2026): repete o comunicado da situação de AGORA. Antes
    // ele não tinha texto próprio e caía no de reprovação, com o assunto de
    // abertura, fosse qual fosse a situação. O log continua registrando "reenvio".
    const modelo = evento === "reenvio" ? await modeloDoReenvio(lancamentoId, linha) : evento;

    const comAlertaInss = (modelo === "confirmado" || modelo === "direto") && linha.snap_kind === "atestado" && linha.end_date;
    const [{ data: destinos, error: erroDestinos }, { data: empresa }, { data: autor }, { apiKey }, { data: ator }, { data: inss }] = await Promise.all([
      // Quem recebe (LUIZ, 16/11/2026): o gestor do cadastro, o carimbado no
      // lançamento e quem lançou, sempre; mais as regras de Configurações
      // (e-mail avulso, hierarquia, cargo), resolvidas pelo cadastro de agora.
      admin.rpc("absenteismo_destinatarios", { p_lancamento: lancamentoId }),
      admin.from("tenants").select("name").eq("id", linha.tenant_id).maybeSingle(),
      admin.from("profiles").select("full_name, email").eq("id", linha.created_by).maybeSingle(),
      getPlatformResend(),
      // quem cancelou pode não ser quem lançou (o RH, o gestor da pessoa)
      modelo === "cancelado" && atorId
        ? admin.from("profiles").select("full_name").eq("id", atorId).maybeSingle()
        : Promise.resolve({ data: null as { full_name: string | null } | null }),
      // só a contagem de dias sai daqui; a categoria do CID fica dentro da RPC
      comAlertaInss
        ? admin.rpc("absenteismo_inss", { p_tenant: linha.tenant_id, p_user: linha.user_id, p_ate: linha.end_date })
        : Promise.resolve({ data: null }),
    ]);
    const alerta = inss as { atinge?: boolean; dias?: number } | null;
    const inssDias = alerta?.atinge && typeof alerta.dias === "number" ? alerta.dias : null;

    if (erroDestinos) throw new Error(`destinatários: ${erroDestinos.message}`);
    // a unidade da regra já foi conferida contra a CARIMBADA no lançamento
    const emails = [...new Set((destinos ?? []).map((d) => d.email.trim().toLowerCase()))];

    if (!apiKey) {
      await registrar(linha.tenant_id, "skipped", emails, "integração de e-mail não configurada");
      return { status: "skipped", destinatarios: emails.length, error: "integração de e-mail não configurada" };
    }
    if (emails.length === 0) {
      await registrar(linha.tenant_id, "skipped", [], "nenhum destinatário cadastrado");
      return { status: "skipped", destinatarios: 0, error: "nenhum destinatário cadastrado" };
    }

    const appUrl = origemDoApp();
    const r = await sendMail({
      apiKey,
      to: emails,
      subject: assunto(modelo, linha),
      html: corpo(modelo, linha, empresa?.name ?? "MANAGER HUB", autor?.full_name ?? "gestor", appUrl, ator?.full_name ?? undefined, inssDias),
      replyTo: autor?.email ?? undefined,
    });

    await registrar(linha.tenant_id, r.ok ? "sent" : "failed", emails, r.error);
    return { status: r.ok ? "sent" : "failed", destinatarios: emails.length, error: r.error };
  } catch (e) {
    console.error("[absenteismo-email] falhou:", (e as Error).message);
    return { status: "failed", destinatarios: 0, error: (e as Error).message };
  }
}

/** Algum comunicado deste lançamento chegou a sair? (o cancelamento só avisa quem foi avisado) */
export async function jaComunicou(lancamentoId: string): Promise<boolean> {
  const { count } = await createServiceClient()
    .from("absenteismo_emails")
    .select("id", { count: "exact", head: true })
    .eq("lancamento_id", lancamentoId)
    .eq("status", "sent");
  return (count ?? 0) > 0;
}

/** O modelo que o reenvio repete: o da situação em que o lançamento está agora. */
async function modeloDoReenvio(lancamentoId: string, l: Pick<Linha, "status" | "occurred_on" | "ausente_ate">): Promise<EventoComunicado> {
  if (l.status === "aprovado") return "aprovado";
  if (l.status === "reprovado") return "reprovado";
  if (l.status === "cancelado") return "cancelado";
  // no RH: "motivo confirmado" se o aviso de abertura saiu antes; senão, "lançada"
  if (l.status === "pendente") return (await avisouAbertura(lancamentoId)) ? "confirmado" : "direto";
  // em aberto com dias acumulados: a versão mais recente é a do "Continua ausente"
  return l.ausente_ate && l.ausente_ate > l.occurred_on ? "continua" : "aberto";
}

/** Já saiu (ou se tentou mandar) o aviso de abertura deste lançamento? */
async function avisouAbertura(lancamentoId: string): Promise<boolean> {
  const { count } = await createServiceClient()
    .from("absenteismo_emails")
    .select("id", { count: "exact", head: true })
    .eq("lancamento_id", lancamentoId)
    .eq("event", "aberto");
  return (count ?? 0) > 0;
}

/**
 * O aviso de abertura que ficou para trás: o gestor começou a lançar com o
 * motivo (sem aviso) e fechou sem enviar ao RH. O lançamento fica em aberto, e
 * o RH precisa saber da ausência como em qualquer outro. Não repete: só manda
 * se nenhum comunicado saiu ainda.
 */
export async function comunicarAberturaSeFaltar(lancamentoId: string, atorId?: string): Promise<ResultadoComunicado | null> {
  const { count } = await createServiceClient()
    .from("absenteismo_emails")
    .select("id", { count: "exact", head: true })
    .eq("lancamento_id", lancamentoId);
  if ((count ?? 0) > 0) return null;
  return dispatchComunicadoAbsenteismo(lancamentoId, "aberto", atorId);
}
