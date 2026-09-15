import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { getApplicant, getEmployerProfile } from "@/lib/employer-store";
import {
  getValidAccessToken,
  monthlySendCount,
  createEnvelopeRecord,
} from "@/lib/docusign-store";
import {
  isDocusignConfigured,
  buildOfferLetterDefinition,
  createEnvelope,
  normalizeEnvelopeStatus,
} from "@/lib/docusign";
import { checkSendAllowance } from "@/lib/employer-plan";
import type { DocusignStatus, OfferTerms } from "@/lib/employer-ai";

export const runtime = "nodejs";

/**
 * Send an offer letter for e-signature. Builds a clean offer-letter document
 * server-side from the offer terms, creates a DocuSign envelope addressed to the
 * candidate, and records it. Enforces the tier's monthly send cap first.
 */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (!isDocusignConfigured()) {
    return NextResponse.json({ error: "DocuSign is not configured on this deployment." }, { status: 503 });
  }

  const b = (await req.json().catch(() => ({}))) as {
    applicantId?: number;
    shortlistMemberId?: number;
    candidateName?: string;
    candidateEmail?: string;
    position?: string;
    salary?: string;
    startDate?: string;
    extraTerms?: string;
    subject?: string;
    message?: string;
  };

  // Resolve the candidate: prefer the applicant record, fall back to the body.
  let candidateName = (b.candidateName || "").trim();
  let candidateEmail = (b.candidateEmail || "").trim();
  let applicantId: number | null = null;
  if (b.applicantId && Number.isFinite(b.applicantId)) {
    const applicant = await getApplicant(ctx.employerId, b.applicantId);
    if (!applicant) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
    applicantId = applicant.id;
    candidateName = candidateName || applicant.name;
    candidateEmail = candidateEmail || applicant.email;
  }
  candidateName = candidateName || "Candidate";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(candidateEmail)) {
    return NextResponse.json(
      { error: "This candidate has no email on file. Add their email address before sending an offer." },
      { status: 400 }
    );
  }

  const offer: OfferTerms = {
    position: (b.position || "").trim(),
    salary: (b.salary || "").trim(),
    startDate: (b.startDate || "").trim(),
    extraTerms: (b.extraTerms || "").trim(),
  };
  if (!offer.position) return NextResponse.json({ error: "A position title is required." }, { status: 400 });

  // Enforce the monthly send cap BEFORE creating the envelope.
  const used = await monthlySendCount(ctx.employerId);
  const allowance = checkSendAllowance(ctx.access, used);
  if (!allowance.allowed) {
    return NextResponse.json({ error: allowance.message, code: "limit_reached" }, { status: 402 });
  }

  // Ensure we have a live DocuSign connection (refreshing the token as needed).
  const access = await getValidAccessToken(ctx.employerId);
  if (!access) {
    return NextResponse.json(
      { error: "DocuSign isn't connected. Connect your DocuSign account first.", code: "not_connected" },
      { status: 409 }
    );
  }

  const profile = await getEmployerProfile(ctx.employerId);
  const companyName = profile?.companyName || "";
  const subject = (b.subject || "").trim() || `Your offer${companyName ? ` from ${companyName}` : ""}`;
  const message = (b.message || "").trim();

  const definition = buildOfferLetterDefinition({
    offer,
    candidateName,
    candidateEmail,
    companyName,
    subject,
    message,
    senderName: companyName,
  });

  const result = await createEnvelope(
    { baseUri: access.baseUri, accountId: access.accountId, accessToken: access.accessToken },
    definition
  );
  if ("error" in result) {
    return NextResponse.json({ error: `Couldn't send via DocuSign: ${result.error}` }, { status: 502 });
  }

  const status = (normalizeEnvelopeStatus(result.status) || "sent") as DocusignStatus;
  const envelope = await createEnvelopeRecord(ctx.employerId, {
    applicantId,
    shortlistMemberId: b.shortlistMemberId && Number.isFinite(b.shortlistMemberId) ? b.shortlistMemberId : null,
    envelopeId: result.envelopeId,
    subject,
    message,
    status,
    offer,
    candidateName,
    candidateEmail,
    sentBy: ctx.userId,
  });

  return NextResponse.json({ envelope, envelopeId: result.envelopeId, status });
}
