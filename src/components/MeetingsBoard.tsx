"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { RoomCalendar, type CalMeeting, type CalRoom, type View } from "./RoomCalendar";
import { NewMeetingDialog, type Prefill } from "./NewMeetingDialog";
import { MeetingsTable } from "./MeetingsTable";
import type { Enums } from "@/types/database";

export function MeetingsBoard({
  meetings,
  rooms,
  userId,
  role,
}: {
  meetings: CalMeeting[];
  rooms: CalRoom[];
  userId: string;
  role: Enums<"member_role">;
}) {
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState<Prefill | undefined>(undefined);
  const [roomFilter, setRoomFilter] = useState<string>("all");
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState<Date>(() => new Date());

  const openNew = (p?: Prefill) => {
    setPrefill(p);
    setOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Reuniões"
        subtitle="Agende e acompanhe as reuniões do time."
        action={
          <button className="btn btn-primary" onClick={() => openNew()}>
            + Nova reunião
          </button>
        }
      />

      <div style={{ marginBottom: "1.5rem" }}>
        <RoomCalendar
          meetings={meetings}
          rooms={rooms}
          onNew={openNew}
          roomFilter={roomFilter}
          onRoomFilterChange={setRoomFilter}
          view={view}
          onViewChange={setView}
          cursor={cursor}
          onCursorChange={setCursor}
        />
      </div>

      <MeetingsTable
        meetings={meetings}
        roomFilter={roomFilter}
        view={view}
        cursor={cursor}
        userId={userId}
        role={role}
      />

      <NewMeetingDialog open={open} onClose={() => setOpen(false)} initial={prefill} rooms={rooms} />
    </>
  );
}
