"use client";

import { useSyncExternalStore } from "react";
import { cancelarPush, pushEmUso, prepararPush, registrarPush, statusPush } from "@/lib/actions/push";
import { detectarPlataforma, rodandoComoApp } from "@/lib/pwa";

/**
 * Notificações no celular NESTE aparelho.
 *
 *  - "carregando": ainda lendo o estado
 *  - "sem-suporte": navegador sem Web Push (ou ambiente de desenvolvimento,
 *    onde o service worker não é registrado)
 *  - "instalar": iPhone/iPad numa aba do Safari; lá o push só existe com o
 *    app instalado na tela inicial
 *  - "bloqueado": a pessoa negou a permissão; só se desfaz no navegador
 *  - "desligado" / "ligado"
 */
export type EstadoPush = "carregando" | "sem-suporte" | "instalar" | "bloqueado" | "desligado" | "ligado";

// estado único por aba: o menu do usuário e o sino mostram a mesma coisa
let estado: EstadoPush = "carregando";
let chave: string | null = null;
let iniciado = false;
const ouvintes = new Set<() => void>();
const mudar = (e: EstadoPush) => { estado = e; ouvintes.forEach((f) => f()); };

function assinar(avisar: () => void) {
  ouvintes.add(avisar);
  if (!iniciado) { iniciado = true; void ler(); }
  return () => { ouvintes.delete(avisar); };
}

/** O worker de produção; no `next dev` ele não existe e isto devolve null. */
async function registro(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((r) => setTimeout(() => r(null), 5000)),
  ]);
}

async function ler() {
  const temApi = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!temApi) {
    const ios = detectarPlataforma(navigator.userAgent, navigator.maxTouchPoints ?? 0).startsWith("ios");
    mudar(ios && !rodandoComoApp() ? "instalar" : "sem-suporte");
    return;
  }
  if (Notification.permission === "denied") { mudar("bloqueado"); return; }
  const reg = await registro();
  if (!reg) { mudar("sem-suporte"); return; }
  const sub = await reg.pushManager.getSubscription();
  if (!sub || Notification.permission !== "granted") { mudar("desligado"); return; }
  // inscrito neste navegador, mas pode ser de quem usou o aparelho antes
  mudar((await statusPush(sub.endpoint)) ? "ligado" : "desligado");
}

const paraBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64.length / 4) * 4, "="));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const mesmaChave = (a: ArrayBuffer | null | undefined, b: Uint8Array) =>
  !!a && a.byteLength === b.length && new Uint8Array(a).every((x, i) => x === b[i]);

/** Nome curto do aparelho, para a pessoa reconhecer se um dia listar. */
function aparelho(): string {
  const p = detectarPlataforma(navigator.userAgent, navigator.maxTouchPoints ?? 0);
  const nomes: Record<string, string> = {
    "ios-safari": "iPhone/iPad", "ios-outro": "iPhone/iPad", android: "Android",
    "mac-safari": "Mac", "firefox-pc": "Computador (Firefox)", pc: "Computador", "app-interno": "Celular",
  };
  return `${nomes[p] ?? "Aparelho"}${rodandoComoApp() ? " (app)" : ""}`;
}

/**
 * Busca a chave antes do toque. No iPhone o pedido de permissão precisa sair
 * do próprio toque: uma ida ao servidor no meio faz o Safari recusar.
 */
async function preparar() {
  if (chave || estado !== "desligado") return;
  const r = await prepararPush();
  if (r.chave) chave = r.chave;
}

export type ResultadoAtivar = { ok: true } | { ok: false; motivo: string };

async function ativar(): Promise<ResultadoAtivar> {
  const reg = await registro();
  if (!reg) return { ok: false, motivo: "Este navegador não recebe notificações." };
  if (!chave) {
    const r = await prepararPush();
    if (!r.chave) return { ok: false, motivo: r.error ?? "Notificações indisponíveis no momento." };
    chave = r.chave;
  }
  const bytes = paraBytes(chave);
  let sub: PushSubscription | null;
  try {
    sub = await reg.pushManager.getSubscription();
    // inscrição feita com outra chave (troca do par VAPID): refaz
    if (sub && !mesmaChave(sub.options.applicationServerKey, bytes)) { await sub.unsubscribe(); sub = null; }
    // o subscribe já pede a permissão quando ela ainda não foi dada
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
  } catch {
    if (Notification.permission === "denied") { mudar("bloqueado"); return { ok: false, motivo: "bloqueado" }; }
    return { ok: false, motivo: "Não foi possível ligar. Tente de novo." };
  }
  const j = sub.toJSON();
  const r = await registrarPush({
    endpoint: sub.endpoint, p256dh: j.keys?.p256dh ?? "", auth: j.keys?.auth ?? "", aparelho: aparelho(),
  });
  if (r.error) return { ok: false, motivo: r.error };
  mudar("ligado");
  return { ok: true };
}

async function desativar(): Promise<void> {
  const reg = await registro();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await cancelarPush(sub.endpoint);
    await sub.unsubscribe().catch(() => false);
  }
  mudar("desligado");
}

/**
 * Ao sair do sistema: o aparelho para de receber os avisos de quem saiu. Sem
 * isso, quem entrasse depois no mesmo celular veria as notificações do outro.
 * Com teto de tempo, para nunca segurar o "Sair".
 */
export async function desligarPushAoSair(): Promise<void> {
  await Promise.race([
    (async () => {
      if (!("serviceWorker" in navigator)) return;
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) return;
      await cancelarPush(sub.endpoint).catch(() => undefined);
      await sub.unsubscribe().catch(() => false);
    })().catch(() => undefined),
    new Promise((r) => setTimeout(r, 2500)),
  ]);
}

/**
 * O aparelho está em uso (chamado pelo controle de inatividade, a cada toque).
 * No máximo uma ida ao servidor a cada 5 minutos. Serve à rota do push: aviso
 * para aparelho parado além do tempo da pessoa sai sem conteúdo.
 */
let ultimoAvisoDeUso = 0;
export async function avisarUsoDoAparelho(): Promise<void> {
  if (estado !== "ligado" || Date.now() - ultimoAvisoDeUso < 5 * 60_000) return;
  ultimoAvisoDeUso = Date.now();
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await pushEmUso(sub.endpoint);
  } catch {
    // sem rede agora: o próximo toque tenta de novo
    ultimoAvisoDeUso = 0;
  }
}

export function usePush() {
  const atual = useSyncExternalStore(assinar, () => estado, () => "carregando" as EstadoPush);
  return { estado: atual, preparar, ativar, desativar };
}
