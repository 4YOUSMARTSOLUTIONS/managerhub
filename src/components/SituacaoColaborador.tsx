"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { FormModal } from "@/components/ui/FormModal";
import { definirSituacaoColaborador } from "@/lib/actions/users";
import { SITUACAO_COLABORADOR } from "@/lib/constants";
import { formatDate } from "@/lib/format";

/**
 * Situação do colaborador fora do trabalho normal (afastado pelo INSS,
 * licença-maternidade...). Sem registro = "Ativo".
 *
 * Mora numa tabela fechada (`colaborador_situacoes`): o motivo pode ser dado de
 * saúde, então só o DP e os gestores leem, e só o DP grava.
 */
export type SituacaoColaborador = {
  situacao: string;
  desde: string | null;
  observacao: string | null;
};

export function rotuloSituacao(s: SituacaoColaborador | null | undefined): string {
  if (!s) return "Ativo";
  return SITUACAO_COLABORADOR[s.situacao] ?? s.situacao;
}

/** o complemento que não cabe na pílula: data de início e observação */
export function detalheSituacao(s: SituacaoColaborador | null | undefined): string {
  if (!s) return "";
  const partes: string[] = [];
  if (s.desde) partes.push(`Desde ${formatDate(s.desde)}`);
  if (s.observacao) partes.push(s.observacao);
  return partes.join(". ");
}

/**
 * A pílula da situação. Fala baixo (quiet): é cadastro, não pede ação, e a
 * linha costuma já ter a pílula tintada dela (DESIGN.md).
 */
export function SituacaoBadge({ situacao }: { situacao: SituacaoColaborador | null | undefined }) {
  if (!situacao) return <Badge variant="quiet" tone="gray">Ativo</Badge>;
  return (
    <span title={detalheSituacao(situacao) || undefined}>
      <Badge variant="quiet" tone="purple">{rotuloSituacao(situacao)}</Badge>
    </span>
  );
}

function hojeNoBrasil(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function Campos({ atual }: { atual: SituacaoColaborador | null }) {
  const [situacao, setSituacao] = useState(atual?.situacao ?? "ativo");
  const ativo = situacao === "ativo";
  const outro = situacao === "outro";

  return (
    <>
      <div>
        <label className="label" htmlFor="situacao-colaborador">Situação</label>
        <select
          id="situacao-colaborador" className="select" name="situacao"
          value={situacao} onChange={(e) => setSituacao(e.target.value)}
        >
          <option value="ativo">Ativo (trabalhando normalmente)</option>
          {Object.entries(SITUACAO_COLABORADOR).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>{rotulo}</option>
          ))}
        </select>
      </div>

      {!ativo && (
        <>
          <div>
            <label className="label" htmlFor="situacao-desde">Desde</label>
            <input
              id="situacao-desde" className="input" type="date" name="desde"
              defaultValue={atual?.desde ?? ""} max={hojeNoBrasil()}
            />
            <p className="soft" style={{ fontSize: "0.76rem", margin: "0.3rem 0 0" }}>
              Opcional. Deixe em branco se não souber a data.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="situacao-obs">
              Observação {outro && <span style={{ color: "var(--mh-danger)" }}>*</span>}
            </label>
            <textarea
              id="situacao-obs" className="input" name="observacao" rows={3} maxLength={500}
              required={outro} defaultValue={atual?.observacao ?? ""}
              placeholder={outro ? "Descreva a situação" : "Opcional"}
            />
          </div>
        </>
      )}

      <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
        {ativo && atual
          ? "Salvar como Ativo encerra o afastamento. O registro anterior fica no log do sistema."
          : "Só o departamento pessoal e os gestores veem esta informação."}
      </p>
    </>
  );
}

/**
 * O formulário da situação, aberto pelo `trigger`. Sem `trigger`, a própria
 * pílula vira o botão (é assim no painel de férias).
 */
export function SituacaoColaboradorModal({
  userId, nome, atual, trigger, triggerClassName = "cell-link", triggerTitle,
}: {
  userId: string;
  nome: string | null;
  atual: SituacaoColaborador | null;
  trigger?: React.ReactNode;
  triggerClassName?: string;
  triggerTitle?: string;
}) {
  return (
    <FormModal
      triggerLabel={trigger ?? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          <SituacaoBadge situacao={atual} />
          <Pencil size={12} aria-hidden className="soft" />
        </span>
      )}
      triggerClassName={triggerClassName}
      // o title vira aria-label do botão: precisa dizer a situação, não só a ação
      triggerTitle={triggerTitle ?? [rotuloSituacao(atual), detalheSituacao(atual), "Clique para alterar."]
        .filter(Boolean).join(". ").replace(/\.\./g, ".")}
      title={`Situação · ${nome ?? "colaborador"}`}
      action={definirSituacaoColaborador}
      submitLabel="Salvar"
      width={480}
    >
      <input type="hidden" name="user_id" value={userId} />
      <Campos atual={atual} />
    </FormModal>
  );
}
