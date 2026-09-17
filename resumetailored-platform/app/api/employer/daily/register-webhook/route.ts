import { NextResponse, type NextRequest } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { appUrl } from "@/lib/subdomain";
import { isDailyConfigured, listWebhooks, createWebhook } from "@/lib/daily";

export const runtime = "nodejs";
// maxDuration is a Vercel serverless directive and a no-op under `next start`
// on Railway (this app's runtime), so it can't be relied on to bound the
// handler. Every dependency call is bounded by its own AbortSignal timeout
// instead (Daily control-plane = 8s in lib/daily.ts).
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
 * with our key. Safe to call repeatedly.
 *
 * - `GET`            → read-only status (nothing changes).
 * - `GET ?do=1`      → register if missing (open the URL — no console needed).
 * - `POST`           → same registration as `GET ?do=1`.
 *
 * IMPORTANT — why operational failures return HTTP 200:
 * This deployment sits behind a Cloudflare layer that rewrites ANY origin 5xx
 * into an opaque branded "502 host error" page, so a JSON 502/503 body never
 * reaches the operator's browser (that is why earlier hardening looked like it
 * "did nothing" — it returned correct JSON that Cloudflare then masked). So all
 * EXPECTED operational outcomes here — registered / exists / created / not
 * configured / Daily unreachable / Daily rejected — return 200 with `ok:false`
 * and a `code`, and the failing reason is ALSO logged server-side. Only real
 * auth rejection stays a 403 (4xx passes through Cloudflare untouched). A
 * genuinely unexpected throw returns 200 `ok:false code:internal` too, so it is
 * visible rather than swallowed.
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
      ok: true,
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
    return NextResponse.json({ ok: true, status: "exists", url, uuid: match.uuid, eventTypes: match.eventTypes });
  }

  const hmac = process.env.DAILY_WEBHOOK_SECRET || undefined;
  const created = await createWebhook(url, EVENT_TYPES, hmac);
  if ("error" in created) {
    // The Daily-side reason is logged in lib/daily.ts; surface it to the
    // operator too. 200 so Cloudflare doesn't mask it (see the doc comment).
    console.error("[register-webhook] createWebhook failed:", created.error);
    return NextResponse.json(
      { ok: false, code: "daily_error", error: `Couldn't register the webhook: ${created.error}`, url },
      { status: 200 }
    );
  }

  return NextResponse.json({
    ok: true,
    status: "created",
    url,
    uuid: created.uuid,
    eventTypes: created.eventTypes || EVENT_TYPES,
    hmacSecret: hmac ? undefined : created.hmac,
    note: hmac
      ? "Registered and signed with your existing DAILY_WEBHOOK_SECRET — signature verification is active."
      : created.hmac
        ? "Registered. Set DAILY_WEBHOOK_SECRET in Railway to the hmacSecret above to enable signature verification, then redeploy."
        : "Registered. Daily did not return an hmac secret; deliveries are accepted unsigned (the webhook still validates payload shape).",
  });
}

/** Daily control-plane timed out or was unreachable (listWebhooks → null). The
 *  transport reason (AbortError / DNS / egress) is logged in lib/daily.ts.
 *  200 so the message reaches the operator through the Cloudflare layer. */
function dailyUnreachable(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      code: "daily_unreachable",
      error: "Couldn't reach the Daily API (timed out or blocked). Check DAILY_API_KEY and Railway egress to api.daily.co; the server log shows the transport error (AbortError = timeout, ENOTFOUND = DNS, ECONNREFUSED/ETIMEDOUT = egress).",
    },
    { status: 200 }
  );
}

async function requireAdmin(): Promise<NextResponse | null> {
  // Resolve auth defensively — a Clerk throw becomes 403 (4xx passes through
  // Cloudflare), never an unhandled rejection.
  let ctx: Awaited<ReturnType<typeof employerContext>> = null;
  try {
    ctx = await employerContext();
  } catch (e) {
    console.error("[register-webhook] auth resolution failed", e);
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  if (!ctx) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if (!ctx.access.isAdmin) return NextResponse.json({ ok: false, error: "Admin only." }, { status: 403 });
  // Not-configured is an operational state, not auth — return 200 so it is
  // visible through Cloudflare rather than masked as a 502.
  if (!isDailyConfigured())
    return NextResponse.json(
      { ok: false, code: "not_configured", error: "DAILY_API_KEY is not set on this deployment." },
      { status: 200 }
    );
  return null;
}

/** Run a handler; turn any thrown error into a VISIBLE 200 `ok:false` (a 5xx
 *  would be masked by the Cloudflare layer) and log it. */
async function safe(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (e) {
    const err = e as { name?: string; message?: string };
    console.error("[register-webhook] handler threw", err?.name, err?.message, e);
    return NextResponse.json(
      { ok: false, code: "internal", error: `Internal error: ${err?.name || "Error"}: ${err?.message || "unknown"}` },
      { status: 200 }
    );
  }
}
