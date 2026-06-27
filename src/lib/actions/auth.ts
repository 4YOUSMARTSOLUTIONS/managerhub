"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
  let email = identifier;
  if (!identifier.includes("@")) {
    const { data } = await supabase.rpc("email_by_cpf", { p_cpf: identifier });
    if (!data) return { error: "E-mail/CPF ou senha inválidos." };
    email = data;
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
