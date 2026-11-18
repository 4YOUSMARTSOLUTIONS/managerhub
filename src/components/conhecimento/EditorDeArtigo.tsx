"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Bold, Eye, Heading2, ImagePlus, List, ListOrdered, Lightbulb, Save, Table, Trash2,
} from "lucide-react";
import { Markdown } from "@/components/conhecimento/Markdown";
import { confirmDialog } from "@/components/ui/confirm";
import { apagarArtigo, enviarImagemConhecimento, salvarArtigo } from "@/lib/actions/conhecimento";
import { slugDe } from "@/lib/conhecimento";
import { MODULES, MODULE_GROUPS, modulesInGroup } from "@/lib/modules";

export type ArtigoEditavel = {
  id: string | null;
  slug: string;
  modulo: string | null;
  titulo: string;
  resumo: string;
  conteudo: string;
  ordem: number;
  publicado: boolean;
};

/** Os módulos na mesma organização do menu, sem o próprio Banco. */
const SOLTOS = MODULES.filter((m) => m.group === null && m.key !== "conhecimento")
  .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

export function EditorDeArtigo({ inicial, imagens: imagensIniciais }: {
  inicial: ArtigoEditavel | null;
  imagens: Record<string, string>;
}) {
  const router = useRouter();
  const [a, setA] = useState<ArtigoEditavel>(inicial ?? {
    id: null, slug: "", modulo: null, titulo: "", resumo: "", conteudo: "", ordem: 0, publicado: false,
  });
  // o endereço acompanha o título até alguém mexer nele (ou até já existir)
  const [slugManual, setSlugManual] = useState(Boolean(inicial));
  const [imagens, setImagens] = useState(imagensIniciais);
  const [sujo, setSujo] = useState(false);
  const [erro, setErro] = useState("");
  const [enviandoImagem, setEnviandoImagem] = useState(false);
  const [pendente, iniciar] = useTransition();
  const texto = useRef<HTMLTextAreaElement>(null);
  const seletor = useRef<HTMLInputElement>(null);

  const muda = (parcial: Partial<ArtigoEditavel>) => { setA((x) => ({ ...x, ...parcial })); setSujo(true); };

  // sair com alteração por salvar pede confirmação do navegador
  useEffect(() => {
    if (!sujo) return;
    const aviso = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [sujo]);

  /** Troca a seleção do texto por `antes + seleção + depois`, com o cursor no fim. */
  // lê o texto do próprio campo, e não do estado: a imagem volta do envio
  // depois, e nesse meio tempo a pessoa pode ter continuado escrevendo
  const envolver = (antes: string, depois = "", padrao = "") => {
    const el = texto.current;
    if (!el) return;
    const atual = el.value;
    const ini = el.selectionStart;
    const fim = el.selectionEnd;
    const sel = atual.slice(ini, fim) || padrao;
    const novo = atual.slice(0, ini) + antes + sel + depois + atual.slice(fim);
    muda({ conteudo: novo });
    const cursor = ini + antes.length + sel.length + depois.length;
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(cursor, cursor); });
  };

  /** Bloco em linha própria (imagem, tabela, aviso), sem grudar no parágrafo. */
  const bloco = (conteudo: string) => {
    const el = texto.current;
    if (!el) return;
    const antes = el.value.slice(0, el.selectionStart);
    const prefixo = !antes || antes.endsWith("\n\n") ? "" : antes.endsWith("\n") ? "\n" : "\n\n";
    envolver(`${prefixo}${conteudo}\n\n`);
  };

  const subirImagem = (file: File) => {
    setErro("");
    setEnviandoImagem(true);
    const fd = new FormData();
    fd.set("file", file);
    void enviarImagemConhecimento(fd).then((r) => {
      setEnviandoImagem(false);
      if (r.error || !r.arquivo) { setErro(r.error ?? "Não foi possível enviar a imagem."); return; }
      if (r.url) setImagens((m) => ({ ...m, [r.arquivo as string]: r.url as string }));
      bloco(`![Legenda da imagem](img:${r.arquivo})`);
    });
  };

  const salvar = () => {
    setErro("");
    iniciar(async () => {
      const r = await salvarArtigo({ ...a, modulo: a.modulo || null });
      if (r.error || !r.id || !r.slug) { setErro(r.error ?? "Não foi possível salvar."); return; }
      setSujo(false);
      toast.success(a.publicado ? "Artigo salvo e publicado." : "Rascunho salvo. Só você vê enquanto não publicar.");
      const novoEndereco = !a.id || r.slug !== inicial?.slug;
      setA((x) => ({ ...x, id: r.id as string, slug: r.slug as string }));
      if (novoEndereco) router.replace(`/conhecimento/${r.slug}/editar`);
      else router.refresh();
    });
  };

  const apagar = async () => {
    if (!a.id) return;
    const ok = await confirmDialog({
      title: "Apagar o artigo",
      tone: "danger",
      confirmLabel: "Apagar",
      message: `Apagar "${a.titulo}"? Ele some do Banco de conhecimento para todas as empresas e não volta.`,
    });
    if (!ok) return;
    iniciar(async () => {
      const r = await apagarArtigo(a.id as string);
      if (r.error) { setErro(r.error); return; }
      setSujo(false);
      toast.success("Artigo apagado.");
      router.push("/conhecimento");
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div className="card" style={{ padding: "1.1rem 1.25rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.9rem" }}>
        <div style={{ gridColumn: "span 2", minWidth: 0 }}>
          <label className="label">Título <span style={{ color: "var(--mh-danger)" }}>*</span></label>
          <input
            className="input" value={a.titulo} placeholder="Absenteísmo: lançar e acompanhar ausências"
            onChange={(e) => muda({ titulo: e.target.value, ...(slugManual ? {} : { slug: slugDe(e.target.value) }) })}
          />
        </div>
        <div>
          <label className="label">Endereço <span style={{ color: "var(--mh-danger)" }}>*</span></label>
          <input
            className="input" value={a.slug} placeholder="absenteismo"
            onChange={(e) => { setSlugManual(true); muda({ slug: e.target.value.toLowerCase() }); }}
          />
        </div>
        <div>
          <label className="label">Módulo</label>
          <select className="select" value={a.modulo ?? ""} onChange={(e) => muda({ modulo: e.target.value || null })}>
            <option value="">Geral (todas as pessoas)</option>
            {MODULE_GROUPS.map((g) => (
              <optgroup key={g.key} label={g.label}>
                {modulesInGroup(g.key).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </optgroup>
            ))}
            <optgroup label="Outras telas">
              {SOLTOS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </optgroup>
          </select>
        </div>
        <div style={{ gridColumn: "span 2", minWidth: 0 }}>
          <label className="label">Resumo</label>
          <input
            className="input" value={a.resumo} placeholder="Uma frase do que o artigo ensina. Aparece na lista."
            onChange={(e) => muda({ resumo: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Ordem na seção</label>
          <input
            type="number" className="input" value={a.ordem}
            onChange={(e) => muda({ ordem: Number(e.target.value) || 0 })}
          />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.84rem", cursor: "pointer", alignSelf: "end", minHeight: 36 }}>
          <input type="checkbox" checked={a.publicado} onChange={(e) => muda({ publicado: e.target.checked })} />
          Publicado (aparece para quem acessa o módulo)
        </label>
      </div>

      <div className="mh-editor-grid">
        <div className="card" style={{ padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem", minWidth: 0 }}>
          <div style={{ display: "flex", gap: "0.25rem", alignItems: "center", flexWrap: "wrap" }}>
            <BotaoDeFormato titulo="Seção" icone={<Heading2 size={16} />} onClick={() => bloco("## Nova seção")} />
            <BotaoDeFormato titulo="Negrito" icone={<Bold size={16} />} onClick={() => envolver("**", "**", "texto")} />
            <BotaoDeFormato titulo="Lista" icone={<List size={16} />} onClick={() => bloco("- item\n- item")} />
            <BotaoDeFormato titulo="Passo a passo" icone={<ListOrdered size={16} />} onClick={() => bloco("1. Primeiro passo\n2. Segundo passo")} />
            <BotaoDeFormato titulo="Aviso" icone={<Lightbulb size={16} />} onClick={() => bloco("> **Atenção:** texto do aviso")} />
            <BotaoDeFormato titulo="Tabela" icone={<Table size={16} />} onClick={() => bloco("| Coluna | Coluna |\n| --- | --- |\n| valor | valor |")} />
            <button
              type="button" className="btn btn-ghost btn-sm" disabled={enviandoImagem}
              onClick={() => seletor.current?.click()} style={{ marginLeft: "auto" }}
            >
              <ImagePlus size={15} /> {enviandoImagem ? "Enviando…" : "Inserir imagem"}
            </button>
            <input
              ref={seletor} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif"
              aria-label="Escolher imagem do artigo"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) subirImagem(f); e.target.value = ""; }}
            />
          </div>
          <textarea
            ref={texto}
            className="input mh-editor-texto"
            value={a.conteudo}
            placeholder={"## Primeira seção\n\nEscreva o texto. Cole um print com Ctrl+V para inserir a imagem."}
            onChange={(e) => muda({ conteudo: e.target.value })}
            onPaste={(e) => {
              const f = [...e.clipboardData.files].find((x) => x.type.startsWith("image/"));
              if (f) { e.preventDefault(); subirImagem(f); }
            }}
            onDrop={(e) => {
              const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("image/"));
              if (f) { e.preventDefault(); subirImagem(f); }
            }}
          />
          <p className="soft" style={{ fontSize: "0.74rem", margin: 0 }}>
            ## seção · ### subseção · **negrito** · _itálico_ · - lista · 1. passo · &gt; aviso · | tabela | ·
            [texto](/caminho). Print: botão Inserir imagem, Ctrl+V ou arrastar. Troque &quot;Legenda da imagem&quot; pela legenda.
          </p>
        </div>

        <div className="card" style={{ padding: "1.25rem 1.5rem", minWidth: 0 }}>
          <span className="soft" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.74rem", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700, marginBottom: "0.75rem" }}>
            <Eye size={13} /> Prévia
          </span>
          {a.conteudo.trim()
            ? <Markdown conteudo={a.conteudo} imagens={imagens} />
            : <p className="soft" style={{ margin: 0, fontSize: "0.86rem" }}>O artigo aparece aqui enquanto você escreve.</p>}
        </div>
      </div>

      {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{erro}</p>}

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={pendente} onClick={salvar}>
          <Save size={15} /> {pendente ? "Salvando…" : "Salvar"}
        </button>
        {a.id && (
          <Link href={`/conhecimento/${a.slug}`} className="btn btn-ghost btn-sm">Ver o artigo</Link>
        )}
        <Link href="/conhecimento" className="btn btn-ghost btn-sm">Voltar</Link>
        {sujo && <span className="soft" style={{ fontSize: "0.8rem" }}>Alterações não salvas</span>}
        {a.id && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={pendente} onClick={apagar} style={{ marginLeft: "auto", color: "var(--mh-danger)" }}>
            <Trash2 size={15} /> Apagar
          </button>
        )}
      </div>
    </div>
  );
}

function BotaoDeFormato({ titulo, icone, onClick }: { titulo: string; icone: React.ReactNode; onClick: () => void }) {
  return <button type="button" className="icon-btn" title={titulo} aria-label={titulo} onClick={onClick}>{icone}</button>;
}
