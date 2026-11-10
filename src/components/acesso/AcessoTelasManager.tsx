"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui/EmptyState";
import { confirmDialog } from "@/components/ui/confirm";
import { SearchSelect } from "@/components/SearchSelect";
import { definirTelasDaPessoa, definirTelasDoNivel } from "@/lib/actions/acesso-telas";
import { resumoDasTelas, type GrupoDeTelas } from "@/lib/acesso-telas";
import { formatDateTime, shortName } from "@/lib/format";
import { TelasDialog } from "./TelasDialog";

export type NivelDeAcesso = { id: string; nome: string; ativos: number; telas: string[] | null };
export type ExcecaoDeAcesso = { userId: string; nome: string; nivel: string | null; livre: boolean; telas: string[]; em: string };
export type PessoaDeAcesso = { id: string; nome: string; nivel: string | null };

type Edicao =
  | { tipo: "nivel"; nivel: NivelDeAcesso }
  | { tipo: "pessoa"; userId: string | null; livre: boolean; telas: string[] };

/**
 * Configurações > Colaboradores > Acesso às telas.
 *
 * Cada nível vê todas as telas contratadas, ou só as escolhidas. A exceção da
 * pessoa vale mais que a regra do nível. Proprietário, administrador e RH
 * nunca são restringidos (a regra mora no banco, em `minhas_telas`).
 */
export function AcessoTelasManager({
  niveis, excecoes, pessoas, opcoes, canEdit,
}: {
  niveis: NivelDeAcesso[];
  excecoes: ExcecaoDeAcesso[];
  /** quem pode ganhar exceção (já sem proprietário, administrador e RH) */
  pessoas: PessoaDeAcesso[];
  opcoes: GrupoDeTelas[];
  canEdit: boolean;
}) {
  const [editando, setEditando] = useState<Edicao | null>(null);
  const [pessoaNova, setPessoaNova] = useState("");
  const [removendo, iniciar] = useTransition();
  const router = useRouter();

  const comExcecao = useMemo(() => new Set(excecoes.map((e) => e.userId)), [excecoes]);
  const opcoesDePessoa = useMemo(
    () => pessoas.filter((p) => !comExcecao.has(p.id)).map((p) => ({ id: p.id, name: p.nivel ? `${p.nome} · ${p.nivel}` : p.nome })),
    [pessoas, comExcecao],
  );

  const remover = async (e: ExcecaoDeAcesso) => {
    const ok = await confirmDialog({
      title: "Remover exceção",
      message: <>{e.nome} volta a seguir a regra do nível {e.nivel ?? "dela"}.</>,
      confirmLabel: "Remover",
      tone: "danger",
    });
    if (!ok) return;
    iniciar(async () => {
      const r = await definirTelasDaPessoa({ userId: e.userId, modo: "nivel", telas: [] });
      if (r.error) { toast.error(r.error); return; }
      toast.success(r.message ?? "Exceção removida.");
      router.refresh();
    });
  };

  const th: React.CSSProperties = { whiteSpace: "nowrap" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", paddingTop: "0.6rem" }}>
      <p className="muted" style={{ fontSize: "0.85rem", margin: 0, lineHeight: 1.55, maxWidth: 820 }}>
        Escolha quais telas cada nível vê. Nível sem regra vê todas as telas contratadas. A exceção de uma
        pessoa vale mais que a regra do nível dela. Proprietário, Administrador e RH sempre veem todas as
        telas contratadas. Quem não tem o Dashboard liberado entra direto na primeira tela que tem.
      </p>

      <section style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>Telas por nível</div>
        {niveis.length === 0 ? (
          <EmptyState title="Nenhum nível cadastrado" description="Cadastre os níveis em Estrutura > Hierarquia." />
        ) : (
          <div className="card" style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={th}>Nível</th>
                  <th style={{ ...th, width: 110 }}>Pessoas ativas</th>
                  <th>Telas</th>
                  {canEdit && <th style={{ width: 90 }} />}
                </tr>
              </thead>
              <tbody>
                {niveis.map((n) => (
                  <tr key={n.id}>
                    <td style={{ fontWeight: 600 }}>{n.nome}</td>
                    <td className="tabular">{n.ativos}</td>
                    <td className={n.telas ? undefined : "soft"} style={{ fontSize: "0.85rem" }}>{resumoDasTelas(n.telas)}</td>
                    {canEdit && (
                      <td style={{ textAlign: "right" }}>
                        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEditando({ tipo: "nivel", nivel: n })}>
                          Editar
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>Exceções por pessoa</div>
            <p className="soft" style={{ fontSize: "0.8rem", margin: "0.15rem 0 0" }}>
              Para quem precisa de acesso diferente do nível. Também dá para definir pela ficha do colaborador.
            </p>
          </div>
          {canEdit && (
            <button
              type="button" className="btn btn-primary btn-sm"
              onClick={() => { setPessoaNova(""); setEditando({ tipo: "pessoa", userId: null, livre: false, telas: [] }); }}
            >
              Adicionar exceção
            </button>
          )}
        </div>
        {excecoes.length === 0 ? (
          <EmptyState title="Nenhuma exceção" description="Todos seguem a regra do próprio nível." />
        ) : (
          <div className="card" style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={th}>Colaborador</th>
                  <th style={{ ...th, width: 140 }}>Nível</th>
                  <th>Telas</th>
                  <th style={{ ...th, width: 150 }}>Atualizada em</th>
                  {canEdit && <th style={{ width: 150 }} />}
                </tr>
              </thead>
              <tbody>
                {excecoes.map((e) => (
                  <tr key={e.userId}>
                    <td style={{ fontWeight: 600 }} title={e.nome}>{shortName(e.nome)}</td>
                    <td className="muted" style={{ fontSize: "0.82rem" }}>{e.nivel ?? ""}</td>
                    <td style={{ fontSize: "0.85rem" }}>{resumoDasTelas(e.livre ? null : e.telas)}</td>
                    <td className="muted" style={{ fontSize: "0.82rem" }}>{formatDateTime(e.em)}</td>
                    {canEdit && (
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEditando({ tipo: "pessoa", userId: e.userId, livre: e.livre, telas: e.telas })}>
                          Editar
                        </button>
                        <button type="button" className="btn btn-ghost btn-xs" disabled={removendo} onClick={() => remover(e)}>
                          Remover
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editando?.tipo === "nivel" && (
        <TelasDialog
          titulo={`Telas do nível ${editando.nivel.nome}`}
          subtitulo={`Vale para as ${editando.nivel.ativos} pessoa(s) ativa(s) deste nível, menos quem tiver exceção.`}
          modos={[
            { id: "livre", rotulo: "Todas as telas contratadas", ajuda: "Sem restrição: o nível vê o que a unidade contratou e o perfil permite." },
            { id: "lista", rotulo: "Só as telas escolhidas" },
          ]}
          modoInicial={editando.nivel.telas ? "lista" : "livre"}
          telasIniciais={editando.nivel.telas ?? []}
          opcoes={opcoes}
          onClose={() => setEditando(null)}
          onSalvar={(modo, telas) => definirTelasDoNivel({ nivelId: editando.nivel.id, telas: modo === "lista" ? telas : null })}
        />
      )}

      {editando?.tipo === "pessoa" && (
        <TelasDialog
          titulo={editando.userId ? `Exceção de ${excecoes.find((e) => e.userId === editando.userId)?.nome ?? "colaborador"}` : "Nova exceção"}
          subtitulo="Vale mais que a regra do nível da pessoa."
          topo={editando.userId ? undefined : (
            <div>
              <label className="label">Colaborador</label>
              <SearchSelect options={opcoesDePessoa} value={pessoaNova} onChange={setPessoaNova} placeholder="Digite o nome…" />
            </div>
          )}
          modos={[
            { id: "lista", rotulo: "Só as telas escolhidas" },
            { id: "livre", rotulo: "Todas as telas contratadas", ajuda: "Ignora a regra do nível para esta pessoa." },
          ]}
          modoInicial={editando.livre ? "livre" : "lista"}
          telasIniciais={editando.telas}
          opcoes={opcoes}
          podeSalvar={!!(editando.userId || pessoaNova)}
          onClose={() => setEditando(null)}
          onSalvar={(modo, telas) => definirTelasDaPessoa({
            userId: editando.userId ?? pessoaNova,
            modo: modo === "livre" ? "livre" : "lista",
            telas,
          })}
        />
      )}
    </div>
  );
}
