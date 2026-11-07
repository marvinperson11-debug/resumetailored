import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseFullBooks } from "@/lib/employer-plan";
import { exchangePublicToken, fetchAccountInfo, plaidConfigured } from "@/lib/books-plaid";
import { saveBankAccount, syncBankAccountTransactions } from "@/lib/books-store";

export const dynamic = "force-dynamic";

/** POST { publicToken } — called by the client once Plaid Link's onSuccess
 *  fires. Exchanges for a long-lived access token, stores the connection,
 *  and runs the first sync so the Unmatched Transactions list isn't empty
 *  on the very next page load. */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseFullBooks(ctx.access)) return NextResponse.json({ error: "Bank feeds are available on the Corporate plan." }, { status: 403 });
  if (!plaidConfigured()) return NextResponse.json({ error: "Bank feeds aren't configured yet. Contact support." }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { publicToken?: string };
  const publicToken = String(body.publicToken || "").trim();
  if (!publicToken) return NextResponse.json({ error: "publicToken is required." }, { status: 400 });

  const exchange = await exchangePublicToken(publicToken);
  if (!exchange) return NextResponse.json({ error: "Could not connect that bank account. Please try again." }, { status: 502 });

  const info = await fetchAccountInfo(exchange.accessToken);
  const account = await saveBankAccount(ctx.employerId, {
    plaidItemId: exchange.itemId,
    plaidAccessToken: exchange.accessToken,
    institutionName: info.institutionName,
    accountName: info.name,
    accountMask: info.mask,
  });
  if (!account) return NextResponse.json({ error: "Connected, but could not save the account. Please try again." }, { status: 500 });

  await syncBankAccountTransactions(ctx.employerId, account.id, exchange.accessToken);
  return NextResponse.json({ account });
}
