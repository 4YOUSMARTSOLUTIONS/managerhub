"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import type { ActionState } from "./types";

export async function signIn(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!identifier || !password) {
    return { error: "Informe e-mail/CPF e senha." };
  }

  const supabase = await createClient();

  // login por e-mail (tem @) ou por CPF (resolve o e-mail de autenticação)
  //
  // A resolução do CPF roda com service role, nunca com a chave pública: exposta
  // ao navegador, `email_by_cpf` viraria um oráculo de CPF para e-mail corporativo
  // para quem não está logado. Aqui a chamada não sai do servidor.
  let email = identifier;
  if (!identifier.includes("@")) {
    let found: string | null = null;
    try {
      const admin = createServiceClient();
      const { data } = await admin.rpc("email_by_cpf", { p_cpf: identifier });
      found = data ?? null;
    } catch {
      return { error: "Login por CPF indisponível no momento. Use o e-mail." };
    }
    if (!found) return { error: "E-mail/CPF ou senha inválidos." };
    email = found;
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: "E-mail/CPF ou senha inválidos." };
  }

  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
