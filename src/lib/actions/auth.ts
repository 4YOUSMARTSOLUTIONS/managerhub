"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  ipDoCliente, chaveIdentificador, checarThrottle, registrarFalha, registrarSucesso,
  mensagemBloqueio, type ChaveThrottle,
} from "@/lib/auth-throttle";
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

  // Dois baldes: o do IP e o do identificador. O do identificador é o que barra
  // tentativa e erro de verdade, inclusive vinda de uma botnet — a chave é quem se
  // está tentando acessar, não de onde vem. O do IP é a segunda linha.
  const chaves: ChaveThrottle[] = [
    { bucket: "login_ip", chave: await ipDoCliente() },
    { bucket: "login_id", chave: chaveIdentificador(identifier) },
  ];

  const portao = await checarThrottle(chaves);
  if (portao.bloqueado) return { error: mensagemBloqueio(portao.esperaSegundos) };

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
    // CPF inexistente conta falha igual a senha errada: sem isso, o tempo de
    // resposta (aqui não há ida ao serviço de autenticação) denunciaria quais CPFs
    // existem na base, mesmo com a mensagem sendo idêntica.
    if (!found) {
      const v = await registrarFalha(chaves);
      return { error: v.bloqueado ? mensagemBloqueio(v.esperaSegundos) : "E-mail/CPF ou senha inválidos." };
    }
    email = found;
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const v = await registrarFalha(chaves);
    return { error: v.bloqueado ? mensagemBloqueio(v.esperaSegundos) : "E-mail/CPF ou senha inválidos." };
  }

  await registrarSucesso(chaves);

  // Senha ainda é a que a administração cadastrou: a troca vem antes de tudo.
  // O proxy também barraria, mas aqui a resposta do login já traz a informação,
  // então a pessoa vai direto para a tela certa em vez de piscar o /dashboard.
  const pendente =
    (data.user?.app_metadata as { must_change_password?: boolean } | undefined)
      ?.must_change_password === true;
  redirect(pendente ? "/trocar-senha" : "/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
