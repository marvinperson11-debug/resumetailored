import { listInterviewsForReminderScan, markInterviewReminded, type InterviewForReminderScan } from "./employer-collab-store";
import { getApplicant, getEmployerProfile } from "./employer-store";
import { sendEmail, resolveUserEmail, escapeHtml, emailShell } from "./email";
import { employerSignatureHtml } from "./employer-signature";
import type { InterviewMode } from "./employer-ai";

/**
 * Candidate interview reminders — 24h and 2h before a scheduled interview.
 * Mirrors lib/cert-cron.ts: best-effort throughout (a failed send never
 * throws), and the "sent" marker is stamped regardless of whether the email
 * actually went out, so a candidate with no/invalid email can't make the same
 * interview retry forever. Pure window logic (`dueReminderWindows`) is
 * exported separately so the scheduler test can assert exact windows without
 * touching Supabase or Resend.
 *
 * The email-sending below is DELIBERATELY self-contained rather than reusing
 * lib/employer-notify.ts's `notifyCandidateOfInterview` (same recipient, same
 * kind of email): that module's shared `context()` helper statically imports
 * lib/career-site-store.ts, which itself reaches lib/employer-plan.ts ->
 * lib/docusign-store.ts -> lib/docusign.ts, which imports Node's `crypto`.
 * This file is reachable from instrumentation.ts (the in-process scheduler),
 * which Next.js also tries to compile for the EDGE runtime — and an edge
 * bundle has no `crypto`. Keeping this file's own import graph to
 * employer-store.ts/email.ts/employer-signature.ts (none of which touch
 * docusign.ts) is what keeps `npm run build` green; pulling in
 * employer-notify.ts here reintroduces that exact build failure.
 */

export type ReminderWindow = "24h" | "2h";

const MODE_LABEL: Record<InterviewMode, string> = { video: "Video call", phone: "Phone call", onsite: "On-site" };

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return `${d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  })} UTC`;
}

/** Hours between `now` and the interview's scheduled start (negative once it
 *  has started/passed). Null when scheduledAt doesn't parse. */
export function hoursUntil(scheduledAtIso: string, now: number = Date.now()): number | null {
  const t = new Date(scheduledAtIso).getTime();
  if (Number.isNaN(t)) return null;
  return (t - now) / (60 * 60 * 1000);
}

/** Which reminder window(s) a SCHEDULED interview is due for, given its start
 *  time and which markers are already stamped. An interview can be due for
 *  both windows at once (e.g. booked 90 minutes out) — the caller sends each
 *  once. Never fires for a past interview (hours < 0) or anything not
 *  'scheduled' (cancelled/completed interviews don't get reminded). */
export function dueReminderWindows(
  interview: Pick<InterviewForReminderScan, "status" | "scheduledAt" | "reminder24hSent" | "reminder2hSent">,
  now: number = Date.now()
): ReminderWindow[] {
  if (interview.status !== "scheduled") return [];
  const hours = hoursUntil(interview.scheduledAt, now);
  if (hours === null || hours < 0) return [];
  const due: ReminderWindow[] = [];
  if (hours <= 24 && !interview.reminder24hSent) due.push("24h");
  if (hours <= 2 && !interview.reminder2hSent) due.push("2h");
  return due;
}

/** Email the candidate a reminder ahead of a scheduled interview, with an easy
 *  way to ask for a reschedule (replying to this email reaches the employer
 *  directly — there is no self-serve reschedule page yet). Best-effort,
 *  fire-and-forget. Returns true only when an email was actually sent, so the
 *  caller can decide whether that part of the job went through (the "sent"
 *  flag is stamped either way — see runInterviewReminderScan). */
async function notifyCandidateOfInterviewReminder(employerId: string, interview: InterviewForReminderScan, which: ReminderWindow): Promise<boolean> {
  const applicant = await getApplicant(employerId, interview.applicantId);
  if (!applicant?.email) return false;
  const profile = await getEmployerProfile(employerId);
  const replyTo = (await resolveUserEmail(employerId)) || undefined;
  const fromName = profile?.companyName || undefined;
  const signature = await employerSignatureHtml(employerId);
  const company = escapeHtml(profile?.companyName || "a recruiter");
  const firstName = escapeHtml((applicant.name || "there").split(" ")[0] || applicant.name || "there");
  const title = escapeHtml(interview.title);
  const windowLabel = which === "24h" ? "tomorrow" : "in about 2 hours";

  const joinLink = interview.roomUrl || (interview.mode === "video" && /^https?:\/\//i.test(interview.location) ? interview.location : "");
  const locationRow =
    !joinLink && interview.location
      ? `<tr><td style="padding:4px 12px 4px 0;color:#888">${interview.mode === "onsite" ? "Location" : "Phone"}</td><td style="padding:4px 0">${
          /^https?:\/\//i.test(interview.location) ? `<a href="${escapeHtml(interview.location)}">${escapeHtml(interview.location)}</a>` : escapeHtml(interview.location)
        }</td></tr>`
      : "";
  const interviewerRow = interview.interviewer
    ? `<tr><td style="padding:4px 12px 4px 0;color:#888">Interviewer</td><td style="padding:4px 0">${escapeHtml(interview.interviewer)}</td></tr>`
    : "";
  const joinBlock = joinLink
    ? `<div style="margin:20px 0">
<a href="${escapeHtml(joinLink)}" style="display:inline-block;background:#7c5cff;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600">Join the video interview</a>
<p style="font-size:13px;color:#666;margin:8px 0 0">No account needed — just open this link at the scheduled time:<br/><a href="${escapeHtml(joinLink)}">${escapeHtml(joinLink)}</a></p>
</div>`
    : "";
  const subject = interview.jobTitle ? `Reminder: your interview for ${interview.jobTitle} is ${windowLabel}` : `Reminder: your interview is ${windowLabel}`;

  return sendEmail({
    to: applicant.email,
    replyTo,
    fromName,
    subject,
    html: emailShell(
      `<p>Hi ${firstName},</p>
<p>Just a reminder — your interview with ${company} is ${windowLabel}:</p>
<table style="margin:16px 0;font-size:14px">
<tr><td style="padding:4px 12px 4px 0;color:#888">What</td><td style="padding:4px 0"><strong>${title}</strong></td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#888">When</td><td style="padding:4px 0">${fmtWhen(interview.scheduledAt)} (${interview.durationMin} min)</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#888">Type</td><td style="padding:4px 0">${MODE_LABEL[interview.mode]}</td></tr>
${locationRow}
${interviewerRow}
</table>
${joinBlock}
<p style="font-size:13px;color:#666">Need to reschedule? Just reply to this email and we'll find a new time.</p>`,
      signature
    ),
  });
}

/** Scan every employer's upcoming scheduled interviews and send any reminders
 *  that are due. Safe to run as often as desired (every 30 minutes, per
 *  instrumentation.ts) — idempotent: a re-run before anything has crossed a
 *  new window sends nothing. */
export async function runInterviewReminderScan(now: number = Date.now()): Promise<{ scanned: number; reminded: number }> {
  const interviews = await listInterviewsForReminderScan(now);
  let reminded = 0;
  for (const interview of interviews) {
    const windows = dueReminderWindows(interview, now);
    for (const which of windows) {
      await notifyCandidateOfInterviewReminder(interview.employerId, interview, which).catch(() => false);
      await markInterviewReminded(interview.id, which);
      reminded++;
    }
  }
  return { scanned: interviews.length, reminded };
}
