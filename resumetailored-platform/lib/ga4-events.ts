import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";

/*
 * lib/ga4-events.ts — GA4 key events via Measurement Protocol, platform side.
 * Keep behavior in sync with legacy ga4-events.js (repo root, used by
 * server.js): same client_id scheme, same MP payload shape, same
 * fire-and-forget contract (never throws, never awaited by its caller, so a
 * GA/Supabase failure can never affect the route it instruments or its
 * latency budget). The one real difference is where dedupe state lives — the
 * legacy app claims a key in its own SQLite `usage_store`; this app has no
 * SQLite, so it claims a row in Supabase `ga4_processed_events` (migration
 * 0070) instead, using the same check-then-insert + unique-index idempotency
 * shape lib/assistant-inbound.ts already established (`claimInboundEventKey`).
 *
 * free_claim_started / free_claim_completed instrument the employer
 * free-tier claim funnel (app/api/employer/claim-free/route.ts): "started"
 * fires once per user EVER, at the top of the handler right after auth;
 * "completed" fires once per user EVER, only after the Clerk metadata write
 * actually commits. A failed or duplicate claim fires nothing.
 */

const DEFAULT_MEASUREMENT_ID = "G-JWC76X5X68";
const MP_URL = "https://www.google-analytics.com/mp/collect";
const MP_DEBUG_URL = "https://www.google-analytics.com/debug/mp/collect";
const TIMEOUT_MS = 5000;
const DEDUPE_TABLE = "ga4_processed_events";

type Env = Record<string, string | undefined>;
type Logger = { log?: (...a: unknown[]) => void; error?: (...a: unknown[]) => void };

let loggedUnconfigured = false;
let cachedDb: SupabaseClient | null = null;

function db(env: Env): SupabaseClient | null {
  if (cachedDb) return cachedDb;
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cachedDb = createClient(url, key, { auth: { persistSession: false } });
  return cachedDb;
}

/** sha256(salt:seed) truncated to 32 hex chars — EXACT legacy scheme (ga4-events.js
 *  `ga4ClientId`), so the same Clerk userId stitches to the same pseudo-user in GA
 *  whether the event came from the legacy app or this one. The raw id never leaves
 *  our infra. */
export function ga4ClientId(seed: string, env: Env = process.env): string {
  const salt = env.GA4_CLIENT_SALT || "";
  return crypto.createHash("sha256").update(`${salt}:${String(seed || "")}`).digest("hex").slice(0, 32);
}

export interface SendResult {
  sent: boolean;
  reason: string;
}

interface SendOpts {
  env?: Env;
  fetchImpl?: typeof fetch;
  log?: Logger;
}

function fetchWithTimeout(fetchImpl: typeof fetch, url: string, opts: RequestInit): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  return fetchImpl(url, { ...opts, signal: ac.signal }).finally(() => clearTimeout(timer));
}

/**
 * Low-level MP sender. Never throws, never rejects. Skips silently (one
 * startup log) when GA4_API_SECRET is unset — every other environment must
 * not error because of it.
 */
export async function sendGA4Event(
  { eventName, params = {}, clientId, userId }: { eventName: string; params?: Record<string, unknown>; clientId: string; userId?: string },
  { env = process.env, fetchImpl = globalThis.fetch, log = console }: SendOpts = {}
): Promise<SendResult> {
  try {
    const secret = env.GA4_API_SECRET;
    if (!secret) {
      if (!loggedUnconfigured) {
        loggedUnconfigured = true;
        log.log?.("[ga4] GA4_API_SECRET not set — Measurement Protocol key events are disabled");
      }
      return { sent: false, reason: "unconfigured" };
    }
    if (!eventName || !clientId) return { sent: false, reason: "invalid_event" };
    const mid = env.GA4_MEASUREMENT_ID || DEFAULT_MEASUREMENT_ID;
    const base = env.GA4_DEBUG === "on" ? MP_DEBUG_URL : MP_URL;
    const url = `${base}?measurement_id=${encodeURIComponent(mid)}&api_secret=${encodeURIComponent(secret)}`;
    const body: Record<string, unknown> = { client_id: clientId, timestamp_micros: Date.now() * 1000, events: [{ name: eventName, params }] };
    if (userId) body.user_id = userId;
    let ok = false;
    try {
      const r = await fetchWithTimeout(fetchImpl, url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      ok = !!(r && r.status >= 200 && r.status < 300);
      if (!ok) log.error?.(`[ga4] ${eventName} MP call failed: status=${r && r.status}`);
    } catch (e) {
      log.error?.(`[ga4] ${eventName} send failed:`, e instanceof Error ? e.message : e);
    }
    return { sent: ok, reason: ok ? "ok" : "send_failed" };
  } catch (e) {
    log.error?.("[ga4] sendGA4Event error:", e instanceof Error ? e.message : e);
    return { sent: false, reason: "error" };
  }
}

/** A genuine unique-index violation (Postgres code 23505, or the message
 *  Postgres/PostgREST uses for one) IS a duplicate claim. Any other insert
 *  error is not evidence of a duplicate and must never be reported as one —
 *  same rule lib/assistant-inbound.ts `isUniqueViolationError` enforces. */
function isUniqueViolationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  if (e.code === "23505") return true;
  return typeof e.message === "string" && /duplicate key|unique constraint/i.test(e.message);
}

type ClaimOutcome = "claimed" | "duplicate" | "error" | "unconfigured";

/** One-per-user-ever claim, keyed on (user_id, event_name) — the unique index
 *  on ga4_processed_events (migration 0070) is the real race guard, same
 *  shape as lib/assistant-inbound.ts `claimInboundEventKey`. An unconfigured
 *  store (no Supabase env) never blocks sending — it just means this call
 *  can't dedupe, the same "best-effort, never block processing" precedent
 *  that file documents on itself. */
async function claimOnce(userId: string, eventName: string, env: Env, log: Logger): Promise<ClaimOutcome> {
  const c = db(env);
  if (!c) return "unconfigured";
  try {
    const { error } = await c.from(DEDUPE_TABLE).insert({ user_id: userId, event_name: eventName });
    if (!error) return "claimed";
    if (isUniqueViolationError(error)) return "duplicate";
    log.error?.("[ga4] claim insert failed", { eventName, error });
    return "error";
  } catch (e) {
    log.error?.("[ga4] claim threw", { eventName, error: e });
    return "error";
  }
}

/** Releases a claim after a failed send so a later call for the same user
 *  can still deliver the event — mirrors legacy `_claimAndSend`'s own
 *  insert-then-delete-on-failure pair. */
async function releaseClaim(userId: string, eventName: string, env: Env): Promise<void> {
  const c = db(env);
  if (!c) return;
  try {
    await c.from(DEDUPE_TABLE).delete().eq("user_id", userId).eq("event_name", eventName);
  } catch {
    // best-effort release; a stuck claim after a failed send just means a rare
    // future retry is treated as a duplicate — never worse than double-counting.
  }
}

/** Claim before send, release on failure — the dedupe row ends up present IFF
 *  the MP call actually returned 2xx, the same end-state legacy semantics
 *  produce, just against Supabase instead of SQLite. */
async function claimAndSend(userId: string, eventName: string, sendFn: () => Promise<SendResult>, env: Env, log: Logger): Promise<SendResult> {
  const claim = await claimOnce(userId, eventName, env, log);
  if (claim === "duplicate") return { sent: false, reason: "duplicate" };
  if (claim === "error") return { sent: false, reason: "error" };
  const result = await sendFn();
  if (!result.sent && claim === "claimed") await releaseClaim(userId, eventName, env);
  return result;
}

/**
 * GA4 key event: free_claim_started — fired at the TOP of the employer
 * free-claim handler (app/api/employer/claim-free/route.ts), right after the
 * caller is confirmed authenticated, before any further processing. Deduped
 * one-per-user-EVER: funnel math wants first-attempt signal, not
 * click-storm signal, so an immediate double-submit fires nothing the
 * second time.
 */
export async function trackFreeClaimStarted({ userId }: { userId: string }, opts: SendOpts = {}): Promise<SendResult> {
  if (!userId) return { sent: false, reason: "invalid_event" };
  const env = opts.env ?? process.env;
  const log = opts.log ?? console;
  const cid = ga4ClientId(userId, env);
  return claimAndSend(
    userId,
    "free_claim_started",
    () =>
      sendGA4Event(
        { eventName: "free_claim_started", params: { claim_source: "employer_free", plan: "free" }, clientId: cid, userId: cid },
        { env, fetchImpl: opts.fetchImpl, log }
      ),
    env,
    log
  );
}

/**
 * GA4 key event: free_claim_completed — fired only after the claim-free
 * handler's Clerk metadata write actually commits (a real new claim, not
 * "already employer" or a confirm-required reprompt). Same one-per-user-EVER
 * dedupe as `trackFreeClaimStarted`; a failed or duplicate claim fires
 * nothing, and a replay after a prior success never refires.
 */
export async function trackFreeClaimCompleted({ userId }: { userId: string }, opts: SendOpts = {}): Promise<SendResult> {
  if (!userId) return { sent: false, reason: "invalid_event" };
  const env = opts.env ?? process.env;
  const log = opts.log ?? console;
  const cid = ga4ClientId(userId, env);
  return claimAndSend(
    userId,
    "free_claim_completed",
    () =>
      sendGA4Event(
        { eventName: "free_claim_completed", params: { claim_source: "employer_free", plan: "free" }, clientId: cid, userId: cid },
        { env, fetchImpl: opts.fetchImpl, log }
      ),
    env,
    log
  );
}
