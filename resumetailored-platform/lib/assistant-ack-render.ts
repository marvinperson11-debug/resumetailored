import { escapeHtml, EMAIL_SHELL_FOOTER } from "./email";

/**
 * The exact greeting + body + sign-off + footer shape of a standing
 * auto-application-acknowledgment email — shared by the REAL send
 * (lib/assistant-ack-worker.ts `notifyCandidateOfAck`) and the confirmation
 * card's preview (lib/assistant-mutations.ts `buildSetAckTemplateArtifact`),
 * so the card the employer approves can never drift from what `sendEmail`
 * actually delivers (Prompt 5a, "approve what sends"). `firstName` is the
 * real applicant's first name for a real send, or the literal
 * `{{firstName}}` placeholder for the card's preview — there is no real
 * applicant yet when a STANDING template is being approved.
 */
export interface AckEmailParts {
  greeting: string;
  body: string;
  signOff: string;
  footer: string;
}

export function ackEmailParts(firstName: string, body: string, companyName: string): AckEmailParts {
  return {
    greeting: `Hi ${firstName || "there"},`,
    body,
    signOff: `— ${companyName || "the employer"}`,
    footer: EMAIL_SHELL_FOOTER,
  };
}

/** Plain-text rendering — what the confirmation card shows (ActionCard
 *  artifacts are plain text, same as every other mutation's card). */
export function renderAckEmailPlainText(parts: AckEmailParts): string {
  return [parts.greeting, "", parts.body, "", parts.signOff, "", parts.footer].join("\n");
}

/** HTML rendering for the real email body (pre-`emailShell`; the shell adds
 *  its own footer line and the employer's signature block around this). */
export function renderAckEmailHtml(parts: AckEmailParts): string {
  return `<p>${escapeHtml(parts.greeting)}</p>
<p>${escapeHtml(parts.body).replace(/\n/g, "<br/>")}</p>
<p style="font-size:13px;color:#666">${escapeHtml(parts.signOff)}</p>`;
}
