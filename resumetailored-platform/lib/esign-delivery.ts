/**
 * E-Signatures: envelope-attachment + signed-document delivery emails.
 *
 * Server-only, best-effort, fire-and-forget throughout — every function resolves
 * what it needs itself and silently no-ops when something is missing or Resend is
 * unset. Nothing here ever throws into a caller, so a failed email never blocks a
 * status update or an upload.
 */
import { getEmployerProfile } from "./employer-store";
import { sendEmail, resolveUserEmail, escapeHtml, emailShell, type EmailAttachment } from "./email";
import { employerSignatureHtml } from "./employer-signature";
import { appUrl } from "./subdomain";
import { getValidAccessToken, getEnvelopeByEnvelopeId, markSignedDocsEmailed, type EnvelopeLookup } from "./docusign-store";
import { getCombinedDocuments } from "./docusign";

/** The login-less signer upload page: /sign/{envelopeId}?key={token}. */
export function signUploadUrl(envelopeId: string, token: string): string {
  return appUrl(`/sign/${encodeURIComponent(envelopeId)}?key=${encodeURIComponent(token)}`);
}

async function employerContext(employerId: string): Promise<{ company: string; replyTo?: string; signature: string }> {
  const profile = await getEmployerProfile(employerId).catch(() => null);
  const replyTo = (await resolveUserEmail(employerId).catch(() => null)) || undefined;
  const signature = await employerSignatureHtml(employerId);
  return { company: profile?.companyName || "", replyTo, signature };
}

function uploadCta(url: string, label = "Upload documents"): string {
  return `<div style="margin:20px 0">
<a href="${escapeHtml(url)}" style="display:inline-block;background:#7c5cff;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600">${escapeHtml(label)}</a>
<p style="font-size:13px;color:#666;margin:8px 0 0">No account needed — open this secure link any time to upload:<br/><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
</div>`;
}

function pendingList(env: EnvelopeLookup): string {
  const pending = env.requestedDocs.filter((d) => !d.uploaded);
  if (!pending.length) return "";
  return `<p style="margin:12px 0 4px">Still needed:</p>
<ul style="margin:0 0 8px;padding-left:20px;color:#333">${pending.map((d) => `<li>${escapeHtml(d.name)}</li>`).join("")}</ul>`;
}

/**
 * On envelope completion: download the completed documents + certificate from
 * DocuSign and email them to the signer ("Your signed documents"), with the
 * upload link for any requested documents. Idempotent (guarded by
 * signed_docs_emailed_at) so the webhook + fallback poll can't double-send.
 */
export async function deliverSignedDocuments(envelopeId: string): Promise<void> {
  try {
    const env = await getEnvelopeByEnvelopeId(envelopeId);
    if (!env || env.signedDocsEmailedAt) return; // already delivered (or unknown)
    if (!env.candidateEmail) return;

    const { company, replyTo, signature } = await employerContext(env.employerId);

    // Best-effort document download — a failure degrades to a link-only email.
    let attachments: EmailAttachment[] | undefined;
    const access = await getValidAccessToken(env.employerId);
    if (access) {
      const pdf = await getCombinedDocuments(
        { baseUri: access.baseUri, accountId: access.accountId, accessToken: access.accessToken },
        env.envelopeId
      );
      if (pdf) {
        attachments = [
          { filename: "signed-documents.pdf", content: pdf.toString("base64"), contentType: "application/pdf" },
        ];
      }
    }

    const firstName = escapeHtml((env.candidateName || "there").split(" ")[0]);
    const companyLabel = company ? escapeHtml(company) : "the sender";
    const hasRequests = env.requestedDocs.some((d) => !d.uploaded);
    const url = signUploadUrl(env.envelopeId, env.signToken);
    const attachNote = attachments
      ? `<p>Your signed documents are attached to this email as a single PDF, including the certificate of completion.</p>`
      : `<p>Your document has been completed. A signed copy is on file with ${companyLabel} and can be shared with you on request.</p>`;
    const requestBlock = hasRequests
      ? `<p>${companyLabel} also asked you to upload a few documents.</p>${pendingList(env)}${uploadCta(url)}`
      : "";

    const ok = await sendEmail({
      to: env.candidateEmail,
      replyTo,
      fromName: company || undefined,
      subject: `Your signed documents${company ? ` — ${company}` : ""}`,
      attachments,
      html: emailShell(
        `<p>Hi ${firstName},</p>
<p>Thank you — the document you signed with ${companyLabel} is now complete.</p>
${attachNote}
${requestBlock}
<p style="font-size:13px;color:#666">Keep this email for your records.</p>`,
        signature
      ),
    });

    // Mark delivered once the email is accepted (or when there is no provider to
    // send with, to avoid a re-send loop). A transient send failure leaves the
    // guard unset so a later completion event can retry.
    if (ok || !process.env.RESEND_API_KEY) await markSignedDocsEmailed(env.envelopeId);
    else console.warn("[deliverSignedDocuments] send failed; will retry on next event", { envelopeId });
  } catch (e) {
    console.error("[deliverSignedDocuments] failed", { envelopeId, error: e });
  }
}

/** C5 — confirm to the signer that we received their upload. One per upload. */
export async function notifySignerOfUpload(env: EnvelopeLookup, filename: string, requestName?: string): Promise<void> {
  try {
    if (!env.candidateEmail) return;
    const { company, replyTo, signature } = await employerContext(env.employerId);
    const firstName = escapeHtml((env.candidateName || "there").split(" ")[0]);
    const forWhat = requestName
      ? `for the requested document <strong>${escapeHtml(requestName)}</strong>`
      : `to your document${env.documentName ? ` <strong>${escapeHtml(env.documentName)}</strong>` : ""}`;
    const url = signUploadUrl(env.envelopeId, env.signToken);
    await sendEmail({
      to: env.candidateEmail,
      replyTo,
      fromName: company || undefined,
      subject: `We received your document: ${filename}`,
      html: emailShell(
        `<p>Hi ${firstName},</p>
<p>We&apos;ve received <strong>${escapeHtml(filename)}</strong> ${forWhat}. Thank you!</p>
${pendingList(env)}
<p>Need to send more? You can upload additional documents any time using the same link:</p>
${uploadCta(url, "Upload more documents")}`,
        signature
      ),
    });
  } catch (e) {
    console.error("[notifySignerOfUpload] failed", e);
  }
}

/** D8 — notify the employer that a requested document arrived from the signer. */
export async function notifyEmployerOfUpload(env: EnvelopeLookup, filename: string, requestName?: string): Promise<void> {
  try {
    const to = await resolveUserEmail(env.employerId).catch(() => null);
    if (!to) return;
    const signature = await employerSignatureHtml(env.employerId);
    const signer = escapeHtml(env.candidateName || env.candidateEmail || "a signer");
    const forWhat = requestName ? ` (${escapeHtml(requestName)})` : "";
    await sendEmail({
      to,
      subject: `New document from ${env.candidateName || "signer"}: ${filename}`,
      html: emailShell(
        `<p><strong>${signer}</strong> uploaded a document${forWhat} on the envelope <strong>${escapeHtml(
          env.documentName || env.subject || "e-signature"
        )}</strong>.</p>
<p>File: <strong>${escapeHtml(filename)}</strong></p>
<p>Open the E-Signatures page in your ResumeTailored employer dashboard to view and download it.</p>`,
        signature
      ),
    });
  } catch (e) {
    console.error("[notifyEmployerOfUpload] failed", e);
  }
}

/** C7 — when the employer requests documents after sending, email the signer the
 *  upload link with the newly-added requests. */
export async function notifySignerOfDocRequest(env: EnvelopeLookup, addedNames: string[]): Promise<void> {
  try {
    if (!env.candidateEmail || !addedNames.length) return;
    const { company, replyTo, signature } = await employerContext(env.employerId);
    const firstName = escapeHtml((env.candidateName || "there").split(" ")[0]);
    const companyLabel = company ? escapeHtml(company) : "The sender";
    const url = signUploadUrl(env.envelopeId, env.signToken);
    await sendEmail({
      to: env.candidateEmail,
      replyTo,
      fromName: company || undefined,
      subject: `${company || "Documents"} requested from you`,
      html: emailShell(
        `<p>Hi ${firstName},</p>
<p>${companyLabel} has requested the following document${addedNames.length > 1 ? "s" : ""} from you:</p>
<ul style="margin:0 0 8px;padding-left:20px;color:#333">${addedNames.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>
${uploadCta(url)}`,
        signature
      ),
    });
  } catch (e) {
    console.error("[notifySignerOfDocRequest] failed", e);
  }
}
