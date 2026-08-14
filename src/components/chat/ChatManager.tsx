"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Plus, Send, Users, X } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PeoplePicker } from "@/components/PeoplePicker";
import { normalizar } from "@/lib/format";
import {
  carregarMensagens, criarDm, criarGrupo, enviarMensagem, marcarLido,
  type ConversaResumo, type MensagemChat,
} from "@/lib/actions/chat";

/**
 * O chat interno: lista de conversas à esquerda, a conversa aberta à direita.
 *
 * Nesta leva tudo chega por server action; o tempo real (novas mensagens sem
 * refresh, presença, toasts) entra na leva seguinte por Supabase Realtime.
 */
export function ChatManager({
  conversas, pessoas, meuId,
}: {
  conversas: ConversaResumo[];
  pessoas: { id: string; name: string }[];
  meuId: string;
}) {
  const [aberta, setAberta] = useState<string | null>(null);
  const [lista, setLista] = useState(conversas);
  const [novaDm, setNovaDm] = useState(false);
  const [novoGrupo, setNovoGrupo] = useState(false);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState("");
  const router = useRouter();

  // props novas (revalidate) atualizam a lista sem perder a conversa aberta;
  // ajuste DURANTE o render (padrão do React para estado derivado), e não em
  // effect, que dispararia um segundo render em cascata
  const [propsAnteriores, setPropsAnteriores] = useState(conversas);
  if (propsAnteriores !== conversas) {
    setPropsAnteriores(conversas);
    setLista(conversas);
  }

  const nomePorId = useMemo(() => new Map(pessoas.map((p) => [p.id, p.name])), [pessoas]);
  const conversaAberta = lista.find((c) => c.channelId === aberta) ?? null;

  const rotulo = (c: ConversaResumo) => {
    if (c.kind === "grupo") return c.name ?? "Grupo";
    const outro = c.membros.find((m) => m.id !== meuId);
    return outro?.name ?? "Conversa";
  };

  const visiveis = useMemo(() => {
    const q = normalizar(busca.trim());
    if (!q) return lista;
    return lista.filter((c) => normalizar(rotulo(c)).includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lista, busca, meuId]);

  const abrir = (id: string) => {
    setAberta(id);
    setErro("");
    // zera o badge localmente na hora; o banco confirma em seguida
    setLista((xs) => xs.map((c) => (c.channelId === id ? { ...c, unread: 0 } : c)));
    void marcarLido(id);
  };

  const aoCriar = (r: { error?: string; channelId?: string }) => {
    if (r.error) { setErro(r.error); return; }
    setNovaDm(false);
    setNovoGrupo(false);
    if (r.channelId) setAberta(r.channelId);
    router.refresh();
  };

  return (
    <div
      className="card"
      style={{
        display: "grid", gridTemplateColumns: "300px 1fr", overflow: "hidden",
        height: "calc(100vh - 190px)", minHeight: 420,
      }}
    >
      {/* ---- coluna das conversas ---- */}
      <div style={{ borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ padding: "0.75rem", borderBottom: "1px solid var(--border)", display: "flex", gap: "0.4rem" }}>
          <input
            className="input" placeholder="Buscar conversa…" value={busca}
            onChange={(e) => setBusca(e.target.value)} style={{ flex: 1, minWidth: 0 }}
          />
          <button type="button" className="btn btn-ghost btn-sm" title="Nova conversa" onClick={() => { setErro(""); setNovaDm(true); }}>
            <Plus size={15} />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" title="Novo grupo" onClick={() => { setErro(""); setNovoGrupo(true); }}>
            <Users size={15} />
          </button>
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {visiveis.length === 0 && (
            <p className="soft" style={{ fontSize: "0.8rem", padding: "1rem" }}>
              Nenhuma conversa ainda. Comece uma pelo botão de mais, ali em cima.
            </p>
          )}
          {visiveis.map((c) => {
            const outro = c.kind === "dm" ? c.membros.find((m) => m.id !== meuId) : null;
            return (
              <button
                key={c.channelId}
                type="button"
                onClick={() => abrir(c.channelId)}
                style={{
                  display: "flex", gap: "0.6rem", alignItems: "center", width: "100%",
                  padding: "0.6rem 0.75rem", background: c.channelId === aberta ? "var(--surface-2)" : "none",
                  border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer", textAlign: "left",
                }}
              >
                {c.kind === "dm"
                  ? <Avatar name={outro?.name} userId={outro?.id} size={34} />
                  : (
                    <span style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Users size={16} />
                    </span>
                  )}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "flex", justifyContent: "space-between", gap: "0.4rem" }}>
                    <span style={{ fontWeight: c.unread > 0 ? 700 : 500, fontSize: "0.85rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {rotulo(c)}
                    </span>
                    {c.lastAt && (
                      <span className="soft" style={{ fontSize: "0.68rem", flexShrink: 0 }}>{horaCurta(c.lastAt)}</span>
                    )}
                  </span>
                  <span style={{ display: "flex", justifyContent: "space-between", gap: "0.4rem", alignItems: "center" }}>
                    <span className="soft" style={{ fontSize: "0.75rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.lastDeleted ? "Mensagem apagada" : c.lastBody ?? (c.lastAt ? "Anexo" : "Sem mensagens")}
                    </span>
                    {c.unread > 0 && <Badge tone="purple">{c.unread > 99 ? "99+" : c.unread}</Badge>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- a conversa aberta ---- */}
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        {conversaAberta ? (
          <Thread key={conversaAberta.channelId} conversa={conversaAberta} meuId={meuId} nomePorId={nomePorId} />
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <EmptyState
              icon={<MessageCircle size={26} />}
              title="Escolha uma conversa"
              description="Ou comece uma nova pelo botão de mais, na lista ao lado."
            />
          </div>
        )}
      </div>

      {novaDm && (
        <DialogoNovaConversa
          titulo="Nova conversa"
          pessoas={pessoas.filter((p) => p.id !== meuId)}
          erro={erro}
          onFechar={() => setNovaDm(false)}
          onCriar={async (ids) => aoCriar(await criarDm(ids[0] ?? ""))}
          single
        />
      )}
      {novoGrupo && (
        <DialogoNovaConversa
          titulo="Novo grupo"
          pessoas={pessoas.filter((p) => p.id !== meuId)}
          erro={erro}
          onFechar={() => setNovoGrupo(false)}
          onCriar={async (ids, nome) => aoCriar(await criarGrupo(nome ?? "", ids))}
          comNome
        />
      )}
    </div>
  );
}

/** A conversa aberta: histórico paginado + campo de envio. */
function Thread({
  conversa, meuId, nomePorId,
}: {
  conversa: ConversaResumo;
  meuId: string;
  nomePorId: Map<string, string>;
}) {
  const [mensagens, setMensagens] = useState<MensagemChat[] | null>(null);
  const [texto, setTexto] = useState("");
  const [temMais, setTemMais] = useState(false);
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const fimRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivo = true;
    carregarMensagens(conversa.channelId).then((ms) => {
      if (!vivo) return;
      setMensagens(ms);
      setTemMais(ms.length >= 50);
    });
    return () => { vivo = false; };
  }, [conversa.channelId]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [mensagens?.length]);

  const maisAntigas = () => {
    const primeira = mensagens?.[0];
    if (!primeira) return;
    iniciar(async () => {
      const ms = await carregarMensagens(conversa.channelId, primeira.createdAt);
      setMensagens((atual) => [...ms, ...(atual ?? [])]);
      setTemMais(ms.length >= 50);
    });
  };

  const enviar = () => {
    const corpo = texto.trim();
    if (!corpo || pendente) return;
    setErro("");
    setTexto("");
    iniciar(async () => {
      const r = await enviarMensagem(conversa.channelId, corpo);
      if (r.error || !r.mensagem) { setErro(r.error ?? "Não foi possível enviar."); setTexto(corpo); return; }
      const nova = r.mensagem;
      setMensagens((atual) => ((atual ?? []).some((m) => m.id === nova.id) ? atual : [...(atual ?? []), nova]));
    });
  };

  const titulo = conversa.kind === "grupo"
    ? conversa.name ?? "Grupo"
    : conversa.membros.find((m) => m.id !== meuId)?.name ?? "Conversa";

  return (
    <>
      <div style={{ padding: "0.7rem 1rem", borderBottom: "1px solid var(--border)", display: "flex", gap: "0.6rem", alignItems: "center" }}>
        {conversa.kind === "dm"
          ? <Avatar name={titulo} userId={conversa.membros.find((m) => m.id !== meuId)?.id} size={30} />
          : (
            <span style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Users size={15} />
            </span>
          )}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{titulo}</div>
          {conversa.kind === "grupo" && (
            <div className="soft" style={{ fontSize: "0.72rem" }}>
              {conversa.membros.length} participante{conversa.membros.length === 1 ? "" : "s"}
            </div>
          )}
        </div>
        {conversa.closedAt && <Badge tone="gray">Encerrado</Badge>}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0.9rem 1rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        {mensagens === null && <p className="soft" style={{ fontSize: "0.8rem" }}>Carregando…</p>}
        {mensagens !== null && temMais && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "center" }} disabled={pendente} onClick={maisAntigas}>
            Carregar mensagens anteriores
          </button>
        )}
        {mensagens?.map((m, i) => (
          <Bolha
            key={m.id}
            m={m}
            minha={m.authorId === meuId}
            autor={conversa.kind === "grupo" && m.authorId !== meuId && mensagens[i - 1]?.authorId !== m.authorId
              ? nomePorId.get(m.authorId) ?? "" : ""}
          />
        ))}
        <div ref={fimRef} />
      </div>

      {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.8rem", margin: "0 1rem 0.4rem" }}>{erro}</p>}

      <div style={{ padding: "0.7rem 1rem", borderTop: "1px solid var(--border)", display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
        <textarea
          className="input"
          rows={1}
          value={texto}
          disabled={Boolean(conversa.closedAt)}
          placeholder={conversa.closedAt ? "Este grupo foi encerrado." : "Escreva uma mensagem…"}
          style={{ flex: 1, resize: "none", maxHeight: 120 }}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); }
          }}
        />
        <button
          type="button" className="btn btn-primary btn-sm"
          disabled={pendente || !texto.trim() || Boolean(conversa.closedAt)}
          onClick={enviar}
          title="Enviar (Enter)"
        >
          <Send size={15} />
        </button>
      </div>
    </>
  );
}

function Bolha({ m, minha, autor }: { m: MensagemChat; minha: boolean; autor: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: minha ? "flex-end" : "flex-start" }}>
      {autor && <span className="soft" style={{ fontSize: "0.7rem", margin: "0.25rem 0 0.1rem" }}>{autor}</span>}
      <div
        style={{
          maxWidth: "72%", padding: "0.45rem 0.7rem", borderRadius: 12, fontSize: "0.86rem",
          whiteSpace: "pre-wrap", overflowWrap: "break-word",
          background: minha ? "var(--mh-primary-soft)" : "var(--surface-2)",
          border: "1px solid var(--border)",
        }}
      >
        {m.deletedAt
          ? (
            <span className="soft" style={{ fontStyle: "italic" }}>
              {m.deletedAdmin ? "Mensagem removida pela administração" : "Mensagem apagada"}
            </span>
          )
          : m.body}
        <span className="soft" style={{ fontSize: "0.65rem", marginLeft: "0.5rem" }}>
          {horaCurta(m.createdAt)}{m.editedAt && !m.deletedAt ? " · editada" : ""}
        </span>
      </div>
    </div>
  );
}

/** Escolha de pessoas para DM ou grupo. Fecha só pelo X ou Cancelar. */
function DialogoNovaConversa({
  titulo, pessoas, erro, onFechar, onCriar, single = false, comNome = false,
}: {
  titulo: string;
  pessoas: { id: string; name: string }[];
  erro: string;
  onFechar: () => void;
  onCriar: (ids: string[], nome?: string) => Promise<void>;
  single?: boolean;
  comNome?: boolean;
}) {
  const [ids, setIds] = useState<string[]>([]);
  const [nome, setNome] = useState("");
  const [pendente, iniciar] = useTransition();

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)",
        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "8vh 1rem", zIndex: 50, overflowY: "auto",
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 460, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>{titulo}</h2>
          <button type="button" onClick={onFechar} className="muted" aria-label="Fechar"
            style={{ background: "none", border: "none", cursor: "pointer", lineHeight: 1, display: "flex" }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          {comNome && (
            <div>
              <label className="label">Nome do grupo <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <input className="input" value={nome} placeholder="Ex.: Logística MATRIZ" onChange={(e) => setNome(e.target.value)} />
            </div>
          )}
          <div>
            <label className="label">{single ? "Com quem?" : "Participantes"} <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <PeoplePicker people={pessoas} selected={ids} onChange={setIds} single={single} />
          </div>
          {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.8rem", margin: 0 }}>{erro}</p>}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button" className="btn btn-primary btn-sm"
              disabled={pendente || ids.length === 0 || (comNome && !nome.trim())}
              onClick={() => iniciar(() => onCriar(ids, nome))}
            >
              {pendente ? "Criando…" : "Começar conversa"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onFechar}>Cancelar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Hoje mostra só a hora; outro dia mostra dia/mês. */
function horaCurta(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  if (mesmoDia) {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
