import { NextResponse, type NextRequest } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { exchangeCode, getUserInfo } from "@/lib/docusign";
import { saveConnection } from "@/lib/docusign-store";
import { appUrl } from "@/lib/subdomain";

export const runtime = "nodejs";

const dest = (q: string) => appUrl(`/employer/docusign${q}`);

/**
 * DocuSign consent callback. Verifies the state nonce, exchanges the auth code
 * for tokens, resolves the connected account, and persists the connection
 * (refresh token encrypted). Redirect URI must be registered in the DocuSign
 * app exactly as: https://app.resumetailored.com/api/employer/docusign/callback
 */
export async function GET(req: NextRequest) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.redirect(appUrl("/employer"));

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const oauthError = req.nextUrl.searchParams.get("error");
  const cookieState = req.cookies.get("ds_oauth_state")?.value;

  const clearCookie = (res: NextResponse) => {
    res.cookies.set("ds_oauth_state", "", { path: "/", maxAge: 0 });
    return res;
  };

  if (oauthError) return clearCookie(NextResponse.redirect(dest("?error=consent_denied")));
  if (!code || !state || !cookieState || state !== cookieState) {
    return clearCookie(NextResponse.redirect(dest("?error=state_mismatch")));
  }

  const tokens = await exchangeCode(code);
  if (!tokens || !tokens.refreshToken) return clearCookie(NextResponse.redirect(dest("?error=auth_failed")));

  const info = await getUserInfo(tokens.accessToken);
  if (!info) return clearCookie(NextResponse.redirect(dest("?error=account_failed")));

  const saved = await saveConnection(ctx.employerId, info, tokens);
  return clearCookie(NextResponse.redirect(dest(saved ? "?connected=1" : "?error=save_failed")));
}
