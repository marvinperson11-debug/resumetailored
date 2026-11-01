import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Generic webhook-delivery idempotency (`provider_webhook_events`, migration
 * 0086) shared by the Twilio and Checkr webhooks — both retry on a timeout
 * or non-2xx response, so every handler must tolerate redelivery of the same
 * event without double-processing it (double-charging a segment, re-firing
 * an audit entry, re-sending a notification).
 *
 * Same check-then-insert + unique-index shape lib/assistant-inbound.ts
 * already established for this codebase: a genuine unique-violation IS a
 * duplicate; any OTHER insert error is not evidence of one and must never
 * be reported as a successful dedupe.
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

export type ClaimOutcome = "claimed" | "duplicate" | "error";

function isUniqueViolationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  if (e.code === "23505") return true;
  return typeof e.message === "string" && /duplicate key|unique constraint/i.test(e.message);
}

/**
 * Claim one (provider, eventId) pair. Returns:
 *   - "claimed": this call owns processing this delivery — proceed.
 *   - "duplicate": a genuine unique-constraint hit — this delivery was
 *     already processed; answer 200 and do nothing else.
 *   - "error": the store itself is unavailable or something unrelated went
 *     wrong — the caller should NOT treat this as success, so Twilio/Checkr
 *     retries rather than the event silently vanishing.
 */
export async function claimWebhookEvent(provider: string, eventId: string): Promise<ClaimOutcome> {
  const c = db();
  if (!c || !provider || !eventId) return "error";
  try {
    const { error } = await c.from("provider_webhook_events").insert({ provider, event_id: eventId });
    if (!error) return "claimed";
    if (isUniqueViolationError(error)) return "duplicate";
    console.error("[webhook-idempotency] claim failed", { provider, eventId, error });
    return "error";
  } catch (e) {
    console.error("[webhook-idempotency] claim threw", { provider, eventId, error: e });
    return "error";
  }
}
