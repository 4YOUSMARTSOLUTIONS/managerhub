"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Target, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { confirmDialog } from "@/components/ui/confirm";
import { formatDate, hojeYmd, somarDias } from "@/lib/format";
import {
  excluirFoco, salvarFoco,
  type FocoSugestao, type FocoVigente, type FocosStatus,
} from "@/lib/actions/seguranca";

type Opcao = { id: string; name: string };

type Rascunho = {
  id?: string;
  areaId: string;
  causaId: string;
  titulo: string;
  orientacao: string;
  inicio: string;
  fim: string;
};

/**
 * O foco da área na tela.
 *
 * Para a operação, é um cartaz: qual é o assunto da minha área agora e o que se
 * espera de mim. Para a equipe de segurança, é o painel de decisão, com a causa
 * dominante de cada área que ainda não tem foco e o número que diz se o foco
 * que já existe está funcionando.
 *
 * Quando não há foco nenhum e quem olha não é da equipe, o bloco não aparece:
 * card vazio dizendo "nada definido" só ocupa espaço na tela de quem não pode
 * fazer nada a respeito.
 */
export function SegFocosPanel({
  status, areas, causas,
}: {
  status: FocosStatus;
  areas: Opcao[];
  causas: Opcao[];
}) {
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [salvando, iniciar] = useTransition();
  const router = useRouter();

  const { podeDefinir, vigentes, sugestoes, dias } = status;
  if (!podeDefinir && vigentes.length === 0) return null;

  const novo = (base?: Partial<Rascunho>) => {
    const inicio = hojeYmd();
    setRascunho({
      areaId: "", causaId: "", titulo: "", orientacao: "",
      inicio, fim: somarDias(inicio, 89), ...base,
    });
  };

  const editar = (f: FocoVigente) =>
    setRascunho({
      id: f.id, areaId: f.area_id, causaId: f.causa_id ?? "", titulo: f.titulo,
      orientacao: f.orientacao ?? "", inicio: f.inicio, fim: f.fim,
    });

  const daSugestao = (s: FocoSugestao) =>
    novo({ areaId: s.area_id, causaId: s.causa_id, titulo: s.causa_nome });

  const salvar = () => {
    if (!rascunho) return;
    iniciar(async () => {
      const r = await salvarFoco({
        id: rascunho.id ?? null,
        areaId: rascunho.areaId,
        causaId: rascunho.causaId || null,
        titulo: rascunho.titulo,
        orientacao: rascunho.orientacao,
        inicio: rascunho.inicio,
        fim: rascunho.fim,
      });
      if (r.error) { toast.error(r.error); return; }
      toast.success(r.message ?? "Foco salvo.");
      setRascunho(null);
      router.refresh();
    });
  };

  const remover = (f: FocoVigente) => {
    void (async () => {
      const ok = await confirmDialog({
        title: "Remover o foco?",
        message: `A área ${f.area_nome} fica sem orientação de segurança até que outro foco seja definido.`,
        confirmLabel: "Remover",
        tone: "danger",
      });
      if (!ok) return;
      const r = await excluirFoco(f.id);
      if (r.error) { toast.error(r.error); return; }
      toast.success(r.message ?? "Foco removido.");
      router.refresh();
    })();
  };

  return (
    <div className="card card-pad" style={{ marginBottom: "1.1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.6rem", flexWrap: "wrap" }}>
        <div>
          <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <Target size={16} aria-hidden /> Foco das áreas
          </h3>
          <p className="soft" style={{ fontSize: "0.76rem", margin: "0.2rem 0 0" }}>
            {podeDefinir
              ? "A causa que mais aparece vira orientação com prazo, e quem relata naquela área lê o foco antes de escrever."
              : "O que a segurança pede atenção na sua área neste período."}
          </p>
        </div>
        {podeDefinir && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => novo()}>
            <Plus size={14} aria-hidden /> Definir foco
          </button>
        )}
      </div>

      {vigentes.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.82rem", margin: "0.8rem 0 0" }}>
          Nenhum foco valendo hoje.
        </p>
      ) : (
        <div
          style={{
            display: "grid", gap: "0.7rem", marginTop: "0.9rem",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
          }}
        >
          {vigentes.map((f) => <CartaoFoco key={f.id} foco={f} podeDefinir={podeDefinir} onEditar={editar} onRemover={remover} />)}
        </div>
      )}

      {podeDefinir && sugestoes.length > 0 && (
        <div style={{ marginTop: "1rem", borderTop: "1px solid var(--border)", paddingTop: "0.8rem" }}>
          <h4 style={{ fontSize: "0.84rem", fontWeight: 700, margin: "0 0 0.15rem" }}>Áreas sem foco</h4>
          <p className="soft" style={{ fontSize: "0.74rem", margin: "0 0 0.6rem" }}>
            A causa que mais apareceu nos últimos {dias} dias. Um clique já abre o foco com ela preenchida.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {sugestoes.slice(0, 6).map((s) => (
              <div
                key={s.area_id}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}
              >
                <span style={{ fontSize: "0.83rem" }}>
                  <strong>{s.area_nome}</strong>
                  <span className="soft"> · {s.qtd} de {s.total} relatos apontam </span>
                  {s.causa_nome}
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => daSugestao(s)}>
                  Definir foco
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {rascunho && (
        <FocoDialog
          rascunho={rascunho} areas={areas} causas={causas} salvando={salvando}
          onChange={setRascunho} onSalvar={salvar} onFechar={() => setRascunho(null)}
        />
      )}
    </div>
  );
}

/** Um foco vigente, com o número que diz se ele está funcionando. */
function CartaoFoco({
  foco, podeDefinir, onEditar, onRemover,
}: {
  foco: FocoVigente;
  podeDefinir: boolean;
  onEditar: (f: FocoVigente) => void;
  onRemover: (f: FocoVigente) => void;
}) {
  // A comparação só existe quando há causa e alguma base para comparar. Sem
  // isso, "0 contra 0" pareceria uma queda, e não é nada.
  const comparavel = foco.causa_id !== null && (foco.na_causa > 0 || foco.na_causa_antes > 0);
  const caindo = foco.na_causa < foco.na_causa_antes;

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "0.7rem 0.8rem", background: "var(--surface-2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.4rem", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--mh-primary-600)" }}>{foco.area_nome}</div>
          <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{foco.titulo}</div>
        </div>
        {podeDefinir && (
          <div style={{ display: "flex", gap: "0.15rem" }}>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Editar" onClick={() => onEditar(foco)}>
              <Pencil size={14} aria-hidden />
            </button>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Remover" onClick={() => onRemover(foco)}>
              <Trash2 size={14} aria-hidden />
            </button>
          </div>
        )}
      </div>

      {foco.orientacao && (
        <p style={{ fontSize: "0.8rem", margin: "0.4rem 0 0" }}>{foco.orientacao}</p>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center", marginTop: "0.55rem" }}>
        <Badge tone="gray">até {formatDate(foco.fim)}</Badge>
        {foco.causa_nome && <Badge tone="blue">{foco.causa_nome}</Badge>}
        {comparavel && (
          <Badge tone={caindo ? "green" : foco.na_causa > foco.na_causa_antes ? "red" : "gray"}>
            {caindo ? <TrendingDown size={12} aria-hidden /> : <TrendingUp size={12} aria-hidden />}
            {" "}{foco.na_causa} na causa, era {foco.na_causa_antes}
          </Badge>
        )}
      </div>
      <p className="soft" style={{ fontSize: "0.72rem", margin: "0.4rem 0 0" }}>
        {foco.relatos} relato(s) na área desde {formatDate(foco.inicio)}.
      </p>
    </div>
  );
}

/** Formulário do foco. Fecha por X ou Cancelar, nunca por clique no fundo. */
function FocoDialog({
  rascunho, areas, causas, salvando, onChange, onSalvar, onFechar,
}: {
  rascunho: Rascunho;
  areas: Opcao[];
  causas: Opcao[];
  salvando: boolean;
  onChange: (r: Rascunho) => void;
  onSalvar: () => void;
  onFechar: () => void;
}) {
  const set = (campo: keyof Rascunho, valor: string) => onChange({ ...rascunho, [campo]: valor });
  const pronto = !!rascunho.areaId && !!rascunho.titulo.trim() && !!rascunho.inicio && !!rascunho.fim;

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)",
        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "6vh 1rem", zIndex: 60, overflowY: "auto",
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 560, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: 0 }}>
            {rascunho.id ? "Editar foco" : "Definir foco da área"}
          </h2>
          <button
            type="button" onClick={onFechar} className="muted" aria-label="Fechar"
            style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "1.15rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.85rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))", gap: "0.85rem" }}>
            <div>
              <label className="label">Área <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <select className="select" value={rascunho.areaId} onChange={(e) => set("areaId", e.target.value)}>
                <option value="">Escolha</option>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Causa que motivou</label>
              <select className="select" value={rascunho.causaId} onChange={(e) => set("causaId", e.target.value)}>
                <option value="">Nenhuma</option>
                {causas.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Título <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <input
              className="input" value={rascunho.titulo} maxLength={120}
              placeholder="Uso de EPI na movimentação de carga"
              onChange={(e) => set("titulo", e.target.value)}
            />
          </div>

          <div>
            <label className="label">Orientação</label>
            <textarea
              className="input" rows={3} value={rascunho.orientacao}
              placeholder="O que a área deve fazer diferente enquanto o foco estiver valendo."
              onChange={(e) => set("orientacao", e.target.value)}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))", gap: "0.85rem" }}>
            <div>
              <label className="label">Início <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <input className="input" type="date" value={rascunho.inicio} onChange={(e) => set("inicio", e.target.value)} />
            </div>
            <div>
              <label className="label">Fim <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <input className="input" type="date" value={rascunho.fim} onChange={(e) => set("fim", e.target.value)} />
            </div>
          </div>

          <p className="soft" style={{ fontSize: "0.74rem", margin: 0 }}>
            Uma área tem um foco de cada vez. Para trocar antes do prazo, edite o foco que está valendo.
          </p>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" onClick={onFechar}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={!pronto || salvando} onClick={onSalvar}>
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
