/**
 * O formato da planilha de colaboradores, num lugar só.
 *
 * As colunas são as MESMAS do modelo de importação, e só elas: o arquivo
 * exportado é o que volta pela importação, então toda coluna daqui ou é lida na
 * volta, ou é ruído que convida a ser preenchida à toa. Por isso o gestor sai só
 * como matrícula, sem o nome.
 *
 * Duas telas exportam: Configurações > Colaboradores (DP e Gerencial, a empresa)
 * e Minha equipe (o gestor, a própria cadeia). Com o formato aqui, as duas não
 * têm como divergir.
 */

import { USER_TYPE } from "@/lib/constants";

export const COLUNAS_PLANILHA_COLABORADORES = [
  "Empresa", "Código Funcionário", "Nome Completo", "Admissão", "Função", "Perfil Função",
  "Setor", "Sub Setor", "Data de Nascimento", "CPF", "Demissão", "Sexo", "Telefone", "E-mail",
  "Código Gestor", "Perfil", "Hierarquia",
];

/** O perfil de acesso como aparece na tela e na planilha. */
export function rotuloPerfil(role: string): string {
  if (role === "owner") return "Proprietário";
  return USER_TYPE[role as keyof typeof USER_TYPE] ?? role;
}

export type LinhaColaborador = {
  unitNames: string[];
  employeeCode: string | null;
  fullName: string | null;
  admissionDate: string | null;
  positionName: string | null;
  levelName: string | null;
  departmentName: string | null;
  subdepartmentName: string | null;
  birthDate: string | null;
  cpf: string | null;
  dismissedAt: string | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  /** matrícula do gestor: é ela que a reimportação usa como chave */
  managerCode: string | null;
  role: string;
  hierarchyName: string | null;
};

const dataBr = (d: string | null) =>
  d && d.length >= 10 ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : (d ?? "");

export function linhaDaPlanilhaDeColaboradores(e: LinhaColaborador): string[] {
  return [
    e.unitNames.join("; "), e.employeeCode ?? "", e.fullName ?? "", dataBr(e.admissionDate),
    e.positionName ?? "", e.levelName ?? "", e.departmentName ?? "", e.subdepartmentName ?? "",
    dataBr(e.birthDate), e.cpf ?? "", dataBr(e.dismissedAt), e.gender ?? "", e.phone ?? "",
    e.email ?? "", e.managerCode ?? "", rotuloPerfil(e.role), e.hierarchyName ?? "",
  ];
}

/**
 * Pela MATRÍCULA, como número (a coluna é texto: sem isso sairia 1, 10, 100, 2).
 * Quem não tem matrícula numérica vai para o fim, em ordem de nome.
 */
export function ordemPorMatricula(
  a: { employeeCode: string | null; fullName: string | null },
  b: { employeeCode: string | null; fullName: string | null },
): number {
  const numerica = (v: string | null) => v != null && /^\d+$/.test(v);
  const na = numerica(a.employeeCode);
  const nb = numerica(b.employeeCode);
  if (na && nb) return Number(a.employeeCode) - Number(b.employeeCode);
  if (na !== nb) return na ? -1 : 1;
  return (a.fullName ?? "").localeCompare(b.fullName ?? "", "pt-BR");
}
