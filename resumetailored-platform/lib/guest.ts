import { createHmac, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getClientIp } from "./client-ip";
import { guestSalt, guestBudgetUsd, assertGuestConfig, DEFAULT_DAILY_BUDGET_USD } from "./guest-config";

export { getClientIp, guestSalt, guestBudgetUsd, assertGuestConfig, DEFAULT_DAILY_BUDGET_USD };

/**
 * Guest (signed-out) access to the free tools.
 *
 * A visitor with no account gets a small taste of the free tier — e.g. one resume tailor
 * a day — and, at the cap, a 402 that asks them to create a free account (unlimited).
 * Signed-in users never come through here: every route checks `auth()` first and only a
 * request with no `userId` is gated.
 *
 * Identity. A guest is the HMAC of (client IP, `rt_guest` cookie) under GUEST_QUOTA_SALT;
 * only that opaque id is stored, never an address. The cookie keeps two people behind one
 * campus/office IP from sharing a single allowance. A cookie alone must not be the whole
 * story, though: a client that drops it (curl, a script) would be handed a fresh identity
 * — and a fresh allowance — on every request. So each reservation also charges a looser
 * per-IP ceiling (IP_CEILING_MULTIPLIER x the tool's cap), and the global spend ceiling
 * below is the backstop for everything else (rotating IPs, a forged CF-Connecting-IP on
 * the *.up.railway.app host).
 *
 * Reserve, then spend. The slot is taken in Postgres (supabase/migrations/0048) BEFORE any
 * Claude call, in a single statement, so concurrent requests cannot both take the last
 * one; it is refunded if the call then fails. What the call really cost is added to a
 * daily total from the response's `usage`, and once that total passes
 * GUEST_DAILY_BUDGET_USD no NEW guest generation starts until 00:00 UTC.
 *
 * Fail closed. If the quota store is unreachable the guest is declined (signed-in users are
 * unaffected): an outage must not become unmetered anonymous spend.
 */

export const GUEST_COOKIE = "rt_guest";
const COOKIE_MAX_AGE_S = 180 * 24 * 60 * 60;
const COOKIE_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** The per-IP ceiling is this many times a tool's per-guest cap. */
export const IP_CEILING_MULTIPLIER = 10;

/** USD per million tokens for CLAUDE_MODEL (claude-sonnet-4-6). Re-check when the model changes
 *  — test/test-guest-gate.cjs fails if CLAUDE_MODEL moves without this being revisited. */
export const SPEND_MODEL = "claude-sonnet-4-6";
export const RATE_IN_PER_MTOK = 3;
export const RATE_OUT_PER_MTOK = 15;

export interface GuestToolDef {
  /** Uses per guest per UTC day. */
  limit: number;
  /** Reads after "You've used today's free …". */
  label: string;
  /** Calls Claude, so it is held back once the daily spend ceiling trips. */
  claude: boolean;
}

export const GUEST_TOOLS = {
  tailor: { limit: 1, label: "resume tailoring", claude: true },
  "cover-letter": { limit: 1, label: "cover letter", claude: true },
  "ats-scan": { limit: 3, label: "ATS scans", claude: true },
  "extract-text": { limit: 3, label: "resume uploads", claude: false },
  "fetch-job-url": { limit: 3, label: "job-link imports", claude: true },
  "linkedin-scrape": { limit: 1, label: "LinkedIn profile import", claude: false },
  "linkedin-import": { limit: 1, label: "LinkedIn export import", claude: false },
  "linkedin-analyze": { limit: 1, label: "LinkedIn profile analysis", claude: true },
  "interview-questions": { limit: 1, label: "interview question set", claude: true },
  "interview-feedback": { limit: 1, label: "interview answer review", claude: true },
  "jobs-search": { limit: 1, label: "job search", claude: true },
  "jobs-cover-letter": { limit: 1, label: "job cover letter", claude: true },
  "jobs-apply-package": { limit: 1, label: "apply package", claude: true },
  "career-insights": { limit: 1, label: "career insights", claude: true },
  "career-skill-gap": { limit: 1, label: "skill-gap analysis", claude: true },
  "career-roadmap": { limit: 1, label: "career roadmap", claude: true },
  "decoder-decode": { limit: 1, label: "job posting decode", claude: true },
} as const satisfies Record<string, GuestToolDef>;

export type GuestTool = keyof typeof GUEST_TOOLS;

export function accountUrgeMessage(label: string): string {
  return `You've used today's free ${label}. Create a free account — it's free, unlimited, and saves your work.`;
}
const UNAVAILABLE_MESSAGE =
  "The free trial is unavailable right now. Create a free account to keep going — it's free, unlimited, and saves your work.";

// ── identity ────────────────────────────────────────────────────────────────────

interface Identity {
  /** HMAC(salt, ip + ":" + cookie) — the guest's own allowance. */
  id: string;
  /** "ip:" + HMAC(salt, ip) — the shared per-IP ceiling. */
  ipKey: string;
  /** A cookie value to hand the browser, or null if it already had a valid one. */
  newCookie: string | null;
}

const identities = new WeakMap<Request, Identity>();

const hmac = (salt: string, data: string): string => createHmac("sha256", salt).update(data).digest("hex").slice(0, 32);

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function identityFor(req: Request): Identity {
  const cached = identities.get(req);
  if (cached) return cached;
  const salt = guestSalt();
  const ip = getClientIp(req);
  const sent = readCookie(req, GUEST_COOKIE);
  const existing = sent && COOKIE_RE.test(sent) ? sent : null;
  const cookie = existing ?? randomBytes(18).toString("base64url");
  const identity: Identity = {
    id: hmac(salt, `${ip}:${cookie}`),
    ipKey: `ip:${hmac(salt, ip)}`,
    newCookie: existing ? null : cookie,
  };
  identities.set(req, identity);
  return identity;
}

function cookieHeader(value: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${GUEST_COOKIE}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE_S}; HttpOnly; SameSite=Lax${secure}`;
}

/** Wrap a route handler so a guest identity minted during the request leaves the browser
 *  with its `rt_guest` cookie — on success, on 402 and on error alike. A request that never
 *  touched the guest path (every signed-in call) is returned untouched. */
export function withGuestCookie<A extends unknown[]>(handler: (req: Request, ...rest: A) => Promise<Response>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    const res = await handler(req, ...rest);
    const identity = identities.get(req);
    if (identity?.newCookie) res.headers.append("Set-Cookie", cookieHeader(identity.newCookie));
    return res;
  };
}

// ── store ───────────────────────────────────────────────────────────────────────

let cachedDb: SupabaseClient | null = null;
function getDb(): SupabaseClient | null {
  if (cachedDb) return cachedDb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cachedDb = createClient(url, key, { auth: { persistSession: false } });
  return cachedDb;
}

const utcDay = (): string => new Date().toISOString().slice(0, 10);

/** Today's anonymous Claude spend in micro-USD, or null if the store cannot be read. */
async function spentMicroUsd(db: SupabaseClient, day: string): Promise<number | null> {
  try {
    const { data, error } = await db.from("guest_spend").select("micro_usd").eq("day", day).maybeSingle();
    if (error) {
      console.error("[guest] spend read failed:", error.message);
      return null;
    }
    return data ? Number((data as { micro_usd: number | string }).micro_usd) : 0;
  } catch (e) {
    console.error("[guest] spend read threw:", e instanceof Error ? e.message : e);
    return null;
  }
}

export interface ClaudeUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
}

/** micro-USD (1e-6 dollar) for one response: tokens x ($ per million tokens) is exactly micro-USD. */
export function usageMicroUsd(usage: ClaudeUsage | null | undefined): number {
  if (!usage) return 0;
  const inTok = Math.max(0, Number(usage.input_tokens) || 0);
  const outTok = Math.max(0, Number(usage.output_tokens) || 0);
  return Math.ceil(inTok * RATE_IN_PER_MTOK + outTok * RATE_OUT_PER_MTOK);
}

let trippedDay = "";
function logBudgetTripped(day: string, spentMicro: number): void {
  if (trippedDay === day) return; // once per day per instance; every blocked request would just be noise
  trippedDay = day;
  console.error(
    `[guest-budget] TRIPPED — anonymous Claude spend for ${day} is $${(spentMicro / 1e6).toFixed(2)}, over the $${guestBudgetUsd()} ceiling (GUEST_DAILY_BUDGET_USD). ` +
      `New guest generations are blocked until 00:00 UTC; signed-in users are unaffected. Raise GUEST_DAILY_BUDGET_USD to reopen.`
  );
}

// ── the gate ────────────────────────────────────────────────────────────────────

export interface GuestGate {
  readonly tool: GuestTool;
  /** Give the slot back (the Claude call or the work failed). Safe to call more than once. */
  refund(): Promise<void>;
  /** Add what a Claude response cost to today's anonymous total. Never throws. */
  recordUsage(usage: ClaudeUsage | null | undefined): Promise<void>;
}

export type GuestReservation = { ok: true; gate: GuestGate } | { ok: false; response: NextResponse };

function decline(status: number, error: string, extra: Record<string, unknown> = {}): { ok: false; response: NextResponse } {
  return { ok: false, response: NextResponse.json({ error, guest: true, message: UNAVAILABLE_MESSAGE, ...extra }, { status }) };
}

/**
 * Take one use of `tool` for the signed-out caller, or say why not. Call it AFTER validating
 * the request (a malformed request must not burn the allowance) and BEFORE the Claude call.
 */
export async function guestReserve(req: Request, tool: GuestTool): Promise<GuestReservation> {
  const def: GuestToolDef = GUEST_TOOLS[tool];
  let identity: Identity;
  try {
    identity = identityFor(req);
  } catch (e) {
    console.error("[guest]", e instanceof Error ? e.message : e);
    return decline(503, "guest_unavailable");
  }
  const db = getDb();
  if (!db) {
    console.error("[guest] Supabase service-role credentials are not configured — declining the guest request");
    return decline(503, "guest_unavailable");
  }
  const day = utcDay();

  if (def.claude) {
    const spent = await spentMicroUsd(db, day);
    if (spent === null) return decline(503, "guest_unavailable");
    if (spent > guestBudgetUsd() * 1e6) {
      logBudgetTripped(day, spent);
      return decline(503, "guest_capacity");
    }
  }

  let outcome: unknown;
  try {
    const { data, error } = await db.rpc("guest_quota_reserve", {
      p_guest: identity.id,
      p_ip_key: identity.ipKey,
      p_day: day,
      p_tool: tool,
      p_limit: def.limit,
      p_ip_limit: def.limit * IP_CEILING_MULTIPLIER,
    });
    if (error) console.error("[guest] reserve failed:", error.message);
    outcome = error ? null : data;
  } catch (e) {
    console.error("[guest] reserve threw:", e instanceof Error ? e.message : e);
    outcome = null;
  }
  if (outcome === "guest_cap" || outcome === "ip_cap") {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "guest_quota",
          tool,
          limit: def.limit,
          resets: "tomorrow",
          guest: true,
          ...(outcome === "ip_cap" ? { scope: "network" } : {}),
          message: accountUrgeMessage(def.label),
        },
        { status: 402 }
      ),
    };
  }
  if (outcome !== "ok") return decline(503, "guest_unavailable");

  let refunded = false;
  return {
    ok: true,
    gate: {
      tool,
      async refund() {
        if (refunded) return;
        refunded = true;
        try {
          const { error } = await db.rpc("guest_quota_refund", { p_guest: identity.id, p_ip_key: identity.ipKey, p_day: day, p_tool: tool });
          if (error) console.error("[guest] refund failed:", error.message);
        } catch (e) {
          console.error("[guest] refund threw:", e instanceof Error ? e.message : e);
        }
      },
      async recordUsage(usage) {
        const micro = usageMicroUsd(usage);
        if (!micro) return;
        try {
          const { error } = await db.rpc("guest_spend_add", { p_day: day, p_micro: micro });
          if (error) console.error("[guest] spend add failed:", error.message);
        } catch (e) {
          console.error("[guest] spend add threw:", e instanceof Error ? e.message : e);
        }
      },
    },
  };
}

/** How many of today's uses this guest has taken (read-only; for quota readouts). */
export async function guestUsedToday(req: Request, tool: GuestTool): Promise<number> {
  try {
    const identity = identityFor(req);
    const db = getDb();
    if (!db) return 0;
    const { data } = await db.from("guest_quotas").select("count").eq("guest_id", identity.id).eq("day", utcDay()).eq("tool", tool).maybeSingle();
    return data ? Number((data as { count: number }).count) || 0 : 0;
  } catch {
    return 0;
  }
}
