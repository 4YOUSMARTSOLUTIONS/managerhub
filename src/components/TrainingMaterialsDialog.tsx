"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Film, Link2, Paperclip, Pencil, Trash2, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/components/ui/confirm";
import {
  autorizarUpload, deleteMaterial, limiteDeVideoMb, listarMateriais, saveMaterial,
  type MaterialRow,
} from "@/lib/actions/training-content";
import type { Enums } from "@/types/database";

type Kind = Enums<"training_material_kind">;

const KIND_LABEL: Record<Kind, string> = {
  video_upload: "Vídeo enviado",
  video_url: "Vídeo por link",
  arquivo: "Arquivo",
  link: "Link",
  texto: "Texto",
};

const KIND_ICON: Record<Kind, React.ElementType> = {
  video_upload: Film,
  video_url: Film,
  arquivo: Paperclip,
  link: Link2,
  texto: FileText,
};

const tamanho = (bytes: number | null) =>
  bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : "";

export function TrainingMaterialsDialog({
  trainingId, trainingName, onClose,
}: {
  trainingId: string;
  trainingName: string;
  onClose: () => void;
}) {
  const [materiais, setMateriais] = useState<MaterialRow[] | null>(null);
  const [editando, setEditando] = useState<MaterialRow | "novo" | null>(null);
  const router = useRouter();

  const recarregar = () => listarMateriais(trainingId).then(setMateriais);
  useEffect(() => {
    let vivo = true;
    listarMateriais(trainingId).then((r) => { if (vivo) setMateriais(r); });
    return () => { vivo = false; };
  }, [trainingId]);

  const excluir = async (m: MaterialRow) => {
    const ok = await confirmDialog({
      title: "Remover material",
      message: `"${m.title}" sai da trilha do treinamento. Quem já assistiu mantém o registro de progresso.`,
      confirmLabel: "Remover",
      tone: "danger",
    });
    if (!ok) return;
    await deleteMaterial(m.id);
    await recarregar();
    router.refresh();
  };

  return (
    <Modal titulo="Conteúdo do treinamento" subtitulo={trainingName} onClose={onClose} largura={720}>
      {editando ? (
        <MaterialForm
          material={editando === "novo" ? null : editando}
          trainingId={trainingId}
          proximaOrdem={(materiais?.length ?? 0) + 1}
          onClose={() => setEditando(null)}
          onSalvo={async () => { setEditando(null); await recarregar(); router.refresh(); }}
        />
      ) : (
        <>
          {materiais === null ? (
            <p className="soft" style={{ fontSize: "0.85rem" }}>Carregando…</p>
          ) : materiais.length === 0 ? (
            <p className="soft" style={{ fontSize: "0.85rem" }}>
              Nenhum conteúdo ainda. O treinamento auto instrucional precisa de pelo menos um
              material para que alguém consiga fazê-lo.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {materiais.map((m) => {
                const Icone = KIND_ICON[m.kind];
                return (
                  <div
                    key={m.id}
                    style={{
                      display: "flex", alignItems: "center", gap: "0.7rem",
                      border: "1px solid var(--border)", borderRadius: 10, padding: "0.6rem 0.8rem",
                    }}
                  >
                    <Icone size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontWeight: 600, fontSize: "0.88rem" }}>{m.title}</p>
                      <p className="soft" style={{ margin: 0, fontSize: "0.74rem" }}>
                        {KIND_LABEL[m.kind]}
                        {m.filename ? `, ${m.filename}` : ""}
                        {tamanho(m.sizeBytes) ? `, ${tamanho(m.sizeBytes)}` : ""}
                        {m.required ? ", obrigatório" : ", opcional"}
                        {(m.kind === "video_upload" || m.kind === "video_url")
                          ? `, conclui com ${m.minWatchPct}% assistido` : ""}
                      </p>
                    </div>
                    <button type="button" className="btn btn-ghost btn-sm" title="Editar" onClick={() => setEditando(m)}>
                      <Pencil size={14} />
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" title="Remover" onClick={() => excluir(m)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1.1rem" }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditando("novo")}>
              Adicionar conteúdo
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>
          </div>
        </>
      )}
    </Modal>
  );
}

function MaterialForm({
  material, trainingId, proximaOrdem, onClose, onSalvo,
}: {
  material: MaterialRow | null;
  trainingId: string;
  proximaOrdem: number;
  onClose: () => void;
  onSalvo: () => void;
}) {
  const [kind, setKind] = useState<Kind>(material?.kind ?? "video_upload");
  const [titulo, setTitulo] = useState(material?.title ?? "");
  const [url, setUrl] = useState(material?.externalUrl ?? "");
  const [texto, setTexto] = useState(material?.body ?? "");
  const [obrigatorio, setObrigatorio] = useState(material?.required ?? true);
  const [pct, setPct] = useState(String(material?.minWatchPct ?? 90));
  const [arquivo, setArquivo] = useState<{
    path: string; filename: string; size: number; contentType: string; duracao: number | null;
  } | null>(
    material?.storagePath
      ? {
          path: material.storagePath,
          filename: material.filename ?? "",
          size: material.sizeBytes ?? 0,
          contentType: material.contentType ?? "",
          duracao: material.durationSeconds,
        }
      : null,
  );
  const [enviando, setEnviando] = useState(0);
  const [limiteMb, setLimiteMb] = useState<number | null>(null);
  const [erro, setErro] = useState("");
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { limiteDeVideoMb().then(setLimiteMb); }, []);

  const ehVideo = kind === "video_upload" || kind === "video_url";
  const precisaArquivo = kind === "video_upload" || kind === "arquivo";

  /**
   * O arquivo vai direto do navegador para o armazenamento.
   *
   * Server action tem teto de 25 MB e vídeo de aula não cabe: o servidor só
   * autoriza o caminho e devolve o token; o upload em si não passa por ele.
   */
  const enviar = async (f: File) => {
    setErro("");
    setEnviando(1);
    try {
      const auth = await autorizarUpload({
        trainingId,
        kind: kind === "video_upload" ? "video_upload" : "arquivo",
        filename: f.name,
        sizeBytes: f.size,
        contentType: f.type,
      });
      if (auth.error || !auth.token || !auth.path || !auth.bucket) {
        setErro(auth.error ?? "Não foi possível iniciar o envio.");
        setEnviando(0);
        return;
      }
      const supabase = createClient();
      const { error } = await supabase.storage
        .from(auth.bucket)
        .uploadToSignedUrl(auth.path, auth.token, f);
      if (error) {
        setErro(error.message);
        setEnviando(0);
        return;
      }
      // duração lida no próprio navegador: evita depender de transcodificação
      // no servidor só para saber quanto o vídeo dura
      const duracao = kind === "video_upload" ? await lerDuracao(f) : null;
      setArquivo({ path: auth.path, filename: f.name, size: f.size, contentType: f.type, duracao });
      if (!titulo) setTitulo(f.name.replace(/\.[^.]+$/, ""));
      setEnviando(0);
    } catch (e) {
      setErro((e as Error).message);
      setEnviando(0);
    }
  };

  const salvar = () => {
    setErro("");
    if (!titulo.trim()) { setErro("Informe o título do material."); return; }
    if (precisaArquivo && !arquivo) { setErro("Envie o arquivo antes de salvar."); return; }
    if ((kind === "video_url" || kind === "link") && !url.trim()) { setErro("Informe o endereço."); return; }
    if (kind === "texto" && !texto.trim()) { setErro("Escreva o conteúdo."); return; }

    start(async () => {
      const r = await saveMaterial({
        id: material?.id,
        trainingId,
        kind,
        title: titulo,
        sort: material?.sort ?? proximaOrdem,
        required: obrigatorio,
        minWatchPct: Math.min(100, Math.max(1, Number(pct) || 90)),
        storagePath: precisaArquivo ? arquivo?.path : null,
        filename: precisaArquivo ? arquivo?.filename : null,
        sizeBytes: precisaArquivo ? arquivo?.size : null,
        contentType: precisaArquivo ? arquivo?.contentType : null,
        externalUrl: kind === "video_url" || kind === "link" ? url : null,
        body: kind === "texto" ? texto : null,
        durationSeconds: arquivo?.duracao ?? material?.durationSeconds ?? null,
      });
      if (r.error) { setErro(r.error); return; }
      onSalvo();
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
      <div>
        <label className="label">Tipo de conteúdo <span style={{ color: "var(--mh-danger)" }}>*</span></label>
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`btn btn-sm ${kind === k ? "btn-primary" : "btn-ghost"}`}
              onClick={() => { setKind(k); setArquivo(null); }}
              disabled={!!material}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label">Título <span style={{ color: "var(--mh-danger)" }}>*</span></label>
        <input className="input" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Aula 1, procedimento, apostila…" />
      </div>

      {precisaArquivo && (
        <div>
          <label className="label">Arquivo <span style={{ color: "var(--mh-danger)" }}>*</span></label>
          <input
            ref={inputRef}
            type="file"
            accept={kind === "video_upload" ? "video/*" : ".pdf,image/*,.doc,.docx,.ppt,.pptx"}
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void enviar(f); }}
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => inputRef.current?.click()}
            disabled={enviando > 0}
          >
            <Upload size={14} style={{ marginRight: "0.35rem" }} />
            {enviando > 0 ? "Enviando…" : arquivo ? "Trocar arquivo" : "Escolher arquivo"}
          </button>
          {arquivo && (
            <p className="soft" style={{ fontSize: "0.76rem", margin: "0.4rem 0 0" }}>
              {arquivo.filename} ({tamanho(arquivo.size)})
              {arquivo.duracao ? `, ${Math.round(arquivo.duracao / 60)} min` : ""}
            </p>
          )}
          {kind === "video_upload" && limiteMb !== null && (
            <p className="soft" style={{ fontSize: "0.72rem", margin: "0.3rem 0 0" }}>
              Limite de {limiteMb} MB por vídeo nesta empresa. Vídeo maior cabe melhor como link.
            </p>
          )}
        </div>
      )}

      {(kind === "video_url" || kind === "link") && (
        <div>
          <label className="label">Endereço <span style={{ color: "var(--mh-danger)" }}>*</span></label>
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </div>
      )}

      {kind === "texto" && (
        <div>
          <label className="label">Conteúdo <span style={{ color: "var(--mh-danger)" }}>*</span></label>
          <textarea className="input" rows={8} value={texto} onChange={(e) => setTexto(e.target.value)} />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.8rem" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.84rem" }}>
          <input type="checkbox" checked={obrigatorio} onChange={(e) => setObrigatorio(e.target.checked)} />
          Obrigatório para concluir
        </label>
        {ehVideo && (
          <div>
            <label className="label">Mínimo assistido</label>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <input type="number" min={1} max={100} className="input" style={{ maxWidth: 90 }} value={pct} onChange={(e) => setPct(e.target.value)} />
              <span className="soft" style={{ fontSize: "0.84rem" }}>%</span>
            </div>
          </div>
        )}
      </div>

      {erro && (
        <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
          {erro}
        </p>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={pending || enviando > 0} onClick={salvar}>
          {pending ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </div>
  );
}

/** Lê a duração do vídeo sem enviar nada: metadados bastam. */
function lerDuracao(f: File): Promise<number | null> {
  return new Promise((resolve) => {
    const el = document.createElement("video");
    el.preload = "metadata";
    const url = URL.createObjectURL(f);
    const limpar = () => URL.revokeObjectURL(url);
    el.onloadedmetadata = () => {
      const d = Number.isFinite(el.duration) ? Math.round(el.duration) : null;
      limpar();
      resolve(d);
    };
    el.onerror = () => { limpar(); resolve(null); };
    el.src = url;
  });
}

function Modal({
  titulo, subtitulo, children, onClose, largura = 620,
}: {
  titulo: string; subtitulo?: string; children: React.ReactNode; onClose: () => void; largura?: number;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 70, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: largura, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)", gap: "0.75rem" }}>
          <div>
            <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>{titulo}</h2>
            {subtitulo && <p className="soft" style={{ fontSize: "0.82rem", margin: "0.25rem 0 0" }}>{subtitulo}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>
        <div style={{ padding: "1.25rem" }}>{children}</div>
      </div>
    </div>
  );
}
