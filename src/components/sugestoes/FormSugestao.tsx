"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ImagePlus, Info, ThumbsUp, X } from "lucide-react";
import { DetailModal } from "@/components/ui/DetailModal";
import { criarSugestao, descartarPrintSugestao, editarSugestao, enviarPrintSugestao } from "@/lib/actions/sugestoes";
import { MAX_PRINTS_SUGESTAO, MIMES_PRINT_SUGESTAO, parecidas, type Sugestao } from "@/lib/sugestoes";
import { MODULES, MODULE_GROUPS, modulesInGroup } from "@/lib/modules";

const SOLTOS = MODULES.filter((m) => m.group === null && m.key !== "admin")
  .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

type Print = { arquivo: string; url: string | null };

/**
 * Nova sugestão ou edição da própria (enquanto está Nova). Fecha só pelo X ou
 * pelo Cancelar: clique fora não fecha, para não perder o que foi escrito.
 */
export function FormSugestao({ inicial, urlsIniciais, todas, onFechar, onAbrir, onSalva }: {
  inicial: Sugestao | null;
  urlsIniciais?: Record<string, string>;
  todas: Sugestao[];
  onFechar: () => void;
  /** abre a ficha de uma parecida, por cima do formulário */
  onAbrir: (id: string) => void;
  onSalva: (id: string) => void;
}) {
  const [titulo, setTitulo] = useState(inicial?.titulo ?? "");
  const [descricao, setDescricao] = useState(inicial?.descricao ?? "");
  const [modulo, setModulo] = useState(inicial?.modulo ?? "");
  const [prints, setPrints] = useState<Print[]>(
    (inicial?.imagens ?? []).map((a) => ({ arquivo: a, url: urlsIniciais?.[a] ?? null })),
  );
  const [enviandoPrint, setEnviandoPrint] = useState(false);
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const seletor = useRef<HTMLInputElement>(null);
  const originais = useMemo(() => new Set(inicial?.imagens ?? []), [inicial]);

  // as parecidas aparecem só ao sugerir: na edição a pessoa já decidiu
  const semelhantes = useMemo(
    () => (inicial ? [] : parecidas(titulo, todas)),
    [inicial, titulo, todas],
  );

  const subir = (files: File[]) => {
    const vagas = MAX_PRINTS_SUGESTAO - prints.length;
    const imagens = files.filter((f) => MIMES_PRINT_SUGESTAO.includes(f.type)).slice(0, Math.max(0, vagas));
    if (vagas <= 0) { setErro(`Até ${MAX_PRINTS_SUGESTAO} prints por sugestão.`); return; }
    if (!imagens.length) { setErro("Escolha uma imagem (PNG, JPG, WEBP ou GIF)."); return; }
    setErro("");
    setEnviandoPrint(true);
    void (async () => {
      for (const f of imagens) {
        const fd = new FormData();
        fd.set("file", f);
        const r = await enviarPrintSugestao(fd);
        if (r.error || !r.arquivo) { setErro(r.error ?? "Não foi possível enviar a imagem."); break; }
        setPrints((p) => [...p, { arquivo: r.arquivo as string, url: r.url ?? null }]);
      }
      setEnviandoPrint(false);
    })();
  };

  const tirar = (p: Print) => {
    setPrints((xs) => xs.filter((x) => x.arquivo !== p.arquivo));
    // o que acabou de subir e saiu antes de salvar não fica no armazenamento;
    // o que já estava na sugestão sai quando a edição for salva
    if (!originais.has(p.arquivo)) void descartarPrintSugestao(p.arquivo);
  };

  const cancelar = () => {
    for (const p of prints) if (!originais.has(p.arquivo)) void descartarPrintSugestao(p.arquivo);
    onFechar();
  };

  const salvar = () => {
    setErro("");
    iniciar(async () => {
      const dados = { titulo, descricao, modulo: modulo || null, imagens: prints.map((p) => p.arquivo) };
      if (inicial) {
        const r = await editarSugestao({ id: inicial.id, ...dados });
        if (r.error) { setErro(r.error); return; }
        toast.success("Sugestão atualizada.");
        onSalva(inicial.id);
      } else {
        const r = await criarSugestao(dados);
        if (r.error || !r.id) { setErro(r.error ?? "Não foi possível enviar."); return; }
        toast.success("Sugestão enviada. Obrigado!");
        onSalva(r.id);
      }
    });
  };

  return (
    <DetailModal
      open onClose={cancelar} width="lg"
      title={inicial ? "Editar sugestão" : "Nova sugestão"}
      footer={
        <>
          <span className="soft" style={{ fontSize: "0.78rem", display: "inline-flex", gap: "0.35rem", alignItems: "center" }}>
            <Info size={14} aria-hidden /> Seu nome e sua empresa aparecem para todos os usuários do portal.
          </span>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="btn btn-ghost btn-sm" disabled={pendente} onClick={cancelar}>Cancelar</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={pendente || enviandoPrint} onClick={salvar}>
              {pendente ? "Enviando…" : inicial ? "Salvar" : "Enviar sugestão"}
            </button>
          </div>
        </>
      }
    >
      <div>
        <label className="label">Título <span style={{ color: "var(--mh-danger)" }}>*</span></label>
        <input
          className="input" value={titulo} maxLength={120} autoFocus
          placeholder="Ex.: Baixar o aviso de férias em PDF"
          onChange={(e) => setTitulo(e.target.value)}
        />
      </div>

      {semelhantes.length > 0 && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--mh-radius-lg)", background: "var(--surface-2)", padding: "0.7rem 0.8rem", display: "flex", flexDirection: "column", gap: "0.45rem" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Já existe uma parecida? Curta a dela em vez de repetir:</span>
          {semelhantes.map((s) => (
            <button
              key={s.id} type="button" onClick={() => onAbrir(s.id)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem", background: "none", border: "none", padding: 0, font: "inherit", color: "inherit", cursor: "pointer", textAlign: "left" }}
            >
              <span style={{ fontSize: "0.84rem", color: "var(--mh-primary-500)" }}>{s.titulo}</span>
              <span className="soft" style={{ fontSize: "0.78rem", display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                <ThumbsUp size={12} aria-hidden /> {s.curtidas}
              </span>
            </button>
          ))}
        </div>
      )}

      <div>
        <label className="label">Tela do portal</label>
        <select className="select" value={modulo} onChange={(e) => setModulo(e.target.value)}>
          <option value="">Geral / módulo novo</option>
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

      <div>
        <label className="label">Descrição <span style={{ color: "var(--mh-danger)" }}>*</span></label>
        <textarea
          className="input" rows={6} value={descricao} maxLength={4000}
          placeholder="O que você gostaria que o portal fizesse, e por que isso ajudaria no seu dia a dia. Fale do sistema, não de pessoas."
          onChange={(e) => setDescricao(e.target.value)}
          onPaste={(e) => {
            const fs = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
            if (fs.length) { e.preventDefault(); subir(fs); }
          }}
        />
      </div>

      <div>
        <label className="label">Prints <span className="soft" style={{ textTransform: "none", fontWeight: 400 }}>(até {MAX_PRINTS_SUGESTAO}, opcional)</span></label>
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
          {prints.map((p) => (
            <span key={p.arquivo} style={{ position: "relative", display: "inline-flex" }}>
              {p.url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={p.url} alt="Print da sugestão" style={{ width: 120, height: 80, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)" }} />
                : <span className="soft" style={{ width: 120, height: 80, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "1px dashed var(--border)", borderRadius: 8, fontSize: "0.75rem" }}>Print</span>}
              <button
                type="button" className="icon-btn" aria-label="Tirar o print" title="Tirar o print"
                onClick={() => tirar(p)}
                style={{ position: "absolute", top: 4, right: 4, width: 24, height: 24, background: "var(--surface)" }}
              >
                <X size={13} />
              </button>
            </span>
          ))}
          {prints.length < MAX_PRINTS_SUGESTAO && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={enviandoPrint} onClick={() => seletor.current?.click()}>
              <ImagePlus size={15} /> {enviandoPrint ? "Enviando…" : "Adicionar print"}
            </button>
          )}
          <input
            ref={seletor} type="file" hidden multiple accept={MIMES_PRINT_SUGESTAO.join(",")}
            aria-label="Escolher print da sugestão"
            onChange={(e) => { const fs = [...(e.target.files ?? [])]; if (fs.length) subir(fs); e.target.value = ""; }}
          />
        </div>
        <p className="soft" style={{ fontSize: "0.74rem", margin: "0.35rem 0 0" }}>Dica: copie o print e cole com Ctrl+V na descrição.</p>
      </div>

      {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{erro}</p>}
    </DetailModal>
  );
}
