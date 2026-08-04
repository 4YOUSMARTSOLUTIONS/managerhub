import { requireContext, effectiveUnitFilter } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { MeetingRecords, type SeriesRow, type OccurrenceRow } from "@/components/MeetingRecords";
import type { OccurrenceDraft } from "@/lib/actions/meeting-records";
import type { Person } from "@/components/PeoplePicker";
import { moduleGate } from "@/lib/module-gate";
import { getPlatformIntegrationFlags } from "@/lib/platform-integrations";

export default async function MeetingRecordsPage() {
  const gate = await moduleGate("reunioes");
  if (gate) return gate;

  const { tenant, unitScope, user, role } = await requireContext();
  const supabase = await createClient();

  const [
    { data: series }, { data: parts }, { data: unitLinks },
    { data: members }, { data: roomsData }, { data: occ }, flags,
  ] = await Promise.all([
    supabase
      .from("meeting_series")
      .select("*")
      .eq("tenant_id", tenant.id)
      .is("deleted_at", null)
      .order("is_active", { ascending: false })
      .order("next_date", { ascending: true, nullsFirst: false })
      .order("name"),
    supabase.from("meeting_series_participants").select("series_id, user_id"),
    supabase.from("meeting_series_units").select("series_id, unit_id"),
    supabase
      .from("memberships")
      .select("user_id, profiles!memberships_user_id_fkey(full_name)")
      .eq("tenant_id", tenant.id)
      .eq("is_active", true),
    supabase.from("rooms").select("id, name").eq("tenant_id", tenant.id).eq("is_active", true).order("name"),
    supabase
      .from("meeting_occurrences")
      .select("id, series_id, occurred_on, status, started_at, ended_at, duration_seconds, auto_finished, meeting_link, draft, registered_by, meeting_series(name), registrant:profiles!registered_by(full_name)")
      .eq("tenant_id", tenant.id)
      .is("deleted_at", null)
      .order("started_at", { ascending: false, nullsFirst: false })
      .order("occurred_on", { ascending: false })
      .limit(300),
    // antes isto era um await ESCONDIDO no meio do JSX, virando uma onda extra
    // depois de tudo, so para um booleano que o dialogo de finalizar usa
    getPlatformIntegrationFlags(),
  ]);

  const rooms = (roomsData ?? []).map((r) => ({ id: r.id, name: r.name }));
  const roomById = new Map(rooms.map((r) => [r.id, r.name]));

  // as unidades ja vieram do requireContext; a consulta daqui repetia a de la
  const units = unitScope.units;
  const unitById = new Map(units.map((u) => [u.id, u.name]));
  const unitsBySeries = new Map<string, string[]>();
  for (const ul of unitLinks ?? []) {
    const arr = unitsBySeries.get(ul.series_id) ?? [];
    arr.push(ul.unit_id);
    unitsBySeries.set(ul.series_id, arr);
  }
  // escopo de unidade global: série entra se tiver alguma unidade do escopo
  const scopeUnitIds = effectiveUnitFilter(unitScope);
  const seriesInScope = (seriesId: string) =>
    !scopeUnitIds || (unitsBySeries.get(seriesId) ?? []).some((u) => scopeUnitIds.includes(u));

  // pessoas (membros ativos)
  const people: Person[] = (members ?? [])
    .map((m) => ({ id: m.user_id, name: (m.profiles as { full_name: string | null } | null)?.full_name ?? "—" }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const personById = new Map(people.map((p) => [p.id, p.name]));

  // participantes habituais por série
  const partsBySeries = new Map<string, string[]>();
  for (const p of parts ?? []) {
    const arr = partsBySeries.get(p.series_id) ?? [];
    arr.push(p.user_id);
    partsBySeries.set(p.series_id, arr);
  }

  // data/hora da última reunião realizada (finalizada) por série.
  // occ já vem ordenado por started_at desc, então o primeiro finalizado de cada série é o mais recente.
  const lastHeldBySeries = new Map<string, string>();
  for (const o of occ ?? []) {
    if (o.status !== "finished") continue;
    if (lastHeldBySeries.has(o.series_id)) continue;
    lastHeldBySeries.set(o.series_id, o.started_at ?? o.occurred_on);
  }

  const seriesRows: SeriesRow[] = (series ?? []).filter((s) => seriesInScope(s.id)).map((s) => ({
    id: s.id,
    name: s.name,
    periodicity: s.periodicity,
    nextDate: s.next_date,
    startTime: s.start_time,
    autoBook: s.auto_book,
    objetivo: s.objetivo,
    owner: s.owner,
    ownerUserId: s.owner_user_id,
    ownerUserName: s.owner_user_id ? personById.get(s.owner_user_id) ?? null : null,
    roomId: s.room_id,
    roomName: s.room_id ? roomById.get(s.room_id) ?? null : null,
    isOnline: s.is_online,
    participantsText: s.participants_text,
    durationMin: s.duration_min,
    durationUnit: s.duration_unit,
    content: (s.content as { item: string; tempo: string; dono: string }[] | null) ?? [],
    generalRules: (s.general_rules as string[] | null) ?? [],
    howTo: (s.how_to as string[] | null) ?? [],
    participantIds: partsBySeries.get(s.id) ?? [],
    unitIds: unitsBySeries.get(s.id) ?? [],
    unitNames: (unitsBySeries.get(s.id) ?? []).map((id) => unitById.get(id)).filter((x): x is string => !!x),
    isActive: s.is_active,
    isPrivate: s.is_private,
    lastHeldDate: lastHeldBySeries.get(s.id) ?? null,
  }));

  // contagens de presença/ações por registro
  const occIds = (occ ?? []).map((o) => o.id);
  const [{ data: att }, { data: acts }, { data: recs }] = await Promise.all([
    occIds.length
      ? supabase.from("meeting_attendance").select("occurrence_id, present").in("occurrence_id", occIds)
      : Promise.resolve({ data: [] as { occurrence_id: string; present: boolean }[] }),
    occIds.length
      ? supabase.from("actions").select("occurrence_id").in("occurrence_id", occIds)
      : Promise.resolve({ data: [] as { occurrence_id: string | null }[] }),
    occIds.length
      ? supabase.from("meeting_recordings").select("occurrence_id").in("occurrence_id", occIds)
      : Promise.resolve({ data: [] as { occurrence_id: string }[] }),
  ]);

  const recBy = new Map<string, number>();
  for (const r of recs ?? []) recBy.set(r.occurrence_id, (recBy.get(r.occurrence_id) ?? 0) + 1);
  const attBy = new Map<string, { total: number; present: number }>();
  for (const a of att ?? []) {
    const cur = attBy.get(a.occurrence_id) ?? { total: 0, present: 0 };
    cur.total += 1;
    if (a.present) cur.present += 1;
    attBy.set(a.occurrence_id, cur);
  }
  const actBy = new Map<string, number>();
  for (const a of acts ?? []) {
    if (!a.occurrence_id) continue;
    actBy.set(a.occurrence_id, (actBy.get(a.occurrence_id) ?? 0) + 1);
  }

  const occurrences: OccurrenceRow[] = (occ ?? []).filter((o) => seriesInScope(o.series_id)).map((o) => {
    const counts = attBy.get(o.id) ?? { total: 0, present: 0 };
    return {
      id: o.id,
      seriesId: o.series_id,
      seriesName: (o.meeting_series as { name: string } | null)?.name ?? "—",
      occurredOn: o.occurred_on,
      status: o.status,
      autoFinished: o.auto_finished ?? false,
      meetingLink: o.meeting_link ?? null,
      startedAt: o.started_at,
      endedAt: o.ended_at,
      durationSeconds: o.duration_seconds,
      draft: (o.draft as OccurrenceDraft | null) ?? null,
      presentCount: counts.present,
      totalCount: counts.total,
      actionsCount: actBy.get(o.id) ?? 0,
      recordingsCount: recBy.get(o.id) ?? 0,
      registeredById: o.registered_by ?? null,
      registeredByName: (o.registrant as { full_name: string | null } | null)?.full_name ?? null,
    };
  });

  return (
    <MeetingRecords
      series={seriesRows}
      occurrences={occurrences}
      people={people}
      rooms={rooms}
      units={units}
      aiEnabled={flags.hasOpenAI}
      currentUserId={user.id}
      role={role}
    />
  );
}
