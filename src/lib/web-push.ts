/**
 * Envio de Web Push (notificação no celular com o app fechado), só no servidor.
 *
 * Feito com o `crypto` do Node, sem biblioteca: são duas peças padronizadas e
 * pequenas, e uma dependência a mais seria código de terceiro com a chave
 * privada na mão.
 *  - RFC 8291 + 8188: o conteúdo vai cifrado (aes128gcm) para a chave do
 *    aparelho; o serviço de push (Google, Apple, Mozilla, Microsoft) só repassa.
 *  - RFC 8292 (VAPID): o servidor assina um JWT ES256 provando que é ele quem
 *    manda. O par de chaves é gerado uma vez e fica no Vault do banco.
 *
 * Nunca importar em componente de cliente.
 */
import { createECDH, createCipheriv, createPrivateKey, hkdfSync, randomBytes, sign } from "node:crypto";

export const b64url = {
  enc: (b: Uint8Array) => Buffer.from(b).toString("base64url"),
  dec: (s: string) => Buffer.from(s, "base64url"),
};

export interface Vapid {
  /** ponto P-256 sem compressão (65 bytes), base64url */
  publica: string;
  /** escalar d (32 bytes), base64url */
  privada: string;
}

export interface Inscricao {
  endpoint: string;
  /** chave pública do aparelho (65 bytes), base64url */
  p256dh: string;
  /** segredo de autenticação do aparelho (16 bytes), base64url */
  auth: string;
}

/** Serviços de push conhecidos. Endpoint fora disso não recebe nada (SSRF). */
const HOSTS_DE_PUSH = /(^|\.)(googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/i;

export function endpointValido(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && HOSTS_DE_PUSH.test(u.hostname);
  } catch {
    return false;
  }
}

export function gerarChavesVapid(): Vapid {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publica: b64url.enc(ecdh.getPublicKey()), privada: b64url.enc(ecdh.getPrivateKey()) };
}

/**
 * Cifra o conteúdo para um aparelho (RFC 8291, um registro só).
 * `efemera` e `salt` existem para o teste com o vetor da RFC; em uso real
 * são sempre novos a cada mensagem.
 */
export function cifrar(
  conteudo: Buffer,
  inscricao: Pick<Inscricao, "p256dh" | "auth">,
  teste?: { efemera: Buffer; salt: Buffer },
): Buffer {
  const uaPublica = b64url.dec(inscricao.p256dh);
  const segredo = b64url.dec(inscricao.auth);
  if (uaPublica.length !== 65 || segredo.length < 16) throw new Error("inscrição com chave inválida");

  const ecdh = createECDH("prime256v1");
  if (teste) ecdh.setPrivateKey(teste.efemera);
  else ecdh.generateKeys();
  const asPublica = ecdh.getPublicKey();
  const compartilhado = ecdh.computeSecret(uaPublica);
  const salt = teste?.salt ?? randomBytes(16);

  const infoChave = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublica, asPublica]);
  const ikm = Buffer.from(hkdfSync("sha256", compartilhado, segredo, infoChave, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));

  // 0x02 = último (e único) registro, sem enchimento
  const cifra = createCipheriv("aes-128-gcm", cek, nonce);
  const corpo = Buffer.concat([cifra.update(Buffer.concat([conteudo, Buffer.from([2])])), cifra.final(), cifra.getAuthTag()]);

  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublica.length]), asPublica, corpo]);
}

/** JWT ES256 do VAPID para a origem do serviço de push. */
export function jwtVapid(endpoint: string, vapid: Vapid, contato: string, agora = Date.now()): string {
  const publica = b64url.dec(vapid.publica);
  const chave = createPrivateKey({
    key: {
      kty: "EC", crv: "P-256", d: vapid.privada,
      x: b64url.enc(publica.subarray(1, 33)), y: b64url.enc(publica.subarray(33, 65)),
    },
    format: "jwk",
  });
  const cab = b64url.enc(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const corpo = b64url.enc(Buffer.from(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(agora / 1000) + 12 * 3600,
    sub: contato,
  })));
  const assinatura = sign("sha256", Buffer.from(`${cab}.${corpo}`), { key: chave, dsaEncoding: "ieee-p1363" });
  return `${cab}.${corpo}.${b64url.enc(assinatura)}`;
}

export type ResultadoPush = "ok" | "expirada" | "falha";

/**
 * Manda uma mensagem a um aparelho. "expirada" = o aparelho desinscreveu ou
 * desinstalou (404/410): a inscrição deve ser apagada.
 */
export async function enviarPush(
  inscricao: Inscricao,
  conteudo: string,
  vapid: Vapid,
  contato: string,
  opcoes: { ttl?: number; urgencia?: "normal" | "high" } = {},
): Promise<{ resultado: ResultadoPush; status: number }> {
  if (!endpointValido(inscricao.endpoint)) return { resultado: "expirada", status: 0 };
  const corpo = cifrar(Buffer.from(conteudo, "utf8"), inscricao);
  try {
    const res = await fetch(inscricao.endpoint, {
      method: "POST",
      headers: {
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(opcoes.ttl ?? 24 * 3600),
        Urgency: opcoes.urgencia ?? "normal",
        Authorization: `vapid t=${jwtVapid(inscricao.endpoint, vapid, contato)}, k=${vapid.publica}`,
      },
      body: new Uint8Array(corpo),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404 || res.status === 410) return { resultado: "expirada", status: res.status };
    return { resultado: res.ok ? "ok" : "falha", status: res.status };
  } catch {
    return { resultado: "falha", status: 0 };
  }
}
