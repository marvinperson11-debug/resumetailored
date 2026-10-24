import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { resolveUserEmail } from "@/lib/email";
import { getEnvelopeRecord, getValidAccessToken, markVoided } from "@/lib/docusign-store";
import { voidEnvelope } from "@/lib/docusign";
import { logAction } from "@/lib/assistant-audit";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Void an offer-letter/document envelope that is still awaiting signature
 * (Fix Round 7) — lets an employer close the loop on a candidate who ghosts
 * on a signed-pending offer rather than leaving it open forever. DocuSign
 * sends its own standard void notice to the signer; nothing further to send
 * here. Owner-scoped.
 *
 * Void only from 'sent' (Marvin's standing rule — completed envelopes are an
 * immutable record and are never exposed for voiding; no other in-progress
 * status is voidable either). `markVoided` performs the local status flip as
 * a single conditional UPDATE scoped to status='sent', so a race with a
 * webhook completing the envelope — or a second void request — loses
 * atomically rather than voiding something that already moved on; that is
 * also what makes voiding the same envelope twice safe (the second call's
 * local check, or the conditional UPDATE, finds nothing left to void).
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const env = await getEnvelopeRecord(ctx.employerId, id);
  if (!env) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (env.status !== "sent") {
    return NextResponse.json(
      {
        error: "not_voidable",
        message: "Only a document still awaiting signature can be voided. Completed documents are an immutable record.",
      },
      { status: 409 }
    );
  }
  if (!env.envelopeId) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const b = (await req.json().catch(() => ({}))) as { reason?: string };
  const reason = String(b.reason || "").trim().slice(0, 400) || "Withdrawn by employer";

  const access = await getValidAccessToken(ctx.employerId);
  if (!access) return NextResponse.json({ error: "not_connected" }, { status: 409 });

  const result = await voidEnvelope(
    { baseUri: access.baseUri, accountId: access.accountId, accessToken: access.accessToken },
    env.envelopeId,
    reason
  );
  if ("error" in result) {
    return NextResponse.json({ error: "void_failed", message: result.error }, { status: 502 });
  }

  const updated = await markVoided(ctx.employerId, id);
  if (!updated) {
    // Lost a race (e.g. the signer completed it, or a second void request got here first).
    return NextResponse.json(
      { error: "not_voidable", message: "This document can no longer be voided — it may have just been completed or already voided." },
      { status: 409 }
    );
  }

  const actorEmail = await resolveUserEmail(ctx.userId).catch(() => null);
  await logAction({
    employerId: ctx.employerId,
    actorUserId: ctx.userId,
    actorEmail,
    action: "void_envelope",
    targetType: "envelope",
    targetId: id,
    payload: { reason, docType: env.docType },
    status: "executed",
  });

  return NextResponse.json({ ok: true, envelope: updated });
}
