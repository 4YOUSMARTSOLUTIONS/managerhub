"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { ExportButton } from "@/components/ui/ExportButton";
import { confirmDialog } from "@/components/ui/confirm";
import { DetailModal } from "@/components/ui/DetailModal";
import { DetailSection, Field, FieldGrid } from "@/components/ui/Field";
import type { Person } from "@/components/PeoplePicker";
import {
  SegBlitzDialog, type BlitzMeioOpt, type BlitzPerguntaOpt, type VeiculoSugestao,
} from "@/components/SegBlitzDialog";
import { SegBlitzTratativas } from "@/components/SegBlitzTratativas";
import type { BlitzAlerta } from "@/lib/actions/seguranca";
import { SEG_BLITZ_RESPOSTA, SEG_VEICULO_PROPRIEDADE } from "@/lib/constants";
import { normalizar, shortName } from "@/lib/format";
import { excluirBlitz } from "@/lib/actions/seguranca";
import type { Enums } from "@/types/database";

export type BlitzRow = {
  id: string;
  occurredOn: string;
  userId: string;
  pessoa: string | null;
  setor: string | null;
  gestor: string | null;
  unidade: string | null;
  meioId: string;
  placa: string | null;
  veiculoTipo: string | null;
  propriedade: Enums<"seg_veiculo_propriedade"> | null;
  liberado: boolean;
  motivoNome: string | null;
  observacao: string | null;
  conforme: boolean;
  avaliador: string | null;
  respostas: { pergunta: string; resposta: Enums<"seg_blitz_resposta"> }[];
};

export type BlitzPainel = {
  total: number;
  conformes: number;
  com_desvio: number;
  bloqueios: number;
  colaboradores: number;
  alertas: { enviados: number; com_tratativa: number };
  /** vazia para quem não tem alçada; recortada pela cadeia para team_lead */
  recorrencia: { user_id: string; nome: string | null; setor: string | null; nao_conformes: number; total: number }[];
};

function dataBr(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/**
 * A situação da blitz em três estados: cor só aqui (DESIGN.md).
 *   Conforme            liberado, tudo sim.
 *   Liberado com desvio liberado apesar de alguma resposta "não": passou, mas
 *                       vira ocorrência para o gestor mesmo assim.
 *   Bloqueado           não passou.
 */
function situacao(r: BlitzRow): { label: string; tone: "green" | "amber" | "red" } {
  if (!r.liberado) return { label: "Bloqueado", tone: "red" };
  if (!r.conforme) return { label: "Liberado com desvio", tone: "amber" };
  return { label: "Conforme", tone: "green" };
}

export function SegBlitzManager({
  rows, podeAvaliar, ehProprietario, pessoas, meios, perguntas, motivos, veiculos, painel, alertas,
}: {
  rows: BlitzRow[];
  podeAvaliar: boolean;
  ehProprietario: boolean;
  pessoas: Person[];
  meios: BlitzMeioOpt[];
  perguntas: BlitzPerguntaOpt[];
  motivos: { id: string; name: string; active: boolean }[];
  veiculos: VeiculoSugestao[];
  painel: BlitzPainel | null;
  /** os alertas do usuário logado como gestor */
  alertas: BlitzAlerta[];
}) {
  const [novo, setNovo] = useState(false);
  const [busca, setBusca] = useState("");
  const [meio, setMeio] = useState("");
  const [sit, setSit] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const nomeMeio = useMemo(() => new Map(meios.map((m) => [m.id, m.name])), [meios]);

  const lista = useMemo(() => {
    const q = normalizar(busca.trim());
    return rows.filter((r) => {
      if (meio && r.meioId !== meio) return false;
      if (sit === "conforme" && !(r.liberado && r.conforme)) return false;
      if (sit === "desvio" && !(r.liberado && !r.conforme)) return false;
      if (sit === "bloqueado" && r.liberado) return false;
      if (!q) return true;
      return [r.pessoa, r.setor, r.placa, r.avaliador, r.motivoNome]
        .some((v) => v && normalizar(v).includes(q));
    });
  }, [rows, busca, meio, sit]);

  const detalhe = aberto ? rows.find((r) => r.id === aberto) ?? null : null;

  const excluir = () => {
    if (!detalhe) return;
    void (async () => {
      const ok = await confirmDialog({
        title: "Excluir a blitz?",
        message: `O registro de ${shortName(detalhe.pessoa)} em ${dataBr(detalhe.occurredOn)} sai da base e da recorrência. A exclusão fica nos Logs do sistema.`,
        confirmLabel: "Excluir",
        tone: "danger",
      });
      if (!ok) return;
      iniciar(async () => {
        const r = await excluirBlitz(detalhe.id);
        if (r.error) { toast.error(r.error); return; }
        toast.success(r.message ?? "Blitz excluída.");
        setAberto(null);
        router.refresh();
      });
    })();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
      <PageHeader
        title="Blitz de trajeto"
        subtitle={
          podeAvaliar
            ? "O deslocamento seguro conferido na porta: veículo, equipamentos e boas práticas, em qualquer meio de transporte."
            : "As blitzes pelas quais você passou e no que deu cada uma."
        }
        action={
          podeAvaliar ? (
            <button type="button" className="btn btn-primary" onClick={() => setNovo(true)}>
              <Plus size={15} /> Nova blitz
            </button>
          ) : undefined
        }
      />

      <SegBlitzTratativas alertas={alertas} />

      {painel && painel.total > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0.8rem" }}>
          <StatCard label="Blitzes no ano" value={painel.total} hint={`${painel.colaboradores} colaborador(es) abordado(s)`} />
          <StatCard
            label="Conformidade"
            value={`${Math.round((painel.conformes / painel.total) * 100)}%`}
            tone={painel.conformes / painel.total >= 0.8 ? "green" : painel.conformes / painel.total >= 0.5 ? "amber" : "red"}
            hint={`${painel.conformes} de ${painel.total} conformes`}
          />
          <StatCard label="Liberadas com desvio" value={painel.com_desvio} tone="amber" />
          <StatCard label="Bloqueios" value={painel.bloqueios} tone={painel.bloqueios > 0 ? "red" : "green"} />
          {painel.alertas.enviados > 0 && (
            <StatCard
              label="Alertas com tratativa"
              value={`${Math.round((painel.alertas.com_tratativa / painel.alertas.enviados) * 100)}%`}
              tone={
                painel.alertas.com_tratativa / painel.alertas.enviados >= 0.8 ? "green"
                  : painel.alertas.com_tratativa / painel.alertas.enviados >= 0.5 ? "amber" : "red"
              }
              hint={`${painel.alertas.com_tratativa} de ${painel.alertas.enviados} gestores registraram`}
            />
          )}
        </div>
      )}

      {/* o indicador pedido: quem repete o "não OK", para o acompanhamento sair
          da memória e virar conversa. team_lead recebe só a própria cadeia. */}
      {painel && painel.recorrencia.length > 0 && (
        <div className="card card-pad">
          <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 0.2rem" }}>Recorrência de não conformidade</h3>
          <p className="soft" style={{ fontSize: "0.76rem", margin: "0 0 0.7rem" }}>
            Quantas vezes cada colaborador saiu não conforme no ano. Recorrência é conversa de
            gestor, não de multa.
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th style={{ width: 160 }}>Setor</th>
                <th style={{ width: 130, textAlign: "right" }}>Não conformes</th>
                <th style={{ width: 110, textAlign: "right" }}>Blitzes</th>
              </tr>
            </thead>
            <tbody>
              {painel.recorrencia.map((r) => (
                <tr key={r.user_id}>
                  <td style={{ fontWeight: 600 }}>{shortName(r.nome)}</td>
                  <td className="muted" style={{ fontSize: "0.82rem" }}>{r.setor ?? "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <Badge tone={r.nao_conformes >= 3 ? "red" : "amber"}>{r.nao_conformes}</Badge>
                  </td>
                  <td className="muted" style={{ textAlign: "right", fontSize: "0.82rem" }}>{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input" placeholder="Buscar por pessoa, placa, setor ou avaliador…"
          value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 320 }}
        />
        <select className="select" value={meio} onChange={(e) => setMeio(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">Todos os meios</option>
          {meios.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select className="select" value={sit} onChange={(e) => setSit(e.target.value)} style={{ maxWidth: 190 }}>
          <option value="">Todas as situações</option>
          <option value="conforme">Conforme</option>
          <option value="desvio">Liberado com desvio</option>
          <option value="bloqueado">Bloqueado</option>
        </select>
        <div style={{ marginLeft: "auto" }}>
          <ExportButton
            filename="blitz-de-trajeto.xlsx"
            sheetName="Blitz"
            headers={[
              "Data", "Colaborador", "Setor", "Gestor", "Unidade", "Meio", "Placa", "Tipo",
              "Propriedade", "Situação", "Motivo do bloqueio", "Observação", "Avaliador",
            ]}
            rows={lista.map((r) => [
              dataBr(r.occurredOn), r.pessoa ?? "", r.setor ?? "", r.gestor ?? "", r.unidade ?? "",
              nomeMeio.get(r.meioId) ?? "", r.placa ?? "", r.veiculoTipo ?? "",
              r.propriedade ? SEG_VEICULO_PROPRIEDADE[r.propriedade] : "",
              situacao(r).label, r.motivoNome ?? "", r.observacao ?? "", r.avaliador ?? "",
            ])}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Nenhuma blitz registrada"
          description={
            podeAvaliar
              ? "No dia da blitz, cada colaborador abordado vira um registro aqui, com as respostas e a decisão."
              : "Quando você passar por uma blitz, o registro aparece aqui."
          }
        />
      ) : lista.length === 0 ? (
        <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>Nenhuma blitz com esses filtros.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 100 }}>Data</th>
              <th>Colaborador</th>
              <th style={{ width: 140 }}>Setor</th>
              <th style={{ width: 150 }}>Meio</th>
              <th style={{ width: 100 }}>Placa</th>
              <th style={{ width: 150 }}>Avaliador</th>
              <th style={{ width: 160 }}>Situação</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((r) => {
              const s = situacao(r);
              return (
                <tr key={r.id} onClick={() => setAberto(r.id)} style={{ cursor: "pointer" }} title="Abrir a blitz">
                  <td>{dataBr(r.occurredOn)}</td>
                  <td style={{ fontWeight: 600 }}>{shortName(r.pessoa)}</td>
                  <td className="muted" style={{ fontSize: "0.82rem" }}>{r.setor ?? "—"}</td>
                  <td>
                    <Badge variant="quiet" tone="blue">{nomeMeio.get(r.meioId) ?? "—"}</Badge>
                  </td>
                  <td className="mono" style={{ fontSize: "0.8rem" }}>{r.placa ?? "—"}</td>
                  <td className="muted" style={{ fontSize: "0.82rem" }}>{shortName(r.avaliador)}</td>
                  <td><Badge tone={s.tone}>{s.label}</Badge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {detalhe && (
        <DetailModal
          open onClose={() => setAberto(null)} width="md"
          title={`${shortName(detalhe.pessoa)} · ${dataBr(detalhe.occurredOn)}`}
          badges={
            <>
              <Badge tone={situacao(detalhe).tone}>{situacao(detalhe).label}</Badge>
              <Badge variant="quiet" tone="blue">{nomeMeio.get(detalhe.meioId) ?? "—"}</Badge>
            </>
          }
          footer={
            <>
              {ehProprietario ? (
                <button
                  type="button" className="btn btn-ghost btn-sm" disabled={pendente}
                  style={{ color: "var(--mh-danger)" }} onClick={excluir}
                >
                  <Trash2 size={14} /> Excluir
                </button>
              ) : <span />}
              <button type="button" className="btn btn-ghost" onClick={() => setAberto(null)}>Fechar</button>
            </>
          }
        >
          {!detalhe.liberado && (
            <p style={{ margin: 0, fontSize: "0.88rem" }}>
              Bloqueado: <strong>{detalhe.motivoNome ?? "sem motivo registrado"}</strong>
            </p>
          )}
          {detalhe.observacao && (
            <p className="soft" style={{ margin: 0, fontSize: "0.83rem", whiteSpace: "pre-wrap" }}>{detalhe.observacao}</p>
          )}

          <DetailSection title="Colaborador">
            <FieldGrid>
              <Field label="Setor">{detalhe.setor}</Field>
              <Field label="Gestor">{detalhe.gestor ? shortName(detalhe.gestor) : null}</Field>
              <Field label="Unidade">{detalhe.unidade}</Field>
              <Field label="Avaliador">{detalhe.avaliador ? shortName(detalhe.avaliador) : null}</Field>
            </FieldGrid>
          </DetailSection>

          {detalhe.placa && (
            <DetailSection title="Veículo">
              <FieldGrid>
                <Field label="Placa">{detalhe.placa}</Field>
                <Field label="Tipo">{detalhe.veiculoTipo}</Field>
                <Field label="Propriedade">{detalhe.propriedade ? SEG_VEICULO_PROPRIEDADE[detalhe.propriedade] : null}</Field>
              </FieldGrid>
            </DetailSection>
          )}

          <DetailSection title="Verificação">
            {detalhe.respostas.length === 0 ? (
              <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>Sem perguntas nesta blitz.</p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {detalhe.respostas.map((x, i) => (
                  <li
                    key={i}
                    style={{
                      display: "flex", gap: "0.7rem", alignItems: "center", justifyContent: "space-between",
                      background: "var(--surface-2)", borderRadius: "var(--mh-radius-md)",
                      padding: "0.45rem 0.7rem", flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontSize: "0.82rem", flex: "1 1 260px" }}>{x.pergunta}</span>
                    <Badge
                      variant={x.resposta === "nao" ? "tint" : "quiet"}
                      tone={x.resposta === "sim" ? "green" : x.resposta === "nao" ? "red" : "gray"}
                    >
                      {SEG_BLITZ_RESPOSTA[x.resposta]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            <p className="soft" style={{ fontSize: "0.72rem", margin: "0.4rem 0 0" }}>
              As perguntas são as da época da blitz; mudanças no cadastro não reescrevem o histórico.
            </p>
          </DetailSection>
        </DetailModal>
      )}

      <SegBlitzDialog
        open={novo} onClose={() => setNovo(false)}
        pessoas={pessoas} meios={meios} perguntas={perguntas} motivos={motivos} veiculos={veiculos}
      />
    </div>
  );
}
