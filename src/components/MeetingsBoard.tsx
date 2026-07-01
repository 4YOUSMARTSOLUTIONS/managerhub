"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { RoomCalendar, type CalMeeting, type CalRoom, type View } from "./RoomCalendar";
import { NewMeetingDialog, type Prefill, type Routine } from "./NewMeetingDialog";
import { MeetingsTable } from "./MeetingsTable";
import type { Person } from "./PeoplePicker";
import type { Enums } from "@/types/database";

export function MeetingsBoard({
  meetings,
  rooms,
  routines,
  people,
  userId,
  role,
  customHolidays = [],
}: {
  meetings: CalMeeting[];
  rooms: CalRoom[];
  routines: Routine[];
  people: Person[];
  userId: string;
  role: Enums<"member_role">;
  customHolidays?: { day: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState<Prefill | undefined>(undefined);
  const [editing, setEditing] = useState<CalMeeting | null>(null);
  const [roomFilter, setRoomFilter] = useState<string>("all");
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState<Date>(() => new Date());

  const openNew = (p?: Prefill) => {
    setEditing(null);
    setPrefill(p);
    setOpen(true);
  };
  const openEdit = (m: CalMeeting) => {
    setEditing(m);
    setPrefill(undefined);
    setOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Salas de reuniões"
        subtitle="Agende e acompanhe a ocupação das salas."
        action={
          <button className="btn btn-primary" onClick={() => openNew()}>
            Agendar reunião
          </button>
        }
      />

      <div style={{ marginBottom: "1.5rem" }}>
        <RoomCalendar
          meetings={meetings}
          rooms={rooms}
          onNew={openNew}
          onEdit={openEdit}
          roomFilter={roomFilter}
          onRoomFilterChange={setRoomFilter}
          view={view}
          onViewChange={setView}
          cursor={cursor}
          onCursorChange={setCursor}
          customHolidays={customHolidays}
        />
      </div>

      <MeetingsTable
        meetings={meetings}
        roomFilter={roomFilter}
        view={view}
        cursor={cursor}
        userId={userId}
        role={role}
        onEdit={openEdit}
      />

      <NewMeetingDialog open={open} onClose={() => setOpen(false)} initial={prefill} editing={editing} rooms={rooms} routines={routines} people={people} customHolidays={customHolidays} />
    </>
  );
}
