"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Power, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { confirmDialog } from "@/components/ui/confirm";
import { normalizar, shortName } from "@/lib/format";
import {
  deleteEmailRecipient, saveEmailRecipient, setEmailRecipientActive,
} from "@/lib/actions/absenteismos";

type TipoRegra = "email" | "hierarquia" | "cargo";
type Alcance = "cadeia" | "unidade";

/** Quem uma regra alcança hoje. O e-mail não vem: só se a pessoa tem um. */
export type PessoaAlcancada = { nome: string; temEmail: boolean };

export type DestinatarioRow = {
  id: string;
  tipo: TipoRegra;
  email: string | null;
  name: string | null;
  hierarchyLevelId: string | null;
  hierarchyName: string | null;
  alcance: Alcance | null;
  positionId: string | null;
  positionName: string | null;
  unitId: string | null;
  unitName: string | null;
  active: boolean;
  pessoas: PessoaAlcancada[];
};

type Opcao = { id: string; name: string };

type Rascunho = {
  id?: string;
  tipo: TipoRegra;
  email: string;
  name: string;
  hierarchyLevelId: string;
  alcance: Alcance;
  positionId: string;
  unitId: string;
};

const vazio: Rascunho = { tipo: "email", email: "", name: "", hierarchyLevelId: "", alcance: "cadeia", positionId: "", unitId: "" };

const ROTULO_TIPO: Record<TipoRegra, string> = { email: "E-mail", hierarquia: "Hierarquia", cargo: "Cargo" };

const ROTULO_ALCANCE: Record<Alcance, string> = {
  cadeia: "Só o superior do colaborador",
  unidade: "Todos da unidade do lançamento",
};

function destinatario(d: DestinatarioRow): string {
  if (d.tipo === "hierarquia") return d.hierarchyName ?? "Hierarquia removida";
  if (d.tipo === "cargo") return d.positionName ?? "Cargo removido";
  return d.email ?? "";
}

function quemRecebe(d: DestinatarioRow): string {
  if (d.tipo === "hierarquia") return d.alcance ? ROTULO_ALCANCE[d.alcance] : "–";
  if (d.tipo === "cargo") return d.unitId ? "Quem tem o cargo na unidade" : "Todos com o cargo";
  return d.name ?? "–";
}

/** "9 no nível, 1 sem e-mail" com os nomes na dica. */
function Alcancados({ pessoas, rotulo }: { pessoas: PessoaAlcancada[]; rotulo: (n: number) => string }) {
  if (pessoas.length === 0) return <span className="soft">Ninguém hoje</span>;
  const semEmail = pessoas.filter((p) => !p.temEmail);
  const nomes = [...pessoas].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    .map((p) => `${shortName(p.nome)}${p.temEmail ? "" : " (sem e-mail)"}`);
  return (
    <span title={nomes.join("\n")} style={{ cursor: "help" }}>
      {rotulo(pessoas.length)}
      {semEmail.length > 0 && (
        <span style={{ color: "var(--mh-warning)", fontWeight: 600 }}>, {semEmail.length} sem e-mail</span>
      )}
    </span>
  );
}

/**
 * Quem recebe o comunicado de ausência.
 *
 * O gestor imediato do colaborador e quem lançou recebem SEMPRE (LUIZ,
 * 16/11/2026): é a linha fixa do topo, que não sai da lista. As regras somam
 * outras pessoas:
 *  - e-mail avulso, para quem está fora do organograma (portaria,
 *    contabilidade, a empresa que faz a folha);
 *  - hierarquia: só o superior do colaborador naquele nível (o gerente da
 *    área, e não todos) ou todos do nível na unidade do lançamento;
 *  - cargo: quem tem a função.
 * As regras são resolvidas a cada envio, pelo cadastro do momento: quem é
 * promovido entra e quem sai da empresa deixa de receber sem mexer aqui.
 */
export function AbsenteismoRecipientsManager({
  rows, gestores, hierarquias, cargos, unidades, canEdit, temChaveDeEmail,
}: {
  rows: DestinatarioRow[];
  /** os gestores imediatos de quem está ativo hoje (a linha fixa) */
  gestores: PessoaAlcancada[];
  hierarquias: Opcao[];
  cargos: Opcao[];
  unidades: Opcao[];
  canEdit: boolean;
  /** integração de e-mail configurada na plataforma */
  temChaveDeEmail: boolean;
}) {
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const lista = useMemo(() => {
    const q = normalizar(busca.trim());
    if (!q) return rows;
    return rows.filter((r) =>
      [r.email, r.name, r.hierarchyName, r.positionName, r.unitName, ROTULO_TIPO[r.tipo]]
        .some((v) => v && normalizar(v).includes(q)));
  }, [rows, busca]);

  const salvar = () => {
    if (!rascunho) return;
    setErro("");
    iniciar(async () => {
      const r = await saveEmailRecipient({ ...rascunho });
      if (r.error) { setErro(r.error); return; }
      setRascunho(null);
    });
  };

  const excluir = async (d: DestinatarioRow) => {
    const ok = await confirmDialog({
      title: "Remover da lista",
      tone: "danger",
      confirmLabel: "Remover",
      message: d.tipo === "email"
        ? `Remover ${d.email} da lista? Ele deixa de receber os comunicados de ausência.`
        : `Remover a regra "${ROTULO_TIPO[d.tipo]}: ${destinatario(d)}"? Quem ela alcança deixa de receber os comunicados de ausência (os gestores continuam recebendo).`,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("id", d.id);
    iniciar(async () => { await deleteEmailRecipient(fd); router.refresh(); });
  };

  const alternar = (d: DestinatarioRow) => {
    const fd = new FormData();
    fd.set("id", d.id);
    fd.set("active", d.active ? "0" : "1");
    iniciar(async () => { await setEmailRecipientActive(fd); router.refresh(); });
  };

  const editar = (d: DestinatarioRow) => {
    setErro("");
    setRascunho({
      id: d.id, tipo: d.tipo, email: d.email ?? "", name: d.name ?? "",
      hierarchyLevelId: d.hierarchyLevelId ?? "", alcance: d.alcance ?? "cadeia",
      positionId: d.positionId ?? "", unitId: d.unitId ?? "",
    });
  };

  const muda = (campos: Partial<Rascunho>) => setRascunho((r) => (r ? { ...r, ...campos } : r));

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: "0 0 0.2rem" }}>Comunicado por e-mail</h3>
        <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
          Quem é avisado assim que um gestor lança uma ausência, e depois quando o motivo é
          confirmado e quando o DP decide. O gestor imediato do colaborador e quem lançou recebem
          sempre. As regras abaixo acrescentam outras pessoas por e-mail, por hierarquia ou por
          cargo, e são conferidas a cada envio pelo cadastro do momento. Com unidade, a regra vale
          só para os lançamentos daquela unidade. Dados do atestado nunca vão por e-mail.
        </p>
      </div>

      {!temChaveDeEmail && (
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--mh-warning)", background: "var(--mh-warning-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
          A integração de e-mail ainda não foi configurada na plataforma, então nenhum comunicado
          será enviado. Os lançamentos continuam sendo registrados normalmente.
        </p>
      )}

      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input" placeholder="Buscar por e-mail, nome, hierarquia, cargo ou unidade…"
          value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 360 }}
        />
        {canEdit && (
          <button
            type="button" className="btn btn-primary btn-sm" style={{ marginLeft: "auto" }}
            onClick={() => { setErro(""); setRascunho({ ...vazio }); }}
          >
            + Nova regra
          </button>
        )}
      </div>

      {rascunho && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--mh-radius-lg)", background: "var(--surface-2)", padding: "0.9rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
          <div>
            <span className="label">Quem recebe</span>
            <div style={{ display: "flex", gap: "1.2rem", flexWrap: "wrap" }}>
              {([
                ["email", "Um e-mail"],
                ["hierarquia", "Uma hierarquia"],
                ["cargo", "Um cargo"],
              ] as [TipoRegra, string][]).map(([v, r]) => (
                <label key={v} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.84rem", cursor: "pointer" }}>
                  <input
                    type="radio" name="tipo-regra" value={v}
                    checked={rascunho.tipo === v} onChange={() => { setErro(""); muda({ tipo: v }); }}
                  />
                  {r}
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0.8rem" }}>
            {rascunho.tipo === "email" && (
              <>
                <div style={{ gridColumn: "span 2", minWidth: 0 }}>
                  <label className="label">E-mail <span style={{ color: "var(--mh-danger)" }}>*</span></label>
                  <input
                    className="input" type="email" value={rascunho.email} placeholder="rh@empresa.com.br"
                    onChange={(e) => muda({ email: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Nome</label>
                  <input
                    className="input" value={rascunho.name} placeholder="Departamento pessoal"
                    onChange={(e) => muda({ name: e.target.value })}
                  />
                </div>
              </>
            )}
            {rascunho.tipo === "hierarquia" && (
              <div>
                <label className="label">Hierarquia <span style={{ color: "var(--mh-danger)" }}>*</span></label>
                <select
                  className="select" value={rascunho.hierarchyLevelId}
                  onChange={(e) => muda({ hierarchyLevelId: e.target.value })}
                >
                  {!rascunho.hierarchyLevelId && <option value="" disabled>Selecione…</option>}
                  {hierarquias.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
            )}
            {rascunho.tipo === "cargo" && (
              <div style={{ gridColumn: "span 2", minWidth: 0 }}>
                <label className="label">Cargo <span style={{ color: "var(--mh-danger)" }}>*</span></label>
                <select
                  className="select" value={rascunho.positionId}
                  onChange={(e) => muda({ positionId: e.target.value })}
                >
                  {!rascunho.positionId && <option value="" disabled>Selecione…</option>}
                  {cargos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="label">Vale para os lançamentos de</label>
              <select
                className="select" value={rascunho.unitId}
                onChange={(e) => muda({ unitId: e.target.value })}
              >
                <option value="">Todas as unidades</option>
                {unidades.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>

          {rascunho.tipo === "hierarquia" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <span className="label" style={{ margin: 0 }}>Quem dessa hierarquia recebe</span>
              {([
                ["cadeia", "Só o superior do colaborador nesse nível (ex.: o gerente da área dele, e não todos os gerentes)"],
                ["unidade", "Todos desse nível na unidade do lançamento"],
              ] as [Alcance, string][]).map(([v, r]) => (
                <label key={v} style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.84rem", cursor: "pointer" }}>
                  <input
                    type="radio" name="alcance-regra" value={v}
                    checked={rascunho.alcance === v} onChange={() => muda({ alcance: v })}
                  />
                  {r}
                </label>
              ))}
            </div>
          )}
          {rascunho.tipo === "cargo" && (
            <p className="soft" style={{ fontSize: "0.76rem", margin: 0 }}>
              Recebem todos os ativos com esse cargo. Com unidade, só os daquela unidade.
            </p>
          )}

          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={pendente} onClick={salvar}>
              {pendente ? "Salvando…" : "Salvar"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRascunho(null)}>Cancelar</button>
            {erro && <span style={{ color: "var(--mh-danger)", fontSize: "0.8rem" }}>{erro}</span>}
          </div>
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 110 }}>Tipo</th>
              <th>Destinatário</th>
              <th>Quem recebe</th>
              <th style={{ width: 130 }}>Unidade</th>
              <th style={{ width: 170 }}>Hoje</th>
              <th style={{ width: 100 }}>Situação</th>
              {canEdit && <th style={{ textAlign: "right" }}></th>}
            </tr>
          </thead>
          <tbody>
            {/* fixa: não é regra, não se edita nem se remove */}
            <tr>
              <td><Badge variant="quiet">Sempre</Badge></td>
              <td style={{ fontWeight: 600 }}>Gestor imediato e quem lançou</td>
              <td className="muted">O gestor do cadastro, o do lançamento e quem lançou</td>
              <td className="muted">Todas</td>
              <td className="muted"><Alcancados pessoas={gestores} rotulo={(n) => `${n} gestor${n === 1 ? "" : "es"}`} /></td>
              <td><Badge variant="quiet" tone="green">Ativo</Badge></td>
              {canEdit && <td></td>}
            </tr>
            {lista.map((d) => (
              <tr key={d.id} style={{ opacity: d.active ? 1 : 0.6 }}>
                <td><Badge variant="quiet">{ROTULO_TIPO[d.tipo]}</Badge></td>
                <td style={{ fontWeight: 600 }}>{destinatario(d)}</td>
                <td className="muted">{quemRecebe(d)}</td>
                <td className="muted">{d.unitName ?? "Todas"}</td>
                <td className="muted">
                  {d.tipo === "email"
                    ? "–"
                    : <Alcancados
                        pessoas={d.pessoas}
                        rotulo={(n) => d.alcance === "cadeia" ? `${n} no nível` : `${n} pessoa${n === 1 ? "" : "s"}`}
                      />}
                </td>
                <td><Badge variant="quiet" tone={d.active ? "green" : "gray"}>{d.active ? "Ativo" : "Inativo"}</Badge></td>
                {canEdit && (
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-flex", gap: "0.3rem" }}>
                      <button type="button" className="icon-btn" title="Editar" onClick={() => editar(d)}>
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button" className="icon-btn" disabled={pendente}
                        title={d.active ? "Desativar" : "Reativar"} onClick={() => alternar(d)}
                      >
                        {d.active ? <Power size={15} /> : <RotateCcw size={15} />}
                      </button>
                      <button type="button" className="icon-btn icon-btn-danger" title="Remover" disabled={pendente} onClick={() => excluir(d)}>
                        <Trash2 size={15} />
                      </button>
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && lista.length === 0 && (
        <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>Nenhuma regra encontrada para a busca.</p>
      )}
      <p className="soft" style={{ fontSize: "0.75rem", margin: 0 }}>
        Em &quot;Hoje&quot;, passe o mouse para ver os nomes. Na hierarquia &quot;só o superior&quot;, o número é de
        quem tem o nível; cada comunicado vai só para o superior daquele colaborador.
      </p>
    </div>
  );
}
