"use server";

import { actionContext } from "./context";

export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  demandaId: string | null;
  isRead: boolean;
  createdAt: string;
};

export async function getNotifications(): Promise<{ items: NotificationRow[]; unread: number }> {
  const { supabase, userId } = await actionContext();
  const { data } = await supabase
    .from("notifications")
    .select("id, type, title, body, demanda_id, is_read, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  const items = (data ?? []).map((n) => ({
    id: n.id, type: n.type, title: n.title, body: n.body, demandaId: n.demanda_id, isRead: n.is_read, createdAt: n.created_at,
  }));
  return { items, unread: items.filter((n) => !n.isRead).length };
}

export async function markNotificationsRead(ids?: string[]): Promise<void> {
  const { supabase, userId } = await actionContext();
  let q = supabase.from("notifications").update({ is_read: true }).eq("user_id", userId).eq("is_read", false);
  if (ids && ids.length) q = q.in("id", ids);
  await q;
}
