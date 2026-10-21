import { NextResponse } from "next/server";
import { parseInboundPayload, processInboundReschedule } from "@/lib/assistant-inbound";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Inbound-email webhook for the reply-by-email interview reschedule flow
 * (Employer Portal AI Assistant — Prompt 3). Provider-agnostic: no inbound-
 * email SDK, just a shared-secret header check
 * (`INBOUND_WEBHOOK_SECRET` via `x-inbound-webhook-secret`) and a body shape
 * tolerant enough to read the common inbound-parse webhook field names (see
 * lib/assistant-inbound.ts `parseInboundPayload`).
 *
 * Unset `INBOUND_WEBHOOK_SECRET` means the whole feature is off: this route
 * answers 404 rather than 401, so its existence (and therefore that the
 * feature is configurable at all) is not disclosed to an unauthenticated
 * caller — the same "no information disclosed" posture the token lookup
 * itself uses for an unknown/expired/tampered token.
 */
export async function POST(req: Request) {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const header = req.headers.get("x-inbound-webhook-secret") || "";
  if (header !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const payload = parseInboundPayload(body);
  if (!payload) return NextResponse.json({ error: "bad_payload" }, { status: 400 });

  const result = await processInboundReschedule(payload);
  if (result.outcome === "invalid_token") {
    // Token lookup failure (unknown/expired/tampered) discloses nothing —
    // same 404 shape as the route being unconfigured.
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, outcome: result.outcome });
}
