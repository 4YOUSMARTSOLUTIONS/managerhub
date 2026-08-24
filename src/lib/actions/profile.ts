"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/auth-cache";
import { redirect } from "next/navigation";
import { verifyOwnPassword } from "./verify-password";
import type { ActionState } from "./types";
import { AVATAR_BUCKET, AVATAR_MAX_BYTES, AVATAR_MIMES, AVATAR_SIZE } from "@/lib/avatar";

/** Mesmo mínimo do setUserPassword (caminho administrativo): uma regra só no sistema. */
const MIN_SENHA = 8;

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

  const [{ data: p }, { data: pessoais }, { data: m }, { data: t }] = await Promise.all([
    supabase.from("profiles").select("full_name, email, avatar_url").eq("id", userId).maybeSingle(),
    // CPF, telefone, nascimento e sexo não são mais legíveis pela chave pública:
    // a RLS libera a LINHA do colega e não tem granularidade de coluna, então
    // qualquer funcionário lia a base inteira pelo PostgREST. Vêm por RPC, que
    // filtra por auth.uid() e não aceita parâmetro.
    supabase.rpc("meu_perfil_pessoal").maybeSingle(),
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
    fullName: p.full_name, email: p.email,
    cpf: pessoais?.cpf ?? null, phone: pessoais?.phone ?? null,
    birthDate: pessoais?.birth_date ?? null, gender: pessoais?.gender ?? null,
    avatarPath: p.avatar_url,
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
 *
 * `createClient` direto, e NÃO `actionContext`: quem está com a senha padrão
 * pendente é barrado lá dentro, e trocar a senha é exatamente o que essa pessoa
 * precisa fazer para sair da pendência. A troca perde as guardas de vínculo
 * inativo e empresa suspensa que o `actionContext` dá, o que é aceitável: nenhum
 * dano vem de um desligado definir a própria senha, e o `requireContext` continua
 * mandando ele para /suspenso em toda tela.
 */
export async function changeOwnPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const supabase = await createClient();
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
 * Troca obrigatória no primeiro acesso.
 *
 * Reusa a troca voluntária inteira (validações, senha atual e updateUser) e só
 * acrescenta as duas pontas que o caso obrigatório precisa. A ORDEM importa:
 *
 * 1. Trocar a senha primeiro. Se limpasse a pendência antes e o updateUser
 *    falhasse, a pessoa sairia da obrigação sem ter trocado senha nenhuma.
 * 2. Limpar a pendência com SERVICE ROLE. A RPC é revogada de `authenticated`
 *    justamente para não existir caminho em que alguém limpe a própria
 *    pendência pelo PostgREST sem trocar coisa alguma.
 * 3. Renovar o token, e isto não é cosmético: o updateUser rotaciona a sessão,
 *    mas o token que ele devolve foi cunhado ANTES do passo 2 e ainda carrega a
 *    pendência. Sem este passo a pessoa troca a senha e continua presa na tela.
 */
export async function trocarSenhaObrigatoria(prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const r = await changeOwnPassword(prev, formData);
  if (!r.ok) return r;

  await createServiceClient().rpc("concluir_troca_de_senha", { p_user: user.id });

  // `signInWithPassword` e não `refreshSession`: a senha nova está aqui, e ele
  // não depende de o refresh token ter sobrevivido à rotação do updateUser.
  // Não passa pelo throttle de login de propósito: não é tentativa de adivinhar
  // senha, é a senha que esta mesma requisição acabou de definir.
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: user.email ?? "",
    password: String(formData.get("new_password") ?? ""),
  });
  if (error) {
    // a senha JÁ foi trocada; só o token não renovou. Entrar de novo resolve.
    await supabase.auth.signOut();
    redirect("/login");
  }

  redirect("/dashboard");
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

    /**
     * O sharp entra SOB DEMANDA, nunca no topo do arquivo.
     *
     * Ele é módulo nativo (libvips). Importado no topo, o binário era carregado
     * ao simplesmente CARREGAR este módulo de actions — e como "Meu perfil" vive
     * no menu de todas as telas, o Next puxa este arquivo no registro de actions
     * de QUALQUER rota. Em produção o libvips não estava presente no runtime, e
     * o efeito era 500 em toda server action do sistema (salvar qualquer coisa,
     * e até o Sair), não só no envio da foto. Aqui a falha fica onde nasceu.
     */
    let sharp: (typeof import("sharp"))["default"];
    try {
      sharp = (await import("sharp")).default;
    } catch (e) {
      console.error("[avatar] sharp indisponível no runtime", e);
      return { error: "O processamento de imagem está indisponível no servidor. Avise a administração." };
    }

    const entrada = Buffer.from(await file.arrayBuffer());
    let webp: Buffer;
    try {
      webp = await sharp(entrada)
        .rotate() // respeita a orientação do EXIF antes de descartá-lo
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "attention" })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      console.error("[avatar] sharp não leu a entrada", { declarado: file.size, recebido: entrada.length, tipo: file.type });
      return { error: "Não foi possível ler a imagem. Tente outro arquivo." };
    }

    // Blob, e não o Buffer do sharp: dentro da Server Action o corpo binário chega
    // ao storage decodificado como texto, cada byte invalido virando U+FFFD. O
    // arquivo sobe com a assinatura RIFF certa e o conteudo destruido. Os outros
    // uploads do projeto nunca esbarraram nisso porque repassam o File do FormData.
    const corpo = new Blob([new Uint8Array(webp)], { type: "image/webp" });

    // o user_id como primeiro segmento é o que a policy do bucket exige
    const path = `${userId}/${Date.now()}_${crypto.randomUUID()}.webp`;
    const up = await supabase.storage.from(AVATAR_BUCKET).upload(path, corpo, {
      contentType: "image/webp",
      upsert: false,
      cacheControl: "31536000", // a URL muda a cada envio, então pode cachear para sempre
    });
    if (up.error) return { error: "Não foi possível enviar a imagem." };

    // Relê o que foi gravado antes de apontar o perfil para lá. Já aconteceu de o
    // arquivo chegar ao storage decodificado como texto (bytes virando U+FFFD): a
    // assinatura RIFF continua certa, o objeto sobe sem erro e só o navegador
    // descobre, mostrando a inicial de novo. Melhor falhar aqui, com mensagem.
    const conferencia = await supabase.storage.from(AVATAR_BUCKET).download(path);
    const gravado = conferencia.data ? Buffer.from(await conferencia.data.arrayBuffer()) : null;
    let valido = false;
    try { valido = !!gravado && (await sharp(gravado).metadata()).width === AVATAR_SIZE; } catch { valido = false; }
    if (!valido) {
      console.error("[avatar] arquivo gravado saiu inválido", { enviado: webp.length, gravado: gravado?.length ?? 0 });
      await supabase.storage.from(AVATAR_BUCKET).remove([path]);
      return { error: "A imagem chegou corrompida ao servidor. Tente novamente." };
    }

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

    // sem "layout": revalidar a raiz inteira derruba o cache de rotas do navegador,
    // e a navegação seguinte volta a pagar o carregamento do zero em toda tela.
    // O avatar chega pelo mapa do layout, que o router.refresh do diálogo já renova.
    revalidatePath("/dashboard");
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

    // sem "layout": revalidar a raiz inteira derruba o cache de rotas do navegador,
    // e a navegação seguinte volta a pagar o carregamento do zero em toda tela.
    // O avatar chega pelo mapa do layout, que o router.refresh do diálogo já renova.
    revalidatePath("/dashboard");
    return { ok: true, message: "Foto removida." };
  } catch (e) { return { error: (e as Error).message }; }
}
