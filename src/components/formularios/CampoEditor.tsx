"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Copy, GitBranch, Plus, Trash2, X } from "lucide-react";
import {
  TIPOS, ehGrade, ehLayout, opcoesDe, temOpcoes,
  type Campo, type FormatoTexto,
} from "@/lib/formularios";

const pequeno: React.CSSProperties = { fontSize: "0.78rem" };
const linha: React.CSSProperties = { display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "flex-end" };

function Check({ checked, onChange, children, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; disabled?: boolean;
}) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.82rem", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1 }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

function NumeroInput({ label, value, onChange, min, max, width = 90 }: {
  label: string; value: number | null | undefined; onChange: (v: number | null) => void; min?: number; max?: number; width?: number;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
      <span className="label" style={{ margin: 0 }}>{label}</span>
      <input
        className="input" type="number" inputMode="decimal" min={min} max={max} style={{ width }}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
    </label>
  );
}

/** Lista editável de textos (opções, linhas e colunas de grade). */
function ListaDeTextos({ itens, onChange, rotulo, novo, max }: {
  itens: string[]; onChange: (v: string[]) => void; rotulo: string; novo: string; max: number;
}) {
  const [colando, setColando] = useState(false);
  const [texto, setTexto] = useState("");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
      <span className="label" style={{ margin: 0 }}>{rotulo}</span>
      {itens.map((o, i) => (
        <div key={i} style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
          <input
            className="input" value={o} placeholder={`${novo} ${i + 1}`}
            onChange={(e) => onChange(itens.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <button type="button" className="icon-btn" aria-label={`Tirar ${o || "item"}`} title="Tirar"
            disabled={itens.length <= 1} onClick={() => onChange(itens.filter((_, j) => j !== i))}>
            <X size={14} />
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-ghost btn-sm" disabled={itens.length >= max}
          onClick={() => onChange([...itens, `${novo} ${itens.length + 1}`])}>
          <Plus size={14} /> Adicionar
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setColando((v) => !v)}>
          {colando ? "Fechar" : "Colar vários de uma vez"}
        </button>
      </div>
      {colando && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          <textarea className="textarea" rows={4} value={texto} onChange={(e) => setTexto(e.target.value)}
            placeholder="Um por linha. Substitui a lista atual." />
          <div>
            <button type="button" className="btn btn-sm btn-primary" disabled={!texto.trim()} onClick={() => {
              const novos = texto.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, max);
              if (novos.length) onChange(novos);
              setTexto(""); setColando(false);
            }}>Usar esta lista</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function CampoEditor({
  campo, numero, aberto, anteriores, onAbrir, onChange, onSubir, onDescer, onDuplicar, onTirar, primeiro, ultimo,
}: {
  campo: Campo;
  /** número da pergunta (layout não conta) */
  numero: number | null;
  aberto: boolean;
  /** perguntas de escolha anteriores, que podem servir de condição */
  anteriores: Campo[];
  onAbrir: () => void;
  onChange: (c: Campo) => void;
  onSubir: () => void;
  onDescer: () => void;
  onDuplicar: () => void;
  onTirar: () => void;
  primeiro: boolean;
  ultimo: boolean;
}) {
  const c = campo;
  const set = (p: Partial<Campo>) => onChange({ ...c, ...p });
  const layout = ehLayout(c.tipo);
  const fonte = c.condicao ? anteriores.find((a) => a.id === c.condicao?.campo) : undefined;
  const ehSecao = c.tipo === "secao";

  return (
    <div
      id={`campo-${c.id}`}
      className="card"
      style={{
        padding: 0, overflow: "hidden",
        borderLeft: aberto ? "3px solid var(--mh-primary-500)" : ehSecao ? "3px solid var(--mh-border-strong)" : undefined,
        background: ehSecao ? "var(--surface-2)" : undefined,
      }}
    >
      <div
        role="button" tabIndex={0}
        onClick={onAbrir}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrir(); } }}
        style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.65rem 0.8rem", cursor: "pointer" }}
      >
        <span className="soft" style={{ ...pequeno, minWidth: 22, fontVariantNumeric: "tabular-nums" }}>
          {numero != null ? `${numero}.` : ""}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: ehSecao ? 700 : 600, fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {c.titulo || <span className="soft" style={{ fontWeight: 400 }}>{layout ? (ehSecao ? "Seção sem título" : "Texto sem título") : "Pergunta sem enunciado"}</span>}
            {c.obrigatorio && <span style={{ color: "var(--mh-danger)" }}> *</span>}
          </div>
          <div className="soft" style={{ ...pequeno, display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <span>{TIPOS[c.tipo].label}</span>
            {c.condicao && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.2rem" }} title="Aparece só com certas respostas">
                <GitBranch size={12} /> condicional
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.15rem" }} onClick={(e) => e.stopPropagation()}>
          <button type="button" className="icon-btn" aria-label="Subir" title="Subir" disabled={primeiro} onClick={onSubir}><ArrowUp size={14} /></button>
          <button type="button" className="icon-btn" aria-label="Descer" title="Descer" disabled={ultimo} onClick={onDescer}><ArrowDown size={14} /></button>
          <button type="button" className="icon-btn" aria-label="Duplicar" title="Duplicar" onClick={onDuplicar}><Copy size={14} /></button>
          <button type="button" className="icon-btn icon-btn-danger" aria-label="Excluir" title="Excluir" onClick={onTirar}><Trash2 size={14} /></button>
        </div>
      </div>

      {aberto && (
        <div style={{ padding: "0.2rem 0.9rem 0.9rem", display: "flex", flexDirection: "column", gap: "0.75rem", borderTop: "1px solid var(--border)" }}>
          <div style={{ paddingTop: "0.7rem" }}>
            <label className="label">{ehSecao ? "Título da seção" : layout ? "Título (opcional)" : "Pergunta"}</label>
            <input className="input" autoFocus value={c.titulo} maxLength={500}
              placeholder={ehSecao ? "Ex.: Dados do veículo" : layout ? "Ex.: Antes de começar" : "Ex.: Qual o seu setor?"}
              onChange={(e) => set({ titulo: e.target.value })} />
          </div>
          <div>
            <label className="label">{layout ? "Texto" : "Descrição (opcional)"}</label>
            <textarea className="textarea" rows={layout && !ehSecao ? 4 : 2} value={c.descricao ?? ""} maxLength={2000}
              placeholder={layout ? "Orientação para quem responde." : "Ajuda ou exemplo de resposta."}
              onChange={(e) => set({ descricao: e.target.value })} />
          </div>

          {temOpcoes(c.tipo) && (
            <ListaDeTextos itens={c.opcoes ?? []} onChange={(opcoes) => set({ opcoes })}
              rotulo={c.tipo === "ranking" ? "Itens para ordenar" : "Opções"} novo={c.tipo === "ranking" ? "Item" : "Opção"} max={100} />
          )}
          {(c.tipo === "multipla_escolha" || c.tipo === "caixas_selecao" || c.tipo === "lista_suspensa") && (
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              {c.tipo !== "lista_suspensa" && (
                <Check checked={!!c.outro} onChange={(v) => set({ outro: v })}>Incluir &quot;Outro&quot; com texto livre</Check>
              )}
              <Check checked={!!c.embaralhar} onChange={(v) => set({ embaralhar: v })}>Embaralhar a ordem para cada pessoa</Check>
            </div>
          )}
          {c.tipo === "caixas_selecao" && (
            <div style={linha}>
              <NumeroInput label="Marcar no mínimo" value={c.minSel} min={0} onChange={(v) => set({ minSel: v })} />
              <NumeroInput label="Marcar no máximo" value={c.maxSel} min={1} onChange={(v) => set({ maxSel: v })} />
            </div>
          )}
          {c.tipo === "texto_curto" && (
            <div style={linha}>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                <span className="label" style={{ margin: 0 }}>Validar como</span>
                <select className="select" value={c.formato ?? "livre"} onChange={(e) => set({ formato: e.target.value as FormatoTexto })}>
                  <option value="livre">Texto livre</option>
                  <option value="email">E-mail</option>
                  <option value="telefone">Telefone</option>
                  <option value="link">Link</option>
                </select>
              </label>
              <NumeroInput label="Máximo de caracteres" value={c.maxCaracteres} min={1} width={130} onChange={(v) => set({ maxCaracteres: v })} />
            </div>
          )}
          {c.tipo === "paragrafo" && (
            <NumeroInput label="Máximo de caracteres" value={c.maxCaracteres} min={1} width={130} onChange={(v) => set({ maxCaracteres: v })} />
          )}
          {c.tipo === "numero" && (
            <div style={linha}>
              <NumeroInput label="Mínimo" value={c.min} onChange={(v) => set({ min: v })} />
              <NumeroInput label="Máximo" value={c.max} onChange={(v) => set({ max: v })} />
              <Check checked={!!c.inteiro} onChange={(v) => set({ inteiro: v })}>Só números inteiros</Check>
            </div>
          )}
          {c.tipo === "escala" && (
            <div style={linha}>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                <span className="label" style={{ margin: 0 }}>De</span>
                <select className="select" value={c.escalaMin ?? 1} onChange={(e) => set({ escalaMin: Number(e.target.value) as 0 | 1 })}>
                  <option value={0}>0</option><option value={1}>1</option>
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                <span className="label" style={{ margin: 0 }}>Até</span>
                <select className="select" value={c.escalaMax ?? 5} onChange={(e) => set({ escalaMax: Number(e.target.value) })}>
                  {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", flex: 1, minWidth: 140 }}>
                <span className="label" style={{ margin: 0 }}>Rótulo do início</span>
                <input className="input" value={c.rotuloMin ?? ""} maxLength={60} placeholder="Ex.: Discordo" onChange={(e) => set({ rotuloMin: e.target.value })} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", flex: 1, minWidth: 140 }}>
                <span className="label" style={{ margin: 0 }}>Rótulo do fim</span>
                <input className="input" value={c.rotuloMax ?? ""} maxLength={60} placeholder="Ex.: Concordo" onChange={(e) => set({ rotuloMax: e.target.value })} />
              </label>
            </div>
          )}
          {c.tipo === "nps" && (
            <div style={linha}>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", flex: 1, minWidth: 140 }}>
                <span className="label" style={{ margin: 0 }}>Rótulo do 0</span>
                <input className="input" value={c.rotuloMin ?? ""} maxLength={60} onChange={(e) => set({ rotuloMin: e.target.value })} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", flex: 1, minWidth: 140 }}>
                <span className="label" style={{ margin: 0 }}>Rótulo do 10</span>
                <input className="input" value={c.rotuloMax ?? ""} maxLength={60} onChange={(e) => set({ rotuloMax: e.target.value })} />
              </label>
            </div>
          )}
          {c.tipo === "avaliacao" && (
            <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", width: 140 }}>
              <span className="label" style={{ margin: 0 }}>Quantas estrelas</span>
              <select className="select" value={c.estrelas ?? 5} onChange={(e) => set({ estrelas: Number(e.target.value) })}>
                {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}
          {ehGrade(c.tipo) && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.9rem" }}>
              <ListaDeTextos itens={c.linhas ?? []} onChange={(linhas) => set({ linhas })} rotulo="Linhas (o que é avaliado)" novo="Linha" max={40} />
              <ListaDeTextos itens={c.colunas ?? []} onChange={(colunas) => set({ colunas })} rotulo="Colunas (as respostas)" novo="Coluna" max={15} />
            </div>
          )}
          {(c.tipo === "fotos" || c.tipo === "arquivos") && (
            <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", width: 160 }}>
              <span className="label" style={{ margin: 0 }}>Até quantos {c.tipo === "fotos" ? "fotos" : "arquivos"}</span>
              <select className="select" value={c.maxArquivos ?? 3} onChange={(e) => set({ maxArquivos: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}

          {/* condição: aparece só com certas respostas de uma pergunta anterior */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", background: "var(--surface-2)", borderRadius: 8, padding: "0.6rem 0.7rem" }}>
            <Check
              checked={!!c.condicao}
              disabled={anteriores.length === 0}
              onChange={(v) => set({ condicao: v ? { campo: anteriores[anteriores.length - 1]?.id ?? "", valores: [] } : null })}
            >
              {ehSecao ? "Mostrar esta seção só com certas respostas" : "Mostrar só com certas respostas"}
            </Check>
            {anteriores.length === 0 && (
              <span className="soft" style={pequeno}>Precisa de uma pergunta de escolha antes desta (múltipla escolha, caixas, lista ou sim/não).</span>
            )}
            {c.condicao && (
              <>
                <select className="select" value={c.condicao.campo}
                  onChange={(e) => set({ condicao: { campo: e.target.value, valores: [] } })}>
                  {anteriores.map((a) => (
                    <option key={a.id} value={a.id}>{a.titulo || "Pergunta sem enunciado"}</option>
                  ))}
                </select>
                {fonte && (
                  <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap" }}>
                    <span className="soft" style={pequeno}>quando a resposta for:</span>
                    {[...opcoesDe(fonte), ...(fonte.outro ? ["__outro__"] : [])].map((o) => (
                      <Check key={o} checked={c.condicao?.valores.includes(o) ?? false}
                        onChange={(v) => set({
                          condicao: {
                            campo: fonte.id,
                            valores: v ? [...(c.condicao?.valores ?? []), o] : (c.condicao?.valores ?? []).filter((x) => x !== o),
                          },
                        })}>
                        {o === "__outro__" ? "Outro" : o}
                      </Check>
                    ))}
                  </div>
                )}
                {c.condicao.valores.length === 0 && (
                  <span style={{ ...pequeno, color: "var(--mh-warning)" }}>Marque pelo menos uma resposta, senão {ehSecao ? "a seção" : "a pergunta"} nunca aparece.</span>
                )}
              </>
            )}
          </div>

          {!layout && (
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Check checked={!!c.obrigatorio} onChange={(v) => set({ obrigatorio: v })}>Resposta obrigatória</Check>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

