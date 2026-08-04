import { requireContext, effectiveUnitFilter } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { MeetingsBoard } from "@/components/MeetingsBoard";
import type { CalMeeting } from "@/components/RoomCalendar";
import type { Person } from "@/components/PeoplePicker";
import { moduleGate } from "@/lib/module-gate";

export default async function MeetingsPage() {
  const gate = await moduleGate("salas");
  if (gate) return gate;

  const { tenant, user, role, unitScope } = await requireContext();
  const supabase = await createClient();
  const scopeUnitIds = effectiveUnitFilter(unitScope);

  // Janela de datas para o calendário (evita carregar histórico inteiro e a
  // truncagem silenciosa do antigo limit(500)). Cobre folga p/ trás + horizonte
  // das séries (12 meses) p/ frente.
  const nowRef = new Date();
  const winStart = new Date(nowRef.getFullYear(), nowRef.getMonth() - 2, 1).toISOString();
  const winEnd = new Date(nowRef.getFullYear(), nowRef.getMonth() + 15, 1).toISOString();

  const [{ data: meetings }, { data: rooms }, { data: series }, { data: members }, { data: holidays }, { data: links }] = await Promise.all([
    // Os participantes vem ANINHADOS na reuniao, e nao numa consulta a parte.
    // Antes `meeting_participants` era lida sem empresa, sem limite e sem recorte
    // de data: as reunioes estavam cuidadosamente janeladas em ~17 meses e presas
    // a 5000, mas os participantes vinham do historico INTEIRO, para sempre, e a
    // maior parte era descartada logo depois. Aninhado, o recorte da reuniao vale
    // para eles tambem, e some uma ida ao banco.
    supabase
      .from("meetings")
      .select("*, rooms(id, name, color, capacity, location, resources), creator:profiles!created_by(full_name), meeting_participants(user_id)")
      .eq("tenant_id", tenant.id)
      .gte("starts_at", winStart)
      .lt("starts_at", winEnd)
      .order("starts_at", { ascending: false })
      .limit(5000),
    // faltava o filtro de empresa: dependia so da RLS, diferente das demais
    supabase.from("rooms").select("id, name, color, capacity, location, resources").eq("tenant_id", tenant.id).eq("is_active", true).order("name"),
    // mesma ideia nas series: os participantes vem junto, ja escopados
    supabase.from("meeting_series").select("id, name, meeting_series_participants(user_id)").eq("tenant_id", tenant.id).eq("is_active", true).is("deleted_at", null).order("name"),
    supabase.from("memberships").select("user_id, profiles!memberships_user_id_fkey(full_name)").eq("tenant_id", tenant.id).eq("is_active", true),
    supabase.from("holidays").select("day, name").eq("tenant_id", tenant.id),
    // escopo de unidade: depende do unitScope (que ja veio do requireContext), nao
    // do resultado das consultas acima. Estava numa segunda onda sem precisar.
    scopeUnitIds
      ? supabase.from("meeting_series_units").select("series_id").in("unit_id", scopeUnitIds)
      : Promise.resolve({ data: null as { series_id: string }[] | null }),
  ]);
  const customHolidays = (holidays ?? []).map((h) => ({ day: h.day, name: h.name }));

  // séries ligadas às unidades do escopo (reuniões avulsas sempre aparecem)
  const scopeSeriesIds: Set<string> | null = links ? new Set(links.map((l) => l.series_id)) : null;

  const partsByMeeting = new Map<string, string[]>();
  for (const m of meetings ?? []) {
    const ps = (m.meeting_participants ?? []) as unknown as { user_id: string }[];
    partsByMeeting.set(m.id, ps.map((x) => x.user_id));
  }
  const localFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const toLocalInput = (iso: string) => localFmt.format(new Date(iso)).replace(" ", "T");

  const routines = (series ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    participantIds: ((s.meeting_series_participants ?? []) as unknown as { user_id: string }[]).map((x) => x.user_id),
  }));
  const people: Person[] = (members ?? [])
    .map((m) => ({ id: m.user_id, name: (m.profiles as { full_name: string | null } | null)?.full_name ?? "—" }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const calMeetings: CalMeeting[] = (meetings ?? [])
    .filter((m) => !scopeSeriesIds || m.series_id === null || scopeSeriesIds.has(m.series_id))
    .map((m) => {
    const room = m.rooms as { id: string; name: string; color: string; capacity: number | null; location: string | null; resources: string[] } | null;
    const creator = m.creator as { full_name: string | null } | null;
    return {
      id: m.id,
      title: m.title,
      description: m.description,
      starts_at: m.starts_at,
      ends_at: m.ends_at,
      status: m.status,
      room: room ? { id: room.id, name: room.name, color: room.color, capacity: room.capacity, location: room.location, resources: room.resources ?? [] } : null,
      created_by: m.created_by,
      creatorName: creator?.full_name ?? null,
      seriesId: m.series_id,
      participantIds: partsByMeeting.get(m.id) ?? [],
      startInput: toLocalInput(m.starts_at),
      endInput: toLocalInput(m.ends_at),
    };
  });
  const calRooms = (rooms ?? []).map((r) => ({ id: r.id, name: r.name, color: r.color, capacity: r.capacity, location: r.location, resources: r.resources ?? [] }));

  return (
    <div>
      <MeetingsBoard meetings={calMeetings} rooms={calRooms} routines={routines} people={people} userId={user.id} role={role} customHolidays={customHolidays} />
    </div>
  );
}
