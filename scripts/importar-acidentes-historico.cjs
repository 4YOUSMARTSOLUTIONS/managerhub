/**
 * Carga do histórico de acidentes a partir da planilha.
 *
 * Roda com service role porque não há tela de importação de acidentes e a RLS
 * exige equipe de segurança. É carga única de histórico, não caminho de uso.
 *
 * Decisões combinadas com o LUIZ:
 *  - "INCIDENTE" (5) entra como FAI;
 *  - LTI entra com 1 dia de afastamento (mínimo que a regra aceita) para
 *    correção posterior — a planilha não traz a coluna;
 *  - tudo entra ENCERRADO, com a data de cadastro da planilha como data de
 *    encerramento (são casos de 2022 a 2026, não fila de trabalho);
 *  - "Ações imediatas" vai para Análise da causa, com rótulo;
 *  - "houve perdas = Sim" (6) entra marcado, com descrição provisória.
 */
const fs = require("node:fs");
const XLSX = require("C:/Users/luiz.nobre/Desktop/MANAGERHUB/node_modules/xlsx");

const RAIZ = "C:/Users/luiz.nobre/Desktop/MANAGERHUB";
const TENANT = "373d5ce2-9c41-4cad-bfe7-24b80616ffa9";
const AUTOR = "6fe54584-70bd-44e0-9542-6f70a0c800a7"; // LUIZ (owner), autor da carga
const PLANILHA = "C:/Users/luiz.nobre/Desktop/Acidentes histórico.xlsx";
const SO_CONFERIR = process.argv.includes("--conferir");

const env = Object.fromEntries(
  fs.readFileSync(RAIZ + "/.env.local", "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const API = env.NEXT_PUBLIC_SUPABASE_URL + "/rest/v1";
const H = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
  "Content-Type": "application/json",
};

/** "10-11-2022" -> "2022-11-10" */
function data(br) {
  const [d, m, a] = String(br || "").trim().split(/[-/]/);
  return d && m && a ? `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : null;
}

/**
 * Normaliza o texto e, quando havia rótulo, remove o resquício de tabulação.
 *
 * O "t" solto só é retirado DEPOIS de um rótulo ter casado: ele é o 	 da
 * exportação de origem, colado no texto ("...(O que aconteceu?) tDURANTE").
 * Removê-lo sempre comeria a inicial de valores legítimos — "Tornozelo" virava
 * "ornozelo" e "Tronco" virava "ronco".
 */
function limpar(txt, rotulo) {
  let s = String(txt || "").replace(/\s+/g, " ").trim();
  if (rotulo) {
    const antes = s;
    s = s.replace(rotulo, "").trim();
    if (s !== antes) s = s.replace(/^t(?=[A-ZÀ-Ú\-–])/, "").replace(/^[-–:\s]+/, "").trim();
  }
  return s;
}

const CLASSE = { LTI: "lti", MDI: "mdi", FAI: "fai", MTI: "mti", INCIDENTE: "fai" };
const TIPO = { "TÍPICO": "tipico", "TIPICO": "tipico", TRAJETO: "trajeto" };

(async () => {
  const wb = XLSX.readFile(PLANILHA);
  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: false });

  // pessoas: o casamento é por CPF, nunca por nome
  const cpfs = [...new Set(linhas.map((l) => String(l["CPF"] || "").replace(/\D/g, "")))];
  const rp = await fetch(`${API}/profiles?select=id,cpf,full_name&cpf=in.(${cpfs.join(",")})`, { headers: H });
  const pessoas = await rp.json();
  const porCpf = new Map(pessoas.map((p) => [p.cpf, p]));

  const ru = await fetch(`${API}/units?select=id,name&tenant_id=eq.${TENANT}`, { headers: H });
  const unidades = await ru.json();
  const porUnidade = new Map(unidades.map((u) => [u.name.toUpperCase(), u.id]));

  const registros = [];
  const problemas = [];

  linhas.forEach((l, i) => {
    const cpf = String(l["CPF"] || "").replace(/\D/g, "");
    const pessoa = porCpf.get(cpf);
    const classe = CLASSE[String(l["NOTIFICAÇÃO DE"] || "").trim().toUpperCase()];
    const tipo = TIPO[String(l["TIPO"] || "").trim().toUpperCase()];
    const occurredOn = data(l["DATA DO ACIDENTE"]);
    const cadastro = data(l["DATA DE CADASTRO"]);

    if (!pessoa) problemas.push(`linha ${i + 2}: CPF ${cpf} sem cadastro`);
    if (!classe) problemas.push(`linha ${i + 2}: classe desconhecida "${l["NOTIFICAÇÃO DE"]}"`);
    if (!tipo) problemas.push(`linha ${i + 2}: tipo desconhecido "${l["TIPO"]}"`);
    if (!occurredOn) problemas.push(`linha ${i + 2}: data inválida "${l["DATA DO ACIDENTE"]}"`);
    if (!pessoa || !classe || !tipo || !occurredOn) return;

    const hora = String(l["HORÁRIO"] || "").trim();
    const tipoLesao = limpar(l["TIPO LESÃO"]);
    const descLesao = limpar(l["DESCRIÇÃO DA LESÃO"]);
    const acoes = limpar(l["AÇÕES IMEDIATAS CORRETIVAS TOMADAS"], /^Ações imediatas corretivas tomadas:?/i);
    const perdas = String(l["HOUVE PERDAS MATERIAIS"] || "").trim().toLowerCase() === "sim";

    registros.push({
      tenant_id: TENANT,
      unit_id: porUnidade.get(String(l["UNIDADE"] || "").trim().toUpperCase()) ?? null,
      occurred_on: occurredOn,
      occurred_at: /^\d{1,2}:\d{2}/.test(hora) ? hora.slice(0, 5) + ":00" : null,
      classe,
      tipo,
      status: "encerrado",
      user_id: pessoa.id,
      descricao: limpar(l["DESCRIÇÃO ACIDENTE/INCIDENTE"], /^Descrição do acidente \/ incidente:\(O que aconteceu\?\)/i),
      parte_corpo: limpar(l["PARTE DO CORPO"]) || null,
      // a natureza reúne o tipo de lesão do catálogo de origem e o detalhe
      // descrito, que não tem campo próprio aqui
      natureza_lesao: [tipoLesao, descLesao].filter(Boolean).join(" — ") || null,
      analise_causa: acoes ? `Ações imediatas tomadas: ${acoes}` : null,
      // LTI exige dias > 0 (regra do banco). A planilha não traz a coluna: entra
      // o mínimo, para correção pela tela.
      dias_afastamento: classe === "lti" ? 1 : null,
      houve_perdas: perdas,
      perdas_descricao: perdas ? "Perdas informadas na notificação de origem, sem detalhamento." : null,
      perdas_valor: null,
      encerrado_em: (cadastro ?? occurredOn) + "T12:00:00Z",
      encerrado_por: AUTOR,
      created_by: AUTOR,
    });
  });

  console.log(`Linhas na planilha: ${linhas.length}`);
  console.log(`Prontos para importar: ${registros.length}`);
  console.log(`Problemas: ${problemas.length}`);
  problemas.forEach((p) => console.log("  !", p));

  const porClasse = {};
  registros.forEach((r) => { porClasse[r.classe] = (porClasse[r.classe] || 0) + 1; });
  console.log("Por classe:", JSON.stringify(porClasse));
  console.log("Com perdas:", registros.filter((r) => r.houve_perdas).length);
  console.log("Sem unidade resolvida:", registros.filter((r) => !r.unit_id).length);

  if (SO_CONFERIR) {
    console.log("\n--- amostra (1º registro) ---");
    console.log(JSON.stringify(registros[0], null, 1));
    return;
  }

  if (problemas.length > 0) {
    console.log("\nABORTADO: resolva os problemas antes de importar.");
    return;
  }

  const resp = await fetch(`${API}/seg_acidentes`, {
    method: "POST",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify(registros),
  });
  const corpo = await resp.json();
  if (!resp.ok) {
    console.log("FALHOU:", resp.status, JSON.stringify(corpo).slice(0, 500));
    return;
  }
  console.log(`\nIMPORTADOS: ${corpo.length} acidentes.`);
})();
