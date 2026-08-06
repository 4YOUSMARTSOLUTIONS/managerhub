"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SearchSelect } from "@/components/SearchSelect";
import { formatDateTime } from "@/lib/format";
import type { Tone } from "@/lib/constants";

/** Filtros vivem na URL, então a página é compartilhável e o voltar do navegador funciona. */
export type AuditFilters = { q: string; acao: string; tipo: string; autor: string };

export type AuditRow = {
  id: number;
  createdAt: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityLabel: string | null;
  entityId: string | null;
  changes: Record<string, unknown> | null;
};

const ENTITY_LABEL: Record<string, string> = {
  rooms: "Sala", meetings: "Reunião", meeting_series: "Reunião (TOR)",
  action_items: "Ação", actions: "Ação", tickets: "Chamado",
  goals: "Meta", area_goals: "Meta da área", individual_goals: "Meta individual",
  memberships: "Membro", departments: "Setor", subdepartments: "Subsetor",
  positions: "Função", position_levels: "Perfil de função", units: "Unidade",
  ticket_sectors: "Setor de chamado", ticket_categories: "Categoria de chamado",
  ticket_slas: "SLA de chamado", ticket_manager_sectors: "Gestor de chamado",
  sdpo_programas: "Programa", sdpo_pilares: "Pilar", sdpo_secoes: "Seção",
  sdpo_blocos: "Bloco", sdpo_itens: "Item", action_kpis: "KPI", action_tools: "Ferramenta de gestão",
  pnr_categories: "Categoria PNR", pnr_kpis: "KPI PNR", sustainability_kpis: "KPI de sustentabilidade",
  feedback_competencies: "Competência de feedback", feedback_cadence_rules: "Cadência de feedback",
  holidays: "Feriado", individual_rv_config: "Remuneração variável",
};

const ACTION_LABEL: Record<string, { label: string; tone: Tone }> = {
  INSERT: { label: "Criou", tone: "green" },
  UPDATE: { label: "Alterou", tone: "amber" },
  DELETE: { label: "Removeu", tone: "red" },
};

const FIELD_LABEL: Record<string, string> = {
  name: "Nome", title: "Título", full_name: "Nome", code: "Código", label: "Rótulo",
  description: "Descrição", is_active: "Status", active: "Status", capacity: "Capacidade",
  location: "Localização", color: "Cor", resources: "Recursos", priority: "Prioridade",
  requested_priority: "Prioridade solicitada", status: "Status", due_date: "Prazo",
  sla_value: "SLA (valor)", sla_unit: "SLA (unidade)", sector_id: "Setor", category_id: "Categoria",
  department_id: "Setor", subdepartment_id: "Subsetor", position_id: "Função", position_level_id: "Perfil",
  unit_id: "Unidade", programa_id: "Programa", pilar_id: "Pilar", secao_id: "Seção", bloco_id: "Bloco",
  item_id: "Item", assignee_id: "Responsável", requester_id: "Solicitante", owner_id: "Responsável",
  role: "Perfil", is_ticket_manager: "Gestor de chamados", ticket_sla_mode: "Modo de SLA",
  starts_at: "Início", ends_at: "Fim", target: "Meta", value: "Valor", effective_from: "Vigência",
  kind: "Tipo", direction: "Direção", consolidation: "Cálculo", unit: "Un. medida", sort: "Ordem",
  gender: "Sexo", cpf: "CPF", email: "E-mail", phone: "Telefone", employee_code: "Código funcionário",
  admission_date: "Admissão", birth_date: "Nascimento", day: "Data", nps_score: "NPS", nps_comment: "Comentário NPS",
  resolved_at: "Resolvido em", approval_requested_at: "Aprovação solicitada em",
  problem_statement: "Problema/Diagnóstico",
};

const fieldLabel = (f: string) => FIELD_LABEL[f] ?? f;
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

function fmtVal(field: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") {
    if (field === "is_active" || field === "active") return v ? "Ativo" : "Inativo";
    return v ? "Sim" : "Não";
  }
  if (Array.isArray(v)) return v.length ? v.map((x) => String(x)).join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return formatDateTime(s);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; }
  if (isUuid(s)) return `#${s.slice(0, 8)}`;
  return s;
}

function Diff({ action, changes }: { action: string; changes: Record<string, unknown> | null }) {
  const entries = Object.entries(changes ?? {});
  if (entries.length === 0) return <span className="soft">Sem detalhes.</span>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      {entries.map(([field, val]) => {
        const isUpdate = action === "UPDATE" && val && typeof val === "object" && !Array.isArray(val) && "de" in (val as object);
        if (isUpdate) {
          const { de, para } = val as { de: unknown; para: unknown };
          return (
            <div key={field} style={{ fontSize: "0.82rem" }}>
              <strong>{fieldLabel(field)}:</strong>{" "}
              <span className="soft" style={{ textDecoration: "line-through" }}>{fmtVal(field, de)}</span>
              {" → "}
              <span>{fmtVal(field, para)}</span>
            </div>
          );
        }
        return (
          <div key={field} style={{ fontSize: "0.82rem" }}>
            <strong>{fieldLabel(field)}:</strong> {fmtVal(field, val)}
          </div>
        );
      })}
    </div>
  );
}

export function AuditLogViewer({
  rows, filters, autores, total,
}: {
  rows: AuditRow[];
  filters: AuditFilters;
  autores: { id: string; name: string }[];
  total: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pendente, iniciarTransicao] = useTransition();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [qRascunho, setQRascunho] = useState(filters.q);

  // A lista de tipos vem do catálogo do próprio código, não do banco: buscar os
  // tipos distintos em 60 mil linhas custava 1,5 s por carga de página, e o
  // conjunto é justamente o que o sistema audita.
  const tipoOpts = useMemo(
    () => Object.entries(ENTITY_LABEL).sort((a, b) => a[1].localeCompare(b[1], "pt-BR")),
    [],
  );

  const aplicar = useCallback((mudancas: Partial<AuditFilters>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor) next.set(chave, valor);
      else next.delete(chave);
    }
    next.delete("p"); // qualquer mudança de filtro volta para a primeira página
    const qs = next.toString();
    iniciarTransicao(() => router.push(qs ? `/auditoria?${qs}` : "/auditoria", { scroll: false }));
  }, [router, searchParams]);

  // busca livre: espera parar de digitar antes de consultar o banco
  useEffect(() => {
    if (qRascunho === filters.q) return;
    const t = setTimeout(() => aplicar({ q: qRascunho }), 400);
    return () => clearTimeout(t);
  }, [qRascunho, filters.q, aplicar]);

  const temFiltro = Boolean(filters.q || filters.acao || filters.tipo || filters.autor);
  const limpar = () => {
    setQRascunho("");
    iniciarTransicao(() => router.push("/auditoria", { scroll: false }));
  };

  const toggle = (id: number) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="card" style={{ overflow: "hidden", opacity: pendente ? 0.6 : 1, transition: "opacity 120ms" }}>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", padding: "0.85rem 1.1rem", borderBottom: "1px solid var(--border)" }}>
        <input
          className="input"
          value={qRascunho}
          onChange={(e) => setQRascunho(e.target.value)}
          placeholder="Buscar pelo registro…"
          style={{ width: 240, padding: "0.4rem 0.7rem", fontSize: "0.85rem" }}
        />
        <div style={{ width: 220 }}>
          <SearchSelect
            options={autores}
            value={filters.autor}
            onChange={(id) => aplicar({ autor: id })}
            placeholder="Todos os usuários"
          />
        </div>
        <select className="select" value={filters.acao} onChange={(e) => aplicar({ acao: e.target.value })} style={{ width: "auto", padding: "0.4rem 0.6rem", fontSize: "0.83rem" }}>
          <option value="">Todas as ações</option>
          <option value="INSERT">Criação</option>
          <option value="UPDATE">Alteração</option>
          <option value="DELETE">Remoção</option>
        </select>
        <select className="select" value={filters.tipo} onChange={(e) => aplicar({ tipo: e.target.value })} style={{ width: "auto", padding: "0.4rem 0.6rem", fontSize: "0.83rem" }}>
          <option value="">Todos os tipos</option>
          {tipoOpts.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {temFiltro && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={limpar}>Limpar</button>
        )}
        <span className="soft" style={{ marginLeft: "auto", fontSize: "0.82rem" }}>
          {total.toLocaleString("pt-BR")} evento{total === 1 ? "" : "s"}
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Nenhum evento"
          description={temFiltro ? "Nenhum log corresponde aos filtros." : "Ainda não há registros."}
        />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Usuário</th>
                <th>Ação</th>
                <th>Tipo</th>
                <th>Registro</th>
                <th style={{ textAlign: "right" }}>Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const act = ACTION_LABEL[r.action] ?? { label: r.action, tone: "gray" as Tone };
                const isOpen = expanded.has(r.id);
                const count = Object.keys(r.changes ?? {}).length;
                return (
                  <Fragment key={r.id}>
                    <tr>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>{formatDateTime(r.createdAt)}</td>
                      <td>{r.actorName ?? <span className="soft">Sistema</span>}</td>
                      <td><Badge tone={act.tone}>{act.label}</Badge></td>
                      <td className="muted">{ENTITY_LABEL[r.entityType] ?? r.entityType}</td>
                      <td>{r.entityLabel ?? <span className="soft" style={{ fontVariantNumeric: "tabular-nums", fontSize: "0.78rem" }}>{r.entityId ? `#${String(r.entityId).slice(0, 8)}` : "—"}</span>}</td>
                      <td style={{ textAlign: "right" }}>
                        {count > 0 ? (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggle(r.id)}>
                            {isOpen ? "Ocultar" : `Ver (${count})`}
                          </button>
                        ) : <span className="soft">—</span>}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={`${r.id}-d`}>
                        <td colSpan={6} style={{ background: "var(--surface-2)", padding: "0.7rem 1.1rem" }}>
                          <Diff action={r.action} changes={r.changes} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
