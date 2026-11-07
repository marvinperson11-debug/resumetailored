import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseFullBooks } from "@/lib/employer-plan";
import { createLinkToken, plaidConfigured } from "@/lib/books-plaid";
import { appUrl } from "@/lib/subdomain";

export const dynamic = "force-dynamic";

/** POST — create a Plaid Link token for this employer to open Plaid Link
 *  with. Corporate-only (full Books) and requires Plaid credentials; either
 *  gap degrades to a 403 with a clear message, never a broken Link open. */
export async function POST() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseFullBooks(ctx.access)) return NextResponse.json({ error: "Bank feeds are available on the Corporate plan." }, { status: 403 });
  if (!plaidConfigured()) return NextResponse.json({ error: "Bank feeds aren't configured yet. Contact support." }, { status: 503 });

  const linkToken = await createLinkToken(ctx.employerId, appUrl("/api/employer/books/bank/webhook"));
  if (!linkToken) return NextResponse.json({ error: "Could not start the bank connection. Please try again." }, { status: 502 });
  return NextResponse.json({ linkToken });
}
