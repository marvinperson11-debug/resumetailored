import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The delayed candidate-message send queue for the Employer Portal AI
 * Assistant (assistant_send_queue, migration 0053). A `message_candidates`
 * mutation enqueues one row per candidate here on approval
 * (lib/assistant-mutations.ts); lib/assistant-send-worker.ts sends due rows
 * and the employer can cancel a still-queued row within the undo window via
 * the send-queue cancel route.
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

export type SendQueueStatus = "queued" | "sent" | "cancelled" | "failed";

export interface SendQueueRow {
  id: string;
  pendingActionId: string;
  employerId: string;
  candidateId: number;
  body: string;
  sendAt: string;
  status: SendQueueStatus;
  sentAt: string | null;
}

export interface EnqueueSendInput {
  pendingActionId: string;
  employerId: string;
  candidateId: number;
  body: string;
  sendAt: string;
}

const QUEUE_COLS = "id, pending_action_id, employer_id, candidate_id, body, send_at, status, sent_at";

function mapRow(r: Record<string, unknown>): SendQueueRow {
  return {
    id: r.id as string,
    pendingActionId: (r.pending_action_id as string) || "",
    employerId: (r.employer_id as string) || "",
    candidateId: Number(r.candidate_id),
    body: (r.body as string) || "",
    sendAt: (r.send_at as string) || "",
    status: (r.status as SendQueueStatus) || "queued",
    sentAt: (r.sent_at as string) ?? null,
  };
}

export async function enqueueSend(input: EnqueueSendInput): Promise<SendQueueRow | null> {
  const c = db();
  if (!c || !input.employerId || !input.pendingActionId || !Number.isFinite(input.candidateId)) return null;
  try {
    const { data, error } = await c
      .from("assistant_send_queue")
      .insert({
        pending_action_id: input.pendingActionId,
        employer_id: input.employerId,
        candidate_id: input.candidateId,
        body: input.body,
        send_at: input.sendAt,
        status: "queued",
      })
      .select(QUEUE_COLS)
      .single();
    if (error || !data) {
      console.error("[assistant-send-queue] enqueueSend failed", { input, error });
      return null;
    }
    return mapRow(data);
  } catch (e) {
    console.error("[assistant-send-queue] enqueueSend threw", { input, error: e });
    return null;
  }
}

/** Unscoped lookup by id, for the same 404-vs-403 reason as
 *  lib/assistant-pending.ts `getPendingActionById`. */
export async function getSendQueueById(id: string): Promise<SendQueueRow | null> {
  const c = db();
  if (!c || !id) return null;
  try {
    const { data } = await c.from("assistant_send_queue").select(QUEUE_COLS).eq("id", id).maybeSingle();
    return data ? mapRow(data) : null;
  } catch (e) {
    console.error("[assistant-send-queue] getSendQueueById threw", { id, error: e });
    return null;
  }
}

/** Every still-queued row for one pending action, for the approve route's
 *  response (the client renders the undo countdown from this). */
export async function listQueuedForPendingAction(pendingActionId: string): Promise<SendQueueRow[]> {
  const c = db();
  if (!c || !pendingActionId) return [];
  try {
    const { data, error } = await c.from("assistant_send_queue").select(QUEUE_COLS).eq("pending_action_id", pendingActionId).limit(200);
    if (error || !data) return [];
    return data.map(mapRow);
  } catch (e) {
    console.error("[assistant-send-queue] listQueuedForPendingAction threw", { pendingActionId, error: e });
    return [];
  }
}

/** Every queued row across every employer whose send_at has passed — for
 *  lib/assistant-send-worker.ts, same cross-employer-scan shape as
 *  lib/employer-collab-store.ts `listInterviewsForReminderScan`. Fetches by
 *  status at the query level and compares `send_at` in application code
 *  (this queue only ever holds a handful of rows at a time, bounded by the
 *  60s-ish undo window, so a second pass in JS is simpler than threading an
 *  inequality through the client). */
export async function listDueQueued(now: number = Date.now()): Promise<SendQueueRow[]> {
  const c = db();
  if (!c) return [];
  try {
    const { data, error } = await c.from("assistant_send_queue").select(QUEUE_COLS).eq("status", "queued").limit(500);
    if (error || !data) return [];
    return data.map(mapRow).filter((r) => {
      const t = new Date(r.sendAt).getTime();
      return Number.isFinite(t) && t <= now;
    });
  } catch (e) {
    console.error("[assistant-send-queue] listDueQueued threw", e);
    return [];
  }
}

export async function markSent(id: string): Promise<boolean> {
  const c = db();
  if (!c || !id) return false;
  try {
    const { error } = await c.from("assistant_send_queue").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", id);
    return !error;
  } catch (e) {
    console.error("[assistant-send-queue] markSent threw", { id, error: e });
    return false;
  }
}

export async function markFailed(id: string, reason: string): Promise<boolean> {
  const c = db();
  if (!c || !id) return false;
  try {
    // No dedicated failure_reason column on this table — a failed SEND is
    // rare (the candidate/approval precondition already passed once at
    // approval time) and the pending action's own failure_reason is what the
    // card surfaces; this status is enough for the worker's own log line.
    const { error } = await c.from("assistant_send_queue").update({ status: "failed" }).eq("id", id);
    if (error) console.error("[assistant-send-queue] markFailed", { id, reason, error });
    return !error;
  } catch (e) {
    console.error("[assistant-send-queue] markFailed threw", { id, error: e });
    return false;
  }
}

/** Cancel a still-queued row within its undo window. Returns false if it was
 *  no longer `queued` (already sent/cancelled/failed) at the moment of the
 *  attempt — the caller route distinguishes "already sent" (409) from
 *  "already cancelled" (no-op) using the row it already loaded. */
export async function cancelQueued(employerId: string, id: string): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !id) return false;
  try {
    const { data, error } = await c
      .from("assistant_send_queue")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("employer_id", employerId)
      .eq("status", "queued")
      .select(QUEUE_COLS)
      .maybeSingle();
    return !error && !!data;
  } catch (e) {
    console.error("[assistant-send-queue] cancelQueued threw", { id, error: e });
    return false;
  }
}
