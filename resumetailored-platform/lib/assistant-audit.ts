import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Append-only audit trail for the Employer Portal AI Assistant
 * (assistant_audit_log, migration 0051). Every tool call the assistant makes
 * is logged here — inputs only (payload_json), never the surrounding chat
 * text. The table itself rejects UPDATE/DELETE at the database level (see the
 * migration); this module additionally never exposes an update/delete
 * function, so there is no code path that could even attempt one.
 *
 * Rows are always scoped to employer_id — `listActions` takes it as a
 * required parameter and filters by it in the query itself, so there is no
 * way to read another employer's log through this module.
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

export type AssistantAuditStatus = "executed" | "failed";

export interface AssistantAuditEntry {
  id: string;
  employerId: string;
  actorUserId: string;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: Record<string, unknown>;
  status: AssistantAuditStatus;
  createdAt: string;
}

export interface LogActionInput {
  employerId: string;
  actorUserId: string;
  actorEmail?: string | null;
  /** The tool name (e.g. "get_jobs", "summarize_pipeline"). */
  action: string;
  targetType?: string | null;
  targetId?: string | number | null;
  payload?: Record<string, unknown>;
  status: AssistantAuditStatus;
}

function mapRow(r: Record<string, unknown>): AssistantAuditEntry {
  return {
    id: r.id as string,
    employerId: (r.employer_id as string) || "",
    actorUserId: (r.actor_user_id as string) || "",
    actorEmail: (r.actor_email as string) || null,
    action: (r.action as string) || "",
    targetType: (r.target_type as string) || null,
    targetId: r.target_id != null ? String(r.target_id) : null,
    payload: (r.payload_json as Record<string, unknown>) || {},
    status: (r.status as AssistantAuditStatus) || "executed",
    createdAt: (r.created_at as string) || "",
  };
}

/** Record one assistant tool call. Best-effort: a logging failure never
 *  throws (it must never block or crash the chat turn that triggered it),
 *  but it is loud in the server log since a silently-missing audit row for a
 *  tool call defeats the whole point of this module. */
export async function logAction(input: LogActionInput): Promise<void> {
  const c = db();
  if (!c || !input.employerId || !input.actorUserId || !input.action) return;
  try {
    const { error } = await c.from("assistant_audit_log").insert({
      employer_id: input.employerId,
      actor_user_id: input.actorUserId,
      actor_email: input.actorEmail || null,
      action: input.action,
      target_type: input.targetType || null,
      target_id: input.targetId != null ? String(input.targetId) : null,
      payload_json: input.payload || {},
      status: input.status,
    });
    if (error) console.error("[assistant-audit] logAction failed", { action: input.action, error });
  } catch (e) {
    console.error("[assistant-audit] logAction threw", { action: input.action, error: e });
  }
}

/** The most recent audit rows for ONE employer — always scoped, never a
 *  cross-employer read. Best-effort: an unreachable store resolves to []. */
export async function listActions(employerId: string, limit = 50): Promise<AssistantAuditEntry[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data, error } = await c
      .from("assistant_audit_log")
      .select("id, employer_id, actor_user_id, actor_email, action, target_type, target_id, payload_json, status, created_at")
      .eq("employer_id", employerId)
      .order("created_at", { ascending: false })
      .limit(Math.max(1, Math.min(limit, 500)));
    if (error || !data) return [];
    return data.map(mapRow);
  } catch (e) {
    console.error("[assistant-audit] listActions threw", e);
    return [];
  }
}
