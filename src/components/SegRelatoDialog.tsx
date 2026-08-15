"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImageOff, ShieldAlert } from "lucide-react";
import { PeoplePicker, type Person } from "@/components/PeoplePicker";
import { Badge } from "@/components/ui/Badge";
import { SEG_NATUREZA, SEG_NATUREZA_TONE } from "@/lib/constants";
import { segIconeSrc } from "@/lib/avatar";
import { criarRelato } from "@/lib/actions/seguranca";
import type { Enums } from "@/types/database";

export type TipoOpt = {
  id: string; name: string; natureza: Enums<"seg_relato_natureza">;
  description: string | null; imagePath: string | null; active: boolean;
};
export type LocalOpt = { id: string; name: string; imagePath: string | null; active: boolean };
export type AreaOpt = { id: string; name: string; localId: string | null; imagePath: string | null; active: boolean };

/** Cartão de escolha: figura quando o cliente cadastrou, ícone neutro quando não. */
function Cartao({
  nome, imagePath, marcado, onClick,
}: {
  nome: string; imagePath: string | null; marcado: boolean; onClick: () => void;
}) {
  const [quebrou, setQuebrou] = useState(false);
  const src = segIconeSrc(imagePath);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={marcado}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: "0.4rem",
        padding: "0.6rem 0.4rem", cursor: "pointer", textAlign: "center",
        background: marcado ? "var(--mh-primary-soft)" : "var(--surface-2)",
        border: "1px solid " + (marcado ? "var(--mh-primary-500)" : "var(--border)"),
        borderRadius: "var(--mh-radius-lg)", color: "var(--mh-text-1)",
        fontSize: "0.78rem", fontWeight: marcado ? 600 : 500, minHeight: 92,
      }}
    >
      {src && !quebrou ? (
        // eslint-disable-next-line @next/next/no-img-element -- bucket público, mesmo racional do Avatar
        <img
          src={src} alt="" loading="lazy" onError={() => setQuebrou(true)}
          style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover" }}
        />
      ) : (
        <span
          aria-hidden
          style={{
            width: 44, height: 44, borderRadius: "50%", background: "var(--mh-surface-1)",
            display: "flex", alignItems: "center", justifyContent: "center", color: "var(--mh-text-3)",
          }}
        >
          <ImageOff size={18} />
        </span>
      )}
      <span style={{ lineHeight: 1.2 }}>{nome}</span>
    </button>
  );
}

const grade = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))",
  gap: "0.5rem",
} as const;

/**
 * O formulário do relato.
 *
 * Escolha por cartão, e não por select, porque quem preenche costuma estar no
 * chão da operação e no celular. A figura é opcional: sem nenhuma cadastrada a
 * tela continua legível, só com o nome.
 *
 * O modal fecha por X ou Cancelar, nunca por clique fora: perder um relato
 * digitado por um clique errado é o tipo de coisa que faz a pessoa não relatar
 * de novo.
 */
export function SegRelatoDialog({
  open, onClose, pessoas, tipos, locais, areas, unidades,
}: {
  open: boolean;
  onClose: () => void;
  pessoas: Person[];
  tipos: TipoOpt[];
  locais: LocalOpt[];
  areas: AreaOpt[];
  unidades: { id: string; name: string }[];
}) {
  const hoje = new Date().toISOString().slice(0, 10);
  const [data, setData] = useState(hoje);
  const [tipoId, setTipoId] = useState("");
  const [localId, setLocalId] = useState("");
  const [areaId, setAreaId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [envolvidos, setEnvolvidos] = useState<string[]>([]);
  const [descricao, setDescricao] = useState("");
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const tiposAtivos = useMemo(() => tipos.filter((t) => t.active), [tipos]);
  const locaisAtivos = useMemo(() => locais.filter((l) => l.active), [locais]);
  // área sem local vale para qualquer um; com local, só aparece no local dela
  const areasVisiveis = useMemo(
    () => areas.filter((a) => a.active && (!a.localId || a.localId === localId)),
    [areas, localId],
  );
  const tipoEscolhido = tiposAtivos.find((t) => t.id === tipoId);

  const limpar = () => {
    setData(hoje); setTipoId(""); setLocalId(""); setAreaId("");
    setUnitId(""); setEnvolvidos([]); setDescricao(""); setErro("");
  };

  const fechar = () => { limpar(); onClose(); };

  const enviar = () => {
    setErro("");
    if (!tipoId) { setErro("Escolha o tipo do relato."); return; }
    if (!descricao.trim()) { setErro("Descreva o que aconteceu."); return; }
    iniciar(async () => {
      const r = await criarRelato({
        occurred_on: data,
        tipo_id: tipoId,
        local_id: localId || null,
        area_id: areaId || null,
        unit_id: unitId || null,
        descricao,
        envolvidos,
      });
      if (r.error) { setErro(r.error); return; }
      toast.success(r.message ?? "Relato registrado.");
      limpar();
      onClose();
      router.refresh();
    });
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)",
        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "5vh 1rem", zIndex: 50, overflowY: "auto",
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 720, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>Novo relato</h2>
          <button
            type="button" onClick={fechar} className="muted" aria-label="Fechar"
            style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1.1rem" }}>
          <div
            style={{
              display: "flex", gap: "0.55rem", alignItems: "flex-start",
              background: "var(--surface-2)", borderRadius: "var(--mh-radius-lg)",
              padding: "0.7rem 0.85rem", fontSize: "0.8rem",
            }}
          >
            <ShieldAlert size={16} style={{ color: "var(--mh-primary-500)", flexShrink: 0, marginTop: 2 }} />
            <span className="muted">
              Seu nome fica visível apenas para a equipe de segurança. O gestor e a pessoa
              citada recebem o encaminhamento sem saber quem relatou.
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.8rem" }}>
            <div>
              <label className="label">Data do ocorrido <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <input className="input" type="date" value={data} max={hoje} onChange={(e) => setData(e.target.value)} />
            </div>
            {unidades.length > 1 && (
              <div>
                <label className="label">Unidade</label>
                <select className="select" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                  <option value="">Não informar</option>
                  {unidades.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="label">Classificação <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            {tiposAtivos.length === 0 ? (
              <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>
                Nenhum tipo de relato cadastrado. Peça ao administrador para cadastrar em Configurações, aba Segurança.
              </p>
            ) : (
              <>
                <div style={grade}>
                  {tiposAtivos.map((t) => (
                    <Cartao
                      key={t.id} nome={t.name} imagePath={t.imagePath}
                      marcado={tipoId === t.id} onClick={() => setTipoId(t.id)}
                    />
                  ))}
                </div>
                {tipoEscolhido && (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
                    <Badge tone={SEG_NATUREZA_TONE[tipoEscolhido.natureza]}>{SEG_NATUREZA[tipoEscolhido.natureza]}</Badge>
                    {tipoEscolhido.description && (
                      <span className="soft" style={{ fontSize: "0.76rem" }}>{tipoEscolhido.description}</span>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {locaisAtivos.length > 0 && (
            <div>
              <label className="label">Local do ocorrido</label>
              <div style={grade}>
                {locaisAtivos.map((l) => (
                  <Cartao
                    key={l.id} nome={l.name} imagePath={l.imagePath}
                    marcado={localId === l.id}
                    onClick={() => {
                      const novo = localId === l.id ? "" : l.id;
                      setLocalId(novo);
                      // a área escolhida pode não pertencer ao novo local
                      setAreaId("");
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {areasVisiveis.length > 0 && (
            <div>
              <label className="label">Área</label>
              <div style={grade}>
                {areasVisiveis.map((a) => (
                  <Cartao
                    key={a.id} nome={a.name} imagePath={a.imagePath}
                    marcado={areaId === a.id}
                    onClick={() => setAreaId(areaId === a.id ? "" : a.id)}
                  />
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="label">Colaboradores envolvidos</label>
            <PeoplePicker
              people={pessoas} selected={envolvidos} onChange={setEnvolvidos}
              placeholder="Buscar colaborador…"
            />
            <p className="soft" style={{ fontSize: "0.74rem", margin: "0.35rem 0 0" }}>
              Opcional. Condição insegura costuma ser sobre o lugar, não sobre alguém.
            </p>
          </div>

          <div>
            <label className="label">O que aconteceu <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <textarea
              className="input" rows={4} value={descricao}
              placeholder="Descreva o fato como você viu, sem opinião. Ex.: empilhadeira circulando com o garfo elevado na área de picking."
              onChange={(e) => setDescricao(e.target.value)}
            />
          </div>

          {erro && (
            <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
              {erro}
            </p>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" disabled={pendente} onClick={fechar}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={pendente} onClick={enviar}>
            {pendente ? "Enviando…" : "Enviar relato"}
          </button>
        </div>
      </div>
    </div>
  );
}
