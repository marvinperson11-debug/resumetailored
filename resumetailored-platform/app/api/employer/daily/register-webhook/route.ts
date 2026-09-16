import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { appUrl } from "@/lib/subdomain";
import { isDailyConfigured, listWebhooks, createWebhook } from "@/lib/daily";

export const runtime = "nodejs";

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
 * webhooks and only adds ours when missing. GET reports current state without
 * changing anything.
 */
export async function GET() {
  const guard = await requireAdmin();
  if (guard) return guard;
  const url = webhookUrl();
  const existing = await listWebhooks();
  if (existing === null) return NextResponse.json({ error: "Couldn't list Daily webhooks." }, { status: 502 });
  const match = existing.find((w) => w.url === url);
  return NextResponse.json({
    url,
    registered: !!match,
    webhook: match || null,
    count: existing.length,
  });
}

export async function POST() {
  const guard = await requireAdmin();
  if (guard) return guard;

  const url = webhookUrl();
  const existing = await listWebhooks();
  if (existing === null) return NextResponse.json({ error: "Couldn't list Daily webhooks (check DAILY_API_KEY)." }, { status: 502 });

  const match = existing.find((w) => w.url === url);
  if (match) {
    return NextResponse.json({ status: "exists", url, uuid: match.uuid, eventTypes: match.eventTypes });
  }

  // If DAILY_WEBHOOK_SECRET is set, register with it so Daily signs deliveries
  // with our known secret (verification then works with no extra copy step).
  const hmac = process.env.DAILY_WEBHOOK_SECRET || undefined;
  const created = await createWebhook(url, EVENT_TYPES, hmac);
  if ("error" in created) {
    return NextResponse.json({ error: `Couldn't register the webhook: ${created.error}` }, { status: 502 });
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

async function requireAdmin(): Promise<NextResponse | null> {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!ctx.access.isAdmin) return NextResponse.json({ error: "Admin only." }, { status: 403 });
  if (!isDailyConfigured()) return NextResponse.json({ error: "DAILY_API_KEY is not set on this deployment." }, { status: 503 });
  return null;
}
