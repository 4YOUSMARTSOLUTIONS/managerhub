/** Normaliza: maiúsculas e remove tudo que não for [0-9A-Z]. */
export function normalizeCnpj(value: string | null | undefined): string {
  return (value ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/**
 * Valida CNPJ no formato numérico clássico OU no novo alfanumérico:
 * 12 posições alfanuméricas [0-9A-Z] + 2 dígitos verificadores [0-9].
 * O cálculo do DV usa (código ASCII do caractere − 48), que coincide com
 * o valor do dígito quando numérico — então cobre os dois formatos.
 */
export function isValidCnpj(value: string): boolean {
  const c = normalizeCnpj(value);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(c)) return false;
  if (/^(.)\1{13}$/.test(c)) return false; // todos os caracteres iguais

  const dv = (len: number): number => {
    let weight = 2;
    let sum = 0;
    for (let i = len - 1; i >= 0; i--) {
      sum += (c.charCodeAt(i) - 48) * weight;
      weight = weight === 9 ? 2 : weight + 1;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };

  if (dv(12) !== c.charCodeAt(12) - 48) return false;
  if (dv(13) !== c.charCodeAt(13) - 48) return false;
  return true;
}

/** Formata 14 posições como 00.000.000/0000-00 (vale para alfanumérico também). */
export function formatCnpj(value: string | null | undefined): string {
  const c = normalizeCnpj(value);
  if (c.length !== 14) return value ?? "—";
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}
