"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { chaveDeRecuperacao, dispararRecuperacao } from "@/lib/reset-senha";
import {
  ipDoCliente, checarThrottle, registrarFalha, mensagemBloqueio, type ChaveThrottle,
} from "@/lib/auth-throttle";
import type { ActionState } from "./types";

/**
 * As duas portas da recuperação de senha.
 *
 * O trabalho de verdade mora em `src/lib/reset-senha.ts`, que NÃO é "use server"
 * de propósito. Aqui ficam só as bordas: freio, resposta e navegação.
 */

/**
 * A mesma resposta para tudo: conta existente, inexistente, sem e-mail ou
 * desligada. É o que impede a tela de virar um verificador de quem trabalha aqui.
 * A frase sobre o link anterior não é ornamento: o GoTrue guarda UM token de
 * recuperação por pessoa, então pedir de novo mata o link que já foi enviado, e
 * sem o aviso isso vira chamado de suporte.
 */
const RESPOSTA_UNICA =
  "Se houver uma conta com esse e-mail ou CPF, enviamos um link para o e-mail cadastrado. "
  + "Confira também a caixa de spam. Se você pedir outro link, o anterior deixa de valer.";

export async function pedirRecuperacaoDeSenha(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const identificador = String(formData.get("identifier") ?? "").trim();
  if (!identificador) return { error: "Informe o seu e-mail ou CPF." };

  const chaves: ChaveThrottle[] = [
    { bucket: "reset_ip", chave: await ipDoCliente() },
    { bucket: "reset_id", chave: chaveDeRecuperacao(identificador) },
  ];

  const portao = await checarThrottle(chaves);
  if (portao.bloqueado) return { error: mensagemBloqueio(portao.esperaSegundos) };

  /**
   * Registrar o PEDIDO, e não uma falha.
   *
   * No fluxo de recuperação não existe "errar a senha": todo pedido é legítimo
   * do ponto de vista de quem pede, e o que se limita é a TAXA. `registrarFalha`
   * é, aqui, o contador de eventos com janela. `registrarSucesso` NUNCA é
   * chamado de propósito: ele apagaria o contador a cada pedido bem-sucedido e
   * o freio deixaria de existir. Não "conserte" isso.
   */
  await registrarFalha(chaves);

  /**
   * O trabalho sai do caminho da resposta.
   *
   * Assim a tela responde no mesmo tempo para quem existe e para quem não
   * existe — uniformidade por construção, em vez de tentar equalizar latências
   * à mão — e a ida ao Resend não segura a pessoa esperando.
   */
  after(() => dispararRecuperacao(identificador));

  return { ok: true, message: RESPOSTA_UNICA };
}

/** Traduz o que o Supabase devolve em inglês (molde de `changeOwnPassword`). */
function mensagemDeSenha(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("different from the old password")) {
    return "A nova senha precisa ser diferente da anterior. Peça um novo link e escolha outra.";
  }
  if (m.includes("should be at least")) return "A senha é curta demais para a política do sistema.";
  if (m.includes("pwned") || m.includes("leaked") || m.includes("compromised")) {
    return "Essa senha aparece em vazamentos conhecidos. Peça um novo link e escolha outra.";
  }
  return "Não foi possível salvar a senha. Peça um novo link e tente de novo.";
}

export async function redefinirSenhaComToken(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = String(formData.get("token") ?? "").trim();
  const nova = String(formData.get("new_password") ?? "");
  const confirma = String(formData.get("confirm_password") ?? "");

  /**
   * Validar o que dá para validar ANTES de tocar no token.
   *
   * O token é de uso único: gastá-lo para descobrir que as senhas não conferem
   * obrigaria a pessoa a pedir outro link por um erro de digitação.
   */
  if (nova.length < 8) return { error: "A senha deve ter ao menos 8 caracteres." };
  if (nova !== confirma) return { error: "A confirmação não confere com a nova senha." };
  if (!token) return { error: "Link inválido. Peça um novo na tela de acesso." };

  const chaves: ChaveThrottle[] = [{ bucket: "reset_ip", chave: await ipDoCliente() }];
  const portao = await checarThrottle(chaves);
  if (portao.bloqueado) return { error: mensagemBloqueio(portao.esperaSegundos) };

  const supabase = await createClient();

  /**
   * O token só é consumido AQUI, no envio do formulário, e nunca ao abrir a
   * página. Verificar no GET seria um erro caro: filtro de e-mail corporativo
   * abre os links da mensagem para varredura, e o link, sendo de uso único,
   * chegaria morto na mão de quem recebeu. É justamente a caixa corporativa
   * onde estão os administradores.
   */
  const { data: verificado, error: erroToken } = await supabase.auth.verifyOtp({
    type: "recovery",
    token_hash: token,
  });
  if (erroToken || !verificado?.user) {
    await registrarFalha(chaves);
    return { error: "Este link já foi usado ou expirou. Peça um novo na tela de acesso." };
  }

  const usuario = verificado.user;
  const { error: erroSenha } = await supabase.auth.updateUser({ password: nova });
  if (erroSenha) {
    /**
     * Deu errado depois de o token ter sido gasto, e agora existe sessão sem que
     * a senha tenha mudado. Encerrar é a saída limpa: sem isto a pessoa ficaria
     * logada com a senha antiga, e aceitar "já está logado" como suficiente para
     * trocar a senha abriria em `/redefinir-senha` um caminho para qualquer
     * sessão viva trocar a senha sem saber a atual.
     */
    await supabase.auth.signOut();
    return { error: mensagemDeSenha(erroSenha.message) };
  }

  /**
   * A ordem é a mesma de `trocarSenhaObrigatoria`: a senha primeiro, a pendência
   * depois. Quase toda conta do sistema nasceu com `must_change_password`, e
   * quem acabou de escolher a própria senha já cumpriu o que a regra pede — daí
   * limpar, e não remarcar como faz o reset feito por um administrador (lá o
   * administrador conhece a senha, aqui não).
   */
  await createServiceClient().rpc("concluir_troca_de_senha", { p_user: usuario.id });

  /**
   * O token de sessão foi cunhado antes da limpeza e ainda carrega a claim
   * antiga. Renovar evita uma volta desnecessária por `/trocar-senha`. Se
   * falhar, não é grave: aquela tela faz a leitura autoritativa, vê que não há
   * pendência e devolve a pessoa ao Dashboard.
   */
  if (usuario.email) {
    await supabase.auth.signInWithPassword({ email: usuario.email, password: nova });
  }

  // FORA de qualquer try/catch: `redirect` funciona lançando, e um catch em
  // volta o engoliria deixando a pessoa parada com a senha já trocada.
  redirect("/dashboard");
}
