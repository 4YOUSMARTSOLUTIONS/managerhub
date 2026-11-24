import { createClient } from "@/lib/supabase/client";
import { autorizarArquivoFormulario } from "@/lib/actions/formularios";
import { BUCKET_FORMULARIOS, TAMANHO_ARQUIVO_FORMULARIO, type Arquivo } from "@/lib/formularios";

const LADO_MAXIMO = 1920;

/**
 * Foto de celular sai com 3 a 8 MB. Reduzida a 1920 px em JPEG ela fica com
 * algumas centenas de KB, sobe rápido no 4G e continua legível para inspeção.
 * HEIC e GIF passam como vieram (o canvas não abre HEIC fora do Safari, e GIF
 * perderia a animação).
 */
async function reduzirImagem(file: File): Promise<{ blob: Blob; tipo: string; nome: string }> {
  const tipo = (file.type || "").toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(tipo)) return { blob: file, tipo: file.type, nome: file.name };
  try {
    const bitmap = await createImageBitmap(file);
    const fator = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
    if (fator === 1 && file.size < 1.5 * 1024 * 1024) { bitmap.close(); return { blob: file, tipo, nome: file.name }; }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * fator);
    canvas.height = Math.round(bitmap.height * fator);
    const ctx = canvas.getContext("2d");
    if (!ctx) { bitmap.close(); return { blob: file, tipo, nome: file.name }; }
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size) return { blob: file, tipo, nome: file.name };
    return { blob, tipo: "image/jpeg", nome: file.name.replace(/\.(png|webp|jpe?g)$/i, "") + ".jpg" };
  } catch {
    return { blob: file, tipo, nome: file.name };
  }
}

/** Sobe direto para o Storage com endereço assinado pelo servidor. */
export async function subirArquivo(formId: string, entrada: File | Blob, nomeOriginal?: string): Promise<{ arquivo?: Arquivo; error?: string }> {
  const file = entrada instanceof File ? entrada : new File([entrada], nomeOriginal ?? "arquivo", { type: entrada.type });
  const { blob, tipo, nome } = file.type.startsWith("image/") ? await reduzirImagem(file) : { blob: file as Blob, tipo: file.type, nome: file.name };
  if (blob.size > TAMANHO_ARQUIVO_FORMULARIO) return { error: `"${nome}" passa de 20 MB.` };
  const auth = await autorizarArquivoFormulario({ formId, tipo, tamanho: blob.size });
  if (auth.error || !auth.path || !auth.token) return { error: auth.error ?? "Não foi possível enviar o arquivo." };
  const { error } = await createClient().storage.from(BUCKET_FORMULARIOS)
    .uploadToSignedUrl(auth.path, auth.token, blob, { contentType: tipo || undefined });
  if (error) return { error: error.message };
  return { arquivo: { path: auth.path, nome, tipo, tamanho: blob.size } };
}
