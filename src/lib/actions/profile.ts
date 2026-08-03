"use server";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { actionContext } from "./context";
import { verifyOwnPassword } from "./verify-password";
import type { ActionState } from "./types";
import { AVATAR_BUCKET, AVATAR_MAX_BYTES, AVATAR_MIMES, AVATAR_SIZE } from "@/lib/avatar";

/** Mesmo mínimo do setUserPassword (caminho administrativo): uma regra só no sistema. */
const MIN_SENHA = 6;

export type OwnProfile = {
  fullName: string | null;
  email: string | null;
  cpf: string | null;
  phone: string | null;
  birthDate: string | null;
  gender: string | null;
  avatarPath: string | null;
  role: string;
  company: string | null;
  employeeCode: string | null;
  admissionDate: string | null;
  department: string | null;
  subdepartment: string | null;
  position: string | null;
  manager: string | null;
};

/** Ficha do próprio usuário. Só leitura: quem mantém esses dados é a administração. */
export async function getOwnProfile(): Promise<OwnProfile | null> {
  const { supabase, userId, tenantId, role } = await actionContext();

  const [{ data: p }, { data: m }, { data: t }] = await Promise.all([
    supabase.from("profiles").select("full_name, email, cpf, phone, birth_date, gender, avatar_url").eq("id", userId).maybeSingle(),
    supabase
      .from("memberships")
      .select("employee_code, admission_date, manager_id, departments(name), subdepartments(name), positions(name)")
      .eq("user_id", userId).eq("tenant_id", tenantId).maybeSingle(),
    supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
  ]);
  if (!p) return null;

  // o gestor é outra pessoa: busca à parte para não depender de embed ambíguo
  let manager: string | null = null;
  if (m?.manager_id) {
    const { data: g } = await supabase.from("profiles").select("full_name").eq("id", m.manager_id).maybeSingle();
    manager = g?.full_name ?? null;
  }

  const nome = (x: unknown) => (x as { name: string } | null)?.name ?? null;
  return {
    fullName: p.full_name, email: p.email, cpf: p.cpf, phone: p.phone,
    birthDate: p.birth_date, gender: p.gender, avatarPath: p.avatar_url,
    role, company: t?.name ?? null,
    employeeCode: m?.employee_code ?? null,
    admissionDate: m?.admission_date ?? null,
    department: nome(m?.departments), subdepartment: nome(m?.subdepartments),
    position: nome(m?.positions), manager,
  };
}

/**
 * Troca a senha do próprio usuário.
 *
 * Precisa rodar em Server Action, não em Server Component: o updateUser rotaciona a
 * sessão e o cliente grava os cookies novos. Em Server Component essa escrita cai no
 * catch silencioso de src/lib/supabase/server.ts e o usuário ficaria com token velho.
 *
 * Não usa a RPC admin_set_password: ela é restrita a owner/admin e pularia justamente
 * a exigência da senha atual.
 */
export async function changeOwnPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase } = await actionContext();
    const atual = String(formData.get("current_password") ?? "");
    const nova = String(formData.get("new_password") ?? "");
    const confirmacao = String(formData.get("confirm_password") ?? "");

    if (nova.length < MIN_SENHA) return { error: `A senha deve ter ao menos ${MIN_SENHA} caracteres.` };
    if (nova !== confirmacao) return { error: "A confirmação não confere com a nova senha." };
    if (nova === atual) return { error: "A nova senha precisa ser diferente da atual." };
    if (!(await verifyOwnPassword(atual))) return { error: "Senha atual incorreta." };

    const { error } = await supabase.auth.updateUser({ password: nova });
    if (error) {
      // as mensagens do Supabase vêm em inglês; não devolver o texto cru ao usuário
      const raw = error.message.toLowerCase();
      if (raw.includes("different from the old password")) {
        return { error: "A nova senha precisa ser diferente da atual." };
      }
      if (raw.includes("should be at least")) {
        return { error: `A senha deve ter ao menos ${MIN_SENHA} caracteres.` };
      }
      if (raw.includes("reauthentication")) {
        return { error: "Por segurança, entre novamente no sistema antes de trocar a senha." };
      }
      return { error: "Não foi possível trocar a senha. Tente novamente." };
    }

    return { ok: true, message: "Senha alterada." };
  } catch (e) { return { error: (e as Error).message }; }
}

/**
 * Envia a foto de perfil.
 *
 * Normaliza com sharp antes de subir: recorte quadrado de 256px em WebP. Isso
 * padroniza o enquadramento, derruba o peso e, de quebra, descarta o EXIF, que em
 * foto de celular costuma carregar coordenadas de GPS.
 */
export async function updateOwnAvatar(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase, userId } = await actionContext();
    const file = formData.get("avatar");
    if (!(file instanceof File) || file.size === 0) return { error: "Selecione uma imagem." };
    if (file.size > AVATAR_MAX_BYTES) return { error: "A imagem deve ter no máximo 2 MB." };
    // o accept do input é dica, não garantia: quem posta direto manda o que quiser
    if (!AVATAR_MIMES.includes(file.type as (typeof AVATAR_MIMES)[number])) {
      return { error: "Formato não aceito. Envie JPG, PNG ou WebP." };
    }

    let webp: Buffer;
    try {
      webp = await sharp(Buffer.from(await file.arrayBuffer()))
        .rotate() // respeita a orientação do EXIF antes de descartá-lo
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "attention" })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      return { error: "Não foi possível ler a imagem. Tente outro arquivo." };
    }

    // o user_id como primeiro segmento é o que a policy do bucket exige
    const path = `${userId}/${Date.now()}_${crypto.randomUUID()}.webp`;
    const up = await supabase.storage.from(AVATAR_BUCKET).upload(path, webp, {
      contentType: "image/webp",
      upsert: false,
      cacheControl: "31536000", // a URL muda a cada envio, então pode cachear para sempre
    });
    if (up.error) return { error: "Não foi possível enviar a imagem." };

    const { data: antes } = await supabase.from("profiles").select("avatar_url").eq("id", userId).maybeSingle();
    const anterior = antes?.avatar_url ?? null;

    const { error: upErr } = await supabase.from("profiles").update({ avatar_url: path }).eq("id", userId);
    if (upErr) {
      await supabase.storage.from(AVATAR_BUCKET).remove([path]); // não deixa órfão
      return { error: "Não foi possível salvar a foto." };
    }

    // só depois de a nova estar gravada: se apagasse antes e o upload falhasse, o
    // usuário ficaria sem foto nenhuma
    if (anterior) await supabase.storage.from(AVATAR_BUCKET).remove([anterior]);

    revalidatePath("/", "layout");
    return { ok: true, message: "Foto atualizada." };
  } catch (e) { return { error: (e as Error).message }; }
}

/** Remove a foto: zera a coluna e apaga o objeto, para o bucket não acumular lixo. */
export async function removeOwnAvatar(): Promise<ActionState> {
  try {
    const { supabase, userId } = await actionContext();
    const { data: antes } = await supabase.from("profiles").select("avatar_url").eq("id", userId).maybeSingle();
    const anterior = antes?.avatar_url ?? null;

    const { error } = await supabase.from("profiles").update({ avatar_url: null }).eq("id", userId);
    if (error) return { error: "Não foi possível remover a foto." };
    if (anterior) await supabase.storage.from(AVATAR_BUCKET).remove([anterior]);

    revalidatePath("/", "layout");
    return { ok: true, message: "Foto removida." };
  } catch (e) { return { error: (e as Error).message }; }
}
