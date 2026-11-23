/**
 * Regras de upload, num lugar só.
 *
 * A camada que realmente vale é o limite declarado no bucket do Storage: ele é
 * imposto pelo Supabase e não tem como ser contornado, nem chamando a API direto,
 * sem passar pelo app. O que está aqui existe para dois motivos menores mas reais:
 * recusar cedo (sem gastar a subida inteira) e dar uma mensagem em português, em
 * vez de deixar o erro cru do Storage chegar ao usuário.
 *
 * Cuidado ao ler `file.type`: quem declara o tipo é o cliente, então ele mente se
 * quiser. Por isso a lista aqui é conveniência, não a defesa.
 */

export const TAMANHO_ANEXO = 10 * 1024 * 1024; // 10 MB
export const TAMANHO_FOTO = 5 * 1024 * 1024; // 5 MB
export const TAMANHO_AUDIO = 25 * 1024 * 1024; // 25 MB, ~70 min a 48 kbps

export const MIMES_ANEXO = [
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain", "text/csv",
];

export const MIMES_FOTO = ["image/jpeg", "image/png", "image/webp", "image/heic"];

/** Anexos de chamado: imagens e PDF (LUIZ, 23/11/2026). */
export const MIMES_CHAMADO = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "application/pdf"];
export const ACCEPT_CHAMADO = "image/jpeg,image/png,image/webp,image/gif,image/heic,.heic,application/pdf,.pdf";

export function ehPdf(nome: string, tipo?: string | null): boolean {
  return tipo === "application/pdf" || (!tipo && /\.pdf$/i.test(nome));
}

export const MIMES_AUDIO = [
  "audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4",
  "audio/wav", "audio/x-m4a", "audio/aac", "video/webm",
];

function mb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** Devolve a mensagem de recusa, ou null quando o arquivo passa. */
export function recusaDeUpload(
  file: File,
  limiteBytes: number,
  mimesAceitos: string[],
): string | null {
  if (file.size === 0) return `"${file.name}" está vazio.`;
  if (file.size > limiteBytes) {
    return `"${file.name}" tem ${mb(file.size)} e o limite é ${mb(limiteBytes)}.`;
  }
  // o tipo pode vir vazio em alguns navegadores; nesse caso o bucket decide
  const tipo = (file.type || "").split(";")[0].trim().toLowerCase();
  if (tipo && !mimesAceitos.includes(tipo)) {
    return `"${file.name}" é de um tipo não aceito aqui (${tipo}).`;
  }
  return null;
}

/** Como `recusaDeUpload`, mas sem tipo informado pelo navegador vale a extensão. */
export function recusaDeAnexoDeChamado(file: File): string | null {
  const tipo = (file.type || "").split(";")[0].trim().toLowerCase();
  const aceito = tipo ? MIMES_CHAMADO.includes(tipo) : /\.(jpe?g|png|webp|gif|heic|pdf)$/i.test(file.name);
  if (!aceito) return `"${file.name}" não é imagem nem PDF.`;
  return recusaDeUpload(file, TAMANHO_ANEXO, MIMES_CHAMADO);
}
