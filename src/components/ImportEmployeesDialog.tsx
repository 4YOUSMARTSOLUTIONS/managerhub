"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { loadXlsx, matrizDaPlanilha } from "@/lib/xlsx-lazy";
import {
  importEmployees, simularImportacao,
  type ImportSummary, type PendenteImportacao,
} from "@/lib/actions/employees";
import { lembrarRegras } from "@/lib/actions/importacao";
import { lerPlanilhaDeColaboradores, NOME_DO_FORMATO, type FormatoArquivo, type LinhaLida } from "@/lib/importacao-layouts";
import { shortName } from "@/lib/format";
import {
  CompletarImportacao, faltaNoItem, SEM,
  type Escolha, type ItemACompletar, type OpcoesCompletar,
} from "./CompletarImportacao";

type Row = Record<string, string>;

const TEMPLATE_HEADERS = [
  "Empresa", "Código Funcionário", "Nome Completo", "Admissão", "Função",
  "Perfil Função", "Setor", "Sub Setor", "Data de Nascimento", "CPF",
  "Demissão", "Sexo", "Telefone", "E-mail", "Código Gestor", "Perfil", "Hierarquia",
];

const pad = (n: number) => String(n).padStart(2, "0");

const soDigitos = (s: string | undefined) => (s ?? "").replace(/\D/g, "");
function hojeIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const dataBr = (iso: string) => iso.split("-").reverse().join("/");

const CHUNK = 150;

function resumoVazio(): ImportSummary {
  return {
    created: 0, updated: 0, skipped: 0, managers: 0, roles: 0, hierarchies: 0, levels: 0,
    movimentacoes: 0, preenchimentos: 0, admissoes: 0,
    skippedList: [], updatedList: [], managersList: [], rolesList: [], hierarchiesList: [],
    levelsList: [], movimentacoesList: [], pendentes: [], admissoesList: [], admissoesDivergentes: [],
    errors: [], createdList: [], avisos: [],
  };
}

function somar(agg: ImportSummary, res: ImportSummary) {
  agg.created += res.created ?? 0;
  agg.updated += res.updated ?? 0;
  agg.skipped += res.skipped ?? 0;
  agg.managers += res.managers ?? 0;
  agg.roles += res.roles ?? 0;
  agg.hierarchies += res.hierarchies ?? 0;
  agg.levels += res.levels ?? 0;
  agg.movimentacoes += res.movimentacoes ?? 0;
  agg.preenchimentos += res.preenchimentos ?? 0;
  agg.admissoes += res.admissoes ?? 0;
  agg.skippedList.push(...(res.skippedList ?? []));
  agg.updatedList.push(...(res.updatedList ?? []));
  agg.managersList.push(...(res.managersList ?? []));
  agg.rolesList.push(...(res.rolesList ?? []));
  agg.hierarchiesList.push(...(res.hierarchiesList ?? []));
  agg.levelsList.push(...(res.levelsList ?? []));
  agg.movimentacoesList.push(...(res.movimentacoesList ?? []));
  agg.pendentes.push(...(res.pendentes ?? []));
  agg.admissoesList.push(...(res.admissoesList ?? []));
  agg.admissoesDivergentes.push(...(res.admissoesDivergentes ?? []));
  agg.errors.push(...(res.errors ?? []));
  agg.createdList.push(...(res.createdList ?? []));
  agg.avisos.push(...(res.avisos ?? []));
}

/** o que impede a data de valer; null = ok. As mesmas regras do servidor. */
function problemaDaData(p: PendenteImportacao, v: string, hoje: string): string | null {
  if (!v) return "Informe a data";
  if (v > hoje) return "Não pode ser futura";
  if (p.desde && v < p.desde) return `Use uma data a partir de ${dataBr(p.desde)}`;
  return null;
}

/**
 * O que a importação precisa saber do sistema para ler o arquivo da folha
 * (Domínio) e sugerir o que ele não traz. Vem da página de Configurações.
 */
export type ContextoImportacao = {
  /** código de empresa do Domínio → unidade */
  empresasDominio: Record<string, string>;
  /** quem tem vínculo ativo, com a situação de hoje */
  ativos: {
    userId: string; nome: string; cpf: string | null; codigo: string | null; unidades: string[];
    gestorId: string | null; gestorNome: string | null; hierarquiaId: string | null; hierarquiaNome: string | null;
  }[];
  /** função (nome) → hierarquia */
  regrasFuncao: { funcao: string; hierarquiaId: string }[];
  /** subsetor + unidade (nome) → gestor */
  regrasSubsetor: { subsetorId: string; unidade: string; gestorId: string }[];
  opcoes: OpcoesCompletar;
};

const canon = (s: string) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
const chaveDeVinculo = (unidade: string, codigo: string) =>
  `${canon(unidade)}|${(codigo ?? "").trim().replace(/^0+(?=\d)/, "")}`;

export function ImportEmployeesDialog({ open, onClose, podeDefinirPerfil = true, contexto }: {
  open: boolean;
  onClose: () => void;
  /** false para o RH: a coluna Perfil é ignorada pelo servidor */
  podeDefinirPerfil?: boolean;
  /** sem ele, o arquivo do Domínio não tem como achar a unidade de cada empresa */
  contexto?: ContextoImportacao;
}) {
  // guarda TODAS as linhas lidas com o sinalizador de demissão: assim alternar
  // "apenas ativos" só reaplica o filtro, sem precisar reler o arquivo
  const [parsed, setParsed] = useState<{ data: Row; dismissed: boolean }[]>([]);
  const [ignored, setIgnored] = useState(0);
  const [onlyActive, setOnlyActive] = useState(true);
  const [password, setPassword] = useState("Mudar@123");
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  // prévia: o banco roda a planilha e desfaz; daqui sai quem precisa de data
  const [analise, setAnalise] = useState<ImportSummary | null>(null);
  const [analisando, setAnalisando] = useState(false);
  const [datas, setDatas] = useState<Record<string, string>>({});
  const [dataTodos, setDataTodos] = useState("");
  // admissão divergente só é corrigida para quem for marcado
  const [corrigirAdm, setCorrigirAdm] = useState<Record<string, boolean>>({});
  // arquivo da folha (Domínio): o que ele não traz é completado aqui
  const [formato, setFormato] = useState<FormatoArquivo>("modelo");
  const [errosDaLeitura, setErrosDaLeitura] = useState<string[]>([]);
  const [antigos, setAntigos] = useState(0);
  const [ausentes, setAusentes] = useState<{ nome: string; codigo: string; unidade: string }[]>([]);
  const [itens, setItens] = useState<ItemACompletar[]>([]);
  const [escolhas, setEscolhas] = useState<Record<string, Escolha>>({});
  const [lembrar, setLembrar] = useState(true);
  // a prévia vale para as escolhas do momento em que rodou
  const [conferido, setConferido] = useState(true);
  const router = useRouter();

  // "Apenas ativos" NÃO joga mais a linha fora. Jogar fora era o que engolia a
  // baixa de quem JÁ está cadastrado: a linha nem chegava ao servidor, e o
  // cadastro antigo seguia Ativo. Agora todas sobem, e a de desligado leva o
  // sinal `skip_if_new`, que impede apenas a CRIAÇÃO de cadastro novo. É o que
  // a caixa sempre quis dizer: não inflar a base com quem já saiu.
  const rows = useMemo(
    () => parsed.map((p) => (onlyActive && p.dismissed ? { ...p.data, skip_if_new: "1" } : p.data)),
    [parsed, onlyActive],
  );
  const dismissed = useMemo(() => parsed.filter((p) => p.dismissed).length, [parsed]);

  if (!open) return null;

  const hoje = hojeIso();
  const pendentes = analise?.pendentes ?? [];
  const admDiv = analise?.admissoesDivergentes ?? [];
  const faltando = pendentes.filter((p) => problemaDaData(p, datas[p.cpf] ?? "", hoje)).length;

  async function downloadTemplate() {
    const XLSX = await loadXlsx();
    const ex1 = ["MATRIZ; FILIAL", "1001", "João da Silva", "01/02/2024", "Analista", "Pleno", "Comercial", "Vendas", "10/05/1990", "390.533.447-05", "", "Masculino", "(11) 99999-0000", "joao@empresa.com", "1002", "Funcionário", "Analista"];
    const ex2 = ["FILIAL", "1002", "Maria Souza", "15/08/2023", "Assistente", "Júnior", "Administrativo", "Financeiro", "02/11/1995", "111.444.777-35", "", "Feminino", "", "", "", "Gestor", "Coordenação"];
    const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ex1, ex2]);
    ws["!cols"] = TEMPLATE_HEADERS.map(() => ({ wch: 22 }));

    const instr = [
      ["Coluna", "Obrigatório", "Como preencher"],
      ["Empresa", "Sim", "Unidade(s). Para mais de uma, separe por ; (ex.: MATRIZ; FILIAL). Transferir quem já está cadastrado pede a data da mudança"],
      ["Código Funcionário", "Sim", "Matrícula do colaborador"],
      ["Nome Completo", "Sim", "Nome completo"],
      ["Admissão", "Sim", "Data no formato dd/mm/aaaa. Se for diferente da cadastrada, a tela mostra e só corrige quem você marcar"],
      ["Função", "Sim", "Cargo (criado automaticamente se não existir). Em quem já está cadastrado, trocar a função pede a data da mudança na hora de importar"],
      ["Perfil Função", "Não", "Nível do cargo (ex.: JUNIOR, PLENO, SENIOR). Vazio mantém o atual; trocar pede a data da mudança"],
      ["Setor", "Sim", "Criado automaticamente se não existir. Trocar o setor de quem já está cadastrado pede a data da mudança"],
      ["Sub Setor", "Não", "Subsetor dentro do setor. Trocar o setor sem informar o subsetor deixa o colaborador sem subsetor"],
      ["Data de Nascimento", "Sim", "Formato dd/mm/aaaa"],
      ["CPF", "Sim", "Com ou sem pontuação"],
      ["Demissão", "Não", "Se preenchida (dd/mm/aaaa), o colaborador fica INATIVO, inclusive quem já está cadastrado. Vazia não reativa ninguém"],
      ["Sexo", "Sim", "Masculino / Feminino / Outro"],
      ["Telefone", "Não", "Opcional"],
      ["E-mail", "Não", "Se vazio, o login do colaborador será por CPF"],
      ["Código Gestor", "Não", "MATRÍCULA do gestor (a mesma que está em Código Funcionário na linha dele). Vazio = não mexe no gestor atual. Para tirar o gestor, escreva -. Trocar o gestor pede a data da mudança"],
      ["Perfil", "Não", "Gestor, Gerencial ou Funcionário. Vazio = não muda o perfil. Administrador e Proprietário só pela tela"],
      ["Hierarquia", "Não", "Diretoria, Gerência, Coordenação, Supervisão, Analista... Nível que ainda não existir é criado. Vazio = não muda; trocar pede a data da mudança"],
    ];
    const wsI = XLSX.utils.aoa_to_sheet(instr);
    wsI["!cols"] = [{ wch: 22 }, { wch: 12 }, { wch: 64 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Colaboradores");
    XLSX.utils.book_append_sheet(wb, wsI, "Instruções");
    XLSX.writeFile(wb, "modelo_colaboradores.xlsx");
  }

  async function analisar(linhas: Row[]) {
    setAnalisando(true); setAnalise(null); setDatas({}); setDataTodos(""); setCorrigirAdm({});
    const agg = resumoVazio();
    for (let i = 0; i < linhas.length; i += CHUNK) {
      const part = linhas.slice(i, i + CHUNK);
      setProgress(`Analisando ${Math.min(i + part.length, linhas.length)} de ${linhas.length}…`);
      somar(agg, await simularImportacao(part));
    }
    // a mesma pessoa em duas linhas aparece uma vez só
    const vistos = new Set<string>();
    agg.pendentes = agg.pendentes.filter((p) => (vistos.has(p.cpf) ? false : (vistos.add(p.cpf), true)));
    const vistosAdm = new Set<string>();
    agg.admissoesDivergentes = agg.admissoesDivergentes.filter((a) => (vistosAdm.has(a.cpf) ? false : (vistosAdm.add(a.cpf), true)));
    setAnalise(agg); setAnalisando(false); setProgress("");
    return agg;
  }

  /** as linhas com o que o DP completou (só no arquivo da folha) */
  function comEscolhas(linhas: Row[]): Row[] {
    if (formato !== "dominio" || !contexto) return linhas;
    const porId = new Map(contexto.ativos.map((a) => [a.userId, a]));
    const subNome = new Map(contexto.opcoes.subsetores.map((x) => [x.id, x.name]));
    const hierNome = new Map(contexto.opcoes.hierarquias.map((x) => [x.id, x.name]));
    return linhas.map((r) => {
      const e = escolhas[soDigitos(r.cpf)];
      if (!e) return r;
      const x: Row = { ...r };
      // "sem subsetor" é não mandar: na mudança de setor o banco apaga o antigo
      if (e.subsetorId && e.subsetorId !== SEM) x.subdepartment = subNome.get(e.subsetorId) ?? "";
      if (e.gestorId === SEM) x.manager_code = "-";
      else if (e.gestorId) {
        // pelo CPF do gestor: resolve mesmo quando ele é de outra unidade
        const g = porId.get(e.gestorId);
        if (g?.cpf) x.manager = g.cpf;
        else if (g?.codigo) x.manager_code = g.codigo;
      }
      if (e.hierarquiaId === SEM) x.hierarchy = "-";
      else if (e.hierarquiaId) x.hierarchy = hierNome.get(e.hierarquiaId) ?? "";
      return x;
    });
  }

  function escolher(cpf: string, e: Escolha) {
    setEscolhas((atual) => ({ ...atual, [cpf]: e }));
    setConferido(false);
  }

  async function conferir() {
    await analisar(comEscolhas(rows));
    setConferido(true);
  }

  async function onFile(file: File) {
    const XLSX = await loadXlsx();
    setParseError(""); setSummary(null); setParsed([]); setFileName(""); setAnalise(null);
    setErrosDaLeitura([]); setAntigos(0); setAusentes([]); setItens([]); setEscolhas({}); setConferido(true);
    setReading(true);
    // dá um respiro ao navegador para pintar o "Lendo a planilha…" antes de travar na leitura
    await new Promise((r) => setTimeout(r, 0));
    let lidas: LinhaLida[] = [];
    let doDominio = false;
    try {
      const buf = await file.arrayBuffer();
      // datas pelo número de série, sem fuso (ver matrizDaPlanilha)
      const aoa = matrizDaPlanilha(XLSX, XLSX.read(buf, { type: "array", cellNF: true }));
      if (aoa.length < 2) { setParseError("Planilha vazia."); return; }
      const leitura = lerPlanilhaDeColaboradores(aoa, { empresasDominio: contexto?.empresasDominio ?? {} });
      doDominio = leitura.formato === "dominio";
      let out = leitura.linhas;
      if (doDominio) {
        // O arquivo da folha traz TODO o histórico (em 26/11/2026, 766 de 1.084
        // linhas eram de desligados antigos). Sobe só o desligado que ainda
        // está ativo no sistema: é o desligamento que precisa acontecer. O
        // resto não mudaria nada e só deixaria a prévia mais lenta.
        const ativos = new Set((contexto?.ativos ?? []).flatMap((a) => a.unidades.map((u) => chaveDeVinculo(u, a.codigo ?? ""))));
        const chave = (l: LinhaLida) => chaveDeVinculo(l.data.unit ?? "", l.data.employee_code ?? "");
        const noArquivo = new Set(out.map(chave));
        setAntigos(out.filter((l) => l.dismissed && !ativos.has(chave(l))).length);
        out = out.filter((l) => !l.dismissed || ativos.has(chave(l)));
        // ativo no sistema que não veio no arquivo: ou saiu do relatório, ou o
        // filtro da exportação deixou de fora. Não desliga ninguém, só avisa.
        setAusentes((contexto?.ativos ?? [])
          .filter((a) => a.codigo && !a.unidades.some((u) => noArquivo.has(chaveDeVinculo(u, a.codigo ?? ""))))
          .map((a) => ({ nome: a.nome, codigo: a.codigo ?? "", unidade: a.unidades.join("; ") })));
      }
      setFormato(leitura.formato);
      setErrosDaLeitura(leitura.erros);
      setParsed(out); setIgnored(leitura.ignoradas); setFileName(file.name);
      lidas = out;
    } catch (e) {
      setParseError("Não consegui ler o arquivo: " + (e as Error).message);
    } finally {
      setReading(false);
    }
    // quem já existe responde igual com ou sem "apenas ativos": a prévia não
    // precisa ser refeita quando a caixa muda
    if (!lidas.length) return;
    const linhas = lidas.map((p) => p.data);
    const primeira = await analisar(linhas);
    if (doDominio && contexto) {
      const novos = montarItens(primeira, linhas, contexto);
      setItens(novos.itens);
      setEscolhas(novos.escolhas);
      setConferido(novos.itens.length === 0);
    }
  }

  function aplicarATodos() {
    if (!dataTodos) return;
    setDatas(Object.fromEntries(pendentes.map((p) => [p.cpf, dataTodos])));
  }

  async function doImport() {
    setImporting(true); setSummary(null); setProgress("");
    // a data de cada mudança (e a correção de admissão marcada) volta para a
    // linha da pessoa, casada pelo CPF
    const comDatas = comEscolhas(rows).map((r) => {
      const cpf = soDigitos(r.cpf);
      const extra: Row = {};
      if (datas[cpf]) extra.effective_date = datas[cpf];
      if (corrigirAdm[cpf]) extra.corrigir_admissao = "1";
      return Object.keys(extra).length ? { ...r, ...extra } : r;
    });
    const agg = resumoVazio();
    for (let i = 0; i < comDatas.length; i += CHUNK) {
      const part = comDatas.slice(i, i + CHUNK);
      setProgress(`Importando ${Math.min(i + part.length, comDatas.length)} de ${comDatas.length}…`);
      somar(agg, await importEmployees(part, password));
    }
    setImporting(false); setProgress("");
    if (formato === "dominio" && lembrar && contexto && agg.errors.length === 0) {
      const novas = regrasNovas(itens, escolhas, contexto);
      if (novas.funcoes.length || novas.subsetores.length) {
        const r = await lembrarRegras(novas);
        if (r.error) toast.warning(`As regras novas não foram guardadas: ${r.error}`);
        else if (r.message) toast.success(r.message);
      }
    }
    router.refresh();

    const parts = [`${agg.created} criado(s)`];
    if (agg.updated > 0) parts.push(`${agg.updated} recontratado(s)`);
    if (agg.movimentacoes > 0) parts.push(`${agg.movimentacoes} movimentação(ões) registrada(s)`);
    if (agg.preenchimentos > 0) parts.push(`${agg.preenchimentos} cadastro(s) completado(s)`);
    if (agg.admissoes > 0) parts.push(`${agg.admissoes} admissão(ões) corrigida(s)`);
    if (agg.managers > 0) parts.push(`${agg.managers} gestor(es) definido(s)`);
    if (agg.roles > 0) parts.push(`${agg.roles} perfil(is) alterado(s)`);
    if (agg.hierarchies > 0) parts.push(`${agg.hierarchies} hierarquia(s) definida(s)`);
    if (agg.levels > 0) parts.push(`${agg.levels} nível(is) alterado(s)`);
    if (agg.skipped > 0) parts.push(`${agg.skipped} já existiam`);
    // só fecha sozinho quando tudo foi criado; havendo ignorados, recontratados,
    // movimentações ou erros, mantém aberto para o usuário ver de quem se trata
    const soCriacao = agg.errors.length === 0 && agg.skipped === 0 && agg.updated === 0
      && agg.managers === 0 && agg.roles === 0 && agg.hierarchies === 0 && agg.levels === 0
      && agg.movimentacoes === 0 && agg.preenchimentos === 0 && agg.admissoes === 0;
    if (soCriacao) {
      toast.success(`Importação concluída: ${parts.join(", ")}.`);
      onClose();
    } else {
      setSummary(agg);
      if (agg.errors.length > 0) toast.warning(`Importação concluída com ${agg.errors.length} erro(s). Revise a lista.`);
      else toast.success(`Importação concluída: ${parts.join(", ")}.`);
    }
  }

  const ocupado = reading || importing || analisando;
  const faltamEscolhas = itens.filter((i) => faltaNoItem(i, escolhas[i.cpf])).length;
  const largura = (pendentes.length > 0 || admDiv.length > 0 || itens.length > 0) && !summary ? 760 : 620;
  const regraSub = new Map((contexto?.regrasSubsetor ?? []).map((r) => [`${r.subsetorId}|${canon(r.unidade)}`, r.gestorId]));
  const sugestaoGestor = (subsetorId: string, unidade: string) => {
    for (const u of unidade.split(";")) {
      const g = regraSub.get(`${subsetorId}|${canon(u)}`);
      if (g) return g;
    }
    return null;
  };
  // o que a prévia diz, agrupado: é isto que o DP confere antes de importar
  const admissoes = analise ? analise.createdList.filter((c) => !c.desligado).length : 0;
  const desligamentos = analise ? analise.updatedList.filter((u) => u.tipo === "desligamento").length : 0;
  const dadosPessoais = analise ? analise.updatedList.filter((u) => u.tipo === "dados").length : 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 70, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: largura, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>Importar colaboradores</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>

        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ background: "var(--surface-2)", borderRadius: 9, padding: "0.85rem 1rem", fontSize: "0.85rem" }}>
            <p style={{ margin: "0 0 0.5rem" }} className="muted">
              Suba uma planilha (.xlsx) com os colaboradores. Use o modelo abaixo (tem uma aba “Instruções”).
              <br />• <strong>Arquivo do Domínio</strong>: o relatório “Empregados em Excel” pode subir como sai do
              sistema da folha. O sistema reconhece o arquivo e pede só o que ele não traz (subsetor, gestor e
              hierarquia), com sugestões de Regras da importação.
              <br />• <strong>Várias unidades</strong>: separe por <code>;</code> na coluna Empresa (ex.: MATRIZ; FILIAL)
              <br />• <strong>Datas</strong> no formato <strong>dd/mm/aaaa</strong>
              <br />• <strong>Quem já está cadastrado</strong>: a planilha atualiza unidade, função, nível,
              setor, subsetor, gestor, hierarquia, perfil e desligamento. Célula vazia não mexe em nada.
              <br />• <strong>Mudanças com data</strong>: se a unidade, a função, o nível, o setor, o
              subsetor, o gestor ou a hierarquia mudarem, o sistema lista as pessoas e pede a data de
              cada mudança antes de importar. Ela fica no histórico e vale para a variável do mês.
              <br />• <strong>Admissão diferente</strong> da cadastrada aparece na lista e só é corrigida
              para quem você marcar.
            </p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={downloadTemplate}>↓ Baixar modelo</button>
          </div>

          {/* Dito na entrada, e não em N linhas de erro na saída: o servidor
              zera a coluna, então a planilha não precisa ser refeita. */}
          {!podeDefinirPerfil && (
            <p style={{ margin: 0, fontSize: "0.82rem", background: "var(--mh-warning-soft)", color: "var(--mh-warning)", borderRadius: 8, padding: "0.6rem 0.75rem" }}>
              A coluna <strong>Perfil</strong> é ignorada nesta importação. Perfil de acesso
              (Gestor, Gerencial, Funcionário) é definido por um administrador, na ficha do
              colaborador. Todo o resto da planilha vale normalmente.
            </p>
          )}

          <div>
            <label className="label">Planilha de colaboradores</label>
            {/* limpa o value depois de ler: sem isso, reescolher o MESMO arquivo não dispara o onChange */}
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="input"
              disabled={ocupado}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) onFile(f);
              }}
            />
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.88rem" }}>
            <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} disabled={ocupado} />
            Não criar cadastro para quem já saiu
          </label>
          <p className="soft" style={{ fontSize: "0.78rem", margin: "-0.6rem 0 0 1.6rem" }}>
            A data de demissão <strong>sempre</strong> desliga quem já está cadastrado. Esta opção
            decide só o que fazer com o desligado que ainda <strong>não</strong> existe no sistema:
            marcada, ele é ignorado; desmarcada, entra no histórico já como inativo.
          </p>

          <div>
            <label className="label">Senha inicial padrão (todos entram com ela + CPF)</label>
            <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} className="input" placeholder="Senha padrão" />
            <p className="soft" style={{ fontSize: "0.78rem", margin: "0.3rem 0 0" }}>Recomende que troquem no primeiro acesso.</p>
          </div>

          {parseError && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{parseError}</p>}

          {reading && (
            <div className="card card-pad soft" style={{ fontSize: "0.88rem" }}>Lendo a planilha…</div>
          )}

          {fileName && !reading && !summary && (
            <div className="card card-pad" style={{ fontSize: "0.88rem" }}>
              <strong>{fileName}</strong>
              <div className="muted" style={{ marginTop: 4 }}>
                {rows.length} colaborador(es) a importar
                {dismissed > 0 && ` · ${dismissed} com demissão${onlyActive ? " (desligam quem já existe; não criam cadastro novo)" : " (desligam quem existe e criam os que faltam)"}`}
                {ignored > 0 && ` · ${ignored} sem CPF/nome (ignorados)`}
              </div>
              <div className="soft" style={{ marginTop: 2, fontSize: "0.78rem" }}>
                {NOME_DO_FORMATO[formato]}
                {formato === "dominio" && antigos > 0 && ` · ${antigos} desligados antigos ficaram de fora (já não estão ativos no sistema)`}
              </div>
              {errosDaLeitura.map((e, i) => (
                <p key={i} style={{ color: "var(--mh-danger)", fontSize: "0.82rem", margin: "0.4rem 0 0" }}>{e}</p>
              ))}
              {analisando && <div className="soft" style={{ marginTop: 4 }}>Conferindo o que muda em cada cadastro…</div>}
              {analise && (
                <div className="muted" style={{ marginTop: 4 }}>
                  {pendentes.length === 0
                    ? "Nenhuma mudança de função, nível, setor, subsetor, gestor ou hierarquia."
                    : `${pendentes.length} colaborador(es) com mudança que pede data.`}
                  {analise.preenchimentos > 0 && ` ${analise.preenchimentos} cadastro(s) só vão ser completados (campo que estava vazio), sem data.`}
                  {admDiv.length > 0 && ` ${admDiv.length} com admissão diferente da planilha.`}
                </div>
              )}
              {analise && (
                <ul className="muted" style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem", fontSize: "0.82rem" }}>
                  <li>{admissoes} admissão(ões)</li>
                  <li>{desligamentos} desligamento(s)</li>
                  <li>{pendentes.length} mudança(s) com data (função, setor, gestor, hierarquia…)</li>
                  {analise.preenchimentos > 0 && <li>{analise.preenchimentos} campo(s) vazio(s) completado(s)</li>}
                  {dadosPessoais > 0 && <li>{dadosPessoais} cadastro(s) com dado pessoal atualizado (telefone, e-mail, nascimento)</li>}
                  <li>{analise.skipped} sem nenhuma mudança</li>
                </ul>
              )}
              {analise && analise.avisos.length > 0 && (
                <details style={{ fontSize: "0.82rem", marginTop: "0.5rem" }}>
                  <summary style={{ cursor: "pointer", color: "var(--mh-warning)" }}>
                    {analise.avisos.length} aviso(s): a linha entra, mas com ressalva
                  </summary>
                  <ul className="muted" style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem", maxHeight: 160, overflow: "auto" }}>
                    {analise.avisos.map((a, i) => <li key={i}>{a.nome ?? "?"}: {a.aviso}</li>)}
                  </ul>
                </details>
              )}
              {formato === "dominio" && ausentes.length > 0 && (
                <details style={{ fontSize: "0.82rem", marginTop: "0.5rem" }}>
                  <summary style={{ cursor: "pointer", color: "var(--mh-warning)" }}>
                    {ausentes.length} ativo(s) no sistema não vieram no arquivo
                  </summary>
                  <p className="soft" style={{ margin: "0.35rem 0 0", fontSize: "0.78rem" }}>
                    Ninguém é desligado por isso. Confira se o relatório saiu completo; quem saiu da empresa
                    precisa vir com a data de demissão.
                  </p>
                  <ul className="muted" style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem", maxHeight: 160, overflow: "auto" }}>
                    {ausentes.map((a, i) => <li key={i} title={a.nome}>{a.codigo} · {shortName(a.nome)} · {a.unidade}</li>)}
                  </ul>
                </details>
              )}
              {analise && analise.errors.length > 0 && (
                <details style={{ fontSize: "0.82rem", marginTop: "0.5rem" }}>
                  <summary style={{ cursor: "pointer", color: "var(--mh-danger)" }}>
                    {analise.errors.length} linha(s) com erro, que não vão entrar
                  </summary>
                  <ul className="muted" style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem", maxHeight: 160, overflow: "auto" }}>
                    {analise.errors.slice(0, 50).map((e, i) => <li key={i}>{e.nome ?? e.cpf ?? "?"}: {e.erro}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}

          {analise && itens.length > 0 && !summary && contexto && (
            <>
              <CompletarImportacao
                itens={itens}
                escolhas={escolhas}
                onEscolha={escolher}
                opcoes={contexto.opcoes}
                sugestaoGestor={sugestaoGestor}
                lembrar={lembrar}
                onLembrar={setLembrar}
                disabled={ocupado}
              />
              {!conferido && (
                <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "0.6rem", marginTop: "-0.4rem" }}>
                  <span className="soft" style={{ fontSize: "0.8rem" }}>
                    {faltamEscolhas > 0 ? "Responda todos para conferir." : "Confira de novo para ver as datas que essas escolhas pedem."}
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={ocupado || faltamEscolhas > 0} onClick={conferir}>
                    Conferir de novo
                  </button>
                </div>
              )}
            </>
          )}

          {analise && pendentes.length > 0 && !summary && conferido && (
            <div className="card" style={{ fontSize: "0.88rem", overflow: "hidden" }}>
              <div style={{ padding: "0.85rem 1rem", background: "var(--surface-2)" }}>
                <strong>Mudanças que precisam de data ({pendentes.length})</strong>
                <p className="muted" style={{ fontSize: "0.8rem", margin: "0.25rem 0 0.6rem" }}>
                  Informe o primeiro dia de cada colaborador na situação nova (ex.: virou analista
                  no dia 16, informe o dia 16). Até o dia anterior, o histórico mantém a situação antiga.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" }}>
                  <label htmlFor="imp-data-todos" className="soft" style={{ fontSize: "0.8rem" }}>Mesma data para todos</label>
                  <input
                    id="imp-data-todos"
                    type="date"
                    className="input"
                    max={hoje}
                    value={dataTodos}
                    onChange={(e) => setDataTodos(e.target.value)}
                    disabled={importing}
                    style={{ width: 170 }}
                  />
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!dataTodos || importing} onClick={aplicarATodos}>
                    Aplicar a todos
                  </button>
                </div>
              </div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 360, overflowY: "auto" }}>
                {pendentes.map((p) => {
                  const valor = datas[p.cpf] ?? "";
                  const problema = valor ? problemaDaData(p, valor, hoje) : null;
                  return (
                    <li key={p.cpf} style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem 1rem", padding: "0.7rem 1rem", borderTop: "1px solid var(--border)" }}>
                      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{p.nome}</div>
                        <div className="soft" style={{ fontSize: "0.75rem" }}>
                          Matrícula {p.matricula ?? "?"}
                          {p.unidade ? ` · ${p.unidade}` : ""}
                          {p.desde ? ` · situação atual desde ${dataBr(p.desde)}` : ""}
                        </div>
                        <ul style={{ listStyle: "none", margin: "0.3rem 0 0", padding: 0, fontSize: "0.8rem" }}>
                          {p.mudancas.map((m, i) => (
                            <li key={i}>
                              <span className="muted">{m.campo}:</span> {m.de ?? "(vazio)"}{" "}
                              <span className="soft">→</span> <strong>{m.para ?? "(vazio)"}</strong>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                        <input
                          type="date"
                          className="input"
                          aria-label={`Data da mudança de ${p.nome}`}
                          min={p.desde ?? undefined}
                          max={hoje}
                          value={valor}
                          disabled={importing}
                          onChange={(e) => setDatas((d) => ({ ...d, [p.cpf]: e.target.value }))}
                          style={{ width: 170, borderColor: problema ? "var(--mh-danger)" : undefined }}
                        />
                        {problema && <span style={{ fontSize: "0.72rem", color: "var(--mh-danger)" }}>{problema}</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {analise && admDiv.length > 0 && !summary && (
            <div className="card" style={{ fontSize: "0.88rem", overflow: "hidden" }}>
              <div style={{ padding: "0.85rem 1rem", background: "var(--surface-2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <strong>Admissão diferente da planilha ({admDiv.length})</strong>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={importing}
                    onClick={() => {
                      const todos = admDiv.every((a) => corrigirAdm[a.cpf]);
                      setCorrigirAdm(todos ? {} : Object.fromEntries(admDiv.map((a) => [a.cpf, true])));
                    }}
                  >
                    {admDiv.every((a) => corrigirAdm[a.cpf]) ? "Desmarcar todos" : "Marcar todos"}
                  </button>
                </div>
                <p className="muted" style={{ fontSize: "0.8rem", margin: "0.25rem 0 0" }}>
                  Marque quem deve ficar com a data da planilha. Quem ficar desmarcado mantém a admissão
                  do sistema. A admissão conta para a variável proporcional do primeiro mês.
                </p>
              </div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 260, overflowY: "auto" }}>
                {admDiv.map((a) => (
                  <li key={a.cpf} style={{ borderTop: "1px solid var(--border)" }}>
                    <label style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem", padding: "0.6rem 1rem", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={!!corrigirAdm[a.cpf]}
                        disabled={importing}
                        onChange={(e) => setCorrigirAdm((c) => ({ ...c, [a.cpf]: e.target.checked }))}
                        style={{ marginTop: 3 }}
                      />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ fontWeight: 600 }}>{a.nome}</span>
                        <span className="soft" style={{ fontSize: "0.75rem" }}> · Matrícula {a.matricula ?? "?"}</span>
                        <span style={{ display: "block", fontSize: "0.8rem" }}>
                          <span className="muted">Sistema:</span> {dataBr(a.atual)}{" "}
                          <span className="soft">→</span> <span className="muted">Planilha:</span> <strong>{dataBr(a.planilha)}</strong>
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary && (
            <div className="card card-pad" style={{ fontSize: "0.9rem" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: 6 }}>
                <span className="badge badge-green">{summary.created} criados</span>
                {summary.updated > 0 && <span className="badge badge-blue">{summary.updated} recontratados</span>}
                {summary.movimentacoes > 0 && <span className="badge badge-blue">{summary.movimentacoes} movimentações registradas</span>}
                {summary.preenchimentos > 0 && <span className="badge badge-blue">{summary.preenchimentos} cadastros completados</span>}
                {summary.admissoes > 0 && <span className="badge badge-blue">{summary.admissoes} admissões corrigidas</span>}
                {summary.managers > 0 && <span className="badge badge-blue">{summary.managers} gestores definidos</span>}
                {summary.roles > 0 && <span className="badge badge-blue">{summary.roles} perfis alterados</span>}
                {summary.hierarchies > 0 && <span className="badge badge-blue">{summary.hierarchies} hierarquias definidas</span>}
                {summary.levels > 0 && <span className="badge badge-blue">{summary.levels} níveis alterados</span>}
                {summary.skipped > 0 && <span className="badge badge-amber">{summary.skipped} já existiam</span>}
                {summary.errors.length > 0 && <span className="badge badge-red">{summary.errors.length} erros</span>}
              </div>

              {summary.movimentacoesList.length > 0 && (
                <details open style={{ fontSize: "0.82rem", marginTop: "0.5rem" }}>
                  <summary style={{ cursor: "pointer" }} className="muted">Movimentações registradas ({summary.movimentacoesList.length})</summary>
                  <ul className="muted" style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem", maxHeight: 200, overflow: "auto" }}>
                    {summary.movimentacoesList.map((u, i) => <li key={i}>{u.nome}: {u.motivo}</li>)}
                  </ul>
                </details>
              )}

              {summary.admissoesList.length > 0 && (
                <details open style={{ fontSize: "0.82rem", marginTop: "0.5rem" }}>
                  <summary style={{ cursor: "pointer" }} className="muted">Admissões corrigidas ({summary.admissoesList.length})</summary>
                  <ul className="muted" style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem", maxHeight: 160, overflow: "auto" }}>
                    {summary.admissoesList.map((u, i) => <li key={i}>{u.nome}: {u.motivo}</li>)}
                  </ul>
                </details>
              )}

              {summary.updatedList.length > 0 && (
                <details open style={{ fontSize: "0.82rem", marginTop: "0.5rem" }}>
                  <summary style={{ cursor: "pointer" }} className="muted">Recontratados ({summary.updatedList.length})</summary>
                  <ul className="muted" style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem", maxHeight: 160, overflow: "auto" }}>
                    {summary.updatedList.map((u, i) => <li key={i}>{u.nome}: {u.motivo}</li>)}
                  </ul>
                </details>
              )}

              {summary.hierarchiesList.length > 0 && (
                <details style={{ fontSize: "0.82rem", marginTop: "0.5rem" }}>
                  <summary style={{ cursor: "pointer" }} className="muted">Hierarquias definidas ({summary.hierarchiesList.length})</summary>
                  <ul className="muted" style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem", maxHeight: 200, overflow: "auto" }}>
                    {summary.hierarchiesList.map((g, i) => <li key={i}>{g.nome}: {g.motivo}</li>)}
                  </ul>
                </details>
              )}

              {summary.levelsList.length > 0 && (
                <details style={{ fontSize: "0.82rem", marginTop: "0.5rem" }}>
                  <summary style={{ cursor: "pointer" }} className="muted">Níveis alterados ({summary.levelsList.length})</summary>
                  <ul className="muted" style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem", maxHeight: 200, overflow: "auto" }}>
                    {summary.levelsList.map((g, i) => <li key={i}>{g.nome}: {g.motivo}</li>)}
                  </ul>
                </details>
              )}

              {summary.rolesList.length > 0 && (
                <details open style={{ fontSize: "0.82rem", marginTop: "0.5rem" }}>
                  <summary style={{ cursor: "pointer" }} className="muted">Perfis alterados ({summary.rolesList.length})</summary>
                  <ul className="muted" style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem", maxHeight: 200, overflow: "auto" }}>
                    {summary.rolesList.map((g, i) => <li key={i}>{g.nome}: {g.motivo}</li>)}
                  </ul>
                </details>
              )}

              {summary.managersList.length > 0 && (
                <details style={{ fontSize: "0.82rem", marginTop: "0.5rem" }}>
                  <summary style={{ cursor: "pointer" }} className="muted">Gestores definidos ({summary.managersList.length})</summary>
                  <ul className="muted" style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem", maxHeight: 200, overflow: "auto" }}>
                    {summary.managersList.map((g, i) => <li key={i}>{g.nome}: {g.motivo}</li>)}
                  </ul>
                </details>
              )}

              {summary.skippedList.length > 0 && (
                <details style={{ fontSize: "0.82rem", marginTop: "0.5rem" }}>
                  <summary style={{ cursor: "pointer" }} className="muted">Não alterados ({summary.skippedList.length})</summary>
                  <ul className="muted" style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem", maxHeight: 200, overflow: "auto" }}>
                    {summary.skippedList.map((s, i) => (
                      <li key={i}>{s.nome}{s.motivo ? `: ${s.motivo}` : s.codigo ? `: código ${s.codigo}` : ""}</li>
                    ))}
                  </ul>
                </details>
              )}

              {summary.errors.length > 0 && (
                <ul className="muted" style={{ margin: "0.6rem 0 0", paddingLeft: "1.1rem", fontSize: "0.8rem", maxHeight: 160, overflow: "auto" }}>
                  {summary.errors.slice(0, 30).map((e, i) => <li key={i}>{e.nome ?? e.cpf ?? "?"}: {e.erro}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <span className="soft" style={{ fontSize: "0.82rem" }}>
            {progress || (analise && !summary && faltando > 0 ? `Falta a data de ${faltando} colaborador(es)` : "")}
          </span>
          <div style={{ display: "flex", gap: "0.6rem" }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>{summary ? "Fechar" : "Cancelar"}</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!rows.length || ocupado || !analise || faltando > 0 || !!summary || !conferido || faltamEscolhas > 0}
              onClick={doImport}
            >
              {importing ? "Importando…" : `Importar ${rows.length || ""}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Quem precisa de complemento depois da primeira prévia do arquivo da folha:
 * as admissões e quem mudou de setor ou de função. A escolha inicial já é a
 * sugestão das regras.
 */
function montarItens(
  a: ImportSummary, linhas: Row[], ctx: ContextoImportacao,
): { itens: ItemACompletar[]; escolhas: Record<string, Escolha> } {
  const porCpf = new Map(linhas.map((r) => [soDigitos(r.cpf), r]));
  const ativoPorChave = new Map(ctx.ativos.flatMap((at) => at.unidades.map((u) => [chaveDeVinculo(u, at.codigo ?? ""), at] as const)));
  const regraFuncao = new Map(ctx.regrasFuncao.map((r) => [canon(r.funcao), r.hierarquiaId]));
  const itens: ItemACompletar[] = [];
  const escolhas: Record<string, Escolha> = {};

  for (const c of a.createdList) {
    const cpf = soDigitos(c.cpf);
    const r = porCpf.get(cpf);
    if (c.desligado || !r || escolhas[cpf]) continue;
    itens.push({
      cpf, nome: c.nome, matricula: r.employee_code ?? c.codigo ?? "", unidade: r.unit ?? c.unidade,
      setor: r.department ?? "", funcao: r.position ?? "", tipo: "admissao", mudaSetor: true, mudaFuncao: true,
    });
    escolhas[cpf] = { subsetorId: "", gestorId: "", hierarquiaId: regraFuncao.get(canon(r.position ?? "")) ?? "" };
  }

  for (const p of a.pendentes) {
    const cpf = soDigitos(p.cpf);
    const r = porCpf.get(cpf);
    if (!r || escolhas[cpf]) continue;
    const mudaSetor = p.mudancas.some((m) => m.campo === "Setor");
    const mudaFuncao = p.mudancas.some((m) => m.campo === "Função");
    const at = ativoPorChave.get(chaveDeVinculo(r.unit ?? "", r.employee_code ?? ""));
    const sugerida = regraFuncao.get(canon(r.position ?? "")) ?? null;
    // função nova com a mesma hierarquia de hoje não pede nada
    const pedeHierarquia = mudaFuncao && (sugerida === null || sugerida !== (at?.hierarquiaId ?? null));
    if (!mudaSetor && !pedeHierarquia) continue;
    itens.push({
      cpf, nome: p.nome, matricula: r.employee_code ?? p.matricula ?? "", unidade: r.unit ?? p.unidade,
      setor: r.department ?? "", funcao: r.position ?? "", tipo: "mudanca", mudaSetor, mudaFuncao: pedeHierarquia,
      atual: {
        gestorId: at?.gestorId ?? null, gestorNome: at?.gestorNome ?? null,
        hierarquiaId: at?.hierarquiaId ?? null, hierarquiaNome: at?.hierarquiaNome ?? null,
      },
    });
    escolhas[cpf] = { subsetorId: "", gestorId: "", hierarquiaId: pedeHierarquia && sugerida ? sugerida : "" };
  }
  return { itens, escolhas };
}

/** o que o DP escolheu para função ou subsetor que ainda não tinha regra */
function regrasNovas(itens: ItemACompletar[], escolhas: Record<string, Escolha>, ctx: ContextoImportacao) {
  const temFuncao = new Set(ctx.regrasFuncao.map((r) => canon(r.funcao)));
  const temSub = new Set(ctx.regrasSubsetor.map((r) => `${r.subsetorId}|${canon(r.unidade)}`));
  const funcoes = new Map<string, { funcao: string; hierarchyId: string }>();
  const subsetores = new Map<string, { subdepartmentId: string; unitName: string; managerId: string }>();
  for (const i of itens) {
    const e = escolhas[i.cpf];
    if (!e) continue;
    if (i.mudaFuncao && e.hierarquiaId && e.hierarquiaId !== SEM && !temFuncao.has(canon(i.funcao))) {
      funcoes.set(canon(i.funcao), { funcao: i.funcao, hierarchyId: e.hierarquiaId });
    }
    const unidade = i.unidade.split(";")[0]?.trim() ?? "";
    if (e.subsetorId && e.subsetorId !== SEM && e.gestorId && e.gestorId !== SEM && !temSub.has(`${e.subsetorId}|${canon(unidade)}`)) {
      subsetores.set(`${e.subsetorId}|${canon(unidade)}`, { subdepartmentId: e.subsetorId, unitName: unidade, managerId: e.gestorId });
    }
  }
  return { funcoes: [...funcoes.values()], subsetores: [...subsetores.values()] };
}
