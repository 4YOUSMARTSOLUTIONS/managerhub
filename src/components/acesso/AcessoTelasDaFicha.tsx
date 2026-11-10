"use client";

import { useEffect, useState } from "react";
import { acessoTelasDaPessoa, definirTelasDaPessoa, type AcessoDaPessoa } from "@/lib/actions/acesso-telas";
import { resumoDasTelas } from "@/lib/acesso-telas";
import { TelasDialog } from "./TelasDialog";

/**
 * "Telas" na ficha do colaborador: o que vale para a pessoa e, para quem
 * administra, o botão de exceção. Carrega por conta própria (a ficha não traz
 * as regras de acesso) e grava na hora, fora do "Salvar" da ficha: acesso não
 * é movimentação e não pede data.
 */
export function AcessoTelasDaFicha({ userId, nome }: { userId: string; nome: string }) {
  const [dados, setDados] = useState<AcessoDaPessoa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let vivo = true;
    acessoTelasDaPessoa(userId).then((r) => {
      if (!vivo) return;
      if (r.error) setErro(r.error);
      else setDados(r.dados ?? null);
    });
    return () => { vivo = false; };
  }, [userId, versao]);

  const resumo = !dados
    ? (erro ?? "Carregando…")
    : dados.isento
      ? `Todas as telas contratadas (${dados.isento} nunca tem restrição)`
      : dados.modo === "nivel"
        ? `${resumoDasTelas(dados.nivel.telas)} (regra do nível${dados.nivel.nome ? ` ${dados.nivel.nome}` : ""})`
        : `${resumoDasTelas(dados.modo === "livre" ? null : dados.telas)} (exceção desta pessoa)`;

  return (
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem",
        padding: "0.6rem 0.75rem", borderRadius: "var(--mh-radius-sm)", background: "var(--mh-surface-2)",
      }}
    >
      <div style={{ minWidth: 0, fontSize: "0.85rem" }}>
        <strong>Telas que acessa</strong>
        <span className="soft" style={{ display: "block", fontSize: "0.78rem" }}>{resumo}</span>
      </div>
      {dados && dados.podeEditar && !dados.isento && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditando(true)}>Alterar</button>
      )}

      {editando && dados && (
        <TelasDialog
          titulo={`Telas de ${nome}`}
          subtitulo="A exceção vale mais que a regra do nível e é gravada na hora, sem precisar salvar a ficha."
          modos={[
            { id: "nivel", rotulo: "Seguir o nível", ajuda: `${dados.nivel.nome ?? "Sem nível"}: ${resumoDasTelas(dados.nivel.telas)}` },
            { id: "lista", rotulo: "Só as telas escolhidas" },
            { id: "livre", rotulo: "Todas as telas contratadas", ajuda: "Ignora a regra do nível para esta pessoa." },
          ]}
          modoInicial={dados.modo}
          telasIniciais={dados.modo === "lista" ? dados.telas : (dados.nivel.telas ?? [])}
          opcoes={dados.opcoes}
          // acima da ficha, que já é uma camada (z-index 70)
          zIndex={80}
          onClose={() => setEditando(false)}
          onSalvar={async (modo, telas) => {
            const r = await definirTelasDaPessoa({ userId, modo, telas });
            if (!r.error) setVersao((v) => v + 1);
            return r;
          }}
        />
      )}
    </div>
  );
}
