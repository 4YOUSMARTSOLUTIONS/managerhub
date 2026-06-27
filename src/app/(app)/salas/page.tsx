import { requireContext } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { MeetingsBoard } from "@/components/MeetingsBoard";
import type { CalMeeting } from "@/components/RoomCalendar";

export default async function MeetingsPage() {
  const { user, role } = await requireContext();
  const supabase = await createClient();

  const [{ data: meetings }, { data: rooms }] = await Promise.all([
    supabase
      .from("meetings")
      .select("*, rooms(id, name, color), creator:profiles!created_by(full_name)")
      .order("starts_at", { ascending: false })
      .limit(500),
    supabase.from("rooms").select("id, name, color").eq("is_active", true).order("name"),
  ]);

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
    };
  });
  const calRooms = (rooms ?? []).map((r) => ({ id: r.id, name: r.name, color: r.color }));

  return (
    <div>
      <MeetingsBoard meetings={calMeetings} rooms={calRooms} userId={user.id} role={role} />
    </div>
  );
}
