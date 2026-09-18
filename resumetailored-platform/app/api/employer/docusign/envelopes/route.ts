import { NextResponse, type NextRequest } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import {
  listEnvelopes,
  listPollableEnvelopes,
  getValidAccessToken,
  updateStatusOwned,
} from "@/lib/docusign-store";
import { getEnvelope, normalizeEnvelopeStatus } from "@/lib/docusign";
import { deliverSignedDocuments } from "@/lib/esign-delivery";

export const runtime = "nodejs";

/**
 * List the employer's offer-letter envelopes. With `?refresh=1`, first runs a
 * lightweight fallback poll: for each non-terminal envelope, ask DocuSign for
 * its current status and persist any change. This keeps statuses fresh even when
 * the Connect webhook isn't configured. Capped so the request stays snappy.
 */
export async function GET(req: NextRequest) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (req.nextUrl.searchParams.get("refresh") === "1") {
    await pollStatuses(ctx.employerId);
  }

  const envelopes = await listEnvelopes(ctx.employerId);
  return NextResponse.json({ envelopes });
}

async function pollStatuses(employerId: string): Promise<void> {
  const pending = await listPollableEnvelopes(employerId);
  if (!pending.length) return;
  const access = await getValidAccessToken(employerId);
  if (!access) return;
  const ctx = { baseUri: access.baseUri, accountId: access.accountId, accessToken: access.accessToken };
  // Cap the number polled per request to bound latency.
  for (const env of pending.slice(0, 25)) {
    const remote = await getEnvelope(ctx, env.envelopeId);
    if (!remote) continue;
    const next = normalizeEnvelopeStatus(remote.status);
    if (next && next !== env.status) {
      await updateStatusOwned(employerId, env.envelopeId, next);
      // Deliver the signed documents when the poll is the first to see completion
      // (webhook not configured). Idempotent, so a later webhook won't double-send.
      if (next === "completed") await deliverSignedDocuments(env.envelopeId);
    }
  }
}
