/**
 * A origem canônica do app.
 *
 * Constante no repositório, e não variável de ambiente, de propósito. Este valor
 * entra em LINK DE RECUPERAÇÃO DE SENHA enviado por e-mail, e derivar a origem do
 * cabeçalho `Host` da requisição é a vulnerabilidade clássica desse fluxo: quem
 * pede a recuperação controla o cabeçalho, planta o próprio domínio e o token
 * chega na mão dele. Aqui não há de onde injetar.
 *
 * Ficar no git também é melhor que ficar no painel da Vercel: muda por PR, com
 * revisão e histórico, em vez de por um campo que qualquer pessoa com acesso ao
 * projeto edita sem deixar rastro. E `NEXT_PUBLIC_*` seria pior ainda: viraria
 * literal no bundle do navegador para um valor que só o servidor usa.
 */
export const APP_URL = "https://managerhub.4yousmartsolutions.com.br";

/**
 * A origem para montar links, respeitando o ambiente local.
 *
 * Em desenvolvimento o link precisa apontar para a máquina de quem está testando,
 * senão o e-mail de teste manda a pessoa para produção. A troca é decidida por
 * `NODE_ENV`, que o build define — nunca por dado que venha da requisição.
 */
export function appUrl(): string {
  if (process.env.NODE_ENV === "development") return "http://localhost:3000";
  return APP_URL;
}
