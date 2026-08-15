"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImagePlus, Pencil, Power, RotateCcw, Trash2, Upload, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { ExportButton } from "@/components/ui/ExportButton";
import { confirmDialog } from "@/components/ui/confirm";
import { normalizar } from "@/lib/format";
import { segIconeSrc } from "@/lib/avatar";
import {
  definirIconeSeg, deleteSegCatalogo, removerIconeSeg, saveSegOcorrencia, setSegCatalogoAtivo,
} from "@/lib/actions/seguranca";
import { SegImportOcorrencias } from "@/components/SegImportOcorrencias";

export type OcorrenciaRow = {
  id: string;
  name: string;
  description: string | null;
  image_path: string | null;
  active: boolean;
  tipoIds: string[];
  localIds: string[];
  areaIds: string[];
};

type Opcao = { id: string; name: string };

type Rascunho = {
  id?: string;
  name: string;
  description: string;
  tipoIds: string[];
  localIds: string[];
  areaIds: string[];
};

const vazio: Rascunho = { name: "", description: "", tipoIds: [], localIds: [], areaIds: [] };

/** Caixas de seleção em linha: lista curta, e marcar é mais rápido que abrir menu. */
function Vinculos({
  titulo, ajuda, opcoes, marcados, onChange,
}: {
  titulo: string;
  ajuda: string;
  opcoes: Opcao[];
  marcados: string[];
  onChange: (ids: string[]) => void;
}) {
  const alternar = (id: string) =>
    onChange(marcados.includes(id) ? marcados.filter((x) => x !== id) : [...marcados, id]);

  return (
    <div>
      <label className="label">{titulo}</label>
      {opcoes.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.76rem", margin: 0 }}>Nada cadastrado ainda.</p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
          {opcoes.map((o) => {
            const on = marcados.includes(o.id);
            return (
              <button
                key={o.id} type="button" onClick={() => alternar(o.id)} aria-pressed={on}
                style={{
                  padding: "0.25rem 0.6rem", fontSize: "0.76rem", cursor: "pointer",
                  background: on ? "var(--mh-primary-soft)" : "var(--surface-2)",
                  border: "1px solid " + (on ? "var(--mh-primary-500)" : "var(--border)"),
                  borderRadius: 999, color: "var(--mh-text-1)", fontWeight: on ? 600 : 400,
                }}
              >
                {o.name}
              </button>
            );
          })}
        </div>
      )}
      <p className="soft" style={{ fontSize: "0.72rem", margin: "0.3rem 0 0" }}>
        {marcados.length === 0 ? ajuda : `Aparece só em ${marcados.length} selecionado(s).`}
      </p>
    </div>
  );
}

function Figura({ path, nome }: { path: string | null; nome: string }) {
  const [quebrou, setQuebrou] = useState(false);
  const src = segIconeSrc(path);
  if (!src || quebrou) {
    return (
      <span
        aria-hidden
        style={{
          width: 34, height: 34, borderRadius: "var(--mh-radius-sm)", background: "var(--surface-2)",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          color: "var(--mh-text-3)", flexShrink: 0,
        }}
      >
        <ImagePlus size={15} />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- bucket público, mesmo racional do Avatar
    <img
      src={src} alt="" title={nome} loading="lazy" onError={() => setQuebrou(true)}
      style={{ width: 34, height: 34, borderRadius: "var(--mh-radius-sm)", objectFit: "cover", flexShrink: 0 }}
    />
  );
}

/**
 * Catálogo de ocorrências.
 *
 * Ganhou tela própria em vez de entrar no `SegCatalogoManager` genérico porque
 * é o único catálogo com VÍNCULOS: ele diz em que classificação, local e área
 * a ocorrência aparece. É esse recorte que faz o formulário do relato mostrar
 * cinco opções em vez de trinta.
 */
export function SegOcorrenciasManager({
  rows, tipos, locais, areas, canEdit,
}: {
  rows: OcorrenciaRow[];
  tipos: Opcao[];
  locais: Opcao[];
  areas: Opcao[];
  canEdit: boolean;
}) {
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [erro, setErro] = useState("");
  const [importar, setImportar] = useState(false);
  const [pendente, iniciar] = useTransition();
  const alvoFigura = useRef<string | null>(null);
  const inputFigura = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const nomeTipo = useMemo(() => new Map(tipos.map((t) => [t.id, t.name])), [tipos]);
  const nomeLocal = useMemo(() => new Map(locais.map((l) => [l.id, l.name])), [locais]);
  const nomeArea = useMemo(() => new Map(areas.map((a) => [a.id, a.name])), [areas]);

  const lista = useMemo(() => {
    const q = normalizar(busca.trim());
    return rows.filter((r) => {
      // sem vínculo a ocorrência vale para todos, então ela passa no filtro
      if (filtroTipo && r.tipoIds.length > 0 && !r.tipoIds.includes(filtroTipo)) return false;
      if (!q) return true;
      return [r.name, r.description].some((v) => v && normalizar(v).includes(q));
    });
  }, [rows, busca, filtroTipo]);

  const salvar = () => {
    if (!rascunho) return;
    setErro("");
    iniciar(async () => {
      const r = await saveSegOcorrencia({
        id: rascunho.id, name: rascunho.name, description: rascunho.description,
        tipoIds: rascunho.tipoIds, localIds: rascunho.localIds, areaIds: rascunho.areaIds,
      });
      if (r.error) { setErro(r.error); return; }
      setRascunho(null);
      router.refresh();
    });
  };

  const excluir = async (o: OcorrenciaRow) => {
    const ok = await confirmDialog({
      title: "Excluir ocorrência",
      tone: "danger",
      confirmLabel: "Excluir",
      message: `Excluir "${o.name}"? Se já houver relato com ela, será apenas desativada, para o histórico continuar dizendo o que aconteceu.`,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("tabela", "seg_ocorrencias");
    fd.set("id", o.id);
    iniciar(async () => { await deleteSegCatalogo(fd); router.refresh(); });
  };

  const alternar = (o: OcorrenciaRow) => {
    const fd = new FormData();
    fd.set("tabela", "seg_ocorrencias");
    fd.set("id", o.id);
    fd.set("active", o.active ? "0" : "1");
    iniciar(async () => { await setSegCatalogoAtivo(fd); router.refresh(); });
  };

  const enviarFigura = (file: File | undefined) => {
    const id = alvoFigura.current;
    if (!file || !id) return;
    const fd = new FormData();
    fd.set("tabela", "seg_ocorrencias");
    fd.set("id", id);
    fd.set("file", file);
    iniciar(async () => {
      const r = await definirIconeSeg(fd);
      if (r.error) toast.error(r.error);
      if (inputFigura.current) inputFigura.current.value = "";
      router.refresh();
    });
  };

  const limparFigura = (o: OcorrenciaRow) => {
    const fd = new FormData();
    fd.set("tabela", "seg_ocorrencias");
    fd.set("id", o.id);
    iniciar(async () => {
      const r = await removerIconeSeg(fd);
      if (r.error) toast.error(r.error);
      router.refresh();
    });
  };

  const rotulo = (ids: string[], mapa: Map<string, string>) =>
    ids.length === 0 ? "Todos" : ids.map((id) => mapa.get(id) ?? "—").join(", ");

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: "0 0 0.2rem" }}>Ocorrências</h3>
        <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
          O que aconteceu, em lista padronizada. É o que permite contar quantas vezes o mesmo
          problema apareceu, coisa que descrição livre não faz. Amarre cada uma à classificação,
          ao local e à área em que ela faz sentido; sem vínculo, ela aparece em todos.
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input" placeholder="Buscar ocorrência…" value={busca}
          onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 280 }}
        />
        <select className="select" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">Todas as classificações</option>
          {tipos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <div style={{ display: "flex", gap: "0.5rem", marginLeft: "auto", flexWrap: "wrap" }}>
          <ExportButton
            filename="ocorrencias-de-seguranca.xlsx"
            sheetName="Ocorrências"
            headers={["Ocorrência", "Classificações", "Locais", "Áreas", "Descrição", "Situação"]}
            rows={lista.map((o) => [
              o.name,
              o.tipoIds.map((id) => nomeTipo.get(id) ?? "").filter(Boolean).join("; "),
              o.localIds.map((id) => nomeLocal.get(id) ?? "").filter(Boolean).join("; "),
              o.areaIds.map((id) => nomeArea.get(id) ?? "").filter(Boolean).join("; "),
              o.description ?? "",
              o.active ? "Ativa" : "Inativa",
            ])}
          />
          {canEdit && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setImportar(true)}>
                <Upload size={15} /> Importar
              </button>
              <button
                type="button" className="btn btn-primary btn-sm"
                onClick={() => { setErro(""); setRascunho({ ...vazio }); }}
              >
                + Nova ocorrência
              </button>
            </>
          )}
        </div>
      </div>

      {rascunho && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--mh-radius-lg)", background: "var(--surface-2)", padding: "0.9rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.8rem" }}>
            <div>
              <label className="label">Ocorrência <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <input
                className="input" value={rascunho.name} placeholder="Pallet quebrado"
                onChange={(e) => setRascunho((r) => (r ? { ...r, name: e.target.value } : r))}
              />
            </div>
            <div>
              <label className="label">Descrição</label>
              <input
                className="input" value={rascunho.description} placeholder="Opcional, aparece como ajuda"
                onChange={(e) => setRascunho((r) => (r ? { ...r, description: e.target.value } : r))}
              />
            </div>
          </div>

          <Vinculos
            titulo="Aparece nas classificações"
            ajuda="Sem marcar nenhuma, aparece em todas."
            opcoes={tipos} marcados={rascunho.tipoIds}
            onChange={(ids) => setRascunho((r) => (r ? { ...r, tipoIds: ids } : r))}
          />
          <Vinculos
            titulo="Aparece nos locais"
            ajuda="Sem marcar nenhum, aparece em todos."
            opcoes={locais} marcados={rascunho.localIds}
            onChange={(ids) => setRascunho((r) => (r ? { ...r, localIds: ids } : r))}
          />
          <Vinculos
            titulo="Aparece nas áreas"
            ajuda="Sem marcar nenhuma, aparece em todas."
            opcoes={areas} marcados={rascunho.areaIds}
            onChange={(ids) => setRascunho((r) => (r ? { ...r, areaIds: ids } : r))}
          />

          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={pendente} onClick={salvar}>
              {pendente ? "Salvando…" : "Salvar"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRascunho(null)}>Cancelar</button>
            {!rascunho.id && (
              <span className="soft" style={{ fontSize: "0.75rem" }}>
                A figura é escolhida depois de salvar, pelo botão da lista.
              </span>
            )}
          </div>
        </div>
      )}

      {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.8rem", margin: 0 }}>{erro}</p>}

      {rows.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>
          Nenhuma ocorrência cadastrada. Sem elas o relato fica só com o texto livre, que não empilha em gráfico.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 52 }}></th>
              <th>Ocorrência</th>
              <th style={{ width: 200 }}>Classificações</th>
              <th style={{ width: 180 }}>Locais</th>
              <th style={{ width: 100 }}>Situação</th>
              {canEdit && <th style={{ textAlign: "right" }}></th>}
            </tr>
          </thead>
          <tbody>
            {lista.map((o) => (
              <tr key={o.id} style={{ opacity: o.active ? 1 : 0.6 }}>
                <td><Figura path={o.image_path} nome={o.name} /></td>
                <td>
                  <span style={{ fontWeight: 600 }}>{o.name}</span>
                  {o.description && <div className="soft" style={{ fontSize: "0.74rem" }}>{o.description}</div>}
                  {o.areaIds.length > 0 && (
                    <div className="soft" style={{ fontSize: "0.72rem" }}>Áreas: {rotulo(o.areaIds, nomeArea)}</div>
                  )}
                </td>
                <td className="muted" style={{ fontSize: "0.8rem" }}>{rotulo(o.tipoIds, nomeTipo)}</td>
                <td className="muted" style={{ fontSize: "0.8rem" }}>{rotulo(o.localIds, nomeLocal)}</td>
                <td><Badge tone={o.active ? "green" : "gray"}>{o.active ? "Ativa" : "Inativa"}</Badge></td>
                {canEdit && (
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-flex", gap: "0.3rem" }}>
                      <button
                        type="button" className="icon-btn" disabled={pendente}
                        title={o.image_path ? "Trocar figura" : "Escolher figura"}
                        onClick={() => { alvoFigura.current = o.id; inputFigura.current?.click(); }}
                      >
                        <ImagePlus size={15} />
                      </button>
                      {o.image_path && (
                        <button type="button" className="icon-btn" disabled={pendente} title="Remover figura" onClick={() => limparFigura(o)}>
                          <X size={15} />
                        </button>
                      )}
                      <button
                        type="button" className="icon-btn" title="Editar"
                        onClick={() => {
                          setErro("");
                          setRascunho({
                            id: o.id, name: o.name, description: o.description ?? "",
                            tipoIds: o.tipoIds, localIds: o.localIds, areaIds: o.areaIds,
                          });
                        }}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button" className="icon-btn" disabled={pendente}
                        title={o.active ? "Desativar" : "Reativar"} onClick={() => alternar(o)}
                      >
                        {o.active ? <Power size={15} /> : <RotateCcw size={15} />}
                      </button>
                      <button type="button" className="icon-btn icon-btn-danger" title="Excluir" disabled={pendente} onClick={() => excluir(o)}>
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
        style={{ display: "none" }} onChange={(e) => enviarFigura(e.target.files?.[0])}
      />

      {importar && <SegImportOcorrencias onClose={() => setImportar(false)} />}
    </div>
  );
}
