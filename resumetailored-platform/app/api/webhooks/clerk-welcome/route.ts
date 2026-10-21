import { NextResponse } from "next/server";
import { readSvixHeaders, verifySvixSignature, isStaleSvixTimestamp } from "@/lib/clerk-webhook-verify";
import { insertPendingWelcome, decideAndSend } from "@/lib/welcome-email";

export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * Platform-only Clerk webhook for the Welcome Email build. This is a SECOND,
 * independent endpoint on the same Clerk instance — the legacy app
 * (resumetailored.com, server.js) already has its own `/api/clerk-webhook`
 * (owner signup alert only) that this build does not touch; Clerk supports
 * multiple endpoints per instance, each with its own signing secret, and
 * this one receives every event for the instance (legacy registrations are
 * retired, so that is intended, not a leak).
 *
 * Auth is Svix (see lib/clerk-webhook-verify.ts): svix-id/svix-timestamp/
 * svix-signature headers, HMAC-verified against CLERK_PLATFORM_WEBHOOK_SECRET
 * with a 5-minute skew check. Missing/invalid -> 401. An unhandled event
 * type still answers 200 (Clerk sends many events this route has no
 * business reacting to; 200 just means "received", not "acted on").
 *
 * `user.created` only records that a welcome email is owed
 * (lib/welcome-email.ts `insertPendingWelcome`) — it never sends from here.
 * `user.updated` re-runs the send decision immediately using the metadata
 * already in the payload (no extra Clerk API round-trip): this is how an
 * employer-path signup — the legacy Stripe webhook's plan sync writing
 * `plan:"employer"` to publicMetadata — gets welcomed with the right
 * version without this route needing to know anything about Stripe. Either
 * way, `decideAndSend`'s own atomic claim (see that file) is what actually
 * enforces "sent at most once" — this route just supplies the signal.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const headers = readSvixHeaders(req.headers);
  const secret = process.env.CLERK_PLATFORM_WEBHOOK_SECRET;
  if (!secret || !headers) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (isStaleSvixTimestamp(headers.timestamp)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!verifySvixSignature(secret, headers, rawBody)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (() => {
    try {
      return JSON.parse(rawBody);
    } catch {
      return null;
    }
  })();
  if (!body || typeof body !== "object") return NextResponse.json({ error: "bad_payload" }, { status: 400 });

  const type = (body as Record<string, unknown>).type;
  const data = (body as Record<string, unknown>).data;
  if (!data || typeof data !== "object") return NextResponse.json({ ok: true });
  const d = data as Record<string, unknown>;
  const userId = typeof d.id === "string" ? d.id : null;
  if (!userId) return NextResponse.json({ ok: true });

  if (type === "user.created") {
    await insertPendingWelcome(userId);
    return NextResponse.json({ ok: true });
  }

  if (type === "user.updated") {
    const meta = (d.public_metadata ?? d.publicMetadata) as Record<string, unknown> | undefined;
    const planHint = meta && typeof meta.plan === "string" ? meta.plan : undefined;
    const emailAddresses = Array.isArray(d.email_addresses) ? (d.email_addresses as Array<Record<string, unknown>>) : [];
    const primaryId = d.primary_email_address_id;
    const primary = emailAddresses.find((e) => e.id === primaryId) || emailAddresses[0];
    const emailHint = typeof primary?.email_address === "string" ? (primary.email_address as string) : null;
    const firstNameHint = typeof d.first_name === "string" ? (d.first_name as string) : null;
    await decideAndSend(userId, { planHint, firstNameHint, emailHint });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}
