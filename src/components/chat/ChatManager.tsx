"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Bell, BellOff, MessageCircle, Paperclip, Pencil, Plus, Search, Send, Settings, Shield, ShieldX, Trash2, Users, X,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { confirmDialog } from "@/components/ui/confirm";
import { PeoplePicker } from "@/components/PeoplePicker";
import { normalizar } from "@/lib/format";
import type { Enums } from "@/types/database";
import {
  apagarMensagem, apagarMensagemAdmin, banirDoChat, buscarChat, carregarMensagens, criarDm,
  criarGrupo, desbanirDoChat, editarMensagem, encerrarGrupo, enviarAnexo, enviarMensagem,
  gerirMembros, getBloqueados, getConversasAdmin, renomearGrupo, transferirDono, urlAnexoChat,
  type BloqueadoChat, type ConversaResumo, type MensagemChat, type ResultadoBusca,
} from "@/lib/actions/chat";
import { type StatusPresenca } from "./useChatRealtime";
import { STATUS_COR, STATUS_ROTULO, useChatStatus } from "./ChatPresenceProvider";
import { useChatVivo } from "./ChatLiveProvider";
import { EmojiPicker } from "./EmojiPicker";

/**
 * A tela cheia do chat: lista de conversas à esquerda, conversa à direita.
 *
 * A lista, as mensagens ao vivo e a conversa aberta vêm do ChatLiveProvider,
 * que mora no shell: é a MESMA assinatura de websocket que alimenta o balão do
 * canto e os avisos nas outras telas. Aqui não se assina nada de novo, senão
 * cada mensagem chegaria duas vezes; e abrir uma conversa no balão e vir para
 * cá continua na mesma conversa.
 */
export function ChatManager({
  pessoas, meuId, souAdminChat,
}: {
  pessoas: { id: string; name: string }[];
  meuId: string;
  /** owner/admin/hr: aba "Todas", gestão de qualquer grupo, remoção e bloqueio */
  souAdminChat: boolean;
}) {
  const [novaDm, setNovaDm] = useState(false);
  const [novoGrupo, setNovoGrupo] = useState(false);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState("");
  // administração: aba "Todas as conversas" (carregada ao abrir) e diálogos
  const [verTodas, setVerTodas] = useState(false);
  const [listaAdmin, setListaAdmin] = useState<ConversaResumo[] | null>(null);
  const [grupoAdmin, setGrupoAdmin] = useState<ConversaResumo | null>(null);
  const [mostrarBloqueados, setMostrarBloqueados] = useState(false);
  const [mostrarBusca, setMostrarBusca] = useState(false);

  // presença, lista e tempo real vêm dos providers do shell
  const { presencas, meuStatus, mudarStatus } = useChatStatus();
  const {
    conversas: lista, aoVivo, canalAberto: aberta, abrirCanal,
    recarregar, notificacoes, alternarNotificacoes,
  } = useChatVivo();

  const abrir = useCallback((id: string) => {
    abrirCanal(id);
    setErro("");
  }, [abrirCanal]);

  const nomePorId = useMemo(() => new Map(pessoas.map((p) => [p.id, p.name])), [pessoas]);
  const conversaAberta = (verTodas ? listaAdmin ?? [] : lista).find((c) => c.channelId === aberta)
    ?? lista.find((c) => c.channelId === aberta)
    ?? null;

  const rotulo = (c: ConversaResumo) => {
    if (c.kind === "grupo") return c.name ?? "Grupo";
    // na aba de administração a DM pode não me incluir: mostra o par completo
    if (!c.membros.some((m) => m.id === meuId)) {
      return c.membros.map((m) => m.name).filter(Boolean).join(" e ") || "Conversa";
    }
    const outro = c.membros.find((m) => m.id !== meuId);
    return outro?.name ?? "Conversa";
  };

  const visiveis = useMemo(() => {
    const base = verTodas ? listaAdmin ?? [] : lista;
    const q = normalizar(busca.trim());
    if (!q) return base;
    return base.filter((c) => normalizar(rotulo(c)).includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lista, listaAdmin, verTodas, busca, meuId]);

  const trocarAba = (todas: boolean) => {
    setVerTodas(todas);
    abrirCanal(null);
    if (todas && listaAdmin === null) {
      void getConversasAdmin().then(setListaAdmin);
    }
  };

  const aoCriar = (r: { error?: string; channelId?: string }) => {
    if (r.error) { setErro(r.error); return; }
    setNovaDm(false);
    setNovoGrupo(false);
    recarregar();
    if (r.channelId) abrirCanal(r.channelId);
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
      <div style={{ borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
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
          <button type="button" className="btn btn-ghost btn-sm" title="Busca avançada no histórico" onClick={() => setMostrarBusca(true)}>
            <Search size={15} />
          </button>
          {souAdminChat && (
            <button type="button" className="btn btn-ghost btn-sm" title="Bloqueados no chat" onClick={() => setMostrarBloqueados(true)}>
              <Shield size={15} />
            </button>
          )}
        </div>
        {souAdminChat && (
          <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
            {([[false, "Minhas"], [true, "Todas as conversas"]] as const).map(([todas, nome]) => (
              <button
                key={nome}
                type="button"
                onClick={() => trocarAba(todas)}
                style={{
                  flex: 1, padding: "0.45rem 0", fontSize: "0.78rem", cursor: "pointer",
                  background: "none", border: "none",
                  borderBottom: verTodas === todas ? "2px solid var(--mh-primary)" : "2px solid transparent",
                  color: verTodas === todas ? "var(--text)" : "var(--text-muted)",
                  fontWeight: verTodas === todas ? 600 : 400,
                }}
              >
                {nome}
              </button>
            ))}
          </div>
        )}
        {/* meu status + liga/desliga das notificações */}
        <div style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid var(--border)", display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span aria-hidden style={{ width: 9, height: 9, borderRadius: "50%", background: STATUS_COR[meuStatus], flexShrink: 0 }} />
          <select
            className="input"
            aria-label="Meu status"
            value={meuStatus}
            onChange={(e) => mudarStatus(e.target.value as Enums<"chat_user_status">)}
            style={{ flex: 1, minWidth: 0, fontSize: "0.8rem", padding: "0.25rem 0.4rem" }}
          >
            <option value="disponivel">Disponível</option>
            <option value="ocupado">Ocupado</option>
            <option value="ausente">Ausente</option>
          </select>
          <button
            type="button" className="btn btn-ghost btn-sm"
            title={notificacoes ? "Desligar a prévia da mensagem" : "Ligar a prévia da mensagem"}
            onClick={alternarNotificacoes}
          >
            {notificacoes ? <Bell size={15} /> : <BellOff size={15} />}
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
                  ? (
                    <span style={{ position: "relative", display: "flex", flexShrink: 0 }}>
                      <Avatar name={outro?.name} userId={outro?.id} size={34} />
                      <span
                        aria-hidden
                        title={STATUS_ROTULO[presencas[outro?.id ?? ""] ?? "offline"]}
                        style={{
                          position: "absolute", right: -1, bottom: -1, width: 11, height: 11,
                          borderRadius: "50%", border: "2px solid var(--surface)",
                          background: STATUS_COR[presencas[outro?.id ?? ""] ?? "offline"],
                        }}
                      />
                    </span>
                  )
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
      {/* minHeight: 0 é o que deixa o filho com overflow rolar dentro do flex */}
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        {conversaAberta ? (
          <Thread
            key={conversaAberta.channelId}
            conversa={conversaAberta}
            meuId={meuId}
            nomePorId={nomePorId}
            extras={aoVivo[conversaAberta.channelId] ?? []}
            presenca={conversaAberta.kind === "dm"
              ? presencas[conversaAberta.membros.find((m) => m.id !== meuId)?.id ?? ""] ?? "offline"
              : null}
            souMembro={conversaAberta.membros.some((m) => m.id === meuId)}
            souAdminChat={souAdminChat}
            onGerir={conversaAberta.kind === "grupo" && (conversaAberta.role === "dono" || souAdminChat)
              ? () => setGrupoAdmin(conversaAberta)
              : undefined}
          />
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
      {grupoAdmin && (
        <GroupAdminDialog
          conversa={grupoAdmin}
          pessoas={pessoas}
          onFechar={() => setGrupoAdmin(null)}
          onFeito={() => {
            recarregar();
            if (verTodas) void getConversasAdmin().then(setListaAdmin);
          }}
        />
      )}
      {mostrarBloqueados && (
        <BloqueadosDialog
          pessoas={pessoas.filter((p) => p.id !== meuId)}
          onFechar={() => setMostrarBloqueados(false)}
        />
      )}
      {mostrarBusca && (
        <BuscaDialog
          pessoas={pessoas}
          conversas={(verTodas ? listaAdmin ?? [] : lista).map((c) => ({ id: c.channelId, nome: rotulo(c) }))}
          nomePorId={nomePorId}
          rotuloPorCanal={new Map((verTodas ? listaAdmin ?? [] : lista).map((c) => [c.channelId, rotulo(c)]))}
          onFechar={() => setMostrarBusca(false)}
          onAbrir={(channelId) => {
            setMostrarBusca(false);
            abrir(channelId);
          }}
        />
      )}
    </div>
  );
}

/** A conversa aberta: histórico paginado + tempo real + campo de envio. */
function Thread({
  conversa, meuId, nomePorId, extras, presenca, souMembro, souAdminChat, onGerir,
}: {
  conversa: ConversaResumo;
  meuId: string;
  nomePorId: Map<string, string>;
  /** mensagens chegadas pelo websocket para este canal (INSERT e UPDATE) */
  extras: MensagemChat[];
  /** presença do outro lado numa DM; null em grupo */
  presenca: StatusPresenca | null;
  /** false = leitura da administração: sem composer, sem editar/apagar próprio */
  souMembro: boolean;
  souAdminChat: boolean;
  /** presente quando quem olha pode gerir o grupo (dono ou administração) */
  onGerir?: () => void;
}) {
  const [mensagens, setMensagens] = useState<MensagemChat[] | null>(null);
  const [texto, setTexto] = useState("");
  const [temMais, setTemMais] = useState(false);
  const [erro, setErro] = useState("");
  // id da mensagem em edição; o composer vira o campo de edição
  const [editando, setEditando] = useState<string | null>(null);
  // menu de contexto (botão direito na mensagem): posição + a mensagem alvo
  const [menu, setMenu] = useState<{ x: number; y: number; m: MensagemChat } | null>(null);
  const [pendente, iniciar] = useTransition();
  const fimRef = useRef<HTMLDivElement>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let vivo = true;
    carregarMensagens(conversa.channelId).then((ms) => {
      if (!vivo) return;
      setMensagens(ms);
      setTemMais(ms.length >= 50);
    });
    return () => { vivo = false; };
  }, [conversa.channelId]);

  // histórico + tempo real fundidos DURANTE o render: dedup por id (o eco do
  // próprio envio chega também pelo websocket) e UPDATE substitui a versão
  // antiga (edição/tombstone da leva seguinte já aparecem ao vivo)
  const todas = useMemo(() => {
    if (mensagens === null) return null;
    const porId = new Map(mensagens.map((m) => [m.id, m] as const));
    for (const m of extras) porId.set(m.id, m);
    return [...porId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [mensagens, extras]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [todas?.length]);

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
    if (editando) {
      const id = editando;
      setEditando(null);
      iniciar(async () => {
        const r = await editarMensagem(id, corpo);
        if (r.error) { setErro(r.error); setTexto(corpo); setEditando(id); return; }
        // o eco do broadcast confirma; aqui só a resposta imediata local
        setMensagens((atual) => (atual ?? []).map((m) => (m.id === id
          ? { ...m, body: corpo, editedAt: new Date().toISOString() } : m)));
      });
      return;
    }
    iniciar(async () => {
      const r = await enviarMensagem(conversa.channelId, corpo);
      if (r.error || !r.mensagem) { setErro(r.error ?? "Não foi possível enviar."); setTexto(corpo); return; }
      const nova = r.mensagem;
      setMensagens((atual) => ((atual ?? []).some((m) => m.id === nova.id) ? atual : [...(atual ?? []), nova]));
    });
  };

  const anexar = (file: File) => {
    setErro("");
    iniciar(async () => {
      const fd = new FormData();
      fd.set("channelId", conversa.channelId);
      fd.set("body", texto.trim());
      fd.set("file", file);
      const r = await enviarAnexo(fd);
      if (r.error || !r.mensagem) { setErro(r.error ?? "Não foi possível enviar o anexo."); return; }
      setTexto("");
      const nova = r.mensagem;
      setMensagens((atual) => ((atual ?? []).some((m) => m.id === nova.id) ? atual : [...(atual ?? []), nova]));
    });
  };

  /** insere na posição do cursor (e não no fim), como qualquer editor */
  const inserirEmoji = (emoji: string) => {
    const campo = campoRef.current;
    const inicio = campo?.selectionStart ?? texto.length;
    const fim = campo?.selectionEnd ?? texto.length;
    const novo = texto.slice(0, inicio) + emoji + texto.slice(fim);
    setTexto(novo);
    requestAnimationFrame(() => {
      campo?.focus();
      const pos = inicio + emoji.length;
      campo?.setSelectionRange(pos, pos);
    });
  };

  const comecarEdicao = (m: MensagemChat) => {
    setEditando(m.id);
    setTexto(m.body ?? "");
    setErro("");
  };

  const apagar = async (m: MensagemChat) => {
    const ok = await confirmDialog({
      title: "Apagar mensagem",
      message: "A mensagem vira “Mensagem apagada” para todos na conversa. Apagar?",
      confirmLabel: "Apagar",
      tone: "danger",
    });
    if (!ok) return;
    iniciar(async () => {
      const r = await apagarMensagem(m.id);
      if (r.error) { setErro(r.error); return; }
      setMensagens((atual) => (atual ?? []).map((x) => (x.id === m.id
        ? { ...x, body: null, anexoPath: null, anexoNome: null, anexoMime: null, deletedAt: new Date().toISOString() }
        : x)));
    });
  };

  const apagarAdmin = async (m: MensagemChat) => {
    const ok = await confirmDialog({
      title: "Remover pela administração",
      message: "A mensagem vira “Mensagem removida pela administração” para todos. Remover?",
      confirmLabel: "Remover",
      tone: "danger",
    });
    if (!ok) return;
    iniciar(async () => {
      const r = await apagarMensagemAdmin(m.id);
      if (r.error) { setErro(r.error); return; }
      setMensagens((atual) => (atual ?? []).map((x) => (x.id === m.id
        ? { ...x, body: null, anexoPath: null, anexoNome: null, anexoMime: null, deletedAt: new Date().toISOString(), deletedAdmin: true }
        : x)));
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
          {conversa.kind === "grupo" ? (
            <div className="soft" style={{ fontSize: "0.72rem" }}>
              {conversa.membros.length} participante{conversa.membros.length === 1 ? "" : "s"}
            </div>
          ) : presenca && (
            <div className="soft" style={{ fontSize: "0.72rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
              <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: STATUS_COR[presenca] }} />
              {STATUS_ROTULO[presenca]}
            </div>
          )}
        </div>
        {conversa.closedAt && <Badge tone="gray">Encerrado</Badge>}
        {!souMembro && <Badge tone="purple">Leitura da administração</Badge>}
        {onGerir && (
          <button
            type="button" className="btn btn-ghost btn-sm" title="Gerenciar grupo"
            onClick={onGerir} style={{ marginLeft: "auto" }}
          >
            <Settings size={15} />
          </button>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0.9rem 1rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        {todas === null && <p className="soft" style={{ fontSize: "0.8rem" }}>Carregando…</p>}
        {todas !== null && temMais && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "center" }} disabled={pendente} onClick={maisAntigas}>
            Carregar mensagens anteriores
          </button>
        )}
        {todas?.map((m, i) => {
          // as ações moram no menu do botão direito, para a tela ficar limpa
          const podeEditar = souMembro && m.authorId === meuId && !m.deletedAt && m.body !== null && !conversa.closedAt;
          const podeApagar = souMembro && m.authorId === meuId && !m.deletedAt;
          const podeRemoverAdmin = souAdminChat && !m.deletedAt && !(souMembro && m.authorId === meuId);
          return (
            <Bolha
              key={m.id}
              m={m}
              minha={m.authorId === meuId}
              autor={(conversa.kind === "grupo" || !souMembro) && m.authorId !== meuId && todas[i - 1]?.authorId !== m.authorId
                ? nomePorId.get(m.authorId) ?? "" : ""}
              onMenu={podeEditar || podeApagar || podeRemoverAdmin
                ? (e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, m }); }
                : undefined}
            />
          );
        })}
        <div ref={fimRef} />
      </div>

      {menu && (
        <MenuMensagem
          x={menu.x}
          y={menu.y}
          podeEditar={souMembro && menu.m.authorId === meuId && !menu.m.deletedAt && menu.m.body !== null && !conversa.closedAt}
          podeApagar={souMembro && menu.m.authorId === meuId && !menu.m.deletedAt}
          podeRemoverAdmin={souAdminChat && !menu.m.deletedAt && !(souMembro && menu.m.authorId === meuId)}
          onEditar={() => { setMenu(null); comecarEdicao(menu.m); }}
          onApagar={() => { setMenu(null); void apagar(menu.m); }}
          onRemoverAdmin={() => { setMenu(null); void apagarAdmin(menu.m); }}
          onFechar={() => setMenu(null)}
        />
      )}

      {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.8rem", margin: "0 1rem 0.4rem" }}>{erro}</p>}
      {editando && (
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", margin: "0 1rem 0.3rem" }}>
          <Badge tone="purple">Editando</Badge>
          <button
            type="button" className="btn btn-ghost btn-sm"
            onClick={() => { setEditando(null); setTexto(""); }}
          >
            Cancelar
          </button>
        </div>
      )}

      <div style={{ padding: "0.7rem 1rem", borderTop: "1px solid var(--border)", display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
        <input
          ref={arquivoRef}
          type="file"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) anexar(f);
          }}
        />
        <button
          type="button" className="btn btn-ghost btn-sm"
          disabled={pendente || Boolean(conversa.closedAt) || Boolean(editando) || !souMembro}
          onClick={() => arquivoRef.current?.click()}
          title="Anexar arquivo (até 10 MB); o texto vira a legenda"
        >
          <Paperclip size={15} />
        </button>
        <EmojiPicker onEscolher={inserirEmoji} disabled={Boolean(conversa.closedAt) || !souMembro} />
        <textarea
          ref={campoRef}
          className="input"
          rows={1}
          value={texto}
          disabled={Boolean(conversa.closedAt) || !souMembro}
          placeholder={!souMembro
            ? "Você não participa desta conversa; a administração só lê."
            : conversa.closedAt ? "Este grupo foi encerrado." : "Escreva uma mensagem…"}
          style={{ flex: 1, resize: "none", maxHeight: 120 }}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); }
            if (e.key === "Escape" && editando) { setEditando(null); setTexto(""); }
          }}
        />
        <button
          type="button" className="btn btn-primary btn-sm"
          disabled={pendente || !texto.trim() || Boolean(conversa.closedAt) || !souMembro}
          onClick={enviar}
          title={editando ? "Salvar edição (Enter)" : "Enviar (Enter)"}
        >
          <Send size={15} />
        </button>
      </div>
    </>
  );
}

function Bolha({
  m, minha, autor, onMenu,
}: {
  m: MensagemChat;
  minha: boolean;
  autor: string;
  /** botão direito na bolha abre o menu de ações (editar/apagar/remover) */
  onMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: minha ? "flex-end" : "flex-start" }}>
      {autor && <span className="soft" style={{ fontSize: "0.7rem", margin: "0.25rem 0 0.1rem" }}>{autor}</span>}
      <div
        onContextMenu={onMenu}
        title={onMenu ? "Botão direito para opções" : undefined}
        style={{
          maxWidth: "72%", padding: "0.45rem 0.7rem", borderRadius: 12, fontSize: "0.86rem",
          whiteSpace: "pre-wrap", overflowWrap: "break-word", minWidth: 0,
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
        {!m.deletedAt && <AnexoChat m={m} />}
        <span className="soft" style={{ fontSize: "0.65rem", marginLeft: "0.5rem" }}>
          {horaCurta(m.createdAt)}{m.editedAt && !m.deletedAt ? " · editada" : ""}
        </span>
      </div>
    </div>
  );
}

/**
 * O menu do botão direito na mensagem. Nasce na posição do clique (recuando
 * quando encostaria na borda), fecha por clique fora, Esc ou rolagem.
 */
function MenuMensagem({
  x, y, podeEditar, podeApagar, podeRemoverAdmin, onEditar, onApagar, onRemoverAdmin, onFechar,
}: {
  x: number;
  y: number;
  podeEditar: boolean;
  podeApagar: boolean;
  podeRemoverAdmin: boolean;
  onEditar: () => void;
  onApagar: () => void;
  onRemoverAdmin: () => void;
  onFechar: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onFechar();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onFechar, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onFechar, true);
    };
  }, [onFechar]);

  const itens = [
    podeEditar && { rotulo: "Editar", icone: <Pencil size={14} />, acao: onEditar, perigo: false },
    podeApagar && { rotulo: "Apagar", icone: <Trash2 size={14} />, acao: onApagar, perigo: true },
    podeRemoverAdmin && { rotulo: "Remover pela administração", icone: <ShieldX size={14} />, acao: onRemoverAdmin, perigo: true },
  ].filter(Boolean) as { rotulo: string; icone: React.ReactNode; acao: () => void; perigo: boolean }[];

  if (itens.length === 0) return null;

  const LARGURA = 240;
  const ALTURA = itens.length * 36 + 12;
  const esq = Math.min(x, (typeof window !== "undefined" ? window.innerWidth : 9999) - LARGURA - 8);
  const topo = Math.min(y, (typeof window !== "undefined" ? window.innerHeight : 9999) - ALTURA - 8);

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        position: "fixed", left: esq, top: topo, zIndex: 70, minWidth: LARGURA,
        background: "var(--mh-surface-1)", border: "1px solid var(--mh-border)",
        borderRadius: "var(--mh-radius-md)", boxShadow: "var(--mh-shadow-e2)",
        padding: "0.3rem", display: "flex", flexDirection: "column", gap: "0.05rem",
      }}
    >
      {itens.map((it) => (
        <button
          key={it.rotulo}
          type="button"
          role="menuitem"
          onClick={it.acao}
          style={{
            display: "flex", alignItems: "center", gap: "0.55rem", width: "100%",
            padding: "0.45rem 0.65rem", background: "none", border: "none",
            borderRadius: "var(--mh-radius-sm)", fontSize: "0.84rem", cursor: "pointer",
            textAlign: "left", color: it.perigo ? "var(--mh-danger)" : "var(--mh-text-1)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--mh-surface-2)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
        >
          {it.icone}
          {it.rotulo}
        </button>
      ))}
    </div>
  );
}

/**
 * O anexo da mensagem: imagem entra inline (URL assinada carregada na hora);
 * o resto vira um botão com o nome do arquivo que abre em outra aba. A URL
 * dura 10 minutos, então o clique pede outra sempre.
 */
function AnexoChat({ m }: { m: MensagemChat }) {
  const ehImagem = (m.anexoMime ?? "").startsWith("image/");
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!m.anexoPath || !ehImagem) return;
    let vivo = true;
    urlAnexoChat(m.anexoPath).then((r) => { if (vivo && r.url) setUrl(r.url); });
    return () => { vivo = false; };
  }, [m.anexoPath, ehImagem]);

  if (!m.anexoPath) return null;

  const abrirAnexo = async () => {
    if (!m.anexoPath) return;
    const r = await urlAnexoChat(m.anexoPath);
    if (r.url) window.open(r.url, "_blank", "noopener");
  };

  return (
    <div style={{ marginTop: m.body ? "0.35rem" : 0 }}>
      {ehImagem && url
        ? (
          <img
            src={url}
            alt={m.anexoNome ?? "Anexo"}
            onClick={abrirAnexo}
            style={{ maxWidth: "100%", maxHeight: 240, borderRadius: 8, cursor: "pointer", display: "block" }}
          />
        )
        : (
          <button
            type="button" className="btn btn-ghost btn-sm" onClick={abrirAnexo}
            style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center", maxWidth: "100%" }}
          >
            <Paperclip size={13} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.anexoNome ?? "Anexo"}</span>
          </button>
        )}
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

/**
 * Gestão do grupo: nome, participantes, dono e encerramento. Aparece para o
 * dono do grupo e para a administração; cada seção salva por si e o diálogo
 * fecha só pelo X ou Fechar.
 */
function GroupAdminDialog({
  conversa, pessoas, onFechar, onFeito,
}: {
  conversa: ConversaResumo;
  pessoas: { id: string; name: string }[];
  onFechar: () => void;
  onFeito: () => void;
}) {
  const [nome, setNome] = useState(conversa.name ?? "");
  const [membroIds, setMembroIds] = useState<string[]>(conversa.membros.map((m) => m.id));
  const [novoDono, setNovoDono] = useState("");
  const [encerrado, setEncerrado] = useState(Boolean(conversa.closedAt));
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [pendente, iniciar] = useTransition();

  const rodar = (fn: () => Promise<{ error?: string }>, feito: string) => {
    setErro("");
    setAviso("");
    iniciar(async () => {
      const r = await fn();
      if (r.error) { setErro(r.error); return; }
      setAviso(feito);
      onFeito();
    });
  };

  const salvarMembros = () => {
    const atuais = conversa.membros.map((m) => m.id);
    const adicionar = membroIds.filter((id) => !atuais.includes(id));
    const remover = atuais.filter((id) => !membroIds.includes(id));
    rodar(() => gerirMembros(conversa.channelId, adicionar, remover), "Participantes atualizados.");
  };

  const alternarEncerrado = async () => {
    const encerrar = !encerrado;
    const ok = await confirmDialog({
      title: encerrar ? "Encerrar grupo" : "Reabrir grupo",
      message: encerrar
        ? "Ninguém mais escreve neste grupo; o histórico continua visível. Encerrar?"
        : "O grupo volta a aceitar mensagens. Reabrir?",
      confirmLabel: encerrar ? "Encerrar" : "Reabrir",
      tone: encerrar ? "danger" : "primary",
    });
    if (!ok) return;
    rodar(async () => {
      const r = await encerrarGrupo(conversa.channelId, encerrar);
      if (!r.error) setEncerrado(encerrar);
      return r;
    }, encerrar ? "Grupo encerrado." : "Grupo reaberto.");
  };

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
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>Gerenciar grupo</h2>
          <button type="button" onClick={onFechar} className="muted" aria-label="Fechar"
            style={{ background: "none", border: "none", cursor: "pointer", lineHeight: 1, display: "flex" }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label className="label">Nome do grupo</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} style={{ flex: 1 }} />
              <button
                type="button" className="btn btn-ghost btn-sm"
                disabled={pendente || !nome.trim() || nome.trim() === (conversa.name ?? "")}
                onClick={() => rodar(() => renomearGrupo(conversa.channelId, nome), "Nome atualizado.")}
              >
                Salvar
              </button>
            </div>
          </div>

          <div>
            <label className="label">Participantes</label>
            <PeoplePicker people={pessoas} selected={membroIds} onChange={setMembroIds} />
            <button
              type="button" className="btn btn-ghost btn-sm" style={{ marginTop: "0.4rem" }}
              disabled={pendente} onClick={salvarMembros}
            >
              Salvar participantes
            </button>
          </div>

          <div>
            <label className="label">Transferir dono</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <select className="input" value={novoDono} onChange={(e) => setNovoDono(e.target.value)} style={{ flex: 1 }}>
                <option value="">Escolha o participante…</option>
                {conversa.membros.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <button
                type="button" className="btn btn-ghost btn-sm"
                disabled={pendente || !novoDono}
                onClick={() => rodar(() => transferirDono(conversa.channelId, novoDono), "Dono transferido.")}
              >
                Transferir
              </button>
            </div>
          </div>

          {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.8rem", margin: 0 }}>{erro}</p>}
          {aviso && !erro && <p style={{ color: "var(--mh-success)", fontSize: "0.8rem", margin: 0 }}>{aviso}</p>}

          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "space-between", borderTop: "1px solid var(--border)", paddingTop: "0.9rem" }}>
            <button
              type="button"
              className={encerrado ? "btn btn-primary btn-sm" : "btn btn-danger btn-sm"}
              disabled={pendente}
              onClick={alternarEncerrado}
            >
              {encerrado ? "Reabrir grupo" : "Encerrar grupo"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onFechar}>Fechar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Bloqueados no chat (só administração): lista, desbloqueio e novo bloqueio. */
function BloqueadosDialog({
  pessoas, onFechar,
}: {
  pessoas: { id: string; name: string }[];
  onFechar: () => void;
}) {
  const [bloqueados, setBloqueados] = useState<BloqueadoChat[] | null>(null);
  const [alvo, setAlvo] = useState<string[]>([]);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();

  useEffect(() => {
    let vivo = true;
    getBloqueados().then((xs) => { if (vivo) setBloqueados(xs); });
    return () => { vivo = false; };
  }, []);

  const bloquear = async () => {
    const id = alvo[0];
    if (!id) return;
    const nome = pessoas.find((p) => p.id === id)?.name ?? "esta pessoa";
    const ok = await confirmDialog({
      title: "Bloquear no chat",
      message: `${nome} continua acessando o sistema, mas perde a leitura e a escrita do chat. Bloquear?`,
      confirmLabel: "Bloquear",
      tone: "danger",
    });
    if (!ok) return;
    setErro("");
    iniciar(async () => {
      const r = await banirDoChat(id, motivo);
      if (r.error) { setErro(r.error); return; }
      setAlvo([]);
      setMotivo("");
      setBloqueados(await getBloqueados());
    });
  };

  const desbloquear = (userId: string) => {
    setErro("");
    iniciar(async () => {
      const r = await desbanirDoChat(userId);
      if (r.error) { setErro(r.error); return; }
      setBloqueados(await getBloqueados());
    });
  };

  const idsBloqueados = (bloqueados ?? []).map((b) => b.userId);

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
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>Bloqueados no chat</h2>
          <button type="button" onClick={onFechar} className="muted" aria-label="Fechar"
            style={{ background: "none", border: "none", cursor: "pointer", lineHeight: 1, display: "flex" }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          {bloqueados === null && <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>Carregando…</p>}
          {bloqueados !== null && bloqueados.length === 0 && (
            <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>Ninguém está bloqueado.</p>
          )}
          {bloqueados?.map((b) => (
            <div key={b.userId} style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <Avatar name={b.name} userId={b.userId} size={28} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: "0.85rem", fontWeight: 600 }}>{b.name}</span>
                {b.reason && <span className="soft" style={{ fontSize: "0.75rem" }}>{b.reason}</span>}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" disabled={pendente} onClick={() => desbloquear(b.userId)}>
                Desbloquear
              </button>
            </div>
          ))}

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.9rem" }}>
            <label className="label">Bloquear alguém</label>
            <PeoplePicker
              people={pessoas.filter((p) => !idsBloqueados.includes(p.id))}
              selected={alvo}
              onChange={setAlvo}
              single
            />
            <input
              className="input" style={{ marginTop: "0.4rem" }}
              placeholder="Motivo (opcional)" value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
            {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.8rem", margin: "0.4rem 0 0" }}>{erro}</p>}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem" }}>
              <button type="button" className="btn btn-danger btn-sm" disabled={pendente || alvo.length === 0} onClick={bloquear}>
                Bloquear
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onFechar}>Fechar</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Busca avançada no histórico: texto (websearch: aspas para frase, -palavra
 * exclui), autor, conversa e período. Cada um só encontra o que a RLS deixa
 * ler; clicar no resultado abre a conversa.
 */
function BuscaDialog({
  pessoas, conversas, nomePorId, rotuloPorCanal, onFechar, onAbrir,
}: {
  pessoas: { id: string; name: string }[];
  conversas: { id: string; nome: string }[];
  nomePorId: Map<string, string>;
  rotuloPorCanal: Map<string, string>;
  onFechar: () => void;
  onAbrir: (channelId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [autorId, setAutorId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [resultados, setResultados] = useState<ResultadoBusca[] | null>(null);
  const [pendente, iniciar] = useTransition();

  const buscar = () => {
    iniciar(async () => {
      setResultados(await buscarChat({
        q: q.trim(), autorId: autorId || undefined, channelId: channelId || undefined,
        de: de || undefined, ate: ate || undefined,
      }));
    });
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)",
        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "8vh 1rem", zIndex: 50, overflowY: "auto",
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 560, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>Busca no histórico</h2>
          <button type="button" onClick={onFechar} className="muted" aria-label="Fechar"
            style={{ background: "none", border: "none", cursor: "pointer", lineHeight: 1, display: "flex" }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <input
            className="input" placeholder="O que procura? Aspas buscam a frase; -palavra exclui" value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") buscar(); }}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
            <div>
              <label className="label">Quem escreveu</label>
              <select className="input" value={autorId} onChange={(e) => setAutorId(e.target.value)}>
                <option value="">Qualquer pessoa</option>
                {pessoas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Conversa</label>
              <select className="input" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                <option value="">Todas</option>
                {conversas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="label">De</label>
              <input type="date" className="input" value={de} onChange={(e) => setDe(e.target.value)} />
            </div>
            <div>
              <label className="label">Até</label>
              <input type="date" className="input" value={ate} onChange={(e) => setAte(e.target.value)} />
            </div>
          </div>
          <div>
            <button type="button" className="btn btn-primary btn-sm" disabled={pendente} onClick={buscar}>
              {pendente ? "Buscando…" : "Buscar"}
            </button>
          </div>

          {resultados !== null && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.2rem", maxHeight: 320, overflowY: "auto" }}>
              {resultados.length === 0 && (
                <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>Nada encontrado com esses filtros.</p>
              )}
              {resultados.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onAbrir(r.channelId)}
                  style={{
                    textAlign: "left", background: "none", border: "none", cursor: "pointer",
                    padding: "0.45rem 0.5rem", borderRadius: 8, borderBottom: "1px solid var(--border)",
                  }}
                >
                  <span style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", fontSize: "0.72rem" }} className="soft">
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {nomePorId.get(r.authorId) ?? "Alguém"} · {rotuloPorCanal.get(r.channelId) ?? "Conversa"}
                    </span>
                    <span style={{ flexShrink: 0 }}>{horaCurta(r.createdAt)}</span>
                  </span>
                  <span style={{ display: "block", fontSize: "0.83rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.body ?? "Anexo"}
                  </span>
                </button>
              ))}
            </div>
          )}
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
