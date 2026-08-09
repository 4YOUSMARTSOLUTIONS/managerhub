"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { EffStatusBadge } from "@/components/ui/EffStatusBadge";
import { Dropdown, ItemDeMenu } from "@/components/ui/Dropdown";
import { GripVertical } from "lucide-react";
import { DemandaPanel, type DemandaInfo } from "@/components/DemandaPanel";
import { demandaSetStatus, demandaAssigneeSubmit } from "@/lib/actions/actions";
import { effStatus, type EffStatus } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import type { Enums } from "@/types/database";

/**
 * As MINHAS ações em formato kanban.
 *
 * O cartão é a demanda, e as colunas são o vocabulário que a tela de Ações já
 * usa (effStatus) — não o enum cru do banco. Duas colunas são DERIVADAS e por
 * isso não recebem cartão:
 *
 *   * Atrasada    = prazo vencido; sai daqui resolvendo o prazo, não arrastando.
 *   * Aguardando  = entrega enviada, esperando o solicitante; a bola não é minha.
 *
 * Soltar em "Concluída" NÃO conclui: registra a MINHA entrega, que vai para
 * aprovação (o fluxo de sempre, `demanda_assignee_submit`). O cartão reaparece
 * em Aguardando, e o toast explica, senão parece bug. Nada aqui contorna as
 * regras do banco: os drops chamam as mesmas RPCs do painel de tratamento.
 */

export type AcaoCard = {
  demanda: DemandaInfo;
  requesterId: string | null;
  /** algum responsável enviou entrega ainda sem decisão */
  pending: boolean;
};

type Pessoa = { id: string; name: string };

/** as colunas do board, na ordem do fluxo. `grava` = o que o drop faz. */
const COLUNAS: { key: EffStatus | "a_fazer" | "em_andamento" | "bloqueada"; titulo: string; grava: Enums<"action_status"> | "entrega" | null }[] = [
  { key: "a_fazer", titulo: "A fazer", grava: "open" },
  { key: "em_andamento", titulo: "Em andamento", grava: "in_progress" },
  { key: "bloqueada", titulo: "Bloqueada", grava: "blocked" },
  { key: "atrasada", titulo: "Atrasada", grava: null },
  { key: "aguardando", titulo: "Aguardando aprovação", grava: null },
  { key: "concluida", titulo: "Concluída", grava: "entrega" },
];

const hojeIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** em qual coluna o cartão mora, a partir do estado real da demanda */
function colunaDe(status: Enums<"action_status">, dueDate: string | null, pending: boolean, hoje: string): (typeof COLUNAS)[number]["key"] {
  const overdue = !!dueDate && dueDate < hoje;
  const eff = effStatus(status, overdue, pending);
  if (eff === "concluida") return "concluida";
  if (eff === "cancelada") return "concluida"; // canceladas não são carregadas; guarda-chuva
  if (eff === "aguardando") return "aguardando";
  if (eff === "atrasada") return "atrasada";
  if (status === "open") return "a_fazer";
  if (status === "blocked") return "bloqueada";
  return "em_andamento";
}

export function ActionsBoard({
  cards, currentUserId, isAdmin, people,
}: {
  cards: AcaoCard[];
  currentUserId: string;
  isAdmin: boolean;
  people: Pessoa[];
}) {
  const router = useRouter();
  const [, iniciar] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const [selected, setSelected] = useState<AcaoCard | null>(null);
  // status otimista por demanda: o cartão muda de coluna no clique/solto, e o
  // refresh confirma (ou o erro reverte)
  const [override, setOverride] = useState<Map<string, Enums<"action_status">>>(new Map());
  useEffect(() => setOverride(new Map()), [cards]);

  const hoje = hojeIso();

  const porColuna = useMemo(() => {
    const m = new Map<string, AcaoCard[]>();
    for (const c of COLUNAS) m.set(c.key, []);
    for (const card of cards) {
      const status = override.get(card.demanda.id) ?? card.demanda.status;
      // entrega otimista: se acabei de enviar, pending vale true localmente
      const pend = card.pending;
      m.get(colunaDe(status, card.demanda.dueDate, pend, hoje))?.push(card);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => (a.demanda.dueDate ?? "9999").localeCompare(b.demanda.dueDate ?? "9999"));
    }
    return m;
  }, [cards, override, hoje]);

  function soltarEm(coluna: (typeof COLUNAS)[number]) {
    const id = dragId;
    setDragId(null);
    setAlvo(null);
    if (!id || !coluna.grava) return;
    const card = cards.find((c) => c.demanda.id === id);
    if (!card) return;

    if (coluna.grava === "entrega") {
      iniciar(async () => {
        const res = await demandaAssigneeSubmit(id);
        if (res?.error) { toast.error(res.error); return; }
        toast.success("Entrega registrada. A ação vai para aprovação do solicitante.");
        router.refresh();
      });
      return;
    }

    const status = coluna.grava;
    const antes = override;
    setOverride((m) => new Map(m).set(id, status));
    iniciar(async () => {
      const res = await demandaSetStatus(id, status);
      if (res?.error) { setOverride(antes); toast.error(res.error); return; }
      router.refresh();
    });
  }

  if (cards.length === 0) {
    return (
      <EmptyState
        title="Nenhuma ação sua em aberto"
        description="Aparecem aqui as demandas atribuídas formalmente a você. Ações antigas importadas por planilha, sem vínculo formal de responsável, ficam só na tela de Ações."
      />
    );
  }

  return (
    <>
      <div style={{ display: "flex", gap: "0.9rem", alignItems: "flex-start", overflowX: "auto", paddingBottom: "0.75rem" }}>
        {COLUNAS.map((col) => {
          const doCol = porColuna.get(col.key) ?? [];
          const aceita = !!col.grava && !!dragId;
          return (
            <div
              key={col.key}
              style={{
                minWidth: 272, width: 272, flexShrink: 0,
                background: "var(--mh-surface-2)", borderRadius: "var(--mh-radius-lg)",
                border: `1px solid ${alvo === col.key && aceita ? "var(--mh-primary-500)" : "var(--border)"}`,
                padding: "0.6rem", display: "flex", flexDirection: "column", gap: "0.5rem",
                opacity: dragId && !col.grava ? 0.55 : 1,
              }}
              onDragOver={(e) => {
                if (!aceita) return; // coluna derivada: sem preventDefault, o drop é negado
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setAlvo(col.key);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node) && alvo === col.key) setAlvo(null);
              }}
              onDrop={(e) => { e.preventDefault(); soltarEm(col); }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0 0.2rem" }}>
                <strong style={{ fontSize: "0.86rem", flex: 1 }}>{col.titulo}</strong>
                <span className="soft" style={{ fontSize: "0.75rem" }}>{doCol.length}</span>
              </div>
              {!col.grava && (
                <p className="soft" style={{ fontSize: "0.7rem", margin: "0 0.2rem", lineHeight: 1.4 }}>
                  {col.key === "atrasada" ? "Coluna automática: prazo vencido." : "Coluna automática: entrega enviada, aguardando o solicitante."}
                </p>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem", minHeight: 8 }}>
                {doCol.map((card) => {
                  const status = override.get(card.demanda.id) ?? card.demanda.status;
                  const overdue = !!card.demanda.dueDate && card.demanda.dueDate < hoje && status !== "done" && status !== "cancelled";
                  const eff = effStatus(status, overdue, card.pending);
                  const finalizada = status === "done" || status === "cancelled";
                  return (
                    <div
                      key={card.demanda.id}
                      draggable={!finalizada}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", card.demanda.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragId(card.demanda.id);
                      }}
                      onDragEnd={() => { setDragId(null); setAlvo(null); }}
                      className="card"
                      style={{
                        padding: "0.6rem 0.65rem",
                        cursor: finalizada ? "pointer" : "grab",
                        opacity: dragId === card.demanda.id ? 0.4 : 1,
                        display: "flex", flexDirection: "column", gap: "0.4rem",
                      }}
                      onClick={() => setSelected(card)}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.4rem" }}>
                        <span className="soft" style={{ fontSize: "0.74rem", fontWeight: 700, flexShrink: 0 }}>{card.demanda.label}</span>
                        <span style={{ fontSize: "0.84rem", fontWeight: 600, lineHeight: 1.35, flex: 1, minWidth: 0 }}>
                          {card.demanda.description}
                        </span>
                        {!finalizada && (
                          <span onClick={(e) => e.stopPropagation()}>
                            <Dropdown rotulo="" icone={<GripVertical size={14} />} largura={220} alinharDireita>
                              {(fechar) => (
                                <>
                                  <div className="soft" style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", padding: "0.25rem 0.6rem" }}>Mover para</div>
                                  {COLUNAS.filter((c) => c.grava && c.key !== col.key).map((c) => (
                                    <ItemDeMenu key={c.key} onClick={() => { fechar(); setDragId(null); const grava = c; const id = card.demanda.id; setAlvo(null);
                                      // mesmo caminho do drop
                                      if (grava.grava === "entrega") {
                                        iniciar(async () => {
                                          const res = await demandaAssigneeSubmit(id);
                                          if (res?.error) { toast.error(res.error); return; }
                                          toast.success("Entrega registrada. A ação vai para aprovação do solicitante.");
                                          router.refresh();
                                        });
                                      } else if (grava.grava) {
                                        const status2 = grava.grava;
                                        setOverride((m) => new Map(m).set(id, status2));
                                        iniciar(async () => {
                                          const res = await demandaSetStatus(id, status2);
                                          if (res?.error) { setOverride(new Map(override)); toast.error(res.error); return; }
                                          router.refresh();
                                        });
                                      }
                                    }}>{c.titulo === "Concluída" ? "Concluída (envia p/ aprovação)" : c.titulo}</ItemDeMenu>
                                  ))}
                                </>
                              )}
                            </Dropdown>
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                        <EffStatusBadge eff={eff} overdue={overdue} />
                        {card.demanda.dueDate && (
                          <span className={overdue ? undefined : "muted"} style={{ fontSize: "0.74rem", color: overdue ? "var(--mh-danger)" : undefined, fontWeight: overdue ? 600 : undefined }}>
                            {formatDate(card.demanda.dueDate)}
                          </span>
                        )}
                        {card.demanda.assigneeIds.length > 1 && (
                          <span style={{ display: "inline-flex", gap: 2, marginLeft: "auto" }}>
                            {card.demanda.assigneeIds.slice(0, 3).map((id, i) => (
                              <Avatar key={id} name={card.demanda.assigneeNames[i] ?? ""} userId={id} size={20} />
                            ))}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* o mesmo painel de tratamento da tela de Ações: clicar no cartão abre a
          ficha completa, com pedidos, conclusão por pessoa e timeline */}
      <DemandaPanel
        open={!!selected}
        onClose={() => setSelected(null)}
        demanda={selected?.demanda ?? null}
        requesterId={selected?.requesterId ?? null}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
        people={people}
      />
    </>
  );
}
