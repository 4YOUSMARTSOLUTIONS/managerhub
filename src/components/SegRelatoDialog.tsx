"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImageOff, ShieldAlert } from "lucide-react";
import { PeoplePicker, type Person } from "@/components/PeoplePicker";
import { Badge } from "@/components/ui/Badge";
import { SEG_NATUREZA, SEG_NATUREZA_TONE } from "@/lib/constants";
import { hojeYmd } from "@/lib/format";
import { segIconeSrc } from "@/lib/avatar";
import { criarRelato, editarRelato } from "@/lib/actions/seguranca";
import type { Enums } from "@/types/database";

export type TipoOpt = {
  id: string; name: string; natureza: Enums<"seg_relato_natureza">;
  description: string | null; imagePath: string | null; active: boolean;
};
export type LocalOpt = {
  id: string; name: string; imagePath: string | null; active: boolean;
  /** vazio = aparece em qualquer classificacao */
  tipoIds: string[];
};
export type AreaOpt = {
  id: string; name: string; localId: string | null; imagePath: string | null; active: boolean;
  tipoIds: string[];
};
/** O foco vigente da área, para o formulário lembrar a orientação. */
export type FocoOpt = { areaId: string; titulo: string; orientacao: string | null };
export type OcorrenciaOpt = {
  id: string; name: string; description: string | null; imagePath: string | null; active: boolean;
  tipoIds: string[]; localIds: string[]; areaIds: string[];
};

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
/** O que o formulário precisa saber para reabrir um relato em edição. */
export type RelatoEmEdicao = {
  id: string;
  occurredOn: string;
  tipoId: string;
  localId: string | null;
  areaId: string | null;
  ocorrenciaId: string | null;
  descricao: string;
  envolvidos: string[];
};

export function SegRelatoDialog({
  open, onClose, pessoas, tipos, locais, areas, ocorrencias, focos, editando,
}: {
  open: boolean;
  onClose: () => void;
  pessoas: Person[];
  tipos: TipoOpt[];
  locais: LocalOpt[];
  areas: AreaOpt[];
  ocorrencias: OcorrenciaOpt[];
  focos: FocoOpt[];
  /** null = novo relato. O pai monta com `key`, então cada abertura começa
   *  no estado certo sem efeito de reset. */
  editando?: RelatoEmEdicao | null;
}) {
  // `hojeYmd` e não `toISOString`: o segundo devolve UTC, e depois das 21h o
  // formulário abriria com a data de amanhã
  const hoje = hojeYmd();
  const [data, setData] = useState(editando?.occurredOn ?? hoje);
  const [tipoId, setTipoId] = useState(editando?.tipoId ?? "");
  const [localId, setLocalId] = useState(editando?.localId ?? "");
  const [areaId, setAreaId] = useState(editando?.areaId ?? "");
  const [ocorrenciaId, setOcorrenciaId] = useState(editando?.ocorrenciaId ?? "");
  const [envolvidos, setEnvolvidos] = useState<string[]>(editando?.envolvidos ?? []);
  const [descricao, setDescricao] = useState(editando?.descricao ?? "");
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const tiposAtivos = useMemo(() => tipos.filter((t) => t.active), [tipos]);
  const foco = useMemo(() => focos.find((f) => f.areaId === areaId) ?? null, [focos, areaId]);
  // A CASCATA. A regra é uma só e vale para os três níveis: item SEM vínculo
  // aparece sempre; item COM vínculo aparece só onde foi amarrado. É o que faz
  // "Comportamento seguro" abrir duas ocorrências em vez de trinta.
  const serve = (ids: string[], escolhido: string) =>
    ids.length === 0 || (!!escolhido && ids.includes(escolhido));

  const locaisAtivos = useMemo(
    () => locais.filter((l) => l.active && serve(l.tipoIds, tipoId)),
    [locais, tipoId],
  );
  // área sem local vale para qualquer um; com local, só aparece no local dela
  const areasVisiveis = useMemo(
    () => areas.filter((a) => a.active && (!a.localId || a.localId === localId) && serve(a.tipoIds, tipoId)),
    [areas, localId, tipoId],
  );
  const ocorrenciasVisiveis = useMemo(
    () => ocorrencias.filter((o) =>
      o.active
      && serve(o.tipoIds, tipoId)
      && (o.localIds.length === 0 || (!!localId && o.localIds.includes(localId)))
      && (o.areaIds.length === 0 || (!!areaId && o.areaIds.includes(areaId)))
    ),
    [ocorrencias, tipoId, localId, areaId],
  );
  const tipoEscolhido = tiposAtivos.find((t) => t.id === tipoId);

  const limpar = () => {
    setData(hoje); setTipoId(""); setLocalId(""); setAreaId(""); setOcorrenciaId("");
    setEnvolvidos([]); setDescricao(""); setErro("");
  };

  const fechar = () => { limpar(); onClose(); };

  const enviar = () => {
    setErro("");
    if (!tipoId) { setErro("Escolha o tipo do relato."); return; }
    if (!descricao.trim()) { setErro("Descreva o que aconteceu."); return; }
    const payload = {
      occurred_on: data,
      tipo_id: tipoId,
      local_id: localId || null,
      area_id: areaId || null,
      ocorrencia_id: ocorrenciaId || null,
      descricao,
      envolvidos,
    };
    iniciar(async () => {
      const r = editando
        ? await editarRelato(editando.id, payload)
        : await criarRelato(payload);
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
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>
            {editando ? "Editar relato" : "Novo relato"}
          </h2>
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
              {/* `max` no dia de hoje: relato é do que já aconteceu */}
              <input className="input" type="date" value={data} max={hoje} onChange={(e) => setData(e.target.value)} />
            </div>
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
                      marcado={tipoId === t.id}
                      onClick={() => {
                        setTipoId(t.id);
                        // o que estava escolhido pode nao pertencer a nova
                        // classificacao; limpar evita gravar combinacao invalida
                        setLocalId(""); setAreaId(""); setOcorrenciaId("");
                      }}
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
                      // área e ocorrência escolhidas podem não pertencer ao
                      // novo local
                      setAreaId(""); setOcorrenciaId("");
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
                    onClick={() => { setAreaId(areaId === a.id ? "" : a.id); setOcorrenciaId(""); }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* O foco aparece DEPOIS da área escolhida e ANTES da descrição: é o
              momento em que a orientação ainda muda o que a pessoa vai escrever. */}
          {foco && (
            <div
              style={{
                border: "1px solid var(--mh-primary-500)", borderRadius: 10,
                background: "var(--mh-primary-soft)", padding: "0.6rem 0.75rem",
              }}
            >
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--mh-primary-600)" }}>
                Foco de segurança desta área
              </div>
              <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>{foco.titulo}</div>
              {foco.orientacao && (
                <p style={{ fontSize: "0.8rem", margin: "0.25rem 0 0" }}>{foco.orientacao}</p>
              )}
            </div>
          )}

          {ocorrenciasVisiveis.length > 0 && (
            <div>
              <label className="label">O que aconteceu</label>
              <div style={grade}>
                {ocorrenciasVisiveis.map((o) => (
                  <Cartao
                    key={o.id} nome={o.name} imagePath={o.imagePath}
                    marcado={ocorrenciaId === o.id}
                    onClick={() => setOcorrenciaId(ocorrenciaId === o.id ? "" : o.id)}
                  />
                ))}
              </div>
              {ocorrenciaId && (
                <p className="soft" style={{ fontSize: "0.74rem", margin: "0.35rem 0 0" }}>
                  {ocorrencias.find((o) => o.id === ocorrenciaId)?.description ?? ""}
                </p>
              )}
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
              A unidade do relato vem do vínculo de quem foi citado; sem citação, do seu.
            </p>
          </div>

          <div>
            <label className="label">Descreva o fato <span style={{ color: "var(--mh-danger)" }}>*</span></label>
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
            {pendente ? "Enviando…" : editando ? "Salvar alterações" : "Enviar relato"}
          </button>
        </div>
      </div>
    </div>
  );
}
