import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ActivityEvent, NotificationItem, NotificationAudience, LogActivityInput } from "./notifications-hub";

/**
 * In-app notification persistence — the log every bell reads from, plus
 * per-reader read-state. Service-role, best-effort (same contract as every
 * other store here): a failed log never throws and never blocks the action
 * that triggered it (training assigned, a message sent, …), it just means
 * that one bell entry is silently missing.
 */
let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

const EVENT_COLS = "id, audience, employee_id, event_type, title, body, link, created_at";
// How far back the bell looks, both for the dropdown and for the unread
// count — an ancient unread event falling out of this window is an
// acceptable trade for not scanning a whole company's history on every
// page load. "Recent notifications" is the spec; this is what bounds it.
const RECENT_WINDOW = 100;

function mapEvent(r: Record<string, unknown>): ActivityEvent {
  return {
    id: r.id as number,
    audience: (r.audience as NotificationAudience) || "employer",
    employeeId: (r.employee_id as number) ?? null,
    eventType: (r.event_type as string) || "",
    title: (r.title as string) || "",
    body: (r.body as string) || null,
    link: (r.link as string) || "",
    createdAt: (r.created_at as string) || "",
  };
}

/** Log one event for the employer's own bell (visible to the owner and any
 *  teammate with employer-portal access). Fire-and-forget: callers should not
 *  await-block the action that triggered it on this succeeding. */
export async function logActivityForEmployer(employerId: string, input: LogActivityInput): Promise<void> {
  const c = db();
  if (!c || !employerId) return;
  try {
    await c.from("activity_events").insert({
      employer_id: employerId,
      audience: "employer",
      employee_id: null,
      event_type: input.eventType,
      title: input.title.slice(0, 300),
      body: (input.body || "").slice(0, 1000) || null,
      link: input.link,
    });
  } catch (e) {
    console.error("[logActivityForEmployer]", e);
  }
}

/** Log the same event onto one employee's own bell. */
export async function logActivityForEmployee(employerId: string, employeeId: number, input: LogActivityInput): Promise<void> {
  const c = db();
  if (!c || !employerId || !employeeId) return;
  try {
    await c.from("activity_events").insert({
      employer_id: employerId,
      audience: "employee",
      employee_id: employeeId,
      event_type: input.eventType,
      title: input.title.slice(0, 300),
      body: (input.body || "").slice(0, 1000) || null,
      link: input.link,
    });
  } catch (e) {
    console.error("[logActivityForEmployee]", e);
  }
}

/** Log the same event onto several employees' bells at once — a broadcast
 *  (e.g. an announcement) is simply one row per employee, same fan-out shape
 *  `ensureAcknowledgments` already uses. */
export async function logActivityForEmployees(employerId: string, employeeIds: number[], input: LogActivityInput): Promise<void> {
  const c = db();
  if (!c || !employerId || !employeeIds.length) return;
  try {
    const rows = employeeIds.map((employeeId) => ({
      employer_id: employerId,
      audience: "employee" as const,
      employee_id: employeeId,
      event_type: input.eventType,
      title: input.title.slice(0, 300),
      body: (input.body || "").slice(0, 1000) || null,
      link: input.link,
    }));
    await c.from("activity_events").insert(rows);
  } catch (e) {
    console.error("[logActivityForEmployees]", e);
  }
}

async function readEventIds(userId: string, eventIds: number[]): Promise<Set<number>> {
  const c = db();
  if (!c || !userId || !eventIds.length) return new Set();
  try {
    const { data } = await c.from("notification_reads").select("event_id").eq("user_id", userId).in("event_id", eventIds);
    return new Set((data || []).map((r) => r.event_id as number));
  } catch {
    return new Set();
  }
}

/** The employer bell's recent events for one reader (the account owner or a
 *  teammate), each flagged with whether THIS reader has read it. */
export async function listForEmployer(employerId: string, userId: string, limit = 20): Promise<NotificationItem[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data } = await c
      .from("activity_events")
      .select(EVENT_COLS)
      .eq("employer_id", employerId)
      .eq("audience", "employer")
      .order("created_at", { ascending: false })
      .limit(RECENT_WINDOW);
    const events = (data || []).map(mapEvent);
    const readIds = await readEventIds(userId, events.map((e) => e.id));
    return events.slice(0, limit).map((e) => ({ ...e, read: readIds.has(e.id) }));
  } catch {
    return [];
  }
}

/** The employee bell's recent events for their own portal. */
export async function listForEmployee(employerId: string, employeeId: number, userId: string, limit = 20): Promise<NotificationItem[]> {
  const c = db();
  if (!c || !employerId || !employeeId) return [];
  try {
    const { data } = await c
      .from("activity_events")
      .select(EVENT_COLS)
      .eq("employer_id", employerId)
      .eq("audience", "employee")
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false })
      .limit(RECENT_WINDOW);
    const events = (data || []).map(mapEvent);
    const readIds = await readEventIds(userId, events.map((e) => e.id));
    return events.slice(0, limit).map((e) => ({ ...e, read: readIds.has(e.id) }));
  } catch {
    return [];
  }
}

export async function countUnreadForEmployer(employerId: string, userId: string): Promise<number> {
  const events = await listForEmployer(employerId, userId, RECENT_WINDOW);
  return events.filter((e) => !e.read).length;
}

export async function countUnreadForEmployee(employerId: string, employeeId: number, userId: string): Promise<number> {
  const events = await listForEmployee(employerId, employeeId, userId, RECENT_WINDOW);
  return events.filter((e) => !e.read).length;
}

/** Mark one notification read for this reader — called on click, when the
 *  bell item navigates to its deep link. */
export async function markRead(userId: string, eventId: number): Promise<void> {
  const c = db();
  if (!c || !userId || !eventId) return;
  try {
    await c.from("notification_reads").upsert({ user_id: userId, event_id: eventId }, { onConflict: "user_id,event_id", ignoreDuplicates: true });
  } catch (e) {
    console.error("[markRead]", e);
  }
}

/** Mark every given notification read at once ("Mark all read"). */
export async function markAllRead(userId: string, eventIds: number[]): Promise<void> {
  const c = db();
  if (!c || !userId || !eventIds.length) return;
  try {
    await c
      .from("notification_reads")
      .upsert(eventIds.map((eventId) => ({ user_id: userId, event_id: eventId })), { onConflict: "user_id,event_id", ignoreDuplicates: true });
  } catch (e) {
    console.error("[markAllRead]", e);
  }
}
