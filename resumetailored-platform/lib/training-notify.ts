import { getEmployerProfile } from "./employer-store";
import { getCareerSiteCompanyName } from "./career-site-store";
import { employerSignatureHtml } from "./employer-signature";
import { sendEmail, resolveUserEmail, escapeHtml, emailShell } from "./email";
import type { Employee, TrainingDoc, Acknowledgment } from "./employee-hub";
import { complianceState } from "./employee-hub";
import { getRecipientLocale } from "./locale-pref";
import { trainingReminderCopy, docKindLabel } from "./email-i18n";

/**
 * Employee-facing training emails via Resend — same best-effort, fire-and-forget
 * contract as employer-notify.ts (candidate emails). Used for the "Send
 * reminder" action on pending/overdue acknowledgments, and for assigning a
 * no-signature training item (a DocuSign-signed item gets its signing email
 * from DocuSign itself).
 */
async function context(employerId: string): Promise<{ company: string; replyTo?: string; fromName?: string; signature: string }> {
  const profile = await getEmployerProfile(employerId);
  const replyTo = (await resolveUserEmail(employerId)) || undefined;
  const fromName = (await getCareerSiteCompanyName(employerId)) || profile?.companyName || undefined;
  const signature = await employerSignatureHtml(employerId);
  return { company: profile?.companyName || "your employer", replyTo, fromName, signature };
}

const BCP47: Record<string, string> = { en: "en-US", zh: "zh-CN", es: "es-ES", hi: "hi-IN", fr: "fr-FR" };

function fmtDue(iso: string | null, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString(BCP47[locale] || "en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Remind one employee about a pending/overdue acknowledgment. Returns true when
 *  an email was actually sent. Localized per the recipient's saved Settings
 *  language preference (getRecipientLocale) — see lib/email-i18n.ts. */
export async function sendTrainingReminder(
  employerId: string,
  employee: Employee,
  doc: TrainingDoc,
  ack: Acknowledgment
): Promise<boolean> {
  if (!employee.email) return false;
  const ctx = await context(employerId);
  const locale = await getRecipientLocale(employee.clerkUserId || null);
  const copy = trainingReminderCopy(locale);
  const firstName = escapeHtml((employee.name || "there").split(" ")[0]);
  const overdue = complianceState(ack) === "overdue";
  const dueLine = ack.dueAt ? `<p style="margin:8px 0"><strong>${escapeHtml(copy.due(overdue, fmtDue(ack.dueAt, locale)))}</strong></p>` : "";
  return sendEmail({
    to: employee.email,
    replyTo: ctx.replyTo,
    fromName: ctx.fromName,
    subject: copy.subject(overdue, doc.title),
    html: emailShell(
      `<p>${escapeHtml(copy.greeting(firstName))}</p>
<p>${escapeHtml(copy.needsToComplete(ctx.company, docKindLabel(locale, doc.docKind)))}</p>
<p style="margin:16px 0;padding:12px 16px;background:#f6f6f8;border-left:3px solid #7c5cff;border-radius:6px"><strong>${escapeHtml(doc.title)}</strong></p>
${dueLine}
<p style="font-size:13px;color:#666">${escapeHtml(doc.requireSignature ? copy.signatureRequiredNote : copy.replyNote)}</p>`,
      ctx.signature
    ),
  });
}
