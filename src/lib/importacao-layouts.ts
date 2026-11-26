/**
 * Formatos de arquivo aceitos na importação de colaboradores.
 *
 * Todo formato vira a MESMA linha: a do modelo do Manager HUB (as chaves que a
 * RPC `admin_import_employees` lê). Daí em diante o caminho é um só, para
 * qualquer empresa: prévia, regras de sugestão, datas das mudanças.
 *
 * - **Modelo Manager HUB**: a planilha baixada em "Baixar modelo" ou exportada
 *   da lista de colaboradores.
 * - **Domínio (Thomson Reuters)**: o relatório "Empregados em Excel", como sai
 *   do sistema da folha (LUIZ, 26/11/2026). Antes o DP montava o modelo à mão a
 *   partir dele, numa planilha de 8 abas.
 *
 * Roda no navegador. O arquivo do Domínio traz salário, RG, PIS, endereço,
 * filiação e raça/cor: daqui só saem as colunas que a importação usa, e o resto
 * nem chega ao servidor.
 *
 * Outro sistema de folha entra como mais um formato aqui, sem mexer no resto.
 */

export type LinhaModelo = Record<string, string>;
export type LinhaLida = { data: LinhaModelo; dismissed: boolean };

export type ConfigImportacao = {
  /** código de empresa do Domínio ("Cód Emp") → nome da unidade */
  empresasDominio: Record<string, string>;
};

export type FormatoArquivo = "modelo" | "dominio";

export const NOME_DO_FORMATO: Record<FormatoArquivo, string> = {
  modelo: "Modelo do Manager HUB",
  dominio: "Arquivo do Domínio",
};

export type Leitura = {
  formato: FormatoArquivo;
  linhas: LinhaLida[];
  /** linhas sem CPF ou nome (no Domínio, também as de total no rodapé) */
  ignoradas: number;
  /** o que impede a leitura inteira: coluna faltando, empresa sem unidade */
  erros: string[];
};

export const normCabecalho = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

const pad = (n: number) => String(n).padStart(2, "0");
export function cellStr(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  return String(v).trim();
}

/** espaços de qualquer tipo viram um só (a mesma limpeza do banco, `nome_limpo`) */
const limpo = (s: string) => s.replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// Modelo do Manager HUB
// ---------------------------------------------------------------------------

export function campoDoModelo(header: string): string | null {
  const h = normCabecalho(header);
  // Gestor vem PRIMEIRO: "Código Gestor" contém "codigo" e cairia em
  // employee_code lá embaixo, atribuindo a matrícula do chefe ao subordinado.
  //
  // Só a MATRÍCULA entra. Uma coluna de nome de gestor é ignorada de propósito:
  // nome tem homônimo, e numa planilha de ~1000 linhas cada acerto por
  // aproximação é uma chance de vincular a pessoa errada em silêncio. A
  // exportação continua trazendo o nome, marcado como não editável, para
  // conferência.
  if (h.includes("gestor") || h.includes("lider") || h.includes("superior")) {
    return h.includes("codigo") || h.includes("matricula") ? "manager_code" : null;
  }
  // "Perfil" sozinho é o perfil de ACESSO. Vem antes do teste de "perfil função",
  // que é o nível do cargo (Júnior/Pleno/Sênior) e nada tem a ver com permissão.
  if (h === "perfil" || h.includes("perfil de acesso") || h.includes("tipo de usuario")) return "role";
  if (h.includes("hierarquia") || h === "nivel hierarquico") return "hierarchy";
  if (h.includes("sub setor") || h.includes("subsetor")) return "subdepartment";
  if (h.startsWith("perfil")) return "level";
  if (h === "empresa" || h === "unidade") return "unit";
  if (h.includes("codigo") || h === "matricula") return "employee_code";
  if (h.includes("nome")) return "full_name";
  if (h.includes("admiss")) return "admission_date";
  if (h.includes("funcao")) return "position";
  if (h === "setor") return "department";
  if (h.includes("nascimento")) return "birth_date";
  if (h === "cpf") return "cpf";
  if (h.includes("demiss")) return "__demissao";
  if (h === "sexo") return "gender";
  if (h.includes("telefone") || h.includes("celular")) return "phone";
  if (h.includes("mail")) return "email";
  return null;
}

function lerModelo(aoa: unknown[][]): Leitura {
  const campos = (aoa[0] ?? []).map((h) => campoDoModelo(String(h ?? "")));
  const linhas: LinhaLida[] = [];
  let ignoradas = 0;
  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i] ?? [];
    const obj: LinhaModelo = {};
    campos.forEach((f, idx) => { if (f) obj[f] = cellStr(r[idx]); });
    // a data de demissão decide se a linha cria cadastro (filtro "apenas
    // ativos") E precisa seguir para o servidor: é ela que desliga quem existe
    const dismissed = !!obj["__demissao"];
    if (dismissed) obj["dismissed_at"] = obj["__demissao"];
    delete obj["__demissao"];
    if (!obj["cpf"] || !obj["full_name"]) { ignoradas++; continue; }
    linhas.push({ data: obj, dismissed });
  }
  return { formato: "modelo", linhas, ignoradas, erros: [] };
}

// ---------------------------------------------------------------------------
// Domínio
// ---------------------------------------------------------------------------

/** as colunas que a leitura usa; o resto do relatório é descartado aqui */
const DOMINIO = {
  empresa: "cod emp",
  matricula: "cod epr",
  nome: "nome do empregado",
  admissao: "admissao",
  cargo: "nome cargo",
  setor: "descricao dpto",
  cpf: "cpf",
  nascimento: "data nascimento",
  sexo: "sexo",
  demissao: "data demissao",
  telefone: "telefone",
  celular: "celular",
  email: "email",
} as const;

/** sem elas o arquivo não serve: o Domínio mudou o relatório, ou é outro relatório */
const DOMINIO_OBRIGATORIAS: (keyof typeof DOMINIO)[] = [
  "empresa", "matricula", "nome", "admissao", "cargo", "setor", "cpf", "nascimento", "sexo", "demissao",
];

const ROTULO_DOMINIO: Record<keyof typeof DOMINIO, string> = {
  empresa: "Cód Emp", matricula: "Cód Epr", nome: "Nome do Empregado", admissao: "Admissão",
  cargo: "Nome cargo", setor: "Descrição Dpto", cpf: "CPF", nascimento: "Data nascimento",
  sexo: "Sexo", demissao: "Data Demissão", telefone: "Telefone", celular: "Celular", email: "Email",
};

export function ehArquivoDoDominio(cabecalhos: string[]): boolean {
  const hs = new Set(cabecalhos.map(normCabecalho));
  return hs.has(DOMINIO.matricula) && hs.has(DOMINIO.nome);
}

/**
 * O nível do cargo é a última palavra da função ("MOTORISTA PLENO" → PLENO).
 *
 * A planilha do DP fazia isso no Power Query com dois defeitos, que deixavam 22
 * ativos sem nível em 26/11/2026: comparava a palavra em maiúsculas com
 * "Master" (nunca casava) e não tirava o espaço que o Domínio deixa no fim de
 * algumas funções ("MOTORISTA PLENO "), o que fazia a última palavra sair vazia.
 */
const NIVEIS = new Set(["I", "II", "III", "IV", "V", "JR", "JUNIOR", "PLENO", "SENIOR", "MASTER"]);
export function nivelDaFuncao(funcao: string): string {
  const palavras = limpo(funcao).split(" ");
  const ultima = palavras[palavras.length - 1] ?? "";
  const chave = ultima.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return palavras.length > 1 && NIVEIS.has(chave) ? ultima : "";
}

function lerDominio(aoa: unknown[][], config: ConfigImportacao): Leitura {
  const cab = (aoa[0] ?? []).map((h) => normCabecalho(String(h ?? "")));
  const col = {} as Record<keyof typeof DOMINIO, number>;
  for (const k of Object.keys(DOMINIO) as (keyof typeof DOMINIO)[]) col[k] = cab.indexOf(DOMINIO[k]);
  const faltando = DOMINIO_OBRIGATORIAS.filter((k) => col[k] < 0);
  if (faltando.length > 0) {
    return {
      formato: "dominio", linhas: [], ignoradas: 0,
      erros: [
        `O arquivo do Domínio não tem ${faltando.length === 1 ? "a coluna" : "as colunas"} ` +
        `${faltando.map((k) => `"${ROTULO_DOMINIO[k]}"`).join(", ")}. ` +
        "Exporte de novo o relatório \"Empregados em Excel\" com todas as colunas.",
      ],
    };
  }

  const v = (r: unknown[], k: keyof typeof DOMINIO) => (col[k] >= 0 ? cellStr(r[col[k]]) : "");
  const empresas = new Map(Object.entries(config.empresasDominio).map(([k, u]) => [k.trim(), u.trim()]));
  const semUnidade = new Set<string>();
  const linhas: LinhaLida[] = [];
  let ignoradas = 0;

  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i] ?? [];
    const codEmp = v(r, "empresa");
    const cpf = v(r, "cpf");
    const nome = limpo(v(r, "nome"));
    // o rodapé "Total: 1084" vem na coluna da matrícula, sem empresa nem CPF
    if (!codEmp || !cpf || !nome) { ignoradas++; continue; }
    const unidade = empresas.get(codEmp.replace(/^0+(?=\d)/, "")) ?? empresas.get(codEmp);
    if (!unidade) { semUnidade.add(codEmp); continue; }

    const funcao = limpo(v(r, "cargo"));
    const celular = v(r, "celular").replace(/\D/g, "");
    const telefone = celular || v(r, "telefone").replace(/\D/g, "");
    const demissao = v(r, "demissao");
    const data: LinhaModelo = {
      unit: unidade,
      employee_code: v(r, "matricula"),
      full_name: nome,
      admission_date: v(r, "admissao"),
      position: funcao,
      level: nivelDaFuncao(funcao),
      department: limpo(v(r, "setor")),
      birth_date: v(r, "nascimento"),
      cpf,
      gender: v(r, "sexo"),
      phone: telefone,
      email: v(r, "email").toLowerCase(),
    };
    if (demissao) data.dismissed_at = demissao;
    // vazio não mexe em nada no banco: não mandar a chave é o mesmo que vazio
    for (const k of Object.keys(data)) if (data[k] === "") delete data[k];
    linhas.push({ data, dismissed: !!demissao });
  }

  const erros = semUnidade.size > 0
    ? [`Código de empresa sem unidade: ${[...semUnidade].sort().join(", ")}. ` +
       "Diga a qual unidade cada código corresponde em Configurações > Colaboradores > Regras da importação. " +
       "As linhas dessas empresas ficaram de fora."]
    : [];
  return { formato: "dominio", linhas, ignoradas, erros };
}

/** Reconhece o formato pelos cabeçalhos e devolve as linhas no formato do modelo. */
export function lerPlanilhaDeColaboradores(aoa: unknown[][], config: ConfigImportacao): Leitura {
  const cabecalhos = (aoa[0] ?? []).map((h) => String(h ?? ""));
  return ehArquivoDoDominio(cabecalhos) ? lerDominio(aoa, config) : lerModelo(aoa);
}
