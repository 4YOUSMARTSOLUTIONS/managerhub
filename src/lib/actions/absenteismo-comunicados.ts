"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import { normTexto } from "@/lib/absences-import";
import { indiceDeAlvos, resolverAlvo, MOTIVO_LABEL } from "@/lib/import-pessoa";
import { carregarCadastroParaImportar } from "@/lib/absenteismo-cadastro";
import { dataBR } from "@/lib/absenteismo-historico";
import type { LinhaComunicado } from "@/lib/absenteismo-comunicados";

/**
 * Importação de COMUNICADOS de absenteísmo (LUIZ, 17/11/2026).
 *
 * Só o proprietário, só o passado. Cada linha entra EM ABERTO, como o "Ainda
 * não sei o motivo", no nome do gestor ATUAL da pessoa (ele efetiva e recebe o
 * lembrete), sem e-mail e sem sino. Decisões do LUIZ.
 *
 * A pessoa vem pelo CPF ou, sem ele, pelo ID + Unidade, nunca pelo nome. O CPF
 * segue até a RPC, que é quem pode lê-lo no cadastro. A prévia é a mesma RPC
 * com `simular`: faz tudo e desfaz, então mostra exatamente o que vai entrar e
 * com quem cada lançamento fica.
 */

const SO_DONO = "Apenas o proprietário importa comunicados de absenteísmo.";

export type RecusaComunicado = {
  linha: number;
  name: string;
  data: string;
  motivo: string;
};

export type EntradaComunicado = {
  linha: number;
  /** o nome no cadastro, para conferir com a planilha */
  nome: string;
  matricula: string | null;
  data: string;
  /** com quem o lançamento fica: o gestor atual, ou quem importou */
  responsavel: string;
  /** a pessoa não tem gestor ativo: ficou com quem importou */
  semGestor: boolean;
};

export type ResultadoComunicados = {
  importadas: number;
  entradas: EntradaComunicado[];
  recusadas: RecusaComunicado[];
  simulado: boolean;
  error?: string;
};

export async function importarComunicadosAbsenteismo(
  linhas: LinhaComunicado[],
  simular: boolean,
): Promise<ResultadoComunicados> {
  const vazio: ResultadoComunicados = { importadas: 0, entradas: [], recusadas: [], simulado: simular };
  try {
    const { supabase, tenantId, role } = await actionContext();
    if (role !== "owner") return { ...vazio, error: SO_DONO };
    if (!Array.isArray(linhas) || linhas.length === 0) return { ...vazio, error: "A planilha não tem linhas." };
    if (linhas.length > 2000) return { ...vazio, error: "No máximo 2.000 linhas por importação. Divida a planilha." };

    // o cadastro só é preciso quando alguma linha vem pelo ID
    const precisaCadastro = linhas.some((l) => !l.cpf && (l.code ?? "").trim());
    const cadastro = precisaCadastro ? await carregarCadastroParaImportar(supabase, tenantId) : null;
    const idx = cadastro ? indiceDeAlvos(cadastro.refs, cadastro.unidades.map((u) => u.name)) : null;
    const unidadePorNome = new Map((cadastro?.unidades ?? []).map((u) => [normTexto(u.name), u.id]));

    const porLinha = new Map<number, LinhaComunicado>();
    const recusadas: RecusaComunicado[] = [];
    const recusar = (l: LinhaComunicado, motivo: string) => {
      recusadas.push({ linha: l.linha, name: (l.name ?? "").trim(), data: l.data ? dataBR(l.data) : "", motivo });
    };

    const paraOBanco: Record<string, unknown>[] = [];
    for (const l of linhas) {
      porLinha.set(l.linha, l);
      if (l.data === null) { recusar(l, "Data ilegível. Use DD/MM/AAAA."); continue; }
      if (!l.data) { recusar(l, "Informe a data."); continue; }

      const cpf = (l.cpf ?? "").replace(/\D/g, "");
      if (cpf) {
        if (cpf.length !== 11) { recusar(l, "CPF precisa ter 11 dígitos."); continue; }
        paraOBanco.push({ linha: l.linha, cpf, data: l.data, obs: (l.obs ?? "").trim() });
        continue;
      }
      if (!(l.code ?? "").trim()) { recusar(l, "Informe o CPF ou o ID (matrícula) do colaborador."); continue; }
      const alvo = resolverAlvo(l.code, l.unit ?? "", idx!);
      if (!alvo.alvoId) {
        const m = MOTIVO_LABEL[alvo.motivo!];
        recusar(l, m[0].toUpperCase() + m.slice(1) + ".");
        continue;
      }
      paraOBanco.push({
        linha: l.linha,
        user_id: alvo.alvoId,
        unit_id: unidadePorNome.get(normTexto(l.unit ?? "")) ?? null,
        matricula: l.code.trim(),
        data: l.data,
        obs: (l.obs ?? "").trim(),
      });
    }

    let importadas = 0;
    const entradas: EntradaComunicado[] = [];
    if (paraOBanco.length > 0) {
      const { data, error } = await supabase.rpc("absenteismo_importar_comunicados", {
        p_tenant: tenantId,
        p_linhas: paraOBanco as never,
        p_simular: simular,
      });
      if (error) return { ...vazio, recusadas, error: error.message };
      const r = data as {
        importadas: number;
        recusadas: { linha: number; motivo: string }[];
        entradas: { linha: number; nome: string | null; matricula: string | null; responsavel: string | null; semGestor: boolean }[];
      } | null;
      importadas = r?.importadas ?? 0;
      for (const x of r?.recusadas ?? []) {
        const l = porLinha.get(x.linha);
        if (l) recusar(l, x.motivo);
      }
      for (const e of r?.entradas ?? []) {
        const l = porLinha.get(e.linha);
        entradas.push({
          linha: e.linha,
          nome: e.nome ?? "",
          matricula: e.matricula,
          data: l?.data ? dataBR(l.data) : "",
          responsavel: e.responsavel ?? "",
          semGestor: e.semGestor,
        });
      }
    }

    recusadas.sort((a, b) => a.linha - b.linha);
    entradas.sort((a, b) => a.linha - b.linha);

    if (!simular && importadas > 0) revalidatePath("/absenteismos");
    return { importadas, entradas, recusadas, simulado: simular };
  } catch (e) {
    return { ...vazio, error: (e as Error).message };
  }
}
