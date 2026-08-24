"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Pencil, Power, RotateCcw, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { ExportButton } from "@/components/ui/ExportButton";
import { confirmDialog } from "@/components/ui/confirm";
import { SEG_NATUREZA, SEG_NATUREZA_AJUDA, SEG_NATUREZA_TONE } from "@/lib/constants";
import { normalizar } from "@/lib/format";
import { segIconeSrc } from "@/lib/avatar";
import {
  definirIconeSeg, deleteSegCatalogo, removerIconeSeg,
  saveBlitzMeio, saveBlitzMotivo,
  saveSegArea, saveSegCausa, saveSegLocal, saveSegTipoRelato, setSegCatalogoAtivo,
  type CatalogoSeg,
} from "@/lib/actions/seguranca";
import type { Enums } from "@/types/database";

export type SegCatalogoRow = {
  id: string;
  name: string;
  description: string | null;
  image_path: string | null;
  active: boolean;
  /** só em tipos de relato */
  natureza?: Enums<"seg_relato_natureza">;
  /** só em áreas */
  local_id?: string | null;
  /** só em meios de transporte da blitz */
  tem_veiculo?: boolean;
};

export type SegCatalogoKind = "tipo" | "local" | "area" | "causa" | "meio" | "blitz_motivo";

type Rascunho = {
  id?: string;
  name: string;
  description: string;
  natureza: Enums<"seg_relato_natureza">;
  local_id: string;
  tem_veiculo: boolean;
};

const vazio: Rascunho = { name: "", description: "", natureza: "desvio", local_id: "", tem_veiculo: true };

const TABELA: Record<SegCatalogoKind, CatalogoSeg> = {
  tipo: "seg_tipos_relato",
  local: "seg_locais",
  area: "seg_areas",
  causa: "seg_causas",
  meio: "seg_blitz_meios",
  blitz_motivo: "seg_blitz_motivos",
};

// causa é vocabulário de análise, não botão de formulário: não tem figura
const COM_FIGURA: Record<SegCatalogoKind, boolean> = {
  tipo: true, local: true, area: true, causa: false, meio: true, blitz_motivo: false,
};

// descrição só onde ela vira ajuda de formulário; pergunta e motivo são o texto inteiro
const COM_DESCRICAO: Record<SegCatalogoKind, boolean> = {
  tipo: true, local: true, area: true, causa: true, meio: false, blitz_motivo: false,
};

const TEXTOS: Record<SegCatalogoKind, { titulo: string; ajuda: string; singular: string; novo: string; vazio: string; arquivo: string }> = {
  tipo: {
    titulo: "Tipos de relato",
    ajuda: "O que a operação pode relatar. O nome é da sua empresa; a natureza diz em que camada da pirâmide de Heinrich o relato entra, e é ela que o painel conta.",
    singular: "tipo de relato",
    novo: "+ Novo tipo",
    vazio: "Nenhum tipo cadastrado. Sem eles ninguém consegue abrir um relato.",
    arquivo: "tipos-de-relato.xlsx",
  },
  local: {
    titulo: "Locais do ocorrido",
    ajuda: "Onde o fato aconteceu, no traço grosso: armazém, revenda, caminhão, rua. As áreas ficam penduradas nestes locais.",
    singular: "local",
    novo: "+ Novo local",
    vazio: "Nenhum local cadastrado. O relato pede o local do ocorrido.",
    arquivo: "locais-de-seguranca.xlsx",
  },
  causa: {
    titulo: "Causas-raiz",
    ajuda: "O porquê do relato, escolhido pela equipe na triagem. É o cruzamento causa x área que vira conversa com o gestor, em vez de só o número de desvios.",
    singular: "causa",
    novo: "+ Nova causa",
    vazio: "Nenhuma causa cadastrada. Sem elas a triagem não consegue apontar tendência.",
    arquivo: "causas-de-seguranca.xlsx",
  },
  meio: {
    titulo: "Meios de transporte",
    ajuda: "Como o colaborador se desloca até a empresa. Meio sem veículo (a pé, coletivo) esconde placa e tipo no formulário da blitz.",
    singular: "meio de transporte",
    novo: "+ Novo meio",
    vazio: "Nenhum meio cadastrado. Sem eles a blitz não tem o que perguntar.",
    arquivo: "meios-de-transporte.xlsx",
  },
  blitz_motivo: {
    titulo: "Motivos de bloqueio",
    ajuda: "Por que um veículo pode ser barrado na blitz. O avaliador escolhe da lista, e é isso que empilha no indicador.",
    singular: "motivo",
    novo: "+ Novo motivo",
    vazio: "Nenhum motivo cadastrado. Bloqueio sem motivo não conta história.",
    arquivo: "motivos-de-bloqueio.xlsx",
  },
  area: {
    titulo: "Áreas do ocorrido",
    ajuda: "O ponto exato dentro do local: picking, área de descarga, abastecimento. Área sem local vale para todos, o que evita cadastrar Escritório várias vezes.",
    singular: "área",
    novo: "+ Nova área",
    vazio: "Nenhuma área cadastrada. Ela é opcional no relato, mas é o que permite ver onde o risco se concentra.",
    arquivo: "areas-de-seguranca.xlsx",
  },
};

/** A figura do item, quando houver. Bucket público, mesmo racional do avatar. */
function Figura({ path, nome, size = 34 }: { path: string | null; nome: string; size?: number }) {
  const [quebrou, setQuebrou] = useState(false);
  const src = segIconeSrc(path);
  if (!src || quebrou) {
    return (
      <span
        aria-hidden
        style={{
          width: size, height: size, borderRadius: "var(--mh-radius-sm)", background: "var(--surface-2)",
          display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          color: "var(--mh-text-3)",
        }}
      >
        <ImagePlus size={Math.round(size * 0.45)} />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- bucket público, mesmo racional do Avatar
    <img
      src={src} alt="" title={nome} loading="lazy" onError={() => setQuebrou(true)}
      style={{ width: size, height: size, borderRadius: "var(--mh-radius-sm)", objectFit: "cover", flexShrink: 0 }}
    />
  );
}

/**
 * Os três catálogos de Segurança numa peça só.
 *
 * Tipo, local e área têm a mesma vida (nome, descrição, figura, ativo) e mudam
 * em um campo cada: o tipo tem natureza, a área tem local. Três componentes
 * quase idênticos envelheceriam em três velocidades diferentes.
 */
export function SegCatalogoManager({
  kind, rows, locais = [], canEdit,
}: {
  kind: SegCatalogoKind;
  rows: SegCatalogoRow[];
  locais?: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const alvoFigura = useRef<string | null>(null);
  const inputFigura = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const t = TEXTOS[kind];
  const nomeDoLocal = useMemo(() => new Map(locais.map((l) => [l.id, l.name])), [locais]);

  const lista = useMemo(() => {
    const q = normalizar(busca.trim());
    if (!q) return rows;
    return rows.filter((r) => [r.name, r.description].some((v) => v && normalizar(v).includes(q)));
  }, [rows, busca]);

  const salvar = () => {
    if (!rascunho) return;
    setErro("");
    iniciar(async () => {
      const r =
        kind === "meio"
          ? await saveBlitzMeio({ id: rascunho.id, name: rascunho.name, tem_veiculo: rascunho.tem_veiculo })
          : kind === "blitz_motivo"
            ? await saveBlitzMotivo({ id: rascunho.id, name: rascunho.name })
            : kind === "tipo"
          ? await saveSegTipoRelato({
              id: rascunho.id, name: rascunho.name,
              natureza: rascunho.natureza, description: rascunho.description,
            })
          : kind === "local"
            ? await saveSegLocal({ id: rascunho.id, name: rascunho.name, description: rascunho.description })
            : kind === "causa"
              ? await saveSegCausa({ id: rascunho.id, name: rascunho.name, description: rascunho.description })
                : await saveSegArea({
                    id: rascunho.id, name: rascunho.name,
                    local_id: rascunho.local_id || null, description: rascunho.description,
                  });
      if (r.error) { setErro(r.error); return; }
      setRascunho(null);
      router.refresh();
    });
  };

  const excluir = async (i: SegCatalogoRow) => {
    const ok = await confirmDialog({
      title: `Excluir ${t.singular}`,
      tone: "danger",
      confirmLabel: "Excluir",
      message: `Excluir "${i.name}"? Se já houver relato ou acidente registrado com ele, será apenas desativado, para o histórico continuar dizendo o que aconteceu.`,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("tabela", TABELA[kind]);
    fd.set("id", i.id);
    iniciar(async () => { await deleteSegCatalogo(fd); router.refresh(); });
  };

  const alternar = (i: SegCatalogoRow) => {
    const fd = new FormData();
    fd.set("tabela", TABELA[kind]);
    fd.set("id", i.id);
    fd.set("active", i.active ? "0" : "1");
    iniciar(async () => { await setSegCatalogoAtivo(fd); router.refresh(); });
  };

  const escolherFigura = (id: string) => {
    alvoFigura.current = id;
    inputFigura.current?.click();
  };

  const enviarFigura = (file: File | undefined) => {
    const id = alvoFigura.current;
    if (!file || !id) return;
    setErro("");
    const fd = new FormData();
    fd.set("tabela", TABELA[kind]);
    fd.set("id", id);
    fd.set("file", file);
    iniciar(async () => {
      const r = await definirIconeSeg(fd);
      if (r.error) setErro(r.error);
      if (inputFigura.current) inputFigura.current.value = "";
      router.refresh();
    });
  };

  const limparFigura = (i: SegCatalogoRow) => {
    const fd = new FormData();
    fd.set("tabela", TABELA[kind]);
    fd.set("id", i.id);
    iniciar(async () => {
      const r = await removerIconeSeg(fd);
      if (r.error) setErro(r.error);
      router.refresh();
    });
  };

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: "0 0 0.2rem" }}>{t.titulo}</h3>
        <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>{t.ajuda}</p>
      </div>

      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input" placeholder="Buscar…" value={busca}
          onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 300 }}
        />
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginLeft: "auto", flexWrap: "wrap" }}>
          <ExportButton
            filename={t.arquivo}
            sheetName={t.titulo}
            headers={
              kind === "tipo"
                ? ["Nome", "Natureza", "Descrição", "Situação"]
                : kind === "area"
                  ? ["Nome", "Local", "Descrição", "Situação"]
                  : ["Nome", "Descrição", "Situação"]
            }
            rows={lista.map((i) =>
              kind === "tipo"
                ? [i.name, SEG_NATUREZA[i.natureza ?? "desvio"], i.description ?? "", i.active ? "Ativo" : "Inativo"]
                : kind === "area"
                  ? [i.name, (i.local_id && nomeDoLocal.get(i.local_id)) || "Todos", i.description ?? "", i.active ? "Ativa" : "Inativa"]
                  : [i.name, i.description ?? "", i.active ? "Ativo" : "Inativo"],
            )}
          />
          {canEdit && (
            <button
              type="button" className="btn btn-primary btn-sm"
              onClick={() => { setErro(""); setRascunho({ ...vazio }); }}
            >
              {t.novo}
            </button>
          )}
        </div>
      </div>

      {rascunho && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--mh-radius-lg)", background: "var(--surface-2)", padding: "0.9rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.8rem" }}>
            <div style={{ gridColumn: "span 2", minWidth: 0 }}>
              <label className="label">Nome <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <input
                className="input" value={rascunho.name}
                placeholder={kind === "tipo" ? "Condição insegura no PDV" : kind === "local" ? "Armazém" : kind === "causa" ? "Pressa por produtividade" : kind === "meio" ? "Motocicleta" : kind === "blitz_motivo" ? "Pneu em má condição" : "Área de descarga"}
                onChange={(e) => setRascunho((r) => (r ? { ...r, name: e.target.value } : r))}
              />
            </div>

            {kind === "tipo" && (
              <div>
                <label className="label">Natureza <span style={{ color: "var(--mh-danger)" }}>*</span></label>
                <select
                  className="select" value={rascunho.natureza}
                  onChange={(e) => setRascunho((r) => (r ? { ...r, natureza: e.target.value as Enums<"seg_relato_natureza"> } : r))}
                >
                  {(Object.keys(SEG_NATUREZA) as Enums<"seg_relato_natureza">[]).map((n) => (
                    <option key={n} value={n}>{SEG_NATUREZA[n]}</option>
                  ))}
                </select>
                <p className="soft" style={{ fontSize: "0.72rem", margin: "0.3rem 0 0" }}>
                  {SEG_NATUREZA_AJUDA[rascunho.natureza]}
                </p>
              </div>
            )}

            {kind === "meio" && (
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", cursor: "pointer", alignSelf: "end", paddingBottom: "0.4rem" }}>
                <input
                  type="checkbox" checked={rascunho.tem_veiculo}
                  onChange={(e) => setRascunho((r) => (r ? { ...r, tem_veiculo: e.target.checked } : r))}
                />
                <span style={{ fontSize: "0.82rem" }}>
                  Tem veículo
                  <span className="soft" style={{ display: "block", fontSize: "0.72rem" }}>
                    Liga placa, tipo e propriedade no formulário da blitz.
                  </span>
                </span>
              </label>
            )}

            {kind === "area" && (
              <div>
                <label className="label">Local</label>
                <select
                  className="select" value={rascunho.local_id}
                  onChange={(e) => setRascunho((r) => (r ? { ...r, local_id: e.target.value } : r))}
                >
                  <option value="">Todos os locais</option>
                  {locais.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            )}

            {COM_DESCRICAO[kind] && (
              <div style={{ gridColumn: "1 / -1" }}>
                <label className="label">Descrição</label>
                <textarea
                  className="input" rows={2} value={rascunho.description}
                  placeholder="Opcional. Aparece como ajuda no formulário de relato."
                  onChange={(e) => setRascunho((r) => (r ? { ...r, description: e.target.value } : r))}
                />
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.9rem", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={pendente} onClick={salvar}>
              {pendente ? "Salvando…" : "Salvar"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRascunho(null)}>Cancelar</button>
            {!rascunho.id && COM_FIGURA[kind] && (
              <span className="soft" style={{ fontSize: "0.75rem" }}>
                A figura é escolhida depois de salvar, pelo botão da lista.
              </span>
            )}
          </div>
        </div>
      )}

      {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.8rem", margin: 0 }}>{erro}</p>}

      {rows.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>{t.vazio}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              {COM_FIGURA[kind] && <th style={{ width: 52 }}></th>}
              <th>Nome</th>
              {kind === "tipo" && <th style={{ width: 190 }}>Natureza</th>}
              {kind === "area" && <th style={{ width: 190 }}>Local</th>}
              {kind === "meio" && <th style={{ width: 140 }}>Veículo</th>}
              <th style={{ width: 100 }}>Situação</th>
              {canEdit && <th style={{ textAlign: "right" }}></th>}
            </tr>
          </thead>
          <tbody>
            {lista.map((i) => (
              <tr key={i.id} style={{ opacity: i.active ? 1 : 0.6 }}>
                {COM_FIGURA[kind] && <td><Figura path={i.image_path} nome={i.name} /></td>}
                <td>
                  <span style={{ fontWeight: 600 }}>{i.name}</span>
                  {i.description && <div className="soft" style={{ fontSize: "0.74rem" }}>{i.description}</div>}
                </td>
                {kind === "tipo" && (
                  <td>
                    <Badge tone={SEG_NATUREZA_TONE[i.natureza ?? "desvio"]}>{SEG_NATUREZA[i.natureza ?? "desvio"]}</Badge>
                  </td>
                )}
                {kind === "area" && (
                  <td className="soft" style={{ fontSize: "0.82rem" }}>
                    {(i.local_id && nomeDoLocal.get(i.local_id)) || "Todos os locais"}
                  </td>
                )}
                {kind === "meio" && (
                  <td className="soft" style={{ fontSize: "0.82rem" }}>
                    {i.tem_veiculo ? "Com placa" : "Sem veículo"}
                  </td>
                )}
                <td><Badge tone={i.active ? "green" : "gray"}>{i.active ? "Ativo" : "Inativo"}</Badge></td>
                {canEdit && (
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-flex", gap: "0.3rem" }}>
                      {COM_FIGURA[kind] && (
                        <button
                          type="button" className="icon-btn" disabled={pendente}
                          title={i.image_path ? "Trocar figura" : "Escolher figura"}
                          onClick={() => escolherFigura(i.id)}
                        >
                          <ImagePlus size={15} />
                        </button>
                      )}
                      {COM_FIGURA[kind] && i.image_path && (
                        <button
                          type="button" className="icon-btn" disabled={pendente}
                          title="Remover figura" onClick={() => limparFigura(i)}
                        >
                          <X size={15} />
                        </button>
                      )}
                      <button
                        type="button" className="icon-btn" title="Editar"
                        onClick={() => {
                          setErro("");
                          setRascunho({
                            id: i.id, name: i.name, description: i.description ?? "",
                            natureza: i.natureza ?? "desvio", local_id: i.local_id ?? "",
                            tem_veiculo: i.tem_veiculo ?? true,
                          });
                        }}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button" className="icon-btn" disabled={pendente}
                        title={i.active ? "Desativar" : "Reativar"} onClick={() => alternar(i)}
                      >
                        {i.active ? <Power size={15} /> : <RotateCcw size={15} />}
                      </button>
                      <button
                        type="button" className="icon-btn icon-btn-danger" title="Excluir"
                        disabled={pendente} onClick={() => excluir(i)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <input
        ref={inputFigura} type="file" accept="image/jpeg,image/png,image/webp"
        style={{ display: "none" }}
        onChange={(e) => enviarFigura(e.target.files?.[0])}
      />
    </div>
  );
}
