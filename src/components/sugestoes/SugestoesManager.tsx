"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lightbulb, MessageSquare, Plus, ThumbsUp } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { FichaSugestao } from "@/components/sugestoes/FichaSugestao";
import { FormSugestao } from "@/components/sugestoes/FormSugestao";
import { curtirSugestao } from "@/lib/actions/sugestoes";
import {
  STATUS_SUGESTAO, STATUS_SUGESTAO_TONE, abaDoStatus, aceitaCurtida,
  type AbaSugestoes, type Sugestao, type SugestaoStatus,
} from "@/lib/sugestoes";
import { MODULE_BY_KEY, MODULES, type ModuleKey } from "@/lib/modules";
import { formatDate, shortName } from "@/lib/format";

type Ordem = "curtidas" | "alta" | "recentes";

const ABAS: { id: AbaSugestoes; label: string; status: SugestaoStatus[] }[] = [
  { id: "abertas", label: "Abertas", status: ["nova", "em_analise", "planejada", "em_desenvolvimento"] },
  { id: "entregues", label: "Entregues", status: ["entregue"] },
  { id: "minhas", label: "Minhas", status: [] },
  { id: "encerradas", label: "Encerradas", status: ["recusada", "duplicada"] },
];

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function SugestoesManager({ sugestoes, meuId, podeTriar, artigos }: {
  sugestoes: Sugestao[];
  meuId: string;
  podeTriar: boolean;
  artigos: { slug: string; titulo: string }[];
}) {
  const router = useRouter();
  const [aba, setAba] = useState<AbaSugestoes>("abertas");
  const [ordem, setOrdem] = useState<Ordem>("curtidas");
  const [busca, setBusca] = useState("");
  const [modulo, setModulo] = useState("");
  const [situacao, setSituacao] = useState<SugestaoStatus | "">("");
  // ficha aberta; a de cima (aberta a partir do formulário ou de outra ficha) fica por cima
  const [fichas, setFichas] = useState<string[]>([]);
  const [form, setForm] = useState<{ s: Sugestao | null; urls?: Record<string, string> } | null>(null);
  const [curtindo, iniciar] = useTransition();

  const minha = (s: Sugestao) => s.autorId === meuId || s.sigo;
  const naAba = (s: Sugestao, a: AbaSugestoes) => (a === "minhas" ? minha(s) : abaDoStatus(s.status) === a);
  const contagem = (a: AbaSugestoes) => sugestoes.filter((s) => naAba(s, a)).length;

  // telas citadas em alguma sugestão, para o filtro não listar o menu inteiro
  const telas = useMemo(() => {
    const ks = new Set(sugestoes.map((s) => s.modulo).filter(Boolean) as string[]);
    return MODULES.filter((m) => ks.has(m.key)).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [sugestoes]);

  const lista = useMemo(() => {
    const termos = normalizar(busca.trim()).split(/\s+/).filter(Boolean);
    const filtrada = sugestoes.filter((s) =>
      naAba(s, aba)
      && (!modulo || (modulo === "geral" ? !s.modulo : s.modulo === modulo))
      && (!situacao || s.status === situacao)
      && (!termos.length || (() => { const t = normalizar(`${s.titulo} ${s.descricao} ${s.autorNome} ${s.empresaNome}`); return termos.every((q) => t.includes(q)); })()),
    );
    const porData = (a: Sugestao, b: Sugestao) => b.createdAt.localeCompare(a.createdAt);
    return filtrada.sort((a, b) =>
      ordem === "recentes" ? porData(a, b)
      : ordem === "alta" ? b.curtidas30d - a.curtidas30d || b.curtidas - a.curtidas || porData(a, b)
      : b.curtidas - a.curtidas || porData(a, b));
    // naAba depende de meuId, que não muda na tela
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sugestoes, aba, modulo, situacao, busca, ordem]);

  const statusDaAba = ABAS.find((a) => a.id === aba)?.status ?? [];

  const curtir = (s: Sugestao) => {
    iniciar(async () => {
      const r = await curtirSugestao(s.id, !s.curti);
      if (r.error) { toast.error(r.error); return; }
      router.refresh();
    });
  };

  const abrir = (id: string) => setFichas((f) => [...f.filter((x) => x !== id), id]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input" placeholder="Buscar nas sugestões…" value={busca}
          onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 300 }}
        />
        <select className="select" value={modulo} onChange={(e) => setModulo(e.target.value)} style={{ width: "auto" }} aria-label="Tela do portal">
          <option value="">Todas as telas</option>
          <option value="geral">Geral / módulo novo</option>
          {telas.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        {statusDaAba.length > 1 && (
          <select className="select" value={situacao} onChange={(e) => setSituacao(e.target.value as SugestaoStatus | "")} style={{ width: "auto" }} aria-label="Situação">
            <option value="">Todas as situações</option>
            {statusDaAba.map((x) => <option key={x} value={x}>{STATUS_SUGESTAO[x]}</option>)}
          </select>
        )}
        <select className="select" value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} style={{ width: "auto" }} aria-label="Ordenar">
          <option value="curtidas">Mais curtidas</option>
          <option value="alta">Em alta (30 dias)</option>
          <option value="recentes">Mais recentes</option>
        </select>
        <button type="button" className="btn btn-primary btn-sm" style={{ marginLeft: "auto" }} onClick={() => setForm({ s: null })}>
          <Plus size={15} /> Nova sugestão
        </button>
      </div>

      <div role="tablist" style={{ display: "flex", gap: "0.25rem", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        {ABAS.map((a) => {
          const ativa = aba === a.id;
          return (
            <button
              key={a.id} type="button" role="tab" aria-selected={ativa}
              onClick={() => { setAba(a.id); setSituacao(""); }}
              style={{
                background: "none", border: "none", font: "inherit", cursor: "pointer", padding: "0.55rem 0.9rem",
                fontSize: "0.88rem", fontWeight: ativa ? 700 : 500,
                color: ativa ? "var(--mh-primary-500)" : "var(--mh-text-2)",
                borderBottom: `2px solid ${ativa ? "var(--mh-primary-500)" : "transparent"}`, marginBottom: -1,
              }}
            >
              {a.label} ({contagem(a.id)})
            </button>
          );
        })}
      </div>

      {lista.length === 0 ? (
        <EmptyState
          icon={<Lightbulb size={24} />}
          title={busca || modulo || situacao ? "Nada encontrado com esses filtros" : aba === "minhas" ? "Você ainda não sugeriu nem segue nenhuma" : "Nenhuma sugestão por aqui ainda"}
          description={aba === "abertas" && !busca && !modulo ? "Tem uma ideia para o portal ficar melhor? Clique em Nova sugestão." : undefined}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {lista.map((s) => {
            const tela = s.modulo ? MODULE_BY_KEY[s.modulo as ModuleKey]?.label : null;
            const podeCurtir = s.autorId !== meuId && aceitaCurtida(s.status) && !s.oculta;
            return (
              <div key={s.id} className="card" style={{ display: "flex", gap: "0.9rem", padding: "0.85rem 1rem", alignItems: "flex-start" }}>
                <button
                  type="button"
                  disabled={curtindo || (!podeCurtir && !s.curti)}
                  onClick={() => curtir(s)}
                  title={s.autorId === meuId ? "Sua sugestão" : !aceitaCurtida(s.status) ? "Sugestão encerrada" : s.curti ? "Desfazer a curtida" : "Curtir"}
                  aria-pressed={s.curti}
                  style={{
                    flexShrink: 0, width: 56, display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                    padding: "0.45rem 0", borderRadius: 10, font: "inherit", cursor: podeCurtir || s.curti ? "pointer" : "default",
                    border: `1px solid ${s.curti ? "var(--mh-primary-500)" : "var(--border)"}`,
                    background: s.curti ? "var(--mh-primary-soft)" : "var(--surface-2)",
                    color: s.curti ? "var(--mh-primary-500)" : "var(--mh-text-2)",
                  }}
                >
                  <ThumbsUp size={16} aria-hidden />
                  <strong style={{ fontSize: "0.95rem", fontVariantNumeric: "tabular-nums" }}>{s.curtidas}</strong>
                </button>
                <button
                  type="button" onClick={() => abrir(s.id)}
                  style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", padding: 0, font: "inherit", color: "inherit", cursor: "pointer", display: "flex", flexDirection: "column", gap: "0.35rem" }}
                >
                  <span style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: "0.98rem", color: "var(--mh-text-1)" }}>{s.titulo}</strong>
                    <Badge tone={STATUS_SUGESTAO_TONE[s.status]}>{STATUS_SUGESTAO[s.status]}</Badge>
                    {s.oculta && <Badge variant="quiet" tone="red">Oculta</Badge>}
                  </span>
                  <span className="soft" style={{ fontSize: "0.84rem", lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {s.descricao}
                  </span>
                  <span style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", fontSize: "0.78rem" }} className="soft">
                    <Badge variant="quiet" tone="blue">{tela ?? "Geral / módulo novo"}</Badge>
                    <span title={s.autorNome}>{shortName(s.autorNome)} · {s.empresaNome}</span>
                    <span>{formatDate(s.createdAt)}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><MessageSquare size={12} aria-hidden /> {s.comentarios}</span>
                    {s.resposta && <span style={{ color: "var(--mh-primary-500)", fontWeight: 600 }}>Resposta da equipe</span>}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {fichas.map((id, i) => {
        const s = sugestoes.find((x) => x.id === id);
        if (!s) return null;
        return (
          <FichaSugestao
            key={id}
            s={s} todas={sugestoes} meuId={meuId} podeTriar={podeTriar} artigos={artigos}
            // a ficha aberta por cima do formulário ou de outra ficha vem acima dela
            zIndex={(form ? 70 : 60) + i * 2}
            onFechar={() => setFichas((f) => f.filter((x) => x !== id))}
            onAbrir={abrir}
            onEditar={(x, urls) => { setFichas((f) => f.filter((y) => y !== x.id)); setForm({ s: x, urls }); }}
          />
        );
      })}

      {form && (
        <FormSugestao
          inicial={form.s} urlsIniciais={form.urls} todas={sugestoes}
          onFechar={() => setForm(null)}
          onAbrir={abrir}
          onSalva={(id) => { setForm(null); router.refresh(); setFichas([id]); }}
        />
      )}
    </div>
  );
}
