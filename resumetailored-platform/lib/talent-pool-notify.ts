import { getEmployerProfile } from "./employer-store";
import { sendEmail, resolveUserEmail, resolveUserIdentity, escapeHtml, emailShell } from "./email";
import { getRecipientLocale } from "./locale-pref";
import { talentPoolNewRequestCopy, talentPoolResponseCopy } from "./email-i18n";
import { logActivityForEmployer } from "./notifications-store";
import { appUrl } from "./subdomain";

/**
 * Talent Pool notifications: in-app + email on both ends of a contact
 * request (Q3). Email mirrors the lib/employer-notify.ts pattern
 * (best-effort, fire-and-forget, never throws, silently skipped when Resend
 * is unset). In-app is the one real asymmetry in this feature: the employer
 * side has a real bell (`activity_events`, lib/notifications-store.ts) to
 * log into, but candidates have no in-app inbox yet anywhere in this
 * codebase (see lib/employer-notify.ts's header comment) — their
 * "in-app" surface for this feature is the always-visible Incoming Requests
 * list on their own Get Found settings page, which needs no logging here at
 * all since it reads the live table directly.
 */

/** Email a candidate that a new contact request is waiting for them. */
export async function notifyCandidateOfNewRequest(candidateId: string, employerId: string): Promise<void> {
  const to = await resolveUserEmail(candidateId);
  if (!to) return;
  const identity = await resolveUserIdentity(candidateId);
  const firstName = (identity.name || "there").split(" ")[0];
  const profile = await getEmployerProfile(employerId);
  const company = profile?.companyName || "An employer";
  const locale = await getRecipientLocale(candidateId);
  const copy = talentPoolNewRequestCopy(locale);
  const link = appUrl("/candidate/talent-pool");
  await sendEmail({
    to,
    subject: copy.subject(company),
    html: emailShell(
      `<p>${escapeHtml(copy.greeting(firstName))}</p>
<p>${copy.body(escapeHtml(company))}</p>
<p>${copy.reviewNote(link)}</p>`
    ),
  });
}

/** Notify the employer — in-app (their activity bell) + email — once a
 *  candidate accepts or declines a request they sent. */
export async function notifyEmployerOfResponse(employerId: string, candidateId: string, accepted: boolean): Promise<void> {
  const identity = await resolveUserIdentity(candidateId);
  const candidateName = identity.name || "A candidate";
  const link = "/employer/talent-pool/requests";

  await logActivityForEmployer(employerId, {
    eventType: "talent_pool_response",
    title: `${candidateName} ${accepted ? "accepted" : "declined"} your Talent Pool request`,
    msg: { key: "talentPoolResponse", params: { candidate: candidateName, status: accepted ? "accepted" : "declined" } },
    link,
  });

  const to = await resolveUserEmail(employerId);
  if (!to) return;
  const locale = await getRecipientLocale(employerId);
  const copy = talentPoolResponseCopy(locale);
  const fullLink = appUrl(link);
  const body = accepted
    ? `<p>${copy.acceptedBody(escapeHtml(candidateName))}</p><p>${copy.acceptedNote(fullLink)}</p>`
    : `<p>${copy.declinedBody(escapeHtml(candidateName))}</p><p>${copy.declinedNote}</p>`;
  await sendEmail({ to, subject: copy.subject(candidateName, accepted), html: emailShell(body) });
}
