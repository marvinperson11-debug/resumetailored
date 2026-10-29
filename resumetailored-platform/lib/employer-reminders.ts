import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Employer-internal reminders (employer_reminders, migration 0075) — the
 * data-access layer for the Assistant's set_reminder/list_reminders/
 * cancel_reminder tools (lib/assistant-tools.ts) and the Scheduler page's
 * Reminders panel (app/employer/scheduler/scheduler-client.tsx). These are
 * NEVER candidate-facing, so — unlike every mutating tool in
 * lib/assistant-tools.ts — they execute directly: no
 * assistant_pending_actions row, no approval card. The 15s scan that fires
 * them lives in lib/reminder-cron.ts, kept in a separate file for the same
 * reason lib/cert-cron.ts is separate from lib/cert-store.ts: this file (the
 * store) is safe for instrumentation.ts's EDGE compile pass on its own
 * import graph, but keeping the scan's own notification/email imports out
 * of it means nothing here has to be re-audited if the scan's dependencies
 * ever change.
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

export type ReminderStatus = "pending" | "fired" | "cancelled";

export interface ReminderRow {
  id: string;
  employerId: string;
  actorUserId: string;
  actorEmail: string | null;
  title: string;
  note: string | null;
  dueAt: string;
  targetType: string | null;
  targetId: string | null;
  status: ReminderStatus;
  firedAt: string | null;
  createdAt: string;
}

function mapRow(r: Record<string, unknown>): ReminderRow {
  return {
    id: r.id as string,
    employerId: (r.employer_id as string) || "",
    actorUserId: (r.actor_user_id as string) || "",
    actorEmail: (r.actor_email as string) || null,
    title: (r.title as string) || "",
    note: (r.note as string) || null,
    dueAt: (r.due_at as string) || "",
    targetType: (r.target_type as string) || null,
    targetId: r.target_id != null ? String(r.target_id) : null,
    status: ((r.status as string) || "pending") as ReminderStatus,
    firedAt: (r.fired_at as string) || null,
    createdAt: (r.created_at as string) || "",
  };
}

export interface CreateReminderInput {
  employerId: string;
  actorUserId: string;
  actorEmail: string | null;
  title: string;
  note?: string | null;
  dueAt: string;
  targetType?: string | null;
  targetId?: string | number | null;
}

/** Create a new reminder — always a brand-new row; there is no upsert-by-title
 *  correction pattern here (unlike draft_job_post) because a reminder has no
 *  "still pending, still being refined" state for a chat correction to land
 *  on — it's either not yet due, or it's done. Asking twice simply creates
 *  two reminders, same as asking a person twice would. */
export async function createReminder(input: CreateReminderInput): Promise<ReminderRow | null> {
  const c = db();
  if (!c || !input.employerId || !input.actorUserId || !input.title.trim() || !input.dueAt) return null;
  const { data, error } = await c
    .from("employer_reminders")
    .insert({
      employer_id: input.employerId,
      actor_user_id: input.actorUserId,
      actor_email: input.actorEmail || null,
      title: input.title.trim().slice(0, 300),
      note: input.note ? input.note.slice(0, 2000) : null,
      due_at: input.dueAt,
      target_type: input.targetType || null,
      target_id: input.targetId != null ? String(input.targetId) : null,
      status: "pending",
    })
    .select()
    .single();
  if (error || !data) {
    console.error("[employer-reminders] createReminder failed", error);
    return null;
  }
  return mapRow(data);
}

/** This employer's OWN reminders, newest-due-first. Scoped by employer_id —
 *  never a cross-tenant read. `status` narrows to one state (e.g. 'pending'
 *  for the Scheduler panel's default view); omitted, every status comes
 *  back so a "what have I asked you to remind me of" question can be
 *  answered honestly, cancelled and fired included. */
export async function listReminders(employerId: string, status?: ReminderStatus): Promise<ReminderRow[]> {
  const c = db();
  if (!c || !employerId) return [];
  let q = c.from("employer_reminders").select("*").eq("employer_id", employerId).order("due_at", { ascending: true });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) {
    console.error("[employer-reminders] listReminders failed", error);
    return [];
  }
  return (data || []).map(mapRow);
}

export async function getReminderById(employerId: string, id: string): Promise<ReminderRow | null> {
  const c = db();
  if (!c || !employerId || !id) return null;
  const { data, error } = await c.from("employer_reminders").select("*").eq("id", id).eq("employer_id", employerId).maybeSingle();
  if (error || !data) return null;
  return mapRow(data);
}

/** Cancel a still-pending reminder. Scoped to (employerId, id) so one
 *  employer can never cancel another's row, and gated on status='pending' —
 *  cancelling something already fired or already cancelled is reported back
 *  as "not found/not pending" rather than silently rewriting history. */
export async function cancelReminder(employerId: string, id: string): Promise<{ found: boolean; cancelled: boolean }> {
  const existing = await getReminderById(employerId, id);
  if (!existing) return { found: false, cancelled: false };
  if (existing.status !== "pending") return { found: true, cancelled: false };
  const c = db();
  if (!c) return { found: true, cancelled: false };
  const { error } = await c.from("employer_reminders").update({ status: "cancelled" }).eq("id", id).eq("employer_id", employerId).eq("status", "pending");
  if (error) {
    console.error("[employer-reminders] cancelReminder failed", error);
    return { found: true, cancelled: false };
  }
  return { found: true, cancelled: true };
}

/** Every employer's still-pending, not-yet-fired reminder — cross-employer
 *  by design (the 15s scan fans out per-employer notification/email sends
 *  once it has the rows). Deliberately NOT filtered by due_at in the query
 *  itself: `reminderIsDue` below is the one place "is this actually due"
 *  is decided, exactly like lib/interview-reminders.ts `dueReminderWindows`
 *  keeps its own due-window math in pure, independently testable code
 *  rather than folded into the query. */
export async function listPendingReminders(): Promise<ReminderRow[]> {
  const c = db();
  if (!c) return [];
  const { data, error } = await c.from("employer_reminders").select("*").eq("status", "pending").is("fired_at", null);
  if (error) {
    console.error("[employer-reminders] listPendingReminders failed", error);
    return [];
  }
  return (data || []).map(mapRow);
}

/** Pure: is this reminder due yet? `now` defaults to Date.now() so callers
 *  rarely need to pass it; tests pass an explicit value for determinism. */
export function reminderIsDue(dueAtIso: string, now: number = Date.now()): boolean {
  const t = new Date(dueAtIso).getTime();
  return Number.isFinite(t) && t <= now;
}

/** Stamp a reminder fired — the idempotency guard. The `is("fired_at", null)`
 *  filter is what makes this safe against two overlapping scan ticks: only
 *  the first UPDATE actually matches a row (and so returns affected data);
 *  a second, concurrent attempt on the same id matches nothing and reports
 *  back `false` rather than re-firing. */
export async function markReminderFired(id: string, firedAtIso: string): Promise<boolean> {
  const c = db();
  if (!c) return false;
  const { data, error } = await c.from("employer_reminders").update({ status: "fired", fired_at: firedAtIso }).eq("id", id).is("fired_at", null).select();
  if (error) {
    console.error("[employer-reminders] markReminderFired failed", error);
    return false;
  }
  return !!(data && data.length);
}
