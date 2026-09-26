import { NextResponse, type NextRequest } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { logInstall } from "@/lib/install-telemetry-store";
import { sendEmail, emailShell, escapeHtml } from "@/lib/email";

export const runtime = "nodejs";

/**
 * POST fired by the `appinstalled` browser event (see components/pwa/pwa-
 * context.tsx). Logs the install and emails support — best-effort both ways;
 * this is telemetry, never something the install itself should wait on or
 * fail over. iOS installs are NOT detectable (Safari never fires
 * `appinstalled` for a home-screen add), so this only ever sees Android and
 * desktop Chrome/Edge installs. That's a known, accepted gap.
 */
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as { platform?: string };
  const platform = (b.platform || "unknown").slice(0, 50);
  const userAgent = req.headers.get("user-agent") || "";

  const { userId } = await auth().catch(() => ({ userId: null }));
  let email: string | null = null;
  if (userId) {
    const user = await currentUser().catch(() => null);
    email = user?.emailAddresses?.[0]?.emailAddress || null;
  }

  await logInstall({ userId, email, platform, userAgent });

  const supportEmail = process.env.SUPPORT_EMAIL || "support@resumetailored.com";
  sendEmail({
    to: supportEmail,
    subject: "App installed",
    html: emailShell(
      `<p>App installed — <strong>${escapeHtml(email || "anonymous")}</strong>, ${escapeHtml(platform)}, ${escapeHtml(new Date().toISOString())}.</p>
<p style="color:#888;font-size:12px">${escapeHtml(userAgent)}</p>`
    ),
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
