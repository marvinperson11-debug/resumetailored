import crypto from "crypto";
import { getApplicant, getEmployerProfile } from "./employer-store";
import { getValidAccessToken, monthlySendCount, createEnvelopeRecord, advanceApplicantOnSend, getTemplateForSend } from "./docusign-store";
import { isDocusignConfigured, buildEnvelope, applyTemplate, renderTemplateSubject, offerToMergeValues, createEnvelope, normalizeEnvelopeStatus } from "./docusign";
import { checkSendAllowance } from "./employer-plan";
import type { Access } from "./plan";
import type { DocusignStatus, OfferTerms, DocusignEnvelope } from "./employer-ai";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Send an OFFER letter for e-signature — the ONE code path both the
 * hand-driven DocuSign send form (app/api/employer/docusign/send/route.ts)
 * and the Employer Portal AI Assistant's send_offer tool
 * (lib/assistant-mutations.ts `executeSendOffer`) call. Extracted out of the
 * route so there is no parallel implementation, per the build's standing
 * rule for every assistant mutation that mirrors a hand-driven action.
 *
 * Agreement / NDA / write-up / custom documents are deliberately NOT covered
 * here — those stay inline in the hand route exactly as before. Only the
 * offer path moved, because that's the only one send_offer needs.
 */
export interface SendOfferInput {
  applicantId: number;
  position: string;
  salary: string;
  startDate: string;
  extraTerms?: string;
  message?: string;
  subject?: string;
  /** Overrides the applicant's own name/email, same as the hand route's
   *  optional manual-entry fields. */
  candidateName?: string;
  candidateEmail?: string;
  /** Only ever set by the hand route (a shortlist-originated send); the
   *  Assistant's send_offer tool never sets this. */
  shortlistMemberId?: number | null;
}

export interface SendOfferFailure {
  ok: false;
  code: "not_configured" | "not_found" | "invalid_position" | "invalid_email" | "limit_reached" | "not_connected" | "docusign_error" | "save_failed";
  message: string;
  /** Only set for code === "limit_reached" — lets a caller reproduce the
   *  hand route's exact `{kind:"esign", limit, tier}` response shape. */
  limit?: number;
  tier?: string;
  /** The HTTP status the hand route should answer with for this failure. */
  status: number;
}

export type SendOfferOutcome = { ok: true; envelope: DocusignEnvelope; envelopeId: string; status: DocusignStatus } | SendOfferFailure;

export async function sendOfferEnvelope(employerId: string, userId: string, access: Access, input: SendOfferInput): Promise<SendOfferOutcome> {
  if (!isDocusignConfigured()) return { ok: false, code: "not_configured", message: "DocuSign is not configured on this deployment.", status: 503 };

  const applicant = await getApplicant(employerId, input.applicantId);
  if (!applicant) return { ok: false, code: "not_found", message: "Candidate not found.", status: 404 };

  const offer: OfferTerms = {
    position: (input.position || "").trim(),
    salary: (input.salary || "").trim(),
    startDate: (input.startDate || "").trim(),
    extraTerms: (input.extraTerms || "").trim(),
  };
  if (!offer.position) return { ok: false, code: "invalid_position", message: "A position title is required.", status: 400 };
  const message = (input.message || "").trim();

  const signerName = (input.candidateName || applicant.name || "Recipient").trim() || "Recipient";
  const signerEmail = (input.candidateEmail || applicant.email || "").trim();
  if (!EMAIL_RE.test(signerEmail)) {
    return { ok: false, code: "invalid_email", message: "This recipient has no valid email. Add their email address before sending.", status: 400 };
  }

  const profile = await getEmployerProfile(employerId);
  const companyName = profile?.companyName || "";
  const tpl = await getTemplateForSend(employerId, "offer");
  const values = offerToMergeValues({ offer, candidateName: signerName, companyName, message });
  const documentHtml = applyTemplate(tpl.bodyHtml, values);
  const documentName = "Offer letter";
  const subject = (input.subject || "").trim() || renderTemplateSubject(tpl.subject, values) || `${documentName}${companyName ? ` from ${companyName}` : ""}`;

  // Enforce the monthly send cap BEFORE creating the envelope — same order as the hand route.
  const used = await monthlySendCount(employerId);
  const allowance = checkSendAllowance(access, used);
  if (!allowance.allowed) {
    return { ok: false, code: "limit_reached", message: allowance.message, limit: allowance.limit, tier: allowance.tier, status: 402 };
  }

  const tokenAccess = await getValidAccessToken(employerId);
  if (!tokenAccess) {
    return { ok: false, code: "not_connected", message: "DocuSign isn't connected. Connect your DocuSign account first.", status: 409 };
  }

  const definition = buildEnvelope({ documentHtml, documentName, subject, message, signerName, signerEmail });
  const result = await createEnvelope({ baseUri: tokenAccess.baseUri, accountId: tokenAccess.accountId, accessToken: tokenAccess.accessToken }, definition);
  if ("error" in result) {
    return { ok: false, code: "docusign_error", message: `Couldn't send via DocuSign: ${result.error}`, status: 502 };
  }

  const status = (normalizeEnvelopeStatus(result.status) || "sent") as DocusignStatus;
  const signToken = crypto.randomUUID();
  const envelope = await createEnvelopeRecord(employerId, {
    docType: "offer",
    documentName: "",
    applicantId: applicant.id,
    shortlistMemberId: input.shortlistMemberId ?? null,
    envelopeId: result.envelopeId,
    subject,
    message,
    status,
    offer,
    candidateName: signerName,
    candidateEmail: signerEmail,
    sentBy: userId,
    signToken,
    requestedDocs: [],
  });
  if (!envelope) {
    return { ok: false, code: "save_failed", message: "Sent via DocuSign, but could not save the record. Check your DocuSign dashboard.", status: 500 };
  }

  await advanceApplicantOnSend(applicant.id, "offer");
  return { ok: true, envelope, envelopeId: result.envelopeId, status };
}
