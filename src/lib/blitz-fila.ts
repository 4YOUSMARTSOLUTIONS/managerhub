/**
 * Blitz guardada no aparelho quando falta sinal (LUIZ, 10/11/2026).
 *
 * A portaria registra a blitz no celular, e o sinal ali cai. Em vez de perder
 * o que foi preenchido, a blitz fica guardada no próprio aparelho e vai para o
 * sistema sozinha quando a conexão volta (`EnvioDasBlitzGuardadas`, montado no
 * layout, tenta em qualquer tela do app).
 *
 * Três cuidados:
 *  - cada blitz nasce com um código (`clientId`) e o banco devolve a que já
 *    existe quando o mesmo código chega de novo: reenviar nunca duplica, nem
 *    quando o servidor gravou e a resposta se perdeu no caminho;
 *  - a blitz é de quem lançou, NESTA empresa: o celular é compartilhado, e
 *    quem entrar depois no mesmo aparelho não envia nada em nome de outro;
 *  - nada é apagado sem ser enviado. A que o servidor recusar (pessoa
 *    desligada no meio do caminho, por exemplo) fica à vista na tela da blitz,
 *    com o motivo, até alguém descartar.
 *
 * Só funciona com a tela já aberta: abrir o app do zero sem internet continua
 * caindo na página "Sem conexão", porque o aparelho não guarda a lista de
 * colaboradores (celular compartilhado). Ver `public/sw.js`.
 */
import { useMemo, useSyncExternalStore } from "react";
import { criarBlitz, type BlitzInput } from "@/lib/actions/seguranca";

export type BlitzGuardada = {
  clientId: string;
  /** quem lançou: só essa pessoa, nesta empresa, envia */
  dono: string;
  tenantId: string;
  input: BlitzInput;
  /** para a tela: nome curto e situação, como na confirmação */
  nome: string;
  situacao: string;
  guardadaEm: string;
  /** o servidor recusou na última tentativa (não é falta de sinal) */
  erro?: string;
};

const CHAVE = "mh_blitz_guardadas_v1";
const EVENTO = "mh-blitz-guardadas";

/** Mais que isso sem resposta, a blitz vai para o aparelho e a fila segue tentando. */
export const LIMITE_DO_ENVIO_MS = 15_000;

/** Código da blitz, criado no aparelho. */
export function novoCodigoDeBlitz(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // navegador antigo: mesmo formato (UUID v4) a partir de bytes aleatórios
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A promessa, ou "demorou" se passar do limite (a original segue correndo). */
export function comLimite<T>(p: Promise<T>, ms = LIMITE_DO_ENVIO_MS): Promise<T | "demorou"> {
  return Promise.race([p, new Promise<"demorou">((ok) => setTimeout(() => ok("demorou"), ms))]);
}

function lerTudo(): BlitzGuardada[] {
  try {
    const raw = localStorage.getItem(CHAVE);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function gravarTudo(lista: BlitzGuardada[]): boolean {
  let ok = true;
  try {
    if (lista.length) localStorage.setItem(CHAVE, JSON.stringify(lista));
    else localStorage.removeItem(CHAVE);
  } catch {
    ok = false;
  }
  window.dispatchEvent(new Event(EVENTO));
  return ok;
}

/**
 * Guarda (ou substitui, pelo código) a blitz no aparelho. Devolve `false` se o
 * navegador não deixou gravar: aí quem chamou NÃO pode limpar o formulário.
 */
export function guardarBlitz(item: BlitzGuardada): boolean {
  const lista = lerTudo().filter((x) => x.clientId !== item.clientId);
  lista.push(item);
  return gravarTudo(lista) && lerTudo().some((x) => x.clientId === item.clientId);
}

export function removerBlitzGuardada(clientId: string) {
  const lista = lerTudo();
  if (lista.some((x) => x.clientId === clientId)) gravarTudo(lista.filter((x) => x.clientId !== clientId));
}

function marcarRecusa(clientId: string, erro: string) {
  gravarTudo(lerTudo().map((x) => (x.clientId === clientId ? { ...x, erro } : x)));
}

// ---------- leitura reativa (a mesma lista em todas as telas e abas) ----------

const VAZIA: BlitzGuardada[] = [];
let ultimoRaw: string | null | undefined;
let ultimaLista: BlitzGuardada[] = VAZIA;

function retrato(): BlitzGuardada[] {
  let raw: string | null = null;
  try { raw = localStorage.getItem(CHAVE); } catch { raw = null; }
  if (raw !== ultimoRaw) {
    ultimoRaw = raw;
    ultimaLista = raw ? lerTudo() : VAZIA;
  }
  return ultimaLista;
}

function assinar(avisar: () => void) {
  const daOutraAba = (e: StorageEvent) => { if (e.key === CHAVE || e.key === null) avisar(); };
  window.addEventListener(EVENTO, avisar);
  window.addEventListener("storage", daOutraAba);
  return () => {
    window.removeEventListener(EVENTO, avisar);
    window.removeEventListener("storage", daOutraAba);
  };
}

/** As blitz guardadas neste aparelho por esta pessoa, nesta empresa. */
export function useBlitzGuardadas(dono: string, tenantId: string): BlitzGuardada[] {
  const todas = useSyncExternalStore(assinar, retrato, () => VAZIA);
  return useMemo(() => todas.filter((x) => x.dono === dono && x.tenantId === tenantId), [todas, dono, tenantId]);
}

function assinarConexao(avisar: () => void) {
  window.addEventListener("online", avisar);
  window.addEventListener("offline", avisar);
  return () => {
    window.removeEventListener("online", avisar);
    window.removeEventListener("offline", avisar);
  };
}

/** O navegador acha que tem rede? (`false` é certeza de que não; `true`, nem sempre.) */
export function useConectado(): boolean {
  return useSyncExternalStore(assinarConexao, () => navigator.onLine, () => true);
}

// ---------- envio ----------

export type ResultadoDoEnvio = { enviadas: number; recusadas: number; semConexao: boolean };

let emCurso: Promise<ResultadoDoEnvio> | null = null;

/**
 * Envia as guardadas desta pessoa, uma por vez. Sem sinal, para na primeira e
 * deixa o resto para a próxima tentativa. As recusadas só voltam a ser
 * tentadas quando pedido (`incluirRecusadas`): ao abrir o app e no botão
 * "Enviar agora", não a cada 30 segundos.
 */
export function enviarBlitzGuardadas(
  dono: string, tenantId: string, { incluirRecusadas = false }: { incluirRecusadas?: boolean } = {},
): Promise<ResultadoDoEnvio> {
  if (emCurso) return emCurso;
  emCurso = (async () => {
    const r: ResultadoDoEnvio = { enviadas: 0, recusadas: 0, semConexao: false };
    const fila = lerTudo().filter((x) => x.dono === dono && x.tenantId === tenantId && (incluirRecusadas || !x.erro));
    for (const item of fila) {
      let resp: Awaited<ReturnType<typeof criarBlitz>> | "demorou";
      try {
        resp = await comLimite(criarBlitz({ ...item.input, clientId: item.clientId }));
      } catch {
        r.semConexao = true;
        break;
      }
      if (resp === "demorou") { r.semConexao = true; break; }
      if (resp.error) {
        marcarRecusa(item.clientId, resp.error);
        r.recusadas += 1;
      } else {
        removerBlitzGuardada(item.clientId);
        r.enviadas += 1;
      }
    }
    return r;
  })().finally(() => { emCurso = null; });
  return emCurso;
}
