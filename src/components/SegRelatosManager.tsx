"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BellRing, Check, ExternalLink, ListChecks, Pencil, Plus } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatCard } from "@/components/ui/StatCard";
import { ExportButton } from "@/components/ui/ExportButton";
import { confirmDialog } from "@/components/ui/confirm";
import type { Person } from "@/components/PeoplePicker";
import {
  SEG_NATUREZA, SEG_NATUREZA_TONE, SEG_RELATO_STATUS, SEG_RELATO_STATUS_TONE,
} from "@/lib/constants";
import { normalizar } from "@/lib/format";
import { SegRelatoDialog, type AreaOpt, type LocalOpt, type TipoOpt } from "@/components/SegRelatoDialog";
import { SegAcaoDialog } from "@/components/SegAcaoDialog";
import { alertarGestor, triarRelato } from "@/lib/actions/seguranca";
import type { Enums } from "@/types/database";

export type EnvolvidoRow = {
  userId: string;
  nome: string | null;
  setorId: string | null;
  setor: string | null;
  subsetorId: string | null;
  subsetor: string | null;
  funcao: string | null;
  /** o gestor da ÉPOCA: é ele quem tinha que conversar com a pessoa */
  gestorId: string | null;
  gestor: string | null;
  unidade: string | null;
};

export type RelatoRow = {
  id: string;
  occurredOn: string;
  tipoId: string;
  natureza: Enums<"seg_relato_natureza">;
  localId: string | null;
  areaId: string | null;
  unitId: string | null;
  descricao: string;
  status: Enums<"seg_relato_status">;
  notaTriagem: string | null;
  triadoEm: string | null;
  triadoPor: string | null;
  /** só chega preenchido para quem pode tratar; para os demais é sempre null */
  relator: string | null;
  souAutor: boolean;
  criadoEm: string;
  envolvidos: EnvolvidoRow[];
  /** ações de tratamento abertas a partir deste relato; elas vivem em /acoes */
  acoes: { id: string; codigo: number; prazo: string | null; concluida: boolean; pendentes: number }[];
};

function dataBr(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/**
 * A tela de relatos, nas duas caras que ela tem.
 *
 * Para o colaborador comum a RLS já entregou só os relatos dele, então a lista
 * é "o que eu apontei e no que deu". Para a equipe de segurança a mesma lista
 * vem completa e ganha filtros, contadores e o nome de quem relatou.
 */
export function SegRelatosManager({
  rows, ehSeguranca, pessoas, tipos, locais, areas, unidades,
}: {
  rows: RelatoRow[];
  ehSeguranca: boolean;
  pessoas: Person[];
  tipos: TipoOpt[];
  locais: LocalOpt[];
  areas: AreaOpt[];
  unidades: { id: string; name: string }[];
}) {
  const [novo, setNovo] = useState(false);
  const [editando, setEditando] = useState<RelatoRow | null>(null);
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("");
  const [tipo, setTipo] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);
  const [nota, setNota] = useState("");
  const [duplicadoDe, setDuplicadoDe] = useState("");
  const [acao, setAcao] = useState(false);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const nomeTipo = useMemo(() => new Map(tipos.map((t) => [t.id, t.name])), [tipos]);
  const nomeLocal = useMemo(() => new Map(locais.map((l) => [l.id, l.name])), [locais]);
  const nomeArea = useMemo(() => new Map(areas.map((a) => [a.id, a.name])), [areas]);
  const nomeUnidade = useMemo(() => new Map(unidades.map((u) => [u.id, u.name])), [unidades]);

  const lista = useMemo(() => {
    const q = normalizar(busca.trim());
    return rows.filter((r) => {
      if (status && r.status !== status) return false;
      if (tipo && r.tipoId !== tipo) return false;
      if (!q) return true;
      const campos = [
        r.descricao, nomeTipo.get(r.tipoId), r.localId ? nomeLocal.get(r.localId) : null,
        r.areaId ? nomeArea.get(r.areaId) : null, ...r.envolvidos.map((e) => e.nome),
      ];
      return campos.some((v) => v && normalizar(v).includes(q));
    });
  }, [rows, busca, status, tipo, nomeTipo, nomeLocal, nomeArea]);

  const detalhe = aberto ? rows.find((r) => r.id === aberto) ?? null : null;
  const encerrado = detalhe
    ? ["tratado", "improcedente", "duplicado"].includes(detalhe.status)
    : false;
  // o gestor sugerido é o da ÉPOCA, carimbado no relato
  const gestoresDoRelato = detalhe
    ? [...new Set(detalhe.envolvidos.map((e) => e.gestorId).filter((id): id is string => !!id))]
    : [];

  const fecharDetalhe = () => { setAberto(null); setNota(""); setDuplicadoDe(""); };

  const triar = (novoStatus: Enums<"seg_relato_status">) => {
    if (!detalhe) return;
    iniciar(async () => {
      const r = await triarRelato({
        id: detalhe.id, status: novoStatus, nota,
        duplicadoDe: novoStatus === "duplicado" ? duplicadoDe : null,
      });
      if (r.error) { toast.error(r.error); return; }
      toast.success(r.message ?? "Relato atualizado.");
      if (novoStatus !== "triado") fecharDetalhe();
      setNota("");
      router.refresh();
    });
  };

  const encerrar = async (novoStatus: Enums<"seg_relato_status">) => {
    if (!detalhe) return;
    const ok = await confirmDialog({
      title: novoStatus === "improcedente" ? "Marcar como improcedente" : "Marcar como duplicado",
      tone: "danger",
      confirmLabel: "Confirmar",
      message:
        novoStatus === "improcedente"
          ? "O relato sai da fila e deixa de contar como desvio na pirâmide. O relator é avisado de que foi analisado."
          : "O relato aponta para o original e deixa de contar de novo na pirâmide. O relator é avisado.",
    });
    if (!ok) return;
    triar(novoStatus);
  };

  const alertar = () => {
    if (!detalhe) return;
    iniciar(async () => {
      const r = await alertarGestor(detalhe.id);
      if (r.error) { toast.error(r.error); return; }
      toast.success(r.message ?? "Gestor avisado.");
      router.refresh();
    });
  };

  const contagem = useMemo(() => ({
    aguardando: rows.filter((r) => r.status === "aberto").length,
    tratativa: rows.filter((r) => r.status === "triado").length,
    tratados: rows.filter((r) => r.status === "tratado").length,
    positivos: rows.filter((r) => r.natureza === "positivo").length,
  }), [rows]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
      {ehSeguranca && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.8rem" }}>
          <StatCard label="Aguardando triagem" value={contagem.aguardando} tone="amber" />
          <StatCard label="Em tratativa" value={contagem.tratativa} tone="blue" />
          <StatCard label="Tratados" value={contagem.tratados} tone="green" />
          <StatCard label="Comportamento seguro" value={contagem.positivos} tone="purple" hint="Relatos positivos, fora da pirâmide" />
        </div>
      )}

      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input" placeholder="Buscar por descrição, tipo, local ou pessoa…"
          value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 340 }}
        />
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 190 }}>
          <option value="">Todos os status</option>
          {(Object.keys(SEG_RELATO_STATUS) as Enums<"seg_relato_status">[]).map((s) => (
            <option key={s} value={s}>{SEG_RELATO_STATUS[s]}</option>
          ))}
        </select>
        <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">Todos os tipos</option>
          {tipos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <div style={{ display: "flex", gap: "0.5rem", marginLeft: "auto", flexWrap: "wrap" }}>
          {ehSeguranca && (
            // O arquivo circula por e-mail e pen drive, então ele sai SEM o
            // relator. A promessa de anonimato não pode depender de quem abre
            // a planilha depois.
            <ExportButton
              filename="relatos-de-seguranca.xlsx"
              sheetName="Relatos"
              headers={["Data", "Tipo", "Natureza", "Local", "Área", "Envolvidos", "Situação", "Triagem", "Descrição"]}
              rows={lista.map((r) => [
                dataBr(r.occurredOn),
                nomeTipo.get(r.tipoId) ?? "",
                SEG_NATUREZA[r.natureza],
                (r.localId && nomeLocal.get(r.localId)) || "",
                (r.areaId && nomeArea.get(r.areaId)) || "",
                r.envolvidos.map((e) => e.nome ?? "").filter(Boolean).join(", "),
                SEG_RELATO_STATUS[r.status],
                r.notaTriagem ?? "",
                r.descricao,
              ])}
            />
          )}
          <button type="button" className="btn btn-primary" onClick={() => setNovo(true)}>
            <Plus size={15} /> Novo relato
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={ehSeguranca ? "Nenhum relato ainda" : "Você ainda não relatou nada"}
          description={
            ehSeguranca
              ? "Assim que a operação começar a relatar, a fila aparece aqui para triagem."
              : "Viu um risco, um quase acidente ou alguém agindo com segurança? Registre. É o que evita o acidente lá na frente."
          }
        />
      ) : lista.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>Nenhum relato com esses filtros.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 100 }}>Data</th>
              <th>Tipo</th>
              <th>Onde</th>
              <th>Envolvidos</th>
              {ehSeguranca && <th style={{ width: 170 }}>Relator</th>}
              <th style={{ width: 150 }}>Situação</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((r) => (
              <tr
                key={r.id} onClick={() => setAberto(r.id)}
                style={{ cursor: "pointer" }}
                title="Abrir o relato"
              >
                <td>{dataBr(r.occurredOn)}</td>
                <td>
                  <span style={{ fontWeight: 600 }}>{nomeTipo.get(r.tipoId) ?? "—"}</span>
                  <div style={{ marginTop: "0.15rem" }}>
                    <Badge tone={SEG_NATUREZA_TONE[r.natureza]}>{SEG_NATUREZA[r.natureza]}</Badge>
                  </div>
                </td>
                <td className="muted" style={{ fontSize: "0.82rem" }}>
                  {[r.localId ? nomeLocal.get(r.localId) : null, r.areaId ? nomeArea.get(r.areaId) : null]
                    .filter(Boolean).join(" · ") || "Não informado"}
                </td>
                <td className="muted" style={{ fontSize: "0.82rem" }}>
                  {r.envolvidos.length === 0
                    ? "Sem pessoa citada"
                    : r.envolvidos.map((e) => e.nome ?? "—").join(", ")}
                </td>
                {ehSeguranca && (
                  <td className="muted" style={{ fontSize: "0.82rem" }}>{r.relator ?? "—"}</td>
                )}
                <td><Badge tone={SEG_RELATO_STATUS_TONE[r.status]}>{SEG_RELATO_STATUS[r.status]}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {detalhe && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)",
            backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            padding: "5vh 1rem", zIndex: 50, overflowY: "auto",
          }}
        >
          <div className="card" style={{ width: "100%", maxWidth: 620, boxShadow: "var(--mh-shadow-e3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
              <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>
                {nomeTipo.get(detalhe.tipoId) ?? "Relato"} · {dataBr(detalhe.occurredOn)}
              </h2>
              <button
                type="button" onClick={fecharDetalhe} className="muted" aria-label="Fechar"
                style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            <div style={{ padding: "1.15rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                <Badge tone={SEG_NATUREZA_TONE[detalhe.natureza]}>{SEG_NATUREZA[detalhe.natureza]}</Badge>
                <Badge tone={SEG_RELATO_STATUS_TONE[detalhe.status]}>{SEG_RELATO_STATUS[detalhe.status]}</Badge>
              </div>

              <p style={{ margin: 0, fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>{detalhe.descricao}</p>

              <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.7rem", margin: 0, fontSize: "0.82rem" }}>
                <div>
                  <dt className="soft">Local</dt>
                  <dd style={{ margin: 0 }}>{(detalhe.localId && nomeLocal.get(detalhe.localId)) || "Não informado"}</dd>
                </div>
                <div>
                  <dt className="soft">Área</dt>
                  <dd style={{ margin: 0 }}>{(detalhe.areaId && nomeArea.get(detalhe.areaId)) || "Não informada"}</dd>
                </div>
                <div>
                  <dt className="soft">Unidade</dt>
                  <dd style={{ margin: 0 }}>{(detalhe.unitId && nomeUnidade.get(detalhe.unitId)) || "Não informada"}</dd>
                </div>
                {ehSeguranca && (
                  <div>
                    <dt className="soft">Relator</dt>
                    <dd style={{ margin: 0 }}>{detalhe.relator ?? "—"}</dd>
                  </div>
                )}
              </dl>

              <div>
                <h3 style={{ fontSize: "0.85rem", fontWeight: 700, margin: "0 0 0.4rem" }}>Envolvidos</h3>
                {detalhe.envolvidos.length === 0 ? (
                  <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Nenhuma pessoa citada.</p>
                ) : (
                  <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                    {detalhe.envolvidos.map((e) => (
                      <li key={e.userId} style={{ background: "var(--surface-2)", borderRadius: "var(--mh-radius-md)", padding: "0.5rem 0.7rem" }}>
                        <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{e.nome ?? "—"}</div>
                        <div className="soft" style={{ fontSize: "0.75rem" }}>
                          {[e.setor, e.subsetor, e.funcao].filter(Boolean).join(" · ") || "Sem setor cadastrado"}
                          {e.gestor ? ` · gestor: ${e.gestor}` : ""}
                          {e.unidade ? ` · ${e.unidade}` : ""}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {/* o carimbo é do dia do relato, e é isso que a estatística usa */}
                <p className="soft" style={{ fontSize: "0.72rem", margin: "0.45rem 0 0" }}>
                  Setor, função e gestor são os do dia do relato.
                </p>
              </div>

              {detalhe.acoes.length > 0 && (
                <div>
                  <h3 style={{ fontSize: "0.85rem", fontWeight: 700, margin: "0 0 0.4rem" }}>Ações de tratamento</h3>
                  <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                    {detalhe.acoes.map((a) => (
                      <li key={a.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", fontSize: "0.82rem" }}>
                        {/* a ação mora no módulo de Ações: aqui vai o ponteiro,
                            não uma segunda cópia do acompanhamento */}
                        <Link href={`/acoes?busca=${a.codigo}`} className="btn btn-ghost btn-sm">
                          <ExternalLink size={13} /> Ação #{a.codigo}
                        </Link>
                        <Badge tone={a.concluida ? "green" : "amber"}>
                          {a.concluida ? "Concluída" : `${a.pendentes} demanda${a.pendentes === 1 ? "" : "s"} em aberto`}
                        </Badge>
                        {a.prazo && <span className="soft">prazo {dataBr(a.prazo)}</span>}
                      </li>
                    ))}
                  </ul>
                  <p className="soft" style={{ fontSize: "0.72rem", margin: "0.4rem 0 0" }}>
                    O relato é dado por tratado quando a ação for concluída.
                  </p>
                </div>
              )}

              {detalhe.notaTriagem && (
                <div>
                  <h3 style={{ fontSize: "0.85rem", fontWeight: 700, margin: "0 0 0.3rem" }}>Triagem</h3>
                  <p style={{ margin: 0, fontSize: "0.84rem", whiteSpace: "pre-wrap" }}>{detalhe.notaTriagem}</p>
                  {detalhe.triadoPor && (
                    <p className="soft" style={{ fontSize: "0.74rem", margin: "0.3rem 0 0" }}>
                      Por {detalhe.triadoPor}
                      {detalhe.triadoEm ? ` em ${dataBr(detalhe.triadoEm)}` : ""}
                    </p>
                  )}
                </div>
              )}

              {/* A triagem só aparece para quem pode triar. Mostrar botão que
                  vai responder "não autorizado" é pior do que não mostrar. */}
              {ehSeguranca && !encerrado && (
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.9rem", display: "flex", flexDirection: "column", gap: "0.7rem" }}>
                  <h3 style={{ fontSize: "0.85rem", fontWeight: 700, margin: 0 }}>Triagem</h3>

                  <textarea
                    className="input" rows={2} value={nota}
                    placeholder="Nota da triagem: o que você concluiu e o que vai ser feito."
                    onChange={(e) => setNota(e.target.value)}
                  />

                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    {detalhe.status === "aberto" && (
                      <button type="button" className="btn btn-primary btn-sm" disabled={pendente} onClick={() => triar("triado")}>
                        <ListChecks size={15} /> Iniciar tratativa
                      </button>
                    )}
                    {/* nem todo relato precisa de ação: muitos se resolvem na
                        hora, e comportamento seguro é reconhecimento */}
                    {detalhe.status === "triado" && (
                      <button type="button" className="btn btn-primary btn-sm" disabled={pendente} onClick={() => triar("tratado")}>
                        <Check size={15} /> Concluir tratativa
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost btn-sm" disabled={pendente} onClick={() => setAcao(true)}>
                      Criar ação de tratamento
                    </button>
                    <button
                      type="button" className="btn btn-ghost btn-sm" disabled={pendente || gestoresDoRelato.length === 0}
                      title={gestoresDoRelato.length === 0 ? "Os envolvidos não têm gestor cadastrado" : "Avisa o gestor sem citar quem relatou"}
                      onClick={alertar}
                    >
                      <BellRing size={15} /> Alertar gestor
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={pendente} onClick={() => encerrar("improcedente")}>
                      Improcedente
                    </button>
                  </div>

                  {detalhe.status === "aberto" && (
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 220 }}>
                        <label className="label">Duplicado de</label>
                        <select className="select" value={duplicadoDe} onChange={(e) => setDuplicadoDe(e.target.value)}>
                          <option value="">Escolher o relato original…</option>
                          {rows
                            .filter((o) => o.id !== detalhe.id && o.status !== "duplicado")
                            .map((o) => (
                              <option key={o.id} value={o.id}>
                                {dataBr(o.occurredOn)} · {nomeTipo.get(o.tipoId) ?? "Relato"} · {o.descricao.slice(0, 40)}
                              </option>
                            ))}
                        </select>
                      </div>
                      <button
                        type="button" className="btn btn-ghost btn-sm"
                        disabled={pendente || !duplicadoDe} onClick={() => encerrar("duplicado")}
                      >
                        Marcar duplicado
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
              {/* o autor corrige o próprio relato enquanto a segurança não
                  pegou: sem isso a saída dele seria abrir um segundo relato do
                  mesmo fato, que a triagem depois marca como duplicado */}
              {detalhe.souAutor && detalhe.status === "aberto" ? (
                <button
                  type="button" className="btn btn-ghost btn-sm"
                  onClick={() => { setEditando(detalhe); setAberto(null); }}
                >
                  <Pencil size={14} /> Editar relato
                </button>
              ) : <span />}
              <button type="button" className="btn btn-ghost" onClick={fecharDetalhe}>Fechar</button>
            </div>
          </div>

          {acao && (
            <SegAcaoDialog
              open={acao} onClose={() => setAcao(false)}
              relatoId={detalhe.id}
              problema={`${nomeTipo.get(detalhe.tipoId) ?? "Relato"} em ${dataBr(detalhe.occurredOn)}: ${detalhe.descricao}`}
              sugestaoResponsaveis={gestoresDoRelato}
              pessoas={pessoas}
              unitId={detalhe.unitId}
              departmentId={detalhe.envolvidos[0]?.setorId ?? null}
              subdepartmentId={detalhe.envolvidos[0]?.subsetorId ?? null}
            />
          )}
        </div>
      )}

      {/* sem `unidades`: a unidade do relato é derivada no servidor, do vínculo
          do envolvido (ou de quem relatou). `key` por relato para a edição
          abrir com os dados certos sem efeito de reset. */}
      <SegRelatoDialog
        key={editando?.id ?? "novo"}
        open={novo || !!editando}
        onClose={() => { setNovo(false); setEditando(null); }}
        pessoas={pessoas} tipos={tipos} locais={locais} areas={areas}
        editando={editando && {
          id: editando.id,
          occurredOn: editando.occurredOn,
          tipoId: editando.tipoId,
          localId: editando.localId,
          areaId: editando.areaId,
          descricao: editando.descricao,
          envolvidos: editando.envolvidos.map((e) => e.userId),
        }}
      />
    </div>
  );
}
