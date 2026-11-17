"use server";

import { revalidatePath } from "next/cache";
import { actionContext } from "./context";
import type { Enums } from "@/types/database";
import { normTexto } from "@/lib/absences-import";
import { indiceDeAlvos, resolverAlvo, MOTIVO_LABEL, type Origem } from "@/lib/import-pessoa";
import { carregarCadastroParaImportar } from "@/lib/absenteismo-cadastro";
import { dataBR, detalheDoAfastamento, normCid, simNao, tipoDeAtestado, type LinhaHistorico } from "@/lib/absenteismo-historico";
import { AFASTAMENTO_MOTIVO } from "@/lib/constants";

/**
 * Importação do HISTÓRICO de absenteísmo (LUIZ, 16/11/2026).
 *
 * Só o proprietário, só o passado. Cada linha entra APROVADA, sem comunicado,
 * sem aviso no sino e sem anexo. O que acontece de hoje em diante segue o fluxo
 * normal, e a RPC recusa linha que começa hoje ou depois.
 *
 * Aqui se resolve o que depende do app (pessoa por unidade + matrícula, motivo
 * pelo nome do catálogo, células ilegíveis); a RPC `absenteismo_importar`
 * confere o que depende do banco (período que cruza, admissão, desligamento,
 * CID) e grava. A prévia é a mesma RPC com `simular`: faz tudo e desfaz, então
 * o que a tela mostra é exatamente o que vai acontecer.
 */

const SO_DONO = "Apenas o proprietário importa o histórico de absenteísmo.";

export type RecusaHistorico = {
  linha: number;
  code: string;
  unit: string;
  name: string;
  periodo: string;
  motivo: string;
};

export type ResultadoHistorico = {
  /** na prévia, quantas entrariam; na importação, quantas entraram */
  importadas: number;
  recusadas: RecusaHistorico[];
  simulado: boolean;
  error?: string;
};

const SITUACAO: Record<Origem, string> = { ativo: "Ativo", desligado: "Desligado", contrato_anterior: "Contrato anterior" };

/**
 * O que o modelo precisa: a lista de colaboradores (para copiar a matrícula) e
 * os motivos do catálogo (o nome tem de ser escrito igual).
 */
export async function dadosDoModeloHistorico(): Promise<{
  pessoas: { code: string; units: string; name: string; situacao: string }[];
  motivos: { name: string; kind: Enums<"absence_kind">; requiresMedical: boolean; requiresCompanion: boolean; requiresKinship: boolean; active: boolean }[];
  multiUnidade: boolean;
  error?: string;
}> {
  try {
    const { supabase, tenantId, role } = await actionContext();
    if (role !== "owner") return { pessoas: [], motivos: [], multiUnidade: false, error: SO_DONO };

    const [{ refs, unidades, nomePorUser }, { data: tipos }] = await Promise.all([
      carregarCadastroParaImportar(supabase, tenantId),
      supabase
        .from("absence_types")
        .select("name, kind, requires_medical, requires_companion, requires_kinship, active")
        .eq("tenant_id", tenantId)
        .order("sort").order("name"),
    ]);

    const pessoas = refs
      .filter((r) => r.code)
      .map((r) => ({
        code: r.code ?? "",
        units: (r.units ?? []).join("; "),
        name: nomePorUser.get(r.id) ?? "",
        situacao: SITUACAO[r.origem ?? "ativo"],
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

    return {
      pessoas,
      motivos: (tipos ?? []).map((t) => ({
        name: t.name, kind: t.kind, requiresMedical: t.requires_medical,
        requiresCompanion: t.requires_companion, requiresKinship: t.requires_kinship, active: t.active,
      })),
      multiUnidade: new Set(unidades.map((u) => normTexto(u.name))).size > 1,
    };
  } catch (e) {
    return { pessoas: [], motivos: [], multiUnidade: false, error: (e as Error).message };
  }
}

/**
 * Prévia (`simular = true`) ou importação de verdade.
 *
 * Reimportar a mesma planilha não duplica: a linha que cruza com absenteísmo já
 * lançado para a pessoa (inclusive o importado antes) volta recusada.
 */
export async function importarHistoricoAbsenteismo(
  linhas: LinhaHistorico[],
  simular: boolean,
): Promise<ResultadoHistorico> {
  const vazio: ResultadoHistorico = { importadas: 0, recusadas: [], simulado: simular };
  try {
    const { supabase, tenantId, role } = await actionContext();
    if (role !== "owner") return { ...vazio, error: SO_DONO };
    if (!Array.isArray(linhas) || linhas.length === 0) return { ...vazio, error: "A planilha não tem linhas." };
    if (linhas.length > 5000) return { ...vazio, error: "No máximo 5.000 linhas por importação. Divida a planilha." };

    const [{ refs, unidades }, { data: tipos }] = await Promise.all([
      carregarCadastroParaImportar(supabase, tenantId),
      supabase.from("absence_types").select("id, name, kind").eq("tenant_id", tenantId),
    ]);
    const idx = indiceDeAlvos(refs, unidades.map((u) => u.name));
    const unidadePorNome = new Map(unidades.map((u) => [normTexto(u.name), u.id]));
    // o nome do motivo casa sem caixa e sem acento, mas inteiro: "Atestado" não
    // pode virar "Atestado de acompanhamento" por aproximação
    const tipoPorNome = new Map<string, { id: string; kind: Enums<"absence_kind"> }>();
    for (const t of tipos ?? []) {
      const k = normTexto(t.name);
      if (!tipoPorNome.has(k)) tipoPorNome.set(k, { id: t.id, kind: t.kind });
    }

    const porLinha = new Map<number, LinhaHistorico>();
    const recusadas: RecusaHistorico[] = [];
    const recusar = (l: LinhaHistorico, motivo: string) => {
      recusadas.push({
        linha: l.linha,
        code: (l.code ?? "").trim(),
        unit: (l.unit ?? "").trim(),
        name: (l.name ?? "").trim(),
        periodo: periodoDaLinha(l),
        motivo,
      });
    };

    const paraOBanco: Record<string, unknown>[] = [];
    for (const l of linhas) {
      porLinha.set(l.linha, l);

      const alvo = resolverAlvo(l.code ?? "", l.unit ?? "", idx);
      if (!alvo.alvoId) { recusar(l, capitalizar(MOTIVO_LABEL[alvo.motivo!])); continue; }

      const motivoNome = normTexto(l.motivo ?? "");
      if (!motivoNome) { recusar(l, "Informe o motivo."); continue; }
      const tipo = tipoPorNome.get(motivoNome);
      if (!tipo) { recusar(l, `Motivo "${(l.motivo ?? "").trim()}" não está no catálogo (veja a aba Motivos do modelo).`); continue; }

      if (l.inicio === null || l.fim === null) { recusar(l, "Data de início ou fim ilegível."); continue; }
      if (!l.inicio || !l.fim) { recusar(l, "Informe o início e o fim."); continue; }
      if (l.das === null || l.ate === null) { recusar(l, "Horário Das ou Até ilegível."); continue; }
      if (l.emissao === null) { recusar(l, "Data de emissão ilegível."); continue; }

      const tipoAtestado = tipoDeAtestado(l.tipoAtestado ?? "");
      if (tipoAtestado === null) { recusar(l, "Tipo de atestado: use Médico ou Odontológico."); continue; }
      const acidente = simNao(l.acidente ?? "");
      if (acidente === null) { recusar(l, "Acidente de trabalho: use Sim ou Não."); continue; }
      const abonada = simNao(l.abonada ?? "");
      if (abonada === null) { recusar(l, "Abonada: use Sim ou Não."); continue; }
      const detalhe = detalheDoAfastamento(l.detalhe ?? "");
      if (detalhe === null) {
        recusar(l, "Detalhe do afastamento: use Afastado pelo INSS, Acidente de trabalho, Aposentadoria por invalidez ou Licença-maternidade.");
        continue;
      }
      if (detalhe && AFASTAMENTO_MOTIVO[detalhe]?.kind !== tipo.kind) {
        recusar(l, `"${AFASTAMENTO_MOTIVO[detalhe].label}" não combina com o motivo "${(l.motivo ?? "").trim()}".`);
        continue;
      }

      paraOBanco.push({
        linha: l.linha,
        user_id: alvo.alvoId,
        tipo_id: tipo.id,
        detalhe: detalhe || null,
        unit_id: unidadePorNome.get(normTexto(l.unit ?? "")) ?? null,
        matricula: (l.code ?? "").trim(),
        inicio: l.inicio,
        fim: l.fim,
        das: l.das || null,
        ate: l.ate || null,
        obs: (l.obs ?? "").trim(),
        tipo_atestado: tipoAtestado,
        cid: normCid(l.cid ?? ""),
        medico: (l.medico ?? "").trim(),
        crm: (l.crm ?? "").trim(),
        local: (l.local ?? "").trim(),
        emissao: l.emissao || null,
        acompanhado: (l.acompanhado ?? "").trim(),
        parentesco: (l.parentesco ?? "").trim(),
        acidente,
        abonada,
      });
    }

    let importadas = 0;
    if (paraOBanco.length > 0) {
      const { data, error } = await supabase.rpc("absenteismo_importar", {
        p_tenant: tenantId,
        p_linhas: paraOBanco as never,
        p_simular: simular,
      });
      if (error) return { ...vazio, recusadas, error: error.message };
      const r = data as { importadas: number; recusadas: { linha: number; motivo: string }[] } | null;
      importadas = r?.importadas ?? 0;
      for (const x of r?.recusadas ?? []) {
        const l = porLinha.get(x.linha);
        if (l) recusar(l, x.motivo);
      }
    }

    recusadas.sort((a, b) => a.linha - b.linha);

    if (!simular && importadas > 0) {
      revalidatePath("/absenteismos");
      revalidatePath("/configuracoes");
      revalidatePath("/metas");
    }
    return { importadas, recusadas, simulado: simular };
  } catch (e) {
    return { ...vazio, error: (e as Error).message };
  }
}

function periodoDaLinha(l: LinhaHistorico): string {
  const ini = l.inicio ? dataBR(l.inicio) : "";
  const fim = l.fim ? dataBR(l.fim) : "";
  const horas = l.das && l.ate ? ` ${l.das} às ${l.ate}` : "";
  if (ini && fim && ini !== fim) return `${ini} a ${fim}${horas}`;
  return `${ini || fim}${horas}`;
}

const capitalizar = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) + "." : s);
