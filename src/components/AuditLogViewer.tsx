"use client";

import { Fragment, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDateTime } from "@/lib/format";
import type { Tone } from "@/lib/constants";

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

export function AuditLogViewer({ rows }: { rows: AuditRow[] }) {
  const [q, setQ] = useState("");
  const [action, setAction] = useState("all");
  const [entity, setEntity] = useState("all");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const entityOpts = useMemo(() => {
    const set = new Map<string, string>();
    for (const r of rows) set.set(r.entityType, ENTITY_LABEL[r.entityType] ?? r.entityType);
    return [...set.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [rows]);

  const nrm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const filtered = useMemo(() => {
    const query = nrm(q.trim());
    return rows.filter((r) => {
      if (action !== "all" && r.action !== action) return false;
      if (entity !== "all" && r.entityType !== entity) return false;
      if (!query) return true;
      const hay = nrm([r.actorName ?? "", r.entityLabel ?? "", ENTITY_LABEL[r.entityType] ?? r.entityType].join(" "));
      return hay.includes(query);
    });
  }, [rows, q, action, entity]);

  const toggle = (id: number) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", padding: "0.85rem 1.1rem", borderBottom: "1px solid var(--border)" }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por usuário ou registro…" style={{ width: 280, padding: "0.4rem 0.7rem", fontSize: "0.85rem" }} />
        <select className="select" value={action} onChange={(e) => setAction(e.target.value)} style={{ width: "auto", padding: "0.4rem 0.6rem", fontSize: "0.83rem" }}>
          <option value="all">Todas as ações</option>
          <option value="INSERT">Criação</option>
          <option value="UPDATE">Alteração</option>
          <option value="DELETE">Remoção</option>
        </select>
        <select className="select" value={entity} onChange={(e) => setEntity(e.target.value)} style={{ width: "auto", padding: "0.4rem 0.6rem", fontSize: "0.83rem" }}>
          <option value="all">Todos os tipos</option>
          {entityOpts.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="soft" style={{ marginLeft: "auto", fontSize: "0.82rem" }}>{filtered.length} evento(s)</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="Nenhum evento" description="Nenhum log corresponde aos filtros." />
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
              {filtered.map((r) => {
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
