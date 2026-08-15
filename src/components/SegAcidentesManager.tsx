"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Paperclip, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatCard } from "@/components/ui/StatCard";
import { ExportButton } from "@/components/ui/ExportButton";
import { confirmDialog } from "@/components/ui/confirm";
import type { Person } from "@/components/PeoplePicker";
import {
  SEG_ACIDENTE_CLASS, SEG_ACIDENTE_CLASS_LONGO, SEG_ACIDENTE_CLASS_TONE,
  SEG_ACIDENTE_STATUS, SEG_ACIDENTE_STATUS_TONE,
} from "@/lib/constants";
import { normalizar } from "@/lib/format";
import { SegAcidenteDialog } from "@/components/SegAcidenteDialog";
import {
  anexarAoAcidente, encerrarAcidente, reabrirAcidente, removerAnexoAcidente, urlAnexoAcidente,
} from "@/lib/actions/seguranca";
import type { Enums } from "@/types/database";

export type AnexoRow = { id: string; nome: string; mime: string | null; tamanho: number | null };

export type AcidenteRow = {
  id: string;
  userId: string;
  pessoa: string | null;
  matricula: string | null;
  setor: string | null;
  subsetor: string | null;
  funcao: string | null;
  gestor: string | null;
  unidade: string | null;
  unitId: string | null;
  occurredOn: string;
  occurredAt: string | null;
  turno: string | null;
  classe: Enums<"seg_acidente_class">;
  status: Enums<"seg_acidente_status">;
  localId: string | null;
  areaId: string | null;
  descricao: string;
  testemunhas: string | null;
  parteCorpo: string | null;
  agenteCausador: string | null;
  naturezaLesao: string | null;
  analiseCausa: string | null;
  catNumero: string | null;
  catEmitidaEm: string | null;
  cidCode: string | null;
  cidDescricao: string | null;
  diasAfastamento: number | null;
  afastamentoDe: string | null;
  retornoEm: string | null;
  anexos: AnexoRow[];
};

function dataBr(iso: string | null) {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/**
 * A lista de acidentes e o painel do caso.
 *
 * Os cartões do topo são os números que a equipe olha primeiro: quantos casos
 * abertos, quantos com afastamento e quantos dias a operação perdeu. É a mesma
 * conta que vai alimentar a pirâmide.
 */
export function SegAcidentesManager({
  rows, pessoas, locais, areas,
}: {
  rows: AcidenteRow[];
  pessoas: Person[];
  locais: { id: string; name: string; active: boolean }[];
  areas: { id: string; name: string; localId: string | null; active: boolean }[];
}) {
  const [form, setForm] = useState<{ open: boolean; editando: AcidenteRow | null }>({ open: false, editando: null });
  const [aberto, setAberto] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [classe, setClasse] = useState("");
  const [status, setStatus] = useState("");
  const [retorno, setRetorno] = useState("");
  const [pendente, iniciar] = useTransition();
  const inputAnexo = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const nomeLocal = useMemo(() => new Map(locais.map((l) => [l.id, l.name])), [locais]);
  const nomeArea = useMemo(() => new Map(areas.map((a) => [a.id, a.name])), [areas]);

  const lista = useMemo(() => {
    const q = normalizar(busca.trim());
    return rows.filter((r) => {
      if (classe && r.classe !== classe) return false;
      if (status && r.status !== status) return false;
      if (!q) return true;
      return [r.pessoa, r.descricao, r.setor, r.parteCorpo, r.agenteCausador, r.catNumero]
        .some((v) => v && normalizar(v).includes(q));
    });
  }, [rows, busca, classe, status]);

  const numeros = useMemo(() => ({
    total: rows.length,
    abertos: rows.filter((r) => r.status === "aberto").length,
    comAfastamento: rows.filter((r) => r.classe === "lti").length,
    diasPerdidos: rows.reduce((s, r) => s + (r.diasAfastamento ?? 0), 0),
    sif: rows.filter((r) => r.classe === "sif").length,
  }), [rows]);

  const detalhe = aberto ? rows.find((r) => r.id === aberto) ?? null : null;

  const encerrar = () => {
    if (!detalhe) return;
    iniciar(async () => {
      const r = await encerrarAcidente(detalhe.id, retorno || null);
      if (r.error) { toast.error(r.error); return; }
      toast.success(r.message ?? "Acidente encerrado.");
      setRetorno("");
      router.refresh();
    });
  };

  const reabrir = () => {
    if (!detalhe) return;
    iniciar(async () => {
      const r = await reabrirAcidente(detalhe.id);
      if (r.error) { toast.error(r.error); return; }
      toast.success(r.message ?? "Acidente reaberto.");
      router.refresh();
    });
  };

  const anexar = (file: File | undefined) => {
    if (!file || !detalhe) return;
    const fd = new FormData();
    fd.set("id", detalhe.id);
    fd.set("file", file);
    iniciar(async () => {
      const r = await anexarAoAcidente(fd);
      if (r.error) toast.error(r.error);
      else toast.success(r.message ?? "Documento anexado.");
      if (inputAnexo.current) inputAnexo.current.value = "";
      router.refresh();
    });
  };

  const abrirAnexo = (anexoId: string) => {
    iniciar(async () => {
      const url = await urlAnexoAcidente(anexoId);
      if (!url) { toast.error("Não foi possível abrir o documento."); return; }
      window.open(url, "_blank", "noopener");
    });
  };

  const excluirAnexo = async (anexo: AnexoRow) => {
    const ok = await confirmDialog({
      title: "Remover documento",
      tone: "danger",
      confirmLabel: "Remover",
      message: `Remover "${anexo.nome}" deste acidente?`,
    });
    if (!ok) return;
    iniciar(async () => {
      const r = await removerAnexoAcidente(anexo.id);
      if (r.error) toast.error(r.error);
      router.refresh();
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0.8rem" }}>
        <StatCard label="Acidentes registrados" value={numeros.total} />
        <StatCard label="Em apuração" value={numeros.abertos} tone="amber" />
        <StatCard label="Com afastamento" value={numeros.comAfastamento} tone="red" hint="LTI" />
        <StatCard label="Dias perdidos" value={numeros.diasPerdidos} tone="red" />
        <StatCard label="Graves ou fatais" value={numeros.sif} tone="dark" hint="SIF" />
      </div>

      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input" placeholder="Buscar por pessoa, descrição, setor, CAT…"
          value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 320 }}
        />
        <select className="select" value={classe} onChange={(e) => setClasse(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">Todas as classificações</option>
          {(Object.keys(SEG_ACIDENTE_CLASS) as Enums<"seg_acidente_class">[]).map((c) => (
            <option key={c} value={c}>{SEG_ACIDENTE_CLASS_LONGO[c]}</option>
          ))}
        </select>
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 170 }}>
          <option value="">Todos os status</option>
          {(Object.keys(SEG_ACIDENTE_STATUS) as Enums<"seg_acidente_status">[]).map((s) => (
            <option key={s} value={s}>{SEG_ACIDENTE_STATUS[s]}</option>
          ))}
        </select>
        <div style={{ display: "flex", gap: "0.5rem", marginLeft: "auto", flexWrap: "wrap" }}>
          <ExportButton
            filename="acidentes.xlsx"
            sheetName="Acidentes"
            headers={[
              "Data", "Hora", "Classificação", "Colaborador", "Matrícula", "Setor", "Função", "Gestor",
              "Unidade", "Local", "Área", "Parte do corpo", "Agente causador", "Natureza da lesão",
              "CAT", "CAT emitida em", "CID", "Dias de afastamento", "Retorno", "Situação", "Descrição",
            ]}
            rows={lista.map((r) => [
              dataBr(r.occurredOn), r.occurredAt?.slice(0, 5) ?? "", SEG_ACIDENTE_CLASS[r.classe],
              r.pessoa ?? "", r.matricula ?? "", r.setor ?? "", r.funcao ?? "", r.gestor ?? "",
              r.unidade ?? "", (r.localId && nomeLocal.get(r.localId)) || "", (r.areaId && nomeArea.get(r.areaId)) || "",
              r.parteCorpo ?? "", r.agenteCausador ?? "", r.naturezaLesao ?? "",
              r.catNumero ?? "", dataBr(r.catEmitidaEm), r.cidCode ?? "",
              r.diasAfastamento ?? "", dataBr(r.retornoEm), SEG_ACIDENTE_STATUS[r.status], r.descricao,
            ])}
          />
          <button type="button" className="btn btn-primary" onClick={() => setForm({ open: true, editando: null })}>
            <Plus size={15} /> Registrar acidente
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Nenhum acidente registrado"
          description="Que continue assim. Quando houver, registre aqui com CAT, CID e afastamento: é este cadastro que sustenta a pirâmide e o histórico legal."
        />
      ) : lista.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>Nenhum acidente com esses filtros.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 100 }}>Data</th>
              <th style={{ width: 80 }}>Classe</th>
              <th>Colaborador</th>
              <th>Onde</th>
              <th style={{ width: 110 }}>Afastamento</th>
              <th style={{ width: 130 }}>Situação</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((r) => (
              <tr key={r.id} onClick={() => { setAberto(r.id); setRetorno(r.retornoEm ?? ""); }} style={{ cursor: "pointer" }} title="Abrir o caso">
                <td>{dataBr(r.occurredOn)}</td>
                <td>
                  <Badge tone={SEG_ACIDENTE_CLASS_TONE[r.classe]}>{SEG_ACIDENTE_CLASS[r.classe]}</Badge>
                </td>
                <td>
                  <span style={{ fontWeight: 600 }}>{r.pessoa ?? "—"}</span>
                  <div className="soft" style={{ fontSize: "0.74rem" }}>
                    {[r.setor, r.funcao].filter(Boolean).join(" · ") || "Sem setor cadastrado"}
                  </div>
                </td>
                <td className="muted" style={{ fontSize: "0.82rem" }}>
                  {[(r.localId && nomeLocal.get(r.localId)), (r.areaId && nomeArea.get(r.areaId))]
                    .filter(Boolean).join(" · ") || "Não informado"}
                </td>
                <td className="muted" style={{ fontSize: "0.82rem" }}>
                  {r.diasAfastamento ? `${r.diasAfastamento} dia${r.diasAfastamento > 1 ? "s" : ""}` : "—"}
                </td>
                <td><Badge tone={SEG_ACIDENTE_STATUS_TONE[r.status]}>{SEG_ACIDENTE_STATUS[r.status]}</Badge></td>
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
            padding: "4vh 1rem", zIndex: 50, overflowY: "auto",
          }}
        >
          <div className="card" style={{ width: "100%", maxWidth: 680, boxShadow: "var(--mh-shadow-e3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
              <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>
                {detalhe.pessoa ?? "Acidente"} · {dataBr(detalhe.occurredOn)}
              </h2>
              <button
                type="button" onClick={() => setAberto(null)} className="muted" aria-label="Fechar"
                style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            <div style={{ padding: "1.15rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                <Badge tone={SEG_ACIDENTE_CLASS_TONE[detalhe.classe]}>{SEG_ACIDENTE_CLASS_LONGO[detalhe.classe]}</Badge>
                <Badge tone={SEG_ACIDENTE_STATUS_TONE[detalhe.status]}>{SEG_ACIDENTE_STATUS[detalhe.status]}</Badge>
              </div>

              <p style={{ margin: 0, fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>{detalhe.descricao}</p>

              <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.7rem", margin: 0, fontSize: "0.82rem" }}>
                <div><dt className="soft">Setor</dt><dd style={{ margin: 0 }}>{detalhe.setor ?? "—"}</dd></div>
                <div><dt className="soft">Função</dt><dd style={{ margin: 0 }}>{detalhe.funcao ?? "—"}</dd></div>
                <div><dt className="soft">Gestor</dt><dd style={{ margin: 0 }}>{detalhe.gestor ?? "—"}</dd></div>
                <div><dt className="soft">Unidade</dt><dd style={{ margin: 0 }}>{detalhe.unidade ?? "—"}</dd></div>
                <div><dt className="soft">Hora e turno</dt><dd style={{ margin: 0 }}>{[detalhe.occurredAt?.slice(0, 5), detalhe.turno].filter(Boolean).join(" · ") || "—"}</dd></div>
                <div><dt className="soft">Local e área</dt><dd style={{ margin: 0 }}>{[(detalhe.localId && nomeLocal.get(detalhe.localId)), (detalhe.areaId && nomeArea.get(detalhe.areaId))].filter(Boolean).join(" · ") || "—"}</dd></div>
                <div><dt className="soft">Parte do corpo</dt><dd style={{ margin: 0 }}>{detalhe.parteCorpo ?? "—"}</dd></div>
                <div><dt className="soft">Agente causador</dt><dd style={{ margin: 0 }}>{detalhe.agenteCausador ?? "—"}</dd></div>
                <div><dt className="soft">Natureza da lesão</dt><dd style={{ margin: 0 }}>{detalhe.naturezaLesao ?? "—"}</dd></div>
                <div><dt className="soft">CAT</dt><dd style={{ margin: 0 }}>{detalhe.catNumero ? `${detalhe.catNumero} · ${dataBr(detalhe.catEmitidaEm)}` : "—"}</dd></div>
                <div><dt className="soft">CID-10</dt><dd style={{ margin: 0 }}>{detalhe.cidCode ? `${detalhe.cidCode} ${detalhe.cidDescricao ?? ""}` : "—"}</dd></div>
                <div><dt className="soft">Afastamento</dt><dd style={{ margin: 0 }}>{detalhe.diasAfastamento ? `${detalhe.diasAfastamento} dias, retorno ${dataBr(detalhe.retornoEm)}` : "—"}</dd></div>
              </dl>

              {detalhe.testemunhas && (
                <div>
                  <div className="soft" style={{ fontSize: "0.78rem" }}>Testemunhas</div>
                  <p style={{ margin: 0, fontSize: "0.84rem" }}>{detalhe.testemunhas}</p>
                </div>
              )}

              {detalhe.analiseCausa && (
                <div>
                  <div className="soft" style={{ fontSize: "0.78rem" }}>Análise da causa</div>
                  <p style={{ margin: 0, fontSize: "0.84rem", whiteSpace: "pre-wrap" }}>{detalhe.analiseCausa}</p>
                </div>
              )}

              <div>
                <h3 style={{ fontSize: "0.85rem", fontWeight: 700, margin: "0 0 0.4rem" }}>Documentos</h3>
                {detalhe.anexos.length === 0 ? (
                  <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>Nenhum documento anexado.</p>
                ) : (
                  <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                    {detalhe.anexos.map((x) => (
                      <li key={x.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <button
                          type="button" className="btn btn-ghost btn-sm" disabled={pendente}
                          onClick={() => abrirAnexo(x.id)} style={{ flex: 1, justifyContent: "flex-start" }}
                        >
                          <Paperclip size={14} /> {x.nome}
                        </button>
                        <button type="button" className="icon-btn icon-btn-danger" title="Remover" disabled={pendente} onClick={() => excluirAnexo(x)}>
                          <Trash2 size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button" className="btn btn-ghost btn-sm" style={{ marginTop: "0.5rem" }}
                  disabled={pendente} onClick={() => inputAnexo.current?.click()}
                >
                  <Paperclip size={14} /> Anexar CAT, laudo ou foto
                </button>
              </div>

              {detalhe.status === "aberto" && (
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.9rem", display: "flex", gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 180 }}>
                    <label className="label">Retorno ao trabalho</label>
                    <input className="input" type="date" value={retorno} onChange={(e) => setRetorno(e.target.value)} />
                  </div>
                  <button type="button" className="btn btn-primary btn-sm" disabled={pendente} onClick={encerrar}>
                    Encerrar caso
                  </button>
                  {detalhe.classe === "lti" && (
                    <span className="soft" style={{ fontSize: "0.75rem" }}>
                      Acidente com afastamento só encerra com a data de retorno.
                    </span>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm({ open: true, editando: detalhe })}>
                  <Pencil size={14} /> Editar
                </button>
                {detalhe.status === "encerrado" && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={pendente} onClick={reabrir}>
                    <RotateCcw size={14} /> Reabrir
                  </button>
                )}
              </div>
              <button type="button" className="btn btn-ghost" onClick={() => setAberto(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* montado só quando abre, com `key` por registro: cada abertura começa
          limpa, sem efeito de reset e sem rascunho do acidente anterior */}
      {form.open && (
        <SegAcidenteDialog
          key={form.editando?.id ?? "novo"}
          onClose={() => setForm({ open: false, editando: null })}
          editando={form.editando} pessoas={pessoas} locais={locais} areas={areas}
        />
      )}

      <input
        ref={inputAnexo} type="file" style={{ display: "none" }}
        onChange={(e) => anexar(e.target.files?.[0])}
      />
    </div>
  );
}
