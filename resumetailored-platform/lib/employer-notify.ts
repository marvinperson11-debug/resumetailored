import { getApplicant, getEmployerProfile } from "./employer-store";
import { sendEmail, resolveUserEmail, escapeHtml, emailShell } from "./email";
import type { Message, Interview, InterviewMode } from "./employer-ai";

/**
 * Candidate-facing email notifications for the employer portal. Best-effort and
 * fire-and-forget: every function resolves the candidate's email + the employer's
 * company/email itself and silently no-ops when anything is missing or Resend is
 * unset. Candidates have no in-app inbox yet (Phase 1B), so these emails are how
 * an outbound message or a scheduled interview actually reaches them — with the
 * employer's address as reply-to so replies go straight back to the recruiter.
 */

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

async function context(employerId: string, applicantId: number): Promise<{ to: string; name: string; company: string; replyTo?: string } | null> {
  const applicant = await getApplicant(employerId, applicantId);
  if (!applicant?.email) return null;
  const profile = await getEmployerProfile(employerId);
  const replyTo = (await resolveUserEmail(employerId)) || undefined;
  return { to: applicant.email, name: applicant.name || "there", company: profile?.companyName || "a recruiter", replyTo };
}

/** Email the candidate an employer's new message (they have no in-app inbox). */
export async function notifyCandidateOfMessage(employerId: string, applicantId: number, message: Message): Promise<void> {
  const ctx = await context(employerId, applicantId);
  if (!ctx) return;
  const firstName = escapeHtml(ctx.name.split(" ")[0] || ctx.name);
  const body = escapeHtml(message.content).replace(/\n/g, "<br/>");
  const attachNote = message.attachments.length
    ? `<p style="font-size:13px;color:#666">📎 ${message.attachments.length} attachment${message.attachments.length > 1 ? "s" : ""} included — open the message to view.</p>`
    : "";
  await sendEmail({
    to: ctx.to,
    replyTo: ctx.replyTo,
    subject: `New message from ${ctx.company}`,
    html: emailShell(
      `<p>Hi ${firstName},</p>
<p>You have a new message from <strong>${escapeHtml(ctx.company)}</strong>:</p>
<blockquote style="margin:16px 0;padding:12px 16px;background:#f6f6f8;border-left:3px solid #7c5cff;border-radius:6px">${body || "(no text)"}</blockquote>
${attachNote}
<p style="font-size:13px;color:#666">Reply to this email to respond.</p>`
    ),
  });
}

/** Email the candidate an interview confirmation / reschedule / cancellation. */
export async function notifyCandidateOfInterview(
  employerId: string,
  interview: Interview,
  kind: "scheduled" | "rescheduled" | "cancelled"
): Promise<void> {
  const ctx = await context(employerId, interview.applicantId);
  if (!ctx) return;
  const firstName = escapeHtml(ctx.name.split(" ")[0] || ctx.name);
  const company = escapeHtml(ctx.company);
  const title = escapeHtml(interview.title);

  if (kind === "cancelled") {
    await sendEmail({
      to: ctx.to,
      replyTo: ctx.replyTo,
      subject: `Interview cancelled — ${interview.title}`,
      html: emailShell(
        `<p>Hi ${firstName},</p>
<p>Your interview <strong>${title}</strong> with ${company}, scheduled for ${fmtWhen(interview.scheduledAt)}, has been <strong>cancelled</strong>.</p>
<p style="font-size:13px;color:#666">Reply to this email with any questions.</p>`
      ),
    });
    return;
  }

  // Prefer the auto-generated Daily room; fall back to a manual URL in location.
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
  // "Your interview for {position}" per the video-interview spec.
  const subject = interview.jobTitle
    ? `Your interview for ${interview.jobTitle}${kind === "rescheduled" ? " (rescheduled)" : ""}`
    : `${kind === "rescheduled" ? "Interview rescheduled" : "Interview scheduled"} — ${interview.title}`;

  await sendEmail({
    to: ctx.to,
    replyTo: ctx.replyTo,
    subject,
    html: emailShell(
      `<p>Hi ${firstName},</p>
<p>${company} has ${kind === "rescheduled" ? "rescheduled your interview" : "scheduled an interview with you"}:</p>
<table style="margin:16px 0;font-size:14px">
<tr><td style="padding:4px 12px 4px 0;color:#888">What</td><td style="padding:4px 0"><strong>${title}</strong></td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#888">When</td><td style="padding:4px 0">${fmtWhen(interview.scheduledAt)} (${interview.durationMin} min)</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#888">Type</td><td style="padding:4px 0">${MODE_LABEL[interview.mode]}</td></tr>
${locationRow}
${interviewerRow}
</table>
${joinBlock}
<p style="font-size:13px;color:#666">Need to change something? Just reply to this email.</p>`
    ),
  });
}

/** Email the scheduling user (interviewer/host) a confirmation with the join
 *  link + host note. Best-effort. */
export async function notifyInterviewerOfInterview(employerId: string, userId: string, interview: Interview): Promise<void> {
  const to = await resolveUserEmail(userId);
  if (!to) return;
  const profile = await getEmployerProfile(employerId);
  const company = escapeHtml(profile?.companyName || "your company");
  const title = escapeHtml(interview.title);
  const candidate = escapeHtml(interview.applicantName || "the candidate");
  const joinLink = interview.roomUrl || (interview.mode === "video" && /^https?:\/\//i.test(interview.location) ? interview.location : "");
  const joinBlock = joinLink
    ? `<div style="margin:20px 0">
<a href="${escapeHtml(joinLink)}" style="display:inline-block;background:#7c5cff;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600">Open interview room (host)</a>
<p style="font-size:13px;color:#666;margin:8px 0 0">You're the host. The same link was sent to ${candidate}.<br/><a href="${escapeHtml(joinLink)}">${escapeHtml(joinLink)}</a></p>
</div>`
    : "";
  await sendEmail({
    to,
    subject: `Interview scheduled — ${interview.title} with ${interview.applicantName || "candidate"}`,
    html: emailShell(
      `<p>Your interview is scheduled:</p>
<table style="margin:16px 0;font-size:14px">
<tr><td style="padding:4px 12px 4px 0;color:#888">What</td><td style="padding:4px 0"><strong>${title}</strong></td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#888">Candidate</td><td style="padding:4px 0">${candidate}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#888">When</td><td style="padding:4px 0">${fmtWhen(interview.scheduledAt)} (${interview.durationMin} min)</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#888">Type</td><td style="padding:4px 0">${MODE_LABEL[interview.mode]}</td></tr>
</table>
${joinBlock}
<p style="font-size:13px;color:#666">Manage this interview in ${company}'s Scheduler.</p>`
    ),
  });
}
