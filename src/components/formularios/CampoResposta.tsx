"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Camera, FileUp, ImagePlus, Paperclip, Star, X } from "lucide-react";
import { SearchSelect } from "@/components/SearchSelect";
import { npsColor } from "@/lib/nps";
import {
  MAX_ARQUIVOS, MAX_FOTOS, OPCOES_SIM_NAO, opcoesDe,
  type Arquivo, type Campo, type Valor,
} from "@/lib/formularios";
import { AssinaturaPad } from "./AssinaturaPad";
import { subirArquivo } from "./subirArquivo";

const ACEITA_ARQUIVOS =
  "image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,video/mp4,video/quicktime,video/webm,audio/*,.heic";

function embaralhada(lista: string[]): string[] {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Botão de escolha (escala, NPS, sim/não, grade): grande o bastante para o dedo. */
function Opcao({ ativo, onClick, children, cor, quadrado, rotulo }: {
  ativo: boolean; onClick: () => void; children: React.ReactNode; cor?: string; quadrado?: boolean; rotulo?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      aria-label={rotulo}
      onClick={onClick}
      style={{
        minWidth: quadrado ? 40 : undefined, height: 40, padding: quadrado ? 0 : "0 0.9rem", borderRadius: 8,
        cursor: "pointer", fontWeight: 600, fontSize: "0.88rem",
        border: `1px solid ${ativo ? (cor ?? "var(--mh-primary-500)") : "var(--border)"}`,
        background: ativo ? (cor ?? "var(--mh-primary-500)") : "var(--surface)",
        color: ativo ? "#fff" : "var(--text)",
      }}
    >
      {children}
    </button>
  );
}

export function CampoResposta({
  campo: c, numero, valor, onChange, erro, formId, podeSubir, pessoas, urls, onUrl, onSubindo,
}: {
  campo: Campo;
  numero: number | null;
  valor: Valor | undefined;
  onChange: (v: Valor | undefined) => void;
  erro?: string;
  formId: string;
  /** na pré-visualização não há envio de arquivo */
  podeSubir: boolean;
  pessoas: { id: string; nome: string }[];
  urls: Record<string, string>;
  onUrl: (path: string, url: string) => void;
  onSubindo: (delta: 1 | -1) => void;
}) {
  const [ordem] = useState(() => (c.embaralhar ? embaralhada(opcoesDe(c)) : opcoesDe(c)));
  const [subindo, setSubindo] = useState(0);
  const camera = useRef<HTMLInputElement | null>(null);
  const galeria = useRef<HTMLInputElement | null>(null);
  const idEntrada = `resp-${c.id}`;

  if (c.tipo === "secao") {
    return (
      <div style={{ padding: "0.4rem 0.2rem 0", borderBottom: "2px solid var(--mh-primary-500)" }}>
        <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 0.3rem" }}>{c.titulo || "Seção"}</h2>
        {c.descricao && <p className="soft" style={{ fontSize: "0.85rem", margin: "0 0 0.5rem", whiteSpace: "pre-wrap" }}>{c.descricao}</p>}
      </div>
    );
  }
  if (c.tipo === "texto") {
    return (
      <div className="card" style={{ padding: "0.85rem 1rem", background: "var(--surface-2)" }}>
        {c.titulo && <strong style={{ display: "block", marginBottom: "0.3rem" }}>{c.titulo}</strong>}
        {c.descricao && <p style={{ fontSize: "0.88rem", margin: 0, whiteSpace: "pre-wrap" }}>{c.descricao}</p>}
      </div>
    );
  }

  const anexos = Array.isArray(valor) && c.tipo !== "ranking" ? (valor as Arquivo[]) : [];

  const subir = async (files: FileList | File[] | null, limite: number) => {
    if (!files || !podeSubir) return;
    const lista = Array.from(files).slice(0, Math.max(0, limite - anexos.length));
    if (Array.from(files).length > lista.length) toast.error(`Até ${limite} ${c.tipo === "fotos" ? "fotos" : "arquivos"} nesta pergunta.`);
    let atuais = [...anexos];
    for (const f of lista) {
      setSubindo((n) => n + 1); onSubindo(1);
      const r = await subirArquivo(formId, f);
      setSubindo((n) => n - 1); onSubindo(-1);
      if (r.error || !r.arquivo) { toast.error(r.error ?? "Não foi possível enviar."); continue; }
      if (f.type.startsWith("image/")) onUrl(r.arquivo.path, URL.createObjectURL(f));
      atuais = [...atuais, r.arquivo];
      onChange(atuais);
    }
  };

  let entrada: React.ReactNode = null;
  switch (c.tipo) {
    case "texto_curto":
      entrada = (
        <input
          id={idEntrada} className="input"
          type={c.formato === "email" ? "email" : c.formato === "telefone" ? "tel" : c.formato === "link" ? "url" : "text"}
          inputMode={c.formato === "telefone" ? "tel" : c.formato === "email" ? "email" : undefined}
          maxLength={c.maxCaracteres ?? 500}
          value={typeof valor === "string" ? valor : ""}
          placeholder={c.formato === "email" ? "nome@empresa.com.br" : c.formato === "telefone" ? "(31) 99999-9999" : c.formato === "link" ? "https://" : "Sua resposta"}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case "paragrafo":
      entrada = (
        <>
          <textarea id={idEntrada} className="textarea" rows={4} maxLength={c.maxCaracteres ?? 10000}
            value={typeof valor === "string" ? valor : ""} placeholder="Sua resposta"
            onChange={(e) => onChange(e.target.value)} />
          {c.maxCaracteres && (
            <span className="soft" style={{ fontSize: "0.74rem", alignSelf: "flex-end" }}>
              {(typeof valor === "string" ? valor.length : 0)}/{c.maxCaracteres}
            </span>
          )}
        </>
      );
      break;
    case "multipla_escolha": {
      const x = (typeof valor === "string" ? { op: valor } : (valor as { op?: string; outro?: string }) ?? {});
      const outroAtivo = x.outro !== undefined;
      entrada = (
        <div role="radiogroup" style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
          {ordem.map((o) => (
            <label key={o} style={{ display: "flex", gap: "0.55rem", alignItems: "center", padding: "0.45rem 0.2rem", cursor: "pointer" }}>
              <input type="radio" name={idEntrada} checked={!outroAtivo && x.op === o} onChange={() => onChange({ op: o })} />
              <span style={{ fontSize: "0.9rem" }}>{o}</span>
            </label>
          ))}
          {c.outro && (
            <label style={{ display: "flex", gap: "0.55rem", alignItems: "center", padding: "0.35rem 0.2rem" }}>
              <input type="radio" name={idEntrada} checked={outroAtivo} onChange={() => onChange({ outro: x.outro ?? "" })} />
              <span style={{ fontSize: "0.9rem" }}>Outro:</span>
              <input className="input" value={x.outro ?? ""} placeholder="Qual?" maxLength={500}
                onFocus={() => { if (!outroAtivo) onChange({ outro: "" }); }}
                onChange={(e) => onChange({ outro: e.target.value })} style={{ flex: 1 }} />
            </label>
          )}
          {(x.op || outroAtivo) && !c.obrigatorio && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => onChange(undefined)}>Limpar escolha</button>
          )}
        </div>
      );
      break;
    }
    case "caixas_selecao": {
      const x = (valor as { ops?: string[]; outro?: string }) ?? {};
      const ops = x.ops ?? [];
      const outroAtivo = x.outro !== undefined;
      entrada = (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
          {ordem.map((o) => (
            <label key={o} style={{ display: "flex", gap: "0.55rem", alignItems: "center", padding: "0.45rem 0.2rem", cursor: "pointer" }}>
              <input type="checkbox" checked={ops.includes(o)}
                onChange={(e) => onChange({ ...x, ops: e.target.checked ? [...ops, o] : ops.filter((y) => y !== o) })} />
              <span style={{ fontSize: "0.9rem" }}>{o}</span>
            </label>
          ))}
          {c.outro && (
            <label style={{ display: "flex", gap: "0.55rem", alignItems: "center", padding: "0.35rem 0.2rem" }}>
              <input type="checkbox" checked={outroAtivo}
                onChange={(e) => onChange(e.target.checked ? { ops, outro: x.outro ?? "" } : { ops })} />
              <span style={{ fontSize: "0.9rem" }}>Outro:</span>
              <input className="input" value={x.outro ?? ""} placeholder="Qual?" maxLength={500}
                onFocus={() => { if (!outroAtivo) onChange({ ops, outro: "" }); }}
                onChange={(e) => onChange({ ops, outro: e.target.value })} style={{ flex: 1 }} />
            </label>
          )}
          {(c.minSel || c.maxSel) && (
            <span className="soft" style={{ fontSize: "0.76rem" }}>
              {c.minSel && c.maxSel ? `Marque de ${c.minSel} a ${c.maxSel}.` : c.minSel ? `Marque pelo menos ${c.minSel}.` : `Marque até ${c.maxSel}.`}
            </span>
          )}
        </div>
      );
      break;
    }
    case "lista_suspensa":
      entrada = (
        <select id={idEntrada} className="select" value={typeof valor === "string" ? valor : ""}
          onChange={(e) => onChange(e.target.value || undefined)} style={{ maxWidth: 420 }}>
          <option value="">Escolha...</option>
          {ordem.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
      break;
    case "sim_nao":
      entrada = (
        <div className="grade-2-no-celular" style={{ display: "flex", gap: "0.5rem" }}>
          {OPCOES_SIM_NAO.map((o) => (
            <Opcao key={o} ativo={valor === o} onClick={() => onChange(valor === o && !c.obrigatorio ? undefined : o)}>{o}</Opcao>
          ))}
        </div>
      );
      break;
    case "numero":
      entrada = (
        <input id={idEntrada} className="input" type="number" inputMode="decimal" style={{ maxWidth: 220 }}
          min={c.min ?? undefined} max={c.max ?? undefined} step={c.inteiro ? 1 : "any"}
          value={typeof valor === "number" ? valor : ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
      );
      break;
    case "data":
      entrada = <input id={idEntrada} className="input" type="date" style={{ maxWidth: 200 }} value={typeof valor === "string" ? valor : ""} onChange={(e) => onChange(e.target.value || undefined)} />;
      break;
    case "hora":
      entrada = <input id={idEntrada} className="input" type="time" style={{ maxWidth: 160 }} value={typeof valor === "string" ? valor : ""} onChange={(e) => onChange(e.target.value || undefined)} />;
      break;
    case "escala": {
      const de = c.escalaMin ?? 1;
      const ate = c.escalaMax ?? 5;
      entrada = (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
            {Array.from({ length: ate - de + 1 }, (_, i) => de + i).map((n) => (
              <Opcao key={n} quadrado ativo={valor === n} rotulo={`Nota ${n}`} onClick={() => onChange(n)}>{n}</Opcao>
            ))}
          </div>
          {(c.rotuloMin || c.rotuloMax) && (
            <div className="soft" style={{ display: "flex", justifyContent: "space-between", fontSize: "0.76rem", maxWidth: (ate - de + 1) * 44 }}>
              <span>{de}: {c.rotuloMin}</span><span>{ate}: {c.rotuloMax}</span>
            </div>
          )}
        </div>
      );
      break;
    }
    case "nps":
      entrada = (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
            {Array.from({ length: 11 }, (_, n) => (
              <Opcao key={n} quadrado ativo={valor === n} cor={npsColor(n)} rotulo={`Nota ${n}`} onClick={() => onChange(n)}>{n}</Opcao>
            ))}
          </div>
          <div className="soft" style={{ display: "flex", justifyContent: "space-between", fontSize: "0.76rem", maxWidth: 11 * 43 }}>
            <span>{c.rotuloMin || "Nada provável"}</span><span>{c.rotuloMax || "Muito provável"}</span>
          </div>
        </div>
      );
      break;
    case "avaliacao": {
      const total = c.estrelas ?? 5;
      const atual = typeof valor === "number" ? valor : 0;
      entrada = (
        <div style={{ display: "flex", gap: "0.15rem" }} role="radiogroup" aria-label={c.titulo}>
          {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" aria-label={`${n} de ${total}`} aria-pressed={atual === n}
              onClick={() => onChange(atual === n && !c.obrigatorio ? undefined : n)}
              style={{ background: "none", border: "none", padding: 4, cursor: "pointer", color: n <= atual ? "#f59e0b" : "var(--mh-text-3)" }}>
              <Star size={28} fill={n <= atual ? "#f59e0b" : "none"} />
            </button>
          ))}
        </div>
      );
      break;
    }
    case "grade_multipla":
    case "grade_caixas": {
      const multi = c.tipo === "grade_caixas";
      const x = (valor as Record<string, string | string[]>) ?? {};
      entrada = (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
          {(c.linhas ?? []).map((l) => (
            <div key={l}>
              <div style={{ fontSize: "0.86rem", fontWeight: 600, marginBottom: "0.3rem" }}>{l}</div>
              <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                {(c.colunas ?? []).map((col) => {
                  const marcada = multi ? ((x[l] as string[] | undefined) ?? []).includes(col) : x[l] === col;
                  return (
                    <Opcao key={col} ativo={marcada} onClick={() => {
                      const novo = { ...x };
                      if (multi) {
                        const atual = (novo[l] as string[] | undefined) ?? [];
                        novo[l] = marcada ? atual.filter((y) => y !== col) : [...atual, col];
                        if ((novo[l] as string[]).length === 0) delete novo[l];
                      } else if (marcada) delete novo[l];
                      else novo[l] = col;
                      onChange(Object.keys(novo).length ? (novo as Record<string, string>) : undefined);
                    }}>{col}</Opcao>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      );
      break;
    }
    case "ranking": {
      const atual = Array.isArray(valor) ? (valor as string[]) : ordem;
      const mover = (i: number, d: -1 | 1) => {
        const j = i + d;
        if (j < 0 || j >= atual.length) return;
        const n = [...atual];
        [n[i], n[j]] = [n[j], n[i]];
        onChange(n);
      };
      entrada = (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", maxWidth: 480 }}>
          {atual.map((o, i) => (
            <div key={o} style={{ display: "flex", alignItems: "center", gap: "0.5rem", border: "1px solid var(--border)", borderRadius: 8, padding: "0.35rem 0.5rem", background: "var(--surface)" }}>
              <strong style={{ width: 22, fontVariantNumeric: "tabular-nums" }}>{i + 1}.</strong>
              <span style={{ flex: 1, fontSize: "0.88rem" }}>{o}</span>
              <button type="button" className="icon-btn" aria-label={`Subir ${o}`} disabled={i === 0} onClick={() => mover(i, -1)}><ArrowUp size={15} /></button>
              <button type="button" className="icon-btn" aria-label={`Descer ${o}`} disabled={i === atual.length - 1} onClick={() => mover(i, 1)}><ArrowDown size={15} /></button>
            </div>
          ))}
          {!Array.isArray(valor) && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => onChange([...ordem])}>
              Manter esta ordem
            </button>
          )}
        </div>
      );
      break;
    }
    case "fotos":
    case "arquivos": {
      const fotos = c.tipo === "fotos";
      const limite = c.maxArquivos ?? (fotos ? MAX_FOTOS : MAX_ARQUIVOS);
      const cheio = anexos.length >= limite;
      entrada = (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {anexos.length > 0 && (
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {anexos.map((a) => {
                const url = urls[a.path];
                const ehImagem = (a.tipo ?? "").startsWith("image/");
                return (
                  <div key={a.path} style={{ position: "relative", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--surface-2)" }}>
                    {ehImagem && url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt={a.nome} style={{ width: 92, height: 92, objectFit: "cover", display: "block" }} />
                    ) : (
                      <div style={{ width: fotos ? 92 : 200, height: fotos ? 92 : 44, display: "flex", alignItems: "center", gap: "0.4rem", padding: "0 0.5rem", fontSize: "0.78rem" }}>
                        <Paperclip size={14} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.nome}>{a.nome}</span>
                      </div>
                    )}
                    <button type="button" aria-label={`Tirar ${a.nome}`} onClick={() => {
                      const resto = anexos.filter((x) => x.path !== a.path);
                      onChange(resto.length ? resto : undefined);
                    }}
                      style={{ position: "absolute", top: 3, right: 3, width: 22, height: 22, borderRadius: 11, border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                      <X size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {!cheio && (
            <div className="grade-2-no-celular" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {fotos ? (
                <>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!podeSubir || subindo > 0} onClick={() => camera.current?.click()}>
                    <Camera size={15} /> Tirar foto
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!podeSubir || subindo > 0} onClick={() => galeria.current?.click()}>
                    <ImagePlus size={15} /> Da galeria
                  </button>
                  <input ref={camera} type="file" accept="image/*" capture="environment" hidden
                    onChange={(e) => { void subir(e.target.files, limite); e.target.value = ""; }} />
                  <input ref={galeria} type="file" accept="image/*,.heic" multiple hidden
                    onChange={(e) => { void subir(e.target.files, limite); e.target.value = ""; }} />
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!podeSubir || subindo > 0} onClick={() => galeria.current?.click()}>
                    <FileUp size={15} /> Escolher arquivo
                  </button>
                  <input ref={galeria} type="file" accept={ACEITA_ARQUIVOS} multiple hidden
                    onChange={(e) => { void subir(e.target.files, limite); e.target.value = ""; }} />
                </>
              )}
            </div>
          )}
          <span className="soft" style={{ fontSize: "0.76rem" }}>
            {subindo > 0 ? "Enviando..." : !podeSubir ? "Na pré-visualização o envio de arquivos fica desligado." : `Até ${limite}, de até 20 MB cada.`}
          </span>
        </div>
      );
      break;
    }
    case "assinatura": {
      const a = anexos[0];
      entrada = a ? (
        <div style={{ display: "flex", alignItems: "flex-end", gap: "0.6rem", flexWrap: "wrap" }}>
          {urls[a.path] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={urls[a.path]} alt="Assinatura" style={{ maxWidth: 320, height: 110, objectFit: "contain", background: "#fff", borderRadius: 8, border: "1px solid var(--border)" }} />
          ) : <span>Assinado</span>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(undefined)}>Assinar de novo</button>
        </div>
      ) : (
        <>
          <AssinaturaPad
            desabilitado={!podeSubir}
            enviando={subindo > 0}
            onConfirmar={async (png) => {
              setSubindo((n) => n + 1); onSubindo(1);
              const r = await subirArquivo(formId, png, "assinatura.png");
              setSubindo((n) => n - 1); onSubindo(-1);
              if (r.error || !r.arquivo) { toast.error(r.error ?? "Não foi possível enviar a assinatura."); return; }
              onUrl(r.arquivo.path, URL.createObjectURL(png));
              onChange([r.arquivo]);
            }}
          />
          {!podeSubir && <span className="soft" style={{ fontSize: "0.76rem" }}>Na pré-visualização a assinatura não é enviada.</span>}
        </>
      );
      break;
    }
    case "colaborador": {
      const x = valor as { id: string; nome: string } | undefined;
      entrada = (
        <div style={{ maxWidth: 420 }}>
          <SearchSelect
            options={pessoas.map((p) => ({ id: p.id, name: p.nome }))}
            value={x?.id ?? ""}
            placeholder="Digite o nome..."
            onChange={(id) => {
              const p = pessoas.find((y) => y.id === id);
              onChange(p ? { id: p.id, nome: p.nome } : undefined);
            }}
          />
        </div>
      );
      break;
    }
  }

  return (
    <div
      data-campo={c.id}
      className="card"
      style={{
        padding: "0.95rem 1rem", display: "flex", flexDirection: "column", gap: "0.55rem",
        borderColor: erro ? "var(--mh-danger)" : undefined, scrollMarginTop: 90,
      }}
    >
      <div>
        <label htmlFor={idEntrada} style={{ fontWeight: 600, fontSize: "0.93rem", display: "block" }}>
          {numero != null && <span className="soft" style={{ marginRight: 6 }}>{numero}.</span>}
          {c.titulo}
          {c.obrigatorio && <span style={{ color: "var(--mh-danger)" }} aria-label="obrigatória"> *</span>}
        </label>
        {c.descricao && <p className="soft" style={{ fontSize: "0.8rem", margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>{c.descricao}</p>}
      </div>
      {entrada}
      {erro && <span role="alert" style={{ color: "var(--mh-danger)", fontSize: "0.8rem" }}>{erro}</span>}
    </div>
  );
}
