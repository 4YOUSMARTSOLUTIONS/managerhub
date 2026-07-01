import { requireContext } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { MeetingRecords, type SeriesRow, type OccurrenceRow } from "@/components/MeetingRecords";
import type { OccurrenceDraft } from "@/lib/actions/meeting-records";
import type { Person } from "@/components/PeoplePicker";

export default async function MeetingRecordsPage() {
  const { tenant } = await requireContext();
  const supabase = await createClient();

  const [
    { data: series }, { data: parts }, { data: unitLinks }, { data: unitsData },
    { data: members }, { data: roomsData }, { data: occ },
    { data: pilares }, { data: blocos }, { data: itens }, { data: kpis }, { data: tools },
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
    supabase.from("units").select("id, name").eq("tenant_id", tenant.id).order("name"),
    supabase
      .from("memberships")
      .select("user_id, profiles!memberships_user_id_fkey(full_name)")
      .eq("tenant_id", tenant.id)
      .eq("is_active", true),
    supabase.from("rooms").select("id, name").eq("tenant_id", tenant.id).eq("is_active", true).order("name"),
    supabase
      .from("meeting_occurrences")
      .select("id, series_id, occurred_on, status, started_at, ended_at, duration_seconds, draft, registered_by, meeting_series(name), registrant:profiles!registered_by(full_name)")
      .eq("tenant_id", tenant.id)
      .is("deleted_at", null)
      .order("started_at", { ascending: false, nullsFirst: false })
      .order("occurred_on", { ascending: false })
      .limit(300),
    supabase.from("sdpo_pilares").select("id, name").eq("tenant_id", tenant.id).order("name"),
    supabase.from("sdpo_blocos").select("id, name, pilar_id").eq("tenant_id", tenant.id).order("name"),
    supabase.from("sdpo_itens").select("id, name, bloco_id").eq("tenant_id", tenant.id).order("name"),
    supabase.from("action_kpis").select("id, name").eq("tenant_id", tenant.id).order("name"),
    supabase.from("action_tools").select("id, name").eq("tenant_id", tenant.id).order("name"),
  ]);

  const rooms = (roomsData ?? []).map((r) => ({ id: r.id, name: r.name }));
  const roomById = new Map(rooms.map((r) => [r.id, r.name]));

  const units = (unitsData ?? []).map((u) => ({ id: u.id, name: u.name }));
  const unitById = new Map(units.map((u) => [u.id, u.name]));
  const unitsBySeries = new Map<string, string[]>();
  for (const ul of unitLinks ?? []) {
    const arr = unitsBySeries.get(ul.series_id) ?? [];
    arr.push(ul.unit_id);
    unitsBySeries.set(ul.series_id, arr);
  }

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

  const seriesRows: SeriesRow[] = (series ?? []).map((s) => ({
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
  }));

  // contagens de presença/ações por registro
  const occIds = (occ ?? []).map((o) => o.id);
  const [{ data: att }, { data: acts }] = await Promise.all([
    occIds.length
      ? supabase.from("meeting_attendance").select("occurrence_id, present").in("occurrence_id", occIds)
      : Promise.resolve({ data: [] as { occurrence_id: string; present: boolean }[] }),
    occIds.length
      ? supabase.from("action_items").select("occurrence_id").in("occurrence_id", occIds)
      : Promise.resolve({ data: [] as { occurrence_id: string | null }[] }),
  ]);

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

  const occurrences: OccurrenceRow[] = (occ ?? []).map((o) => {
    const counts = attBy.get(o.id) ?? { total: 0, present: 0 };
    return {
      id: o.id,
      seriesId: o.series_id,
      seriesName: (o.meeting_series as { name: string } | null)?.name ?? "—",
      occurredOn: o.occurred_on,
      status: o.status,
      startedAt: o.started_at,
      endedAt: o.ended_at,
      durationSeconds: o.duration_seconds,
      draft: (o.draft as OccurrenceDraft | null) ?? null,
      presentCount: counts.present,
      totalCount: counts.total,
      actionsCount: actBy.get(o.id) ?? 0,
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
      pilares={(pilares ?? []).map((p) => ({ id: p.id, name: p.name }))}
      blocos={(blocos ?? []).map((b) => ({ id: b.id, name: b.name, pilarId: b.pilar_id }))}
      itens={(itens ?? []).map((i) => ({ id: i.id, name: i.name, blocoId: i.bloco_id }))}
      kpis={(kpis ?? []).map((k) => ({ id: k.id, name: k.name }))}
      tools={(tools ?? []).map((t) => ({ id: t.id, name: t.name }))}
      aiEnabled={tenant.has_openai_key}
    />
  );
}
