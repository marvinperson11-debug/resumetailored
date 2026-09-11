import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { employerContext } from "@/lib/employer-auth";
import { listTeam, inviteMember, getEmployerProfile } from "@/lib/employer-store";
import { isTeamRole } from "@/lib/employer-ai";

export const runtime = "nodejs";

/** GET the team roster (owner + admins/recruiters/viewers, active + pending). */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const team = await listTeam(ctx.employerId);
  return NextResponse.json({ team });
}

/** POST an invite: create a pending row + best-effort email with the join link. */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  // Only the employer owner (not an invited employee) may invite.
  if (ctx.access.plan !== "employer") return NextResponse.json({ error: "Only the account owner can invite." }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as { email?: string; role?: string };
  const email = (b.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  const role = isTeamRole(b.role) && b.role !== "owner" ? b.role : "viewer";

  const token = randomUUID();
  const member = await inviteMember(ctx.employerId, email, role, token);
  if (!member) return NextResponse.json({ error: "Could not create the invite." }, { status: 500 });

  const origin = new URL(req.url).origin;
  const link = `${origin}/join?token=${token}&company=${encodeURIComponent(ctx.employerId)}`;
  const emailed = await sendInviteEmail(email, link, ctx.employerId);
  return NextResponse.json({ member, link, emailed });
}

/** Fire-and-forget invite email via Resend when configured; false otherwise. */
async function sendInviteEmail(to: string, link: string, employerId: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const from = process.env.RESEND_FROM || "ResumeTailored <onboarding@resend.dev>";
  const profile = await getEmployerProfile(employerId);
  const company = profile?.companyName || "a team";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject: `You're invited to join ${company} on ResumeTailored`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#0B0F19">You've been invited to ${escapeHtml(company)}</h2>
          <p style="color:#334155;line-height:1.6">Join the hiring team on ResumeTailored to review candidates and manage roles.</p>
          <p><a href="${link}" style="display:inline-block;background:#8B5CF6;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600">Accept invite</a></p>
          <p style="color:#94a3b8;font-size:12px">Or paste this link into your browser:<br>${link}</p>
        </div>`,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] || ch);
}
