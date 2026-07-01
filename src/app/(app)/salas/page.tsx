import { requireContext } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { MeetingsBoard } from "@/components/MeetingsBoard";
import type { CalMeeting } from "@/components/RoomCalendar";
import type { Person } from "@/components/PeoplePicker";

export default async function MeetingsPage() {
  const { tenant, user, role } = await requireContext();
  const supabase = await createClient();

  // Janela de datas para o calendário (evita carregar histórico inteiro e a
  // truncagem silenciosa do antigo limit(500)). Cobre folga p/ trás + horizonte
  // das séries (12 meses) p/ frente.
  const nowRef = new Date();
  const winStart = new Date(nowRef.getFullYear(), nowRef.getMonth() - 2, 1).toISOString();
  const winEnd = new Date(nowRef.getFullYear(), nowRef.getMonth() + 15, 1).toISOString();

  const [{ data: meetings }, { data: rooms }, { data: series }, { data: seriesParts }, { data: members }, { data: meetingParts }, { data: holidays }] = await Promise.all([
    supabase
      .from("meetings")
      .select("*, rooms(id, name, color), creator:profiles!created_by(full_name)")
      .eq("tenant_id", tenant.id)
      .gte("starts_at", winStart)
      .lt("starts_at", winEnd)
      .order("starts_at", { ascending: false })
      .limit(5000),
    supabase.from("rooms").select("id, name, color").eq("is_active", true).order("name"),
    supabase.from("meeting_series").select("id, name").eq("tenant_id", tenant.id).eq("is_active", true).order("name"),
    supabase.from("meeting_series_participants").select("series_id, user_id"),
    supabase.from("memberships").select("user_id, profiles!memberships_user_id_fkey(full_name)").eq("tenant_id", tenant.id).eq("is_active", true),
    supabase.from("meeting_participants").select("meeting_id, user_id"),
    supabase.from("holidays").select("day, name").eq("tenant_id", tenant.id),
  ]);
  const customHolidays = (holidays ?? []).map((h) => ({ day: h.day, name: h.name }));

  const partsByMeeting = new Map<string, string[]>();
  for (const p of meetingParts ?? []) {
    const arr = partsByMeeting.get(p.meeting_id) ?? [];
    arr.push(p.user_id);
    partsByMeeting.set(p.meeting_id, arr);
  }
  const localFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const toLocalInput = (iso: string) => localFmt.format(new Date(iso)).replace(" ", "T");

  const partsBySeries = new Map<string, string[]>();
  for (const p of seriesParts ?? []) {
    const arr = partsBySeries.get(p.series_id) ?? [];
    arr.push(p.user_id);
    partsBySeries.set(p.series_id, arr);
  }
  const routines = (series ?? []).map((s) => ({ id: s.id, name: s.name, participantIds: partsBySeries.get(s.id) ?? [] }));
  const people: Person[] = (members ?? [])
    .map((m) => ({ id: m.user_id, name: (m.profiles as { full_name: string | null } | null)?.full_name ?? "—" }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const calMeetings: CalMeeting[] = (meetings ?? []).map((m) => {
    const room = m.rooms as { id: string; name: string; color: string } | null;
    const creator = m.creator as { full_name: string | null } | null;
    return {
      id: m.id,
      title: m.title,
      description: m.description,
      starts_at: m.starts_at,
      ends_at: m.ends_at,
      status: m.status,
      room: room ? { id: room.id, name: room.name, color: room.color } : null,
      created_by: m.created_by,
      creatorName: creator?.full_name ?? null,
      seriesId: m.series_id,
      participantIds: partsByMeeting.get(m.id) ?? [],
      startInput: toLocalInput(m.starts_at),
      endInput: toLocalInput(m.ends_at),
    };
  });
  const calRooms = (rooms ?? []).map((r) => ({ id: r.id, name: r.name, color: r.color }));

  return (
    <div>
      <MeetingsBoard meetings={calMeetings} rooms={calRooms} routines={routines} people={people} userId={user.id} role={role} customHolidays={customHolidays} />
    </div>
  );
}
