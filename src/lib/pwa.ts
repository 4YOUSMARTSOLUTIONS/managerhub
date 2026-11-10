/**
 * Peças do aplicativo instalável (PWA) que servidor e navegador compartilham.
 * Sem "use client" de propósito: o layout raiz (servidor) usa o script abaixo
 * como texto, e uma constante de módulo de cliente chegaria lá como referência.
 */

/** Disparado quando o navegador libera o botão de instalar. */
export const EVENTO_INSTALAVEL = "mh:instalavel";
/** Disparado quando a instalação termina. */
export const EVENTO_INSTALADO = "mh:instalado";

/**
 * Roda antes do React, no HTML da primeira carga. O Chrome e o Edge avisam
 * UMA vez que o site pode ser instalado (`beforeinstallprompt`), muitas vezes
 * antes da hidratação; quem só escuta depois perde o aviso e o botão
 * "Instalar aplicativo" nunca aparece.
 *
 * Só a página /instalar segura a faixa automática do navegador (preventDefault),
 * porque ali o botão próprio já faz esse papel. Nas outras telas o Chrome do
 * Android continua oferecendo a faixa dele.
 */
export const CAPTURA_INSTALACAO = `(function(){try{
window.addEventListener("beforeinstallprompt",function(e){
if(location.pathname.indexOf("/instalar")===0)e.preventDefault();
window.__mhInstalar=e;window.dispatchEvent(new Event("${EVENTO_INSTALAVEL}"));});
window.addEventListener("appinstalled",function(){
window.__mhInstalar=null;window.__mhInstalado=true;window.dispatchEvent(new Event("${EVENTO_INSTALADO}"));});
}catch(e){}})();`;

export type Plataforma =
  | "ios-safari"
  | "ios-outro"
  | "app-interno"
  | "android"
  | "mac-safari"
  | "firefox-pc"
  | "pc";

/**
 * O caminho de instalação muda por aparelho e navegador, então a tela precisa
 * saber onde está. `toques` separa o iPad, que se apresenta como Mac.
 */
export function detectarPlataforma(ua: string, toques: number): Plataforma {
  // navegador embutido de outro app (WhatsApp, Instagram, Facebook, WebView do
  // Android): nenhum deles instala, a pessoa precisa abrir no navegador
  if (/FBAN|FBAV|FB_IAB|Instagram|WhatsApp|LinkedInApp|Line\/|; wv\)/i.test(ua)) return "app-interno";
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && toques > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? "ios-outro" : "ios-safari";
  if (/Android/i.test(ua)) return "android";
  if (/Firefox\//.test(ua)) return "firefox-pc";
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua)) return "mac-safari";
  return "pc";
}

/** Aberto pelo ícone instalado, e não numa aba do navegador. */
export function rodandoComoApp(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches
    || window.matchMedia("(display-mode: window-controls-overlay)").matches
    // Safari do iPhone, que não implementa o display-mode acima
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Celular ou tablet: muda o texto de onde o ícone aparece. */
export function ehAparelhoMovel(p: Plataforma): boolean {
  return p === "ios-safari" || p === "ios-outro" || p === "android" || p === "app-interno";
}
