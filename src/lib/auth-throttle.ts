import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/admin";

/**
 * Freio de tentativa e erro na autenticação.
 *
 * Sem isto, o login não tinha contador, atraso nem bloqueio, e `verifyOwnPassword`
 * era um oráculo de senha ilimitado para qualquer sessão.
 *
 * O rate limit nativo do Supabase não resolve: o `signInWithPassword` sai do
 * SERVIDOR (função Vercel em gru1), então o que o serviço de autenticação enxerga
 * é sempre um IP da Vercel, nunca o do atacante. O freio precisa ser daqui, com o
 * IP real tirado dos headers, e o contador precisa ser compartilhado entre as
 * instâncias serverless — por isso mora no Postgres.
 *
 * Este módulo NÃO tem "use server": é chamado de dentro de server actions, mas não
 * pode virar endpoint.
 */

export type ChaveThrottle = {
  bucket: "login_ip" | "login_id" | "senha_usuario" | "reset_ip" | "reset_id";
  chave: string;
};
export type Veredito = { bloqueado: boolean; esperaSegundos: number };

const LIBERADO: Veredito = { bloqueado: false, esperaSegundos: 0 };

/**
 * IP real do cliente dentro de uma server action.
 *
 * Ordem de confiança: `x-vercel-forwarded-for` (o proxy da Vercel sobrescreve
 * headers `x-vercel-*` que venham de fora, então é o menos falsificável), depois
 * `x-real-ip`, e só então o `x-forwarded-for`.
 *
 * No `x-forwarded-for` lemos o ÚLTIMO elemento, nunca o primeiro. O primeiro é
 * exatamente o que um atacante consegue plantar: ele envia
 * `X-Forwarded-For: 1.2.3.4`, o proxy ANEXA o IP real ao final, e quem lê `[0]`
 * recebe o valor escolhido por ele. Aí bastaria variar o header a cada requisição
 * para o balde de IP virar decoração.
 */
export async function ipDoCliente(): Promise<string> {
  try {
    const h = await headers();
    const vercel = h.get("x-vercel-forwarded-for");
    if (vercel) return ultimo(vercel);
    const real = h.get("x-real-ip");
    if (real) return real.trim();
    const xff = h.get("x-forwarded-for");
    if (xff) return ultimo(xff);
  } catch {
    // headers() fora de contexto de requisição
  }
  return "sem-ip";
}

function ultimo(valor: string): string {
  const partes = valor.split(",").map((p) => p.trim()).filter(Boolean);
  return partes[partes.length - 1] ?? "sem-ip";
}

/**
 * Identificador (e-mail ou CPF) vira HMAC antes de virar chave.
 *
 * Guardar CPF em claro numa tabela de throttle seria criar um SEGUNDO repositório
 * de CPF, que é justamente o problema que a proteção de colunas de `profiles`
 * fecha. O tempero é a chave de service role: já é segredo só-servidor e já é
 * obrigatória neste caminho de código, então não exige variável de ambiente nova.
 * Se ela rotacionar, os contadores zeram — inofensivo.
 */
export function chaveIdentificador(identificador: string): string {
  const tempero = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createHmac("sha256", tempero)
    .update(identificador.trim().toLowerCase())
    .digest("hex");
}

/**
 * As três chamadas abaixo são FAIL-OPEN de propósito.
 *
 * O login é a única porta do sistema. Fail-closed transformaria qualquer soluço da
 * tabela em indisponibilidade total para mil pessoas. O balde por identificador
 * continua sendo a defesa real; um erro aqui é raro e some no próximo request, mas
 * vai para o log para não passar despercebido.
 */
export async function checarThrottle(chaves: ChaveThrottle[]): Promise<Veredito> {
  try {
    const admin = createServiceClient();
    const { data, error } = await admin.rpc("auth_throttle_check", { p_chaves: chaves });
    if (error) throw new Error(error.message);
    return traduzir(data);
  } catch (e) {
    console.error("[auth-throttle] check falhou (seguindo liberado):", (e as Error).message);
    return LIBERADO;
  }
}

export async function registrarFalha(chaves: ChaveThrottle[]): Promise<Veredito> {
  try {
    const admin = createServiceClient();
    const { data, error } = await admin.rpc("auth_throttle_falha", { p_chaves: chaves });
    if (error) throw new Error(error.message);
    return traduzir(data);
  } catch (e) {
    console.error("[auth-throttle] falha nao registrada:", (e as Error).message);
    return LIBERADO;
  }
}

export async function registrarSucesso(chaves: ChaveThrottle[]): Promise<void> {
  try {
    const admin = createServiceClient();
    await admin.rpc("auth_throttle_sucesso", { p_chaves: chaves });
  } catch (e) {
    console.error("[auth-throttle] sucesso nao registrado:", (e as Error).message);
  }
}

function traduzir(data: unknown): Veredito {
  const d = data as { bloqueado?: boolean; espera_segundos?: number } | null;
  return { bloqueado: Boolean(d?.bloqueado), esperaSegundos: Number(d?.espera_segundos ?? 0) };
}

/** Mensagem única, para as três telas dizerem a mesma coisa. */
export function mensagemBloqueio(esperaSegundos: number): string {
  const min = Math.max(1, Math.ceil(esperaSegundos / 60));
  return `Muitas tentativas seguidas. Aguarde ${min} ${min === 1 ? "minuto" : "minutos"} e tente de novo.`;
}
