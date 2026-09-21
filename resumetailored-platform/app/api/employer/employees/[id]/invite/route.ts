import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { employerContext } from "@/lib/employer-auth";
import { getEmployee, setInviteToken, generateInviteCode } from "@/lib/employees-store";
import { getEmployerProfile } from "@/lib/employer-store";
import { employerSignatureHtml } from "@/lib/employer-signature";
import { appUrl } from "@/lib/subdomain";
import { sendEmail, escapeHtml } from "@/lib/email";

export const runtime = "nodejs";

/**
 * Invite an employee to the /employee portal. Mints a one-time token + a 6-digit
 * acceptance code on the employee row (status → invited) and best-effort emails
 * the acceptance link WITH the code shown prominently.
 *
 * Body `{ action }`:
 *   - "regenerate" → new code (invalidates the old one).
 *   - "resend"     → keep the existing code, re-mint the link, re-send the email.
 *   - default      → first invite (new code).
 *
 * Only the employer OWNER may invite — an invited recruiter cannot. SMS delivery
 * is a future PR; the email carries the code for now.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (ctx.access.plan !== "employer" && !ctx.access.isAdmin) {
    return NextResponse.json({ error: "Only the account owner can invite employees." }, { status: 403 });
  }

  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const employee = await getEmployee(ctx.employerId, id);
  if (!employee) return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(employee.email)) {
    return NextResponse.json({ error: "Add a valid email to this employee before inviting them." }, { status: 400 });
  }

  const b = (await req.json().catch(() => ({}))) as { action?: string };
  // Resend keeps the code the employee already has; anything else mints a new one.
  const code = b.action === "resend" && employee.inviteCode ? employee.inviteCode : generateInviteCode();
  const token = randomUUID();
  const updated = await setInviteToken(ctx.employerId, id, token, code);
  if (!updated) return NextResponse.json({ error: "Could not create the invite." }, { status: 500 });

  const link = appUrl(`/employee/accept?token=${token}`);
  const emailed = await sendInviteEmail(employee.email, employee.name, link, code, ctx.employerId);
  return NextResponse.json({ employee: updated, link, code, emailed });
}

/** Fire-and-forget invite email via Resend (through the shared sender). The
 *  6-digit code is shown in a prominent block next to the accept link. */
async function sendInviteEmail(to: string, name: string, link: string, code: string, employerId: string): Promise<boolean> {
  const profile = await getEmployerProfile(employerId);
  const company = profile?.companyName || "your team";
  const signature = await employerSignatureHtml(employerId);
  const first = (name || "").trim().split(/\s+/)[0] || "there";
  return sendEmail({
    to,
    fromName: profile?.companyName || undefined,
    subject: `${company} invited you to your employee portal`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#0B0F19">Hi ${escapeHtml(first)}, welcome to ${escapeHtml(company)}</h2>
        <p style="color:#334155;line-height:1.6">You've been invited to your employee portal. Sign in with <strong>this email address</strong>, then enter the invite code below to finish setting up.</p>
        <div style="margin:20px 0;padding:16px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;text-align:center">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#64748b">Your invite code</div>
          <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#0B0F19;margin-top:4px">${escapeHtml(code)}</div>
        </div>
        <p><a href="${link}" style="display:inline-block;background:#8B5CF6;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600">Set up your portal</a></p>
        <p style="color:#94a3b8;font-size:12px">Or paste this link into your browser:<br>${link}</p>
        ${signature}
      </div>`,
  });
}
