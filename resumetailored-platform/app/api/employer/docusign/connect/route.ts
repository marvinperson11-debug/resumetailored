import { NextResponse } from "next/server";
import crypto from "crypto";
import { employerContext } from "@/lib/employer-auth";
import { buildConsentUrl, isDocusignConfigured } from "@/lib/docusign";
import { appUrl } from "@/lib/subdomain";

export const runtime = "nodejs";

/**
 * Start the DocuSign Authorization Code Grant. Sends the employer to DocuSign's
 * consent screen; a random `state` nonce is stashed in an httpOnly cookie and
 * echoed back on the callback for CSRF protection.
 */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.redirect(appUrl("/employer"));
  if (!isDocusignConfigured()) return NextResponse.redirect(appUrl("/employer/docusign?error=not_configured"));

  const nonce = crypto.randomBytes(16).toString("hex");
  const res = NextResponse.redirect(buildConsentUrl(nonce));
  res.cookies.set("ds_oauth_state", nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });
  return res;
}
