import { NextResponse } from "next/server";
import { getBankAccountByItemId, syncBankAccountTransactions } from "@/lib/books-store";

export const dynamic = "force-dynamic";

/** POST — Plaid's webhook callback. No employer session (Plaid calls this
 *  server-to-server); the item_id in the payload is the only identity, and
 *  it only ever resolves to a row this app itself created during Connect —
 *  there's nothing here keyed by employer that an outside caller could
 *  target by guessing an id. Always answers 200 (Plaid retries on
 *  non-2xx) even when the item isn't recognized or the webhook type isn't
 *  one Books acts on, matching this codebase's other best-effort webhook
 *  handlers. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { webhook_type?: string; webhook_code?: string; item_id?: string };
  if (body.webhook_type !== "TRANSACTIONS" || !body.item_id) return NextResponse.json({ ok: true });

  // SYNC_UPDATES_AVAILABLE covers the /transactions/sync model this client
  // uses end to end (lib/books-plaid.ts `syncTransactions`); other
  // transaction webhook codes (the legacy non-sync model) don't apply here.
  if (body.webhook_code !== "SYNC_UPDATES_AVAILABLE") return NextResponse.json({ ok: true });

  const account = await getBankAccountByItemId(body.item_id);
  if (!account) return NextResponse.json({ ok: true });

  await syncBankAccountTransactions(account.employerId, account.id, account.plaidAccessToken);
  return NextResponse.json({ ok: true });
}
