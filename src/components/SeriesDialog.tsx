"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSeries, parseTorPdf, parseTorExcel, type ContentRow } from "@/lib/actions/meeting-records";
import type { ParsedTor } from "@/lib/tor-parser";
import { PERIODICITY } from "@/lib/constants";
import { PeoplePicker, type Person } from "./PeoplePicker";
import { InfoHint } from "@/components/ui/InfoHint";

export type Room = { id: string; name: string };
export type Unit = { id: string; name: string };

export type SeriesData = {
  id: string;
  name: string;
  periodicity: string;
  nextDate: string | null;
  startTime: string | null;
  autoBook: boolean;
  objetivo: string | null;
  owner: string | null;
  ownerUserId: string | null;
  ownerUserName: string | null;
  roomId: string | null;
  roomName: string | null;
  isOnline: boolean;
  participantsText: string | null;
  durationMin: number | null;
  durationUnit: string;
  content: ContentRow[];
  generalRules: string[];
  howTo: string[];
  participantIds: string[];
  unitIds: string[];
  unitNames: string[];
  isPrivate: boolean;
};

const PERIOD_OPTS = Object.entries(PERIODICITY) as [string, string][];
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function ListEditor({ items, onChange, placeholder }: { items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const set = (i: number, v: string) => onChange(items.map((x, idx) => (idx === i ? v : x)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "20px 1fr 32px", gap: "0.4rem", alignItems: "center" }}>
          <span className="soft" style={{ fontSize: "0.8rem", textAlign: "right" }}>{i + 1}.</span>
          <input className="input" value={it} onChange={(e) => set(i, e.target.value)} placeholder={placeholder} />
          <button type="button" className="icon-btn icon-btn-danger" onClick={() => onChange(items.filter((_, idx) => idx !== i))} title="Remover" style={{ width: 32, height: 32 }}>×</button>
        </div>
      ))}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...items, ""])} style={{ alignSelf: "flex-start" }}>+ Adicionar</button>
    </div>
  );
}

function ContentEditor({ rows, onChange }: { rows: ContentRow[]; onChange: (v: ContentRow[]) => void }) {
  const set = (i: number, patch: Partial<ContentRow>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      {rows.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "20px 1fr 90px 90px 32px", gap: "0.4rem" }} className="soft">
          <span /><span style={{ fontSize: "0.72rem", fontWeight: 600 }}>Item</span>
          <span style={{ fontSize: "0.72rem", fontWeight: 600 }}>Tempo</span>
          <span style={{ fontSize: "0.72rem", fontWeight: 600 }}>Dono</span><span />
        </div>
      )}
      {rows.map((r, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "20px 1fr 90px 90px 32px", gap: "0.4rem", alignItems: "center" }}>
          <span className="soft" style={{ fontSize: "0.8rem", textAlign: "right" }}>{i + 1}.</span>
          <input className="input" value={r.item} onChange={(e) => set(i, { item: e.target.value })} placeholder="Tema / assunto" />
          <input className="input" value={r.tempo} onChange={(e) => set(i, { tempo: e.target.value })} placeholder="15 min" />
          <input className="input" value={r.dono} onChange={(e) => set(i, { dono: e.target.value })} placeholder="GC" />
          <button type="button" className="icon-btn icon-btn-danger" onClick={() => onChange(rows.filter((_, idx) => idx !== i))} title="Remover" style={{ width: 32, height: 32 }}>×</button>
        </div>
      ))}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...rows, { item: "", tempo: "", dono: "" }])} style={{ alignSelf: "flex-start" }}>+ Item da pauta</button>
    </div>
  );
}

export function SeriesDialog({
  open,
  onClose,
  people,
  rooms,
  units,
  series,
}: {
  open: boolean;
  onClose: () => void;
  people: Person[];
  rooms: Room[];
  units: Unit[];
  series?: SeriesData;
}) {
  const editing = !!series;
  const [name, setName] = useState("");
  const [periodicity, setPeriodicity] = useState("mensal");
  const [nextDate, setNextDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [autoBook, setAutoBook] = useState(false);
  const [objetivo, setObjetivo] = useState("");
  const [owner, setOwner] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [isOnline, setIsOnline] = useState(false);
  const [participantsText, setParticipantsText] = useState("");
  const [durationMin, setDurationMin] = useState("");
  const [durationUnit, setDurationUnit] = useState("min");
  const [content, setContent] = useState<ContentRow[]>([]);
  const [generalRules, setGeneralRules] = useState<string[]>([]);
  const [howTo, setHowTo] = useState<string[]>([]);
  const [participants, setParticipants] = useState<string[]>([]);
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState("");
  const [imported, setImported] = useState("");
  const [pending, start] = useTransition();
  const [importing, startImport] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (open) {
      setName(series?.name ?? "");
      setPeriodicity(series?.periodicity ?? "mensal");
      setNextDate(series?.nextDate ?? "");
      setStartTime(series?.startTime ? series.startTime.slice(0, 5) : "");
      setAutoBook(series?.autoBook ?? false);
      setObjetivo(series?.objetivo ?? "");
      setOwner(series?.owner ?? "");
      setOwnerUserId(series?.ownerUserId ?? "");
      setRoomId(series?.roomId ?? "");
      setIsOnline(series?.isOnline ?? false);
      setParticipantsText(series?.participantsText ?? "");
      setDurationMin(series?.durationMin != null ? String(series.durationMin) : "");
      setDurationUnit(series?.durationUnit ?? "min");
      setContent(series?.content ?? []);
      setGeneralRules(series?.generalRules ?? []);
      setHowTo(series?.howTo ?? []);
      setParticipants(series?.participantIds ?? []);
      setUnitIds(series?.unitIds ?? []);
      setIsPrivate(series?.isPrivate ?? false);
      setError(""); setImported("");
    }
  }, [open, series]);

  if (!open) return null;

  // aplica o TOR interpretado (PDF ou Excel) aos campos do formulário
  const applyParsed = (d: ParsedTor) => {
    if (d.name) setName(d.name);
    if (d.objetivo) setObjetivo(d.objetivo);
    if (d.owner) setOwner(d.owner);
    if (d.participantsText) setParticipantsText(d.participantsText);
    if (d.periodicity) setPeriodicity(d.periodicity);
    if (d.durationValue != null) { setDurationMin(String(d.durationValue)); setDurationUnit(d.durationUnit ?? "min"); }
    if (d.content?.length) setContent(d.content);
    if (d.generalRules?.length) setGeneralRules(d.generalRules);
    if (d.howTo?.length) setHowTo(d.howTo);
    // local: interpreta texto -> online + sala
    if (d.locationText) {
      if (/online|zoom|teams|meet|remoto|h[ií]brid/i.test(d.locationText)) setIsOnline(true);
      const lt = norm(d.locationText);
      const match = rooms.find((r) => lt.includes(norm(r.name)));
      if (match) setRoomId(match.id);
    }
    setImported("Campos preenchidos a partir do arquivo. Revise e selecione os usuários participantes.");
  };

  const onImport = (file: File) => {
    setError(""); setImported("");
    const fd = new FormData();
    fd.append("file", file);
    const isExcel = /\.xlsx?$/i.test(file.name) || /sheet|excel/i.test(file.type);
    startImport(async () => {
      const res = isExcel ? await parseTorExcel(fd) : await parseTorPdf(fd);
      if (!res.ok) { setError(res.error); return; }
      applyParsed(res.data);
    });
  };

  const submit = () => {
    setError("");
    if (!name.trim()) { setError("Informe o nome da reunião."); return; }
    if (!objetivo.trim()) { setError("Informe o objetivo da reunião."); return; }
    if (!owner.trim()) { setError("Informe o dono (cargo/descrição)."); return; }
    if (!periodicity) { setError("Selecione a frequência."); return; }
    if (!nextDate) { setError("Informe a data da próxima reunião."); return; }
    if (!startTime) { setError("Informe o horário de início."); return; }
    if (!durationMin || Number(durationMin) <= 0) { setError("Informe a duração da reunião."); return; }
    if (!ownerUserId) { setError("Selecione o usuário responsável (dono)."); return; }
    if (!isOnline && !roomId) { setError("Selecione uma sala ou marque a reunião como online."); return; }
    if (unitIds.length === 0) { setError("Selecione ao menos uma unidade."); return; }
    if (!participantsText.trim()) { setError("Descreva os participantes (ex.: “Todos os gerentes do comercial”)."); return; }
    if (participants.length === 0) { setError("Selecione ao menos um usuário participante."); return; }
    if (content.filter((c) => c.item.trim()).length === 0) { setError("Adicione ao menos um item no Conteúdo / Pauta."); return; }
    if (generalRules.filter((r) => r.trim()).length === 0) { setError("Informe ao menos uma Regra Geral."); return; }
    if (howTo.filter((r) => r.trim()).length === 0) { setError("Informe ao menos um item em Como Realizar."); return; }
    start(async () => {
      const res = await saveSeries({
        id: series?.id,
        name, periodicity, next_date: nextDate, start_time: startTime, auto_book: autoBook,
        is_private: isPrivate,
        objetivo, owner, owner_user_id: ownerUserId,
        room_id: roomId, is_online: isOnline, participants_text: participantsText,
        duration_min: durationMin, duration_unit: durationUnit,
        content: content.filter((c) => c.item.trim()),
        general_rules: generalRules.filter((r) => r.trim()),
        how_to: howTo.filter((r) => r.trim()),
        participants,
        units: unitIds,
      });
      if (res.error) { setError(res.error); return; }
      onClose();
      router.refresh();
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 60, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 680, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>{editing ? "Editar reunião (TOR)" : "Nova reunião (TOR)"}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>

        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1.1rem" }}>
          {/* Importar TOR (PDF ou Excel) */}
          <div style={{ background: "var(--surface-2)", borderRadius: 9, padding: "0.8rem 1rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
            <div style={{ fontSize: "0.85rem" }}>
              <strong>Importar TOR de um PDF ou Excel padrão</strong>
              <div className="muted" style={{ fontSize: "0.8rem" }}>Preenche os campos automaticamente se o arquivo estiver no padrão SDPO.</div>
            </div>
            <input ref={fileRef} type="file" accept="application/pdf,.pdf,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
            <button type="button" className="btn btn-ghost btn-sm" disabled={importing} onClick={() => fileRef.current?.click()}>
              {importing ? "Lendo arquivo…" : "↑ Importar TOR"}
            </button>
          </div>
          {imported && <p style={{ color: "var(--mh-success)", fontSize: "0.82rem", margin: 0, background: "var(--mh-success-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>{imported}</p>}

          {/* Privacidade */}
          <div>
            <label className="label">Privacidade <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <div style={{ display: "inline-flex", border: "1px solid var(--mh-border)", borderRadius: "var(--mh-radius-md)", overflow: "hidden" }}>
              <button type="button" onClick={() => setIsPrivate(false)}
                className={`btn btn-sm ${!isPrivate ? "btn-primary" : "btn-ghost"}`} style={{ borderRadius: 0 }}>Pública</button>
              <button type="button" onClick={() => setIsPrivate(true)}
                className={`btn btn-sm ${isPrivate ? "btn-primary" : "btn-ghost"}`} style={{ borderRadius: 0 }}>Privada</button>
            </div>
            <p className="soft" style={{ fontSize: "0.78rem", margin: "0.3rem 0 0" }}>
              {isPrivate
                ? "Privada: apenas os participantes, o dono e gerentes veem esta reunião e as ações vinculadas a ela."
                : "Pública: todos os usuários da empresa podem ver esta reunião e suas ações."}
            </p>
          </div>

          {/* Unidades */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.35rem" }}>
              <label className="label" style={{ margin: 0 }}>Unidades <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              {units.length > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setUnitIds(unitIds.length === units.length ? [] : units.map((u) => u.id))}
                >
                  {unitIds.length === units.length ? "Limpar" : "Todas"}
                </button>
              )}
            </div>
            {units.length === 0 ? (
              <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>Nenhuma unidade cadastrada. Cadastre em Configurações → Empresa.</p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem 0.9rem" }}>
                {units.map((u) => {
                  const checked = unitIds.includes(u.id);
                  return (
                    <label key={u.id} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setUnitIds(e.target.checked ? [...unitIds, u.id] : unitIds.filter((x) => x !== u.id))}
                      />
                      {u.name}
                    </label>
                  );
                })}
              </div>
            )}
            <p className="soft" style={{ fontSize: "0.78rem", margin: "0.3rem 0 0" }}>
              Marque todas se a reunião reúne as unidades juntas, ou selecione apenas a(s) unidade(s) específica(s).
            </p>
          </div>

          <div>
            <label className="label">Nome da reunião <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Reunião de Planejamento do Mês" />
          </div>

          <div>
            <label className="label">Objetivo <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <textarea className="textarea" value={objetivo} onChange={(e) => setObjetivo(e.target.value)} placeholder="Para que serve esta reunião…" style={{ minHeight: 60 }} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
            <div>
              <label className="label">Dono <span style={{ color: "var(--mh-danger)" }}>*</span> <span className="soft">(cargo/descrição)</span></label>
              <input className="input" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Ex.: Gerente Comercial" />
            </div>
            <div>
              <label className="label">Frequência <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <select className="select" value={periodicity} onChange={(e) => setPeriodicity(e.target.value)}>
                {PERIOD_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Usuário responsável <span style={{ color: "var(--mh-danger)" }}>*</span> <span className="soft">(dono)</span></label>
            <PeoplePicker
              people={people}
              selected={ownerUserId ? [ownerUserId] : []}
              onChange={(ids) => setOwnerUserId(ids[0] ?? "")}
              single
              placeholder="Buscar o usuário responsável…"
            />
          </div>

          {/* Local: sala + online */}
          <div>
            <label className="label">Local <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "0.8rem", alignItems: "center" }}>
              <select className="select" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                <option value="">{isOnline ? "Sem sala física (somente online)" : "Selecione a sala…"}</option>
                {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <label style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.85rem", whiteSpace: "nowrap" }}>
                <input type="checkbox" checked={isOnline} onChange={(e) => setIsOnline(e.target.checked)} />
                {roomId ? "Também online" : "Online"}
              </label>
            </div>
            <p className="soft" style={{ fontSize: "0.78rem", margin: "0.3rem 0 0" }}>
              Presencial: escolha a sala. Marque “Também online” para híbrida. Ou marque Sem sala física para uma reunião que ocorrerá somente online.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0.8rem" }}>
            <div>
              <label className="label">Duração <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <input type="number" min={1} step="any" className="input" value={durationMin} onChange={(e) => setDurationMin(e.target.value)} placeholder="120" />
            </div>
            <div>
              <label className="label">Unidade</label>
              <select className="select" value={durationUnit} onChange={(e) => setDurationUnit(e.target.value)}>
                <option value="min">Minutos</option>
                <option value="h">Horas</option>
              </select>
            </div>
            <div>
              <label className="label">Próxima reunião <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <input type="date" className="input" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
            </div>
            <div>
              <label className="label">Horário <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <input type="time" className="input" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
          </div>

          {/* Auto-reserva + convite recorrente */}
          <div style={{ background: "var(--surface-2)", borderRadius: 9, padding: "0.7rem 1rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.55rem", cursor: "pointer" }}>
                <input type="checkbox" checked={autoBook} onChange={(e) => setAutoBook(e.target.checked)} />
                <strong>Reservar sala e enviar convites automaticamente (Outlook)</strong>
              </label>
              <InfoHint label="Sobre a reserva e os convites automáticos">
                Gera as ocorrências futuras no calendário de salas (pré-reservando o horário) e envia um convite recorrente por e-mail aos participantes. Reserva 12 meses à frente, ou 30 dias quando a frequência for diária. Exige data, horário e sala (ou “online”).
              </InfoHint>
            </div>
          </div>

          <div>
            <label className="label">Participantes <span style={{ color: "var(--mh-danger)" }}>*</span> <span className="soft">(descrição — ex.: “Todos os gerentes do comercial”)</span></label>
            <input className="input" value={participantsText} onChange={(e) => setParticipantsText(e.target.value)} placeholder="Descrição dos participantes (vem do PDF ou manual)" />
          </div>

          <div>
            <label className="label">Usuários participantes <span style={{ color: "var(--mh-danger)" }}>*</span> <span className="soft">(selecione no sistema)</span></label>
            <PeoplePicker people={people} selected={participants} onChange={setParticipants} />
          </div>

          <div>
            <label className="label">Regras Gerais <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <ListEditor items={generalRules} onChange={setGeneralRules} placeholder="Ex.: Não interrompa quem estiver falando." />
          </div>

          <div>
            <label className="label">Como Realizar <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <ListEditor items={howTo} onChange={setHowTo} placeholder="Ex.: O dono deve definir o calendário do mês…" />
          </div>

          <div>
            <label className="label">Conteúdo / Pauta <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <ContentEditor rows={content} onChange={setContent} />
          </div>

          {error && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>{error}</p>}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>
            {pending ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
