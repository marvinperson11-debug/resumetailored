import { NextResponse, type NextRequest } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { appUrl } from "@/lib/subdomain";
import { isDailyConfigured, listWebhooks, createWebhook } from "@/lib/daily";

export const runtime = "nodejs";
// Never let this route hang: cap the whole handler well under the Cloudflare→
// origin window so a slow dependency returns JSON, not a 502 host error.
export const maxDuration = 20;

const WEBHOOK_PATH = "/api/daily/webhook";
const EVENT_TYPES = ["recording.ready-to-download"];

/** The endpoint URL Daily should call, honoring DAILY_WEBHOOK_URL if set. */
function webhookUrl(): string {
  return process.env.DAILY_WEBHOOK_URL || appUrl(WEBHOOK_PATH);
}

/**
 * Admin-only, idempotent one-time setup: register the Daily Connect webhook
 * (`recording.ready-to-download` → /api/daily/webhook). Daily manages webhooks
 * via its REST API, not a dashboard page — so this route creates the endpoint
 * with our key. Safe to call repeatedly: it checks the account's existing
 * webhooks and only adds ours when missing.
 *
 * - `GET`            → read-only status (nothing changes).
 * - `GET ?do=1`      → register if missing (for a browser with no console —
 *                      just open the URL), otherwise report it exists.
 * - `POST`           → same registration as `GET ?do=1`.
 *
 * Every branch returns JSON — the whole body is wrapped so a thrown error or a
 * hung Daily call becomes a JSON 5xx instead of a crashed worker (Cloudflare
 * 502 host error).
 */
export async function GET(req: NextRequest) {
  return safe(async () => {
    const guard = await requireAdmin();
    if (guard) return guard;
    if (req.nextUrl.searchParams.get("do") === "1") return register();

    const url = webhookUrl();
    const existing = await listWebhooks();
    if (existing === null) return dailyUnreachable();
    const match = existing.find((w) => w.url === url);
    return NextResponse.json({
      url,
      registered: !!match,
      webhook: match || null,
      count: existing.length,
      hint: match ? undefined : "Open this URL with ?do=1 to register it.",
    });
  });
}

export async function POST() {
  return safe(async () => {
    const guard = await requireAdmin();
    if (guard) return guard;
    return register();
  });
}

/** Register the webhook if missing; idempotent. Shared by POST and GET?do=1. */
async function register(): Promise<NextResponse> {
  const url = webhookUrl();
  const existing = await listWebhooks();
  if (existing === null) return dailyUnreachable();

  const match = existing.find((w) => w.url === url);
  if (match) {
    return NextResponse.json({ status: "exists", url, uuid: match.uuid, eventTypes: match.eventTypes });
  }

  // If DAILY_WEBHOOK_SECRET is set, register with it so Daily signs deliveries
  // with our known secret (verification then works with no extra copy step).
  const hmac = process.env.DAILY_WEBHOOK_SECRET || undefined;
  const created = await createWebhook(url, EVENT_TYPES, hmac);
  if ("error" in created) {
    return NextResponse.json({ error: `Couldn't register the webhook: ${created.error}`, code: "daily_error" }, { status: 502 });
  }

  return NextResponse.json({
    status: "created",
    url,
    uuid: created.uuid,
    eventTypes: created.eventTypes || EVENT_TYPES,
    // Surface the hmac secret so the operator can set DAILY_WEBHOOK_SECRET to it
    // (only when we didn't already supply one).
    hmacSecret: hmac ? undefined : created.hmac,
    note: hmac
      ? "Registered and signed with your existing DAILY_WEBHOOK_SECRET — signature verification is active."
      : created.hmac
        ? "Registered. Set DAILY_WEBHOOK_SECRET in Railway to the hmacSecret above to enable signature verification, then redeploy."
        : "Registered. Daily did not return an hmac secret; deliveries are accepted unsigned (the webhook still validates payload shape).",
  });
}

/** Clear, app-owned JSON for a Daily control-plane timeout/failure — never a
 *  bare 502 that could be mistaken for a Cloudflare host error. */
function dailyUnreachable(): NextResponse {
  return NextResponse.json(
    {
      error: "Couldn't reach the Daily API (timed out or blocked). Check DAILY_API_KEY and Railway egress to api.daily.co, then retry.",
      code: "daily_unreachable",
    },
    { status: 503 }
  );
}

async function requireAdmin(): Promise<NextResponse | null> {
  // Resolve auth defensively — if Clerk is unreachable/misconfigured, treat the
  // caller as unauthenticated (403) rather than letting the throw bubble up.
  let ctx: Awaited<ReturnType<typeof employerContext>> = null;
  try {
    ctx = await employerContext();
  } catch (e) {
    console.error("[register-webhook] auth resolution failed", e);
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!ctx.access.isAdmin) return NextResponse.json({ error: "Admin only." }, { status: 403 });
  if (!isDailyConfigured()) return NextResponse.json({ error: "DAILY_API_KEY is not set on this deployment." }, { status: 503 });
  return null;
}

/** Run a handler, turning any thrown error into a JSON 500 (never a crashed
 *  worker / host-level 502). */
async function safe(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (e) {
    console.error("[register-webhook] handler threw", e);
    return NextResponse.json({ error: "Internal error while registering the webhook.", code: "internal" }, { status: 500 });
  }
}
