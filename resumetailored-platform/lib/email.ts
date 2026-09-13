/**
 * Minimal transactional email via Resend, matching the existing inline pattern
 * used by the job-apply and team-invite routes. Best-effort: returns false (and
 * never throws) when `RESEND_API_KEY` is unset or the request fails, so callers
 * can fire-and-forget. No provider configured ⇒ email is simply skipped.
 */
export async function sendEmail(opts: { to: string; subject: string; html: string; replyTo?: string }): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !opts.to) return false;
  try {
    const from = process.env.RESEND_FROM || "ResumeTailored <noreply@resumetailored.com>";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The employer account's primary email (via Clerk), or null. Used as reply-to
 *  so a candidate can reply to a notification by email. */
export async function resolveUserEmail(userId: string): Promise<string | null> {
  try {
    const { clerkClient } = await import("@clerk/nextjs/server");
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return user?.emailAddresses?.[0]?.emailAddress || null;
  } catch {
    return null;
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] || ch);
}

/** A small branded wrapper so every notification looks consistent in the inbox. */
export function emailShell(bodyHtml: string): string {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;line-height:1.5">
${bodyHtml}
<hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
<p style="font-size:12px;color:#888">Sent via ResumeTailored. Reply to this email to respond directly.</p>
</div>`;
}
