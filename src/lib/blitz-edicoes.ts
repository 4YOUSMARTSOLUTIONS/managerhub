import { SEG_BLITZ_RESPOSTA, SEG_VEICULO_PROPRIEDADE, nomeDaCor } from "@/lib/constants";
import type { Enums } from "@/types/database";

/**
 * A correção da blitz (LUIZ, 18/11/2026): cada uma fica em
 * `seg_blitz_edicoes` com a blitz inteira antes e depois (`seg_blitz_foto`),
 * e a ficha mostra o que mudou, campo a campo.
 */
export type BlitzFoto = {
  user_id: string;
  colaborador: string | null;
  occurred_on: string;
  meio_id: string;
  meio: string | null;
  placa: string | null;
  veiculo_tipo: string | null;
  propriedade: Enums<"seg_veiculo_propriedade"> | null;
  cor: string | null;
  liberado: boolean;
  motivo_bloqueio_id: string | null;
  motivo: string | null;
  observacao: string | null;
  conforme: boolean;
  educativa: boolean;
  respostas: { pergunta_id: string | null; pergunta: string; resposta: Enums<"seg_blitz_resposta"> }[];
};

export type BlitzEdicao = {
  id: string;
  /** ISO */
  em: string;
  por: string | null;
  motivo: string;
  mudancas: BlitzMudanca[];
};

export type BlitzMudanca = { campo: string; de: string; para: string };

const VAZIO = "—";

function dataBr(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

function situacao(f: BlitzFoto): string {
  if (!f.liberado) return "Bloqueado";
  return f.conforme ? "Conforme" : "Liberado com desvio";
}

/** O que mudou entre o antes e o depois de uma correção, na ordem do formulário. */
export function mudancasDaBlitz(antes: BlitzFoto, depois: BlitzFoto): BlitzMudanca[] {
  const out: BlitzMudanca[] = [];
  const comparar = (campo: string, de: string | null | undefined, para: string | null | undefined) => {
    const a = de && de.trim() ? de : VAZIO;
    const b = para && para.trim() ? para : VAZIO;
    if (a !== b) out.push({ campo, de: a, para: b });
  };

  comparar("Colaborador", antes.colaborador, depois.colaborador);
  comparar("Data da blitz", dataBr(antes.occurred_on), dataBr(depois.occurred_on));
  comparar("Meio de transporte", antes.meio, depois.meio);
  comparar("Placa", antes.placa, depois.placa);
  comparar("Modelo", antes.veiculo_tipo, depois.veiculo_tipo);
  comparar("Propriedade",
    antes.propriedade ? SEG_VEICULO_PROPRIEDADE[antes.propriedade] : null,
    depois.propriedade ? SEG_VEICULO_PROPRIEDADE[depois.propriedade] : null);
  comparar("Cor", nomeDaCor(antes.cor), nomeDaCor(depois.cor));

  // as respostas, pergunta a pergunta (pelo id; pelo texto se a pergunta saiu do cadastro)
  const chave = (r: BlitzFoto["respostas"][number]) => r.pergunta_id ?? `texto:${r.pergunta}`;
  const deAntes = new Map(antes.respostas.map((r) => [chave(r), r]));
  const deDepois = new Map(depois.respostas.map((r) => [chave(r), r]));
  for (const k of new Set([...deAntes.keys(), ...deDepois.keys()])) {
    const a = deAntes.get(k);
    const b = deDepois.get(k);
    comparar(
      (a ?? b)!.pergunta,
      a ? SEG_BLITZ_RESPOSTA[a.resposta] : "Não perguntada",
      b ? SEG_BLITZ_RESPOSTA[b.resposta] : "Não perguntada",
    );
  }

  comparar("Decisão", antes.liberado ? "Liberado" : "Bloqueado", depois.liberado ? "Liberado" : "Bloqueado");
  comparar("Motivo do bloqueio", antes.motivo, depois.motivo);
  comparar("Observação", antes.observacao, depois.observacao);
  comparar("Situação", situacao(antes), situacao(depois));
  if (antes.educativa !== depois.educativa) {
    out.push({ campo: "Educativa", de: antes.educativa ? "Sim" : "Não", para: depois.educativa ? "Sim" : "Não" });
  }
  return out;
}
