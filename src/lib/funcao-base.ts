/**
 * O nome base de uma função: sem acento, maiúsculo e sem o nível do fim
 * ("Representante de Negócios Master" → "REPRESENTANTE DE NEGOCIOS"). É a mesma
 * regra do banco (`public.funcao_base`), usada nas funções da carteira de
 * Equipes do setor: um nível novo da mesma função entra sozinho.
 */
const NIVEIS = new Set(["I", "II", "III", "IV", "V", "JR", "JUNIOR", "PLENO", "SENIOR", "MASTER"]);

export function funcaoBase(nome: string | null | undefined): string {
  const c = (nome ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
  const partes = c.split(" ");
  return partes.length > 1 && NIVEIS.has(partes[partes.length - 1]) ? partes.slice(0, -1).join(" ") : c;
}
