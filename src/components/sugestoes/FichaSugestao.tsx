"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bell, BellOff, BookOpen, EyeOff, MessageSquare, Pencil, ThumbsUp, Trash2 } from "lucide-react";
import { DetailModal } from "@/components/ui/DetailModal";
import { Badge } from "@/components/ui/Badge";
import { confirmDialog } from "@/components/ui/confirm";
import { FiguraDoArtigo } from "@/components/conhecimento/FiguraDoArtigo";
import {
  apagarComentarioSugestao, apagarSugestao, comentarSugestao, curtirSugestao, editarComentarioSugestao,
  lerFichaSugestao, moderarComentarioSugestao, moderarSugestao, seguirSugestao, triarSugestao,
} from "@/lib/actions/sugestoes";
import {
  ORDEM_STATUS, STATUS_SUGESTAO, STATUS_SUGESTAO_TONE, aceitaCurtida,
  type ComentarioSugestao, type Sugestao, type SugestaoStatus,
} from "@/lib/sugestoes";
import { MODULE_BY_KEY, type ModuleKey } from "@/lib/modules";
import { formatDate, formatDateTime, shortName } from "@/lib/format";

export function FichaSugestao({ s, todas, meuId, podeTriar, artigos, zIndex = 60, onFechar, onAbrir, onEditar }: {
  s: Sugestao;
  todas: Sugestao[];
  meuId: string;
  podeTriar: boolean;
  artigos: { slug: string; titulo: string }[];
  zIndex?: number;
  onFechar: () => void;
  onAbrir: (id: string) => void;
  onEditar: (s: Sugestao, urls: Record<string, string>) => void;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [comentarios, setComentarios] = useState<ComentarioSugestao[] | null>(null);
  const [curtidores, setCurtidores] = useState<{ nome: string; empresa: string }[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [novo, setNovo] = useState("");
  const [editando, setEditando] = useState<{ id: string; texto: string } | null>(null);
  const [erro, setErro] = useState("");
  const [versao, setVersao] = useState(0);

  // os comentários, quem curtiu e os prints vêm ao abrir, e de novo a cada mudança
  const chave = `${s.id}|${s.curtidas}|${s.comentarios}|${s.imagens.join(",")}|${versao}`;
  useEffect(() => {
    let vivo = true;
    void lerFichaSugestao(s.id, s.imagens).then((r) => {
      if (!vivo) return;
      if (r.error) { setErro(r.error); return; }
      setComentarios(r.comentarios ?? []);
      setCurtidores(r.curtidores ?? []);
      setUrls(r.urls ?? {});
    });
    return () => { vivo = false; };
    // a chave junta tudo que muda o que a ficha mostra
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  const minha = s.autorId === meuId;
  const original = s.duplicadaDe ? todas.find((x) => x.id === s.duplicadaDe) ?? null : null;
  const modulo = s.modulo ? MODULE_BY_KEY[s.modulo as ModuleKey] : null;
  const podeApagar = podeTriar || (minha && s.status === "nova" && s.curtidas === 0 && s.comentarios === 0);

  const rodar = (fn: () => Promise<{ error?: string }>, ok?: string) => {
    setErro("");
    iniciar(async () => {
      const r = await fn();
      if (r.error) { setErro(r.error); return; }
      if (ok) toast.success(ok);
      setVersao((v) => v + 1);
      router.refresh();
    });
  };

  const apagar = async () => {
    const ok = await confirmDialog({
      title: "Apagar a sugestão",
      tone: "danger",
      confirmLabel: "Apagar",
      message: `Apagar "${s.titulo}"? Ela some para todos, com as curtidas e os comentários, e não volta.`,
    });
    if (!ok) return;
    setErro("");
    iniciar(async () => {
      const r = await apagarSugestao(s.id);
      if (r.error) { setErro(r.error); return; }
      toast.success("Sugestão apagada.");
      onFechar();
      router.refresh();
    });
  };

  const comentar = () => {
    const texto = novo;
    rodar(async () => {
      const r = await comentarSugestao(s.id, texto);
      if (!r.error) setNovo("");
      return r;
    });
  };

  return (
    <DetailModal
      open onClose={onFechar} width="lg" zIndex={zIndex}
      title={s.titulo}
      badges={
        <>
          <Badge tone={STATUS_SUGESTAO_TONE[s.status]}>{STATUS_SUGESTAO[s.status]}</Badge>
          <Badge variant="quiet" tone="blue">{modulo?.label ?? "Geral / módulo novo"}</Badge>
          {s.oculta && <Badge variant="quiet" tone="red">Oculta pela moderação</Badge>}
        </>
      }
    >
      <p className="soft" style={{ margin: 0, fontSize: "0.82rem" }}>
        Sugerida por <strong title={s.autorNome}>{shortName(s.autorNome)}</strong> · {s.empresaNome} · {formatDate(s.createdAt)}
      </p>

      {s.oculta && (
        <p style={{ margin: 0, fontSize: "0.84rem", background: "var(--mh-danger-soft)", borderLeft: "3px solid var(--mh-danger)", padding: "0.55rem 0.7rem", borderRadius: 8 }}>
          Esta sugestão foi ocultada pela moderação e só você{podeTriar ? " (triagem) e o autor" : " e a triagem"} a veem.
          {s.ocultaMotivo ? ` Motivo: ${s.ocultaMotivo}` : ""}
        </p>
      )}

      <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "0.92rem", lineHeight: 1.6 }}>{s.descricao}</p>

      {s.imagens.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "0.6rem" }}>
          {s.imagens.map((a, i) => (
            <figure key={a} className="mh-artigo-figura" style={{ margin: 0 }}>
              {urls[a]
                ? <FiguraDoArtigo url={urls[a]} legenda={`Print ${i + 1} da sugestão`} />
                : <div className="mh-artigo-sem-imagem">Carregando…</div>}
            </figure>
          ))}
        </div>
      )}

      {original && (
        <p style={{ margin: 0, fontSize: "0.86rem" }}>
          Duplicada de{" "}
          <button type="button" onClick={() => onAbrir(original.id)} style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "var(--mh-primary-500)", cursor: "pointer", textDecoration: "underline" }}>
            {original.titulo}
          </button>
          . As curtidas e quem acompanhava passaram para ela.
        </p>
      )}

      {s.resposta && (
        <aside className="mh-artigo-aviso dica" style={{ margin: 0 }}>
          <MessageSquare size={17} aria-hidden />
          <div>
            <p style={{ fontWeight: 700, fontSize: "0.8rem", marginBottom: "0.25rem" }}>
              Resposta da equipe{s.respostaPorNome ? ` · ${shortName(s.respostaPorNome)}` : ""}{s.respostaEm ? ` · ${formatDate(s.respostaEm)}` : ""}
            </p>
            <p style={{ whiteSpace: "pre-wrap", fontSize: "0.88rem" }}>{s.resposta}</p>
          </div>
        </aside>
      )}

      {s.status === "entregue" && s.artigoSlug && (
        <Link href={`/conhecimento/${s.artigoSlug}`} className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }}>
          <BookOpen size={15} /> Ver como usar no Banco de conhecimento
        </Link>
      )}

      {/* ações de quem lê */}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          className={`btn btn-sm ${s.curti ? "btn-primary" : "btn-ghost"}`}
          disabled={pendente || minha || (!s.curti && !aceitaCurtida(s.status)) || s.oculta}
          title={minha ? "Sua sugestão" : !aceitaCurtida(s.status) ? "Sugestão encerrada" : s.curti ? "Desfazer a curtida" : "Curtir"}
          onClick={() => rodar(() => curtirSugestao(s.id, !s.curti))}
        >
          <ThumbsUp size={15} /> {s.curti ? "Curtida" : "Curtir"} · {s.curtidas}
        </button>
        <button
          type="button" className="btn btn-ghost btn-sm" disabled={pendente}
          title={s.sigo ? "Você recebe os avisos de mudança desta sugestão" : "Receber os avisos de mudança desta sugestão"}
          onClick={() => rodar(() => seguirSugestao(s.id, !s.sigo))}
        >
          {s.sigo ? <><BellOff size={15} /> Deixar de seguir</> : <><Bell size={15} /> Seguir</>}
        </button>
        {minha && s.status === "nova" && !s.oculta && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={pendente} onClick={() => onEditar(s, urls)}>
            <Pencil size={15} /> Editar
          </button>
        )}
        {podeApagar && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={pendente} onClick={apagar} style={{ color: "var(--mh-danger)" }}>
            <Trash2 size={15} /> Apagar
          </button>
        )}
      </div>
      {curtidores.length > 0 && (
        <p className="soft" style={{ margin: "-0.5rem 0 0", fontSize: "0.78rem" }}>
          Curtiram: {curtidores.slice(0, 8).map((c) => `${shortName(c.nome)} (${c.empresa})`).join(", ")}
          {curtidores.length > 8 ? ` e mais ${curtidores.length - 8}` : ""}
        </p>
      )}

      {/* comentários */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.9rem", display: "flex", flexDirection: "column", gap: "0.7rem" }}>
        <span style={{ fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--mh-text-3)" }}>
          Comentários ({s.comentarios})
        </span>
        {comentarios === null && <span className="soft" style={{ fontSize: "0.84rem" }}>Carregando…</span>}
        {comentarios?.length === 0 && <span className="soft" style={{ fontSize: "0.84rem" }}>Ninguém comentou ainda.</span>}
        {comentarios?.map((c) => {
          const meu = c.autorId === meuId;
          return (
            <div key={c.id} style={{ background: "var(--surface-2)", borderRadius: 10, padding: "0.6rem 0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.8rem" }}>
                  <strong title={c.autorNome}>{shortName(c.autorNome)}</strong>
                  <span className="soft"> · {c.empresaNome} · {formatDateTime(c.createdAt)}{c.editadoEm ? " · editado" : ""}</span>
                </span>
                <span style={{ display: "inline-flex", gap: "0.25rem" }}>
                  {meu && !c.oculto && editando?.id !== c.id && (
                    <>
                      <button type="button" className="icon-btn" title="Editar" aria-label="Editar comentário" onClick={() => setEditando({ id: c.id, texto: c.texto ?? "" })}><Pencil size={13} /></button>
                      <button
                        type="button" className="icon-btn" title="Apagar" aria-label="Apagar comentário" style={{ color: "var(--mh-danger)" }}
                        onClick={async () => {
                          if (await confirmDialog({ title: "Apagar o comentário", tone: "danger", confirmLabel: "Apagar", message: "O comentário some e não volta." })) {
                            rodar(() => apagarComentarioSugestao(c.id));
                          }
                        }}
                      ><Trash2 size={13} /></button>
                    </>
                  )}
                  {podeTriar && !meu && (
                    <button
                      type="button" className="btn btn-ghost btn-xs" title={c.oculto ? "Mostrar de novo" : "Ocultar por ser impróprio"}
                      onClick={() => rodar(() => moderarComentarioSugestao(c.id, !c.oculto), c.oculto ? "Comentário visível de novo." : "Comentário ocultado.")}
                    >
                      <EyeOff size={12} /> {c.oculto ? "Mostrar" : "Ocultar"}
                    </button>
                  )}
                </span>
              </div>
              {editando?.id === c.id ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginTop: "0.4rem" }}>
                  <textarea className="input" rows={3} value={editando.texto} maxLength={2000} onChange={(e) => setEditando({ id: c.id, texto: e.target.value })} />
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <button type="button" className="btn btn-primary btn-xs" disabled={pendente}
                      onClick={() => { const e = editando; rodar(async () => { const r = await editarComentarioSugestao(e.id, e.texto); if (!r.error) setEditando(null); return r; }); }}>
                      Salvar
                    </button>
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEditando(null)}>Cancelar</button>
                  </div>
                </div>
              ) : c.oculto ? (
                <p className="soft" style={{ margin: "0.3rem 0 0", fontSize: "0.84rem", fontStyle: "italic" }}>Comentário removido pela moderação.</p>
              ) : (
                <p style={{ margin: "0.3rem 0 0", fontSize: "0.88rem", whiteSpace: "pre-wrap" }}>{c.texto}</p>
              )}
            </div>
          );
        })}
        {!s.oculta && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <textarea
              className="input" rows={2} value={novo} maxLength={2000}
              placeholder="Escreva um comentário: como isso ajudaria você, um detalhe a mais, uma dúvida…"
              onChange={(e) => setNovo(e.target.value)}
            />
            <button type="button" className="btn btn-primary btn-sm" style={{ alignSelf: "flex-start" }} disabled={pendente || !novo.trim()} onClick={comentar}>
              Comentar
            </button>
          </div>
        )}
      </div>

      {podeTriar && (
        // recomeça com o que foi salvo (o estado do painel nasce da sugestão)
        <Triagem
          key={`${s.status}|${s.resposta}|${s.duplicadaDe}|${s.artigoSlug}|${s.oculta}`}
          s={s} todas={todas} artigos={artigos} pendente={pendente} rodar={rodar}
        />
      )}

      {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{erro}</p>}
    </DetailModal>
  );
}

/** O painel do Proprietário: situação, resposta oficial, original, manual e moderação. */
function Triagem({ s, todas, artigos, pendente, rodar }: {
  s: Sugestao;
  todas: Sugestao[];
  artigos: { slug: string; titulo: string }[];
  pendente: boolean;
  rodar: (fn: () => Promise<{ error?: string }>, ok?: string) => void;
}) {
  const [status, setStatus] = useState<SugestaoStatus>(s.status);
  const [resposta, setResposta] = useState(s.resposta ?? "");
  const [original, setOriginal] = useState(s.duplicadaDe ?? "");
  const [artigo, setArtigo] = useState(s.artigoSlug ?? "");
  const [motivo, setMotivo] = useState("");
  const candidatas = todas.filter((x) => x.id !== s.id && x.status !== "duplicada");

  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.9rem", display: "flex", flexDirection: "column", gap: "0.7rem" }}>
      <span style={{ fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--mh-text-3)" }}>
        Triagem
      </span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.7rem" }}>
        <div>
          <label className="label">Situação</label>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value as SugestaoStatus)}>
            {ORDEM_STATUS.map((x) => <option key={x} value={x}>{STATUS_SUGESTAO[x]}</option>)}
          </select>
        </div>
        {status === "duplicada" && (
          <div>
            <label className="label">Original <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <select className="select" value={original} onChange={(e) => setOriginal(e.target.value)}>
              <option value="">Escolha a sugestão original…</option>
              {candidatas.map((x) => <option key={x.id} value={x.id}>{x.titulo}</option>)}
            </select>
          </div>
        )}
        {status === "entregue" && (
          <div>
            <label className="label">Manual no Banco de conhecimento</label>
            <select className="select" value={artigo} onChange={(e) => setArtigo(e.target.value)}>
              <option value="">Sem artigo</option>
              {artigos.map((a) => <option key={a.slug} value={a.slug}>{a.titulo}</option>)}
            </select>
          </div>
        )}
      </div>
      <div>
        <label className="label">
          Resposta oficial {status === "recusada" && <span style={{ color: "var(--mh-danger)" }}>*</span>}
        </label>
        <textarea
          className="input" rows={3} value={resposta} maxLength={4000}
          placeholder={status === "recusada" ? "Por que a sugestão não vai entrar." : "O que acontece com a sugestão, para quem curtiu e comentou."}
          onChange={(e) => setResposta(e.target.value)}
        />
        <p className="soft" style={{ fontSize: "0.74rem", margin: "0.3rem 0 0" }}>
          Ao salvar uma mudança de situação ou de resposta, o autor e quem segue a sugestão recebem o aviso.
        </p>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button" className="btn btn-primary btn-sm" disabled={pendente}
          onClick={() => rodar(() => triarSugestao({ id: s.id, status, resposta, duplicadaDe: original || null, artigoSlug: artigo || null }), "Triagem salva.")}
        >
          Salvar triagem
        </button>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
        {!s.oculta && (
          <div style={{ flex: "1 1 240px" }}>
            <label className="label">Motivo para ocultar</label>
            <input className="input" value={motivo} placeholder="Ex.: fala de uma pessoa, não do sistema" onChange={(e) => setMotivo(e.target.value)} />
          </div>
        )}
        <button
          type="button" className="btn btn-ghost btn-sm" disabled={pendente}
          onClick={() => rodar(() => moderarSugestao(s.id, !s.oculta, motivo), s.oculta ? "Sugestão visível de novo." : "Sugestão ocultada.")}
        >
          <EyeOff size={14} /> {s.oculta ? "Mostrar para todos de novo" : "Ocultar sugestão"}
        </button>
      </div>
    </div>
  );
}
