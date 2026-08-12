"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, FileText, Film, Link2, Paperclip } from "lucide-react";
import { toast } from "sonner";
import {
  concluirTreinamento, marcarComoLido, registrarProgresso, urlDoMaterial,
  type ConteudoParaFazer, type MaterialParaFazer,
} from "@/lib/actions/training-content";
import type { Enums } from "@/types/database";

const ICONE: Record<Enums<"training_material_kind">, React.ElementType> = {
  video_upload: Film,
  video_url: Film,
  arquivo: Paperclip,
  link: Link2,
  texto: FileText,
};

/** de quanto em quanto tempo o progresso vai ao servidor */
const BATIDA_MS = 20_000;

export function TrainingPlayer({
  conteudo, temProva = false,
}: {
  conteudo: ConteudoParaFazer;
  /** com prova, quem conclui é a aprovação: o botão daqui sai de cena */
  temProva?: boolean;
}) {
  const [materiais, setMateriais] = useState<MaterialParaFazer[]>(conteudo.materiais);
  const [ativoId, setAtivoId] = useState<string | null>(
    conteudo.materiais.find((m) => !m.concluido)?.id ?? conteudo.materiais[0]?.id ?? null,
  );
  const [pending, start] = useTransition();
  const router = useRouter();

  const ativo = materiais.find((m) => m.id === ativoId) ?? null;
  const obrigatoriosPendentes = materiais.filter((m) => m.required && !m.concluido);
  const jaConcluido = conteudo.status === "concluido";

  const atualizar = useCallback((id: string, dados: Partial<MaterialParaFazer>) => {
    setMateriais((atual) => atual.map((m) => (m.id === id ? { ...m, ...dados } : m)));
  }, []);

  const concluir = () => {
    start(async () => {
      const r = await concluirTreinamento(conteudo.enrollmentId);
      if (r.error) { toast.error(r.error); return; }
      toast.success(
        r.certificado
          ? `Treinamento concluído. Certificado ${r.certificado}.`
          : "Treinamento concluído.",
      );
      router.push("/treinamentos");
      router.refresh();
    });
  };

  if (materiais.length === 0) {
    return (
      <div className="card" style={{ padding: "1.5rem", textAlign: "center" }}>
        <p style={{ margin: 0, fontWeight: 600 }}>Este treinamento ainda não tem conteúdo publicado.</p>
        <p className="soft" style={{ fontSize: "0.85rem", margin: "0.5rem 0 0" }}>
          Procure quem responde pelo treinamento para saber quando o material estará disponível.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 280px", gap: "1.25rem", alignItems: "start" }}>
      <div className="card" style={{ padding: "1.25rem", minWidth: 0 }}>
        {ativo ? (
          <Visualizador
            key={ativo.id}
            material={ativo}
            enrollmentId={conteudo.enrollmentId}
            onProgresso={(pct, concluido) => atualizar(ativo.id, { pct, concluido })}
          />
        ) : (
          <p className="soft" style={{ fontSize: "0.85rem" }}>Escolha um item do conteúdo ao lado.</p>
        )}
      </div>

      <div className="card" style={{ padding: "1rem" }}>
        <h2 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 0.7rem" }}>Conteúdo</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          {materiais.map((m) => {
            const Icone = ICONE[m.kind];
            const selecionado = m.id === ativoId;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setAtivoId(m.id)}
                style={{
                  display: "flex", alignItems: "center", gap: "0.55rem", textAlign: "left",
                  padding: "0.5rem 0.6rem", borderRadius: 8, cursor: "pointer", width: "100%",
                  border: `1px solid ${selecionado ? "var(--mh-primary)" : "var(--border)"}`,
                  background: selecionado ? "var(--mh-primary-soft)" : "transparent",
                  color: "inherit",
                }}
              >
                {m.concluido
                  ? <Check size={15} style={{ color: "var(--mh-success)", flexShrink: 0 }} />
                  : <Icone size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />}
                <span style={{ flex: 1, minWidth: 0, fontSize: "0.83rem" }}>
                  {m.title}
                  {!m.required && <span className="soft" style={{ fontSize: "0.72rem" }}> (opcional)</span>}
                  {!m.concluido && m.pct > 0 && (
                    <span className="soft" style={{ fontSize: "0.72rem" }}> {m.pct}%</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ borderTop: "1px solid var(--border)", marginTop: "0.9rem", paddingTop: "0.9rem" }}>
          {jaConcluido ? (
            <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
              Você já concluiu este treinamento.
            </p>
          ) : temProva ? (
            <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
              {obrigatoriosPendentes.length > 0
                ? `Faltam ${obrigatoriosPendentes.length} itens obrigatórios para liberar a avaliação.`
                : "Conteúdo concluído. A conclusão do treinamento vem da aprovação na avaliação, abaixo."}
            </p>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ width: "100%" }}
                disabled={pending || obrigatoriosPendentes.length > 0}
                onClick={concluir}
              >
                {pending ? "Concluindo…" : "Concluir treinamento"}
              </button>
              {obrigatoriosPendentes.length > 0 && (
                <p className="soft" style={{ fontSize: "0.74rem", margin: "0.5rem 0 0" }}>
                  Faltam {obrigatoriosPendentes.length} de {materiais.filter((m) => m.required).length} itens obrigatórios.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Visualizador({
  material, enrollmentId, onProgresso,
}: {
  material: MaterialParaFazer;
  enrollmentId: string;
  onProgresso: (pct: number, concluido: boolean) => void;
}) {
  const ehVideo = material.kind === "video_upload" || material.kind === "video_url";
  const ehEmbed = material.kind === "video_upload";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem", minWidth: 0 }}>
      <div>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: 0 }}>{material.title}</h2>
        {ehVideo && (
          <p className="soft" style={{ fontSize: "0.76rem", margin: "0.25rem 0 0" }}>
            Conclui com {material.minWatchPct}% do vídeo assistido. Adiantar a barra não conta como assistido.
          </p>
        )}
      </div>

      {ehEmbed ? (
        <VideoComProgresso material={material} enrollmentId={enrollmentId} onProgresso={onProgresso} />
      ) : material.kind === "video_url" ? (
        <LinkExterno material={material} enrollmentId={enrollmentId} onProgresso={onProgresso} />
      ) : material.kind === "texto" ? (
        <Texto material={material} enrollmentId={enrollmentId} onProgresso={onProgresso} />
      ) : (
        <LinkExterno material={material} enrollmentId={enrollmentId} onProgresso={onProgresso} />
      )}
    </div>
  );
}

/**
 * Vídeo com registro de permanência.
 *
 * O tempo assistido é somado a partir dos avanços NATURAIS do relógio do vídeo:
 * um salto na barra produz um delta grande e é descartado. É isso que faz a
 * diferença entre "abriu o vídeo" e "assistiu ao vídeo", que é o que o Anexo II
 * da NR-1 cobra de EAD.
 */
function VideoComProgresso({
  material, enrollmentId, onProgresso,
}: {
  material: MaterialParaFazer;
  enrollmentId: string;
  onProgresso: (pct: number, concluido: boolean) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const ref = useRef<HTMLVideoElement>(null);
  const acumulado = useRef(0);
  const ultimoTempo = useRef(0);
  const inicioJanela = useRef(0);

  useEffect(() => {
    let vivo = true;
    urlDoMaterial(material.id).then((r) => {
      if (!vivo) return;
      if (r.error) setErro(r.error);
      else setUrl(r.url ?? null);
    });
    return () => { vivo = false; };
  }, [material.id]);

  const bater = useCallback(async () => {
    const el = ref.current;
    if (!el || acumulado.current < 1) return;
    const segundos = acumulado.current;
    acumulado.current = 0;
    const de = inicioJanela.current;
    inicioJanela.current = el.currentTime;
    const r = await registrarProgresso({
      enrollmentId,
      materialId: material.id,
      assistidoSegundos: Math.round(segundos),
      posicaoSegundos: el.currentTime,
      duracaoSegundos: el.duration || material.durationSeconds || 0,
      deSegundos: de,
    });
    if (r.pct !== undefined) onProgresso(r.pct, !!r.concluido);
  }, [enrollmentId, material.id, material.durationSeconds, onProgresso]);

  useEffect(() => {
    const id = setInterval(() => { void bater(); }, BATIDA_MS);
    // sair da página sem perder o que já foi assistido
    const aoSair = () => { void bater(); };
    window.addEventListener("pagehide", aoSair);
    return () => {
      clearInterval(id);
      window.removeEventListener("pagehide", aoSair);
      void bater();
    };
  }, [bater]);

  if (erro) return <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem" }}>{erro}</p>;
  if (!url) return <p className="soft" style={{ fontSize: "0.85rem" }}>Carregando o vídeo…</p>;

  return (
    <video
      ref={ref}
      src={url}
      controls
      controlsList="nodownload"
      style={{ width: "100%", borderRadius: 10, background: "#000" }}
      onLoadedMetadata={(e) => {
        ultimoTempo.current = e.currentTarget.currentTime;
        inicioJanela.current = e.currentTarget.currentTime;
      }}
      onTimeUpdate={(e) => {
        const agora = e.currentTarget.currentTime;
        const delta = agora - ultimoTempo.current;
        // avanço natural do relógio do vídeo: entre 0 e 2s por evento.
        // Fora disso foi salto na barra, e salto não é tempo assistido.
        if (delta > 0 && delta < 2) acumulado.current += delta;
        ultimoTempo.current = agora;
      }}
      onPause={() => { void bater(); }}
      onEnded={() => { void bater(); }}
    />
  );
}

function Texto({
  material, enrollmentId, onProgresso,
}: {
  material: MaterialParaFazer;
  enrollmentId: string;
  onProgresso: (pct: number, concluido: boolean) => void;
}) {
  return (
    <>
      <div
        style={{
          whiteSpace: "pre-wrap", fontSize: "0.9rem", lineHeight: 1.6,
          border: "1px solid var(--border)", borderRadius: 10, padding: "1rem",
          maxHeight: "60vh", overflowY: "auto",
        }}
      >
        {material.body}
      </div>
      <BotaoLido material={material} enrollmentId={enrollmentId} onProgresso={onProgresso} />
    </>
  );
}

function LinkExterno({
  material, enrollmentId, onProgresso,
}: {
  material: MaterialParaFazer;
  enrollmentId: string;
  onProgresso: (pct: number, concluido: boolean) => void;
}) {
  const [pending, start] = useTransition();

  const abrir = () => {
    start(async () => {
      const r = await urlDoMaterial(material.id);
      if (r.error || !r.url) { toast.error(r.error ?? "Conteúdo indisponível."); return; }
      window.open(r.url, "_blank", "noopener,noreferrer");
    });
  };

  return (
    <>
      <div
        style={{
          border: "1px solid var(--border)", borderRadius: 10, padding: "1.5rem",
          display: "flex", flexDirection: "column", alignItems: "center", gap: "0.7rem",
        }}
      >
        <p className="soft" style={{ fontSize: "0.85rem", margin: 0, textAlign: "center" }}>
          {material.kind === "arquivo"
            ? `Abra o arquivo${material.filename ? ` ${material.filename}` : ""} para estudar o conteúdo.`
            : "O conteúdo abre em outra aba."}
        </p>
        <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={abrir}>
          <ExternalLink size={14} style={{ marginRight: "0.35rem" }} />
          {pending ? "Abrindo…" : "Abrir conteúdo"}
        </button>
      </div>
      <BotaoLido material={material} enrollmentId={enrollmentId} onProgresso={onProgresso} />
    </>
  );
}

function BotaoLido({
  material, enrollmentId, onProgresso,
}: {
  material: MaterialParaFazer;
  enrollmentId: string;
  onProgresso: (pct: number, concluido: boolean) => void;
}) {
  const [pending, start] = useTransition();

  if (material.concluido) {
    return (
      <p style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.83rem", color: "var(--mh-success)", margin: 0 }}>
        <Check size={15} /> Concluído.
      </p>
    );
  }

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      style={{ alignSelf: "flex-start" }}
      disabled={pending}
      onClick={() => start(async () => {
        const r = await marcarComoLido(enrollmentId, material.id);
        if (r.error) { toast.error(r.error); return; }
        onProgresso(100, true);
      })}
    >
      Marcar como concluído
    </button>
  );
}
