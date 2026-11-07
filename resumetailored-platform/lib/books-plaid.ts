/**
 * Plaid bank-feed client for Books — raw `fetch` against Plaid's REST API,
 * no `plaid` npm SDK. Same convention as every other third-party client in
 * this codebase that calls a provider's HTTP API directly rather than
 * through its SDK (lib/email.ts → Resend, lib/bgc-store.ts → Checkr):
 * `npm install` is blocked in this environment and the SDK was never a
 * dependency here, so a raw client is the only option — and it matches
 * house style anyway.
 *
 * Every function degrades gracefully when Plaid isn't configured
 * (`PLAID_CLIENT_ID`/`PLAID_SECRET` unset): `plaidConfigured()` returns
 * false and every other function here returns `null`/`[]` rather than
 * throwing, so the Connect Bank flow can hide/disable itself with a clear
 * message instead of breaking Books or the build (see BOOKS.md).
 */

export type PlaidEnv = "sandbox" | "development" | "production";

function plaidEnv(): PlaidEnv {
  const v = (process.env.PLAID_ENV || "sandbox").trim().toLowerCase();
  return v === "development" || v === "production" ? v : "sandbox";
}

function plaidBaseUrl(): string {
  return `https://${plaidEnv()}.plaid.com`;
}

export function plaidConfigured(): boolean {
  return !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

function credentials(): { client_id: string; secret: string } | null {
  const client_id = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!client_id || !secret) return null;
  return { client_id, secret };
}

async function plaidPost<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
  const creds = credentials();
  if (!creds) return null;
  try {
    const res = await fetch(`${plaidBaseUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...creds, ...body }),
    });
    if (!res.ok) {
      console.error("[plaid]", path, res.status, await res.text().catch(() => ""));
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    console.error("[plaid]", path, e);
    return null;
  }
}

/** Create a Link token for the employer to open Plaid Link with (client-side
 *  widget, loaded only when `plaidConfigured()` is true). `webhookUrl` is
 *  the app's own `/api/employer/books/bank/webhook` endpoint, absolute. */
export async function createLinkToken(employerId: string, webhookUrl: string): Promise<string | null> {
  const data = await plaidPost<{ link_token: string }>("/link/token/create", {
    user: { client_user_id: employerId },
    client_name: "ResumeTailored Books",
    products: ["transactions"],
    country_codes: ["US"],
    language: "en",
    webhook: webhookUrl,
  });
  return data?.link_token || null;
}

export interface PlaidExchangeResult {
  accessToken: string;
  itemId: string;
}

export async function exchangePublicToken(publicToken: string): Promise<PlaidExchangeResult | null> {
  const data = await plaidPost<{ access_token: string; item_id: string }>("/item/public_token/exchange", { public_token: publicToken });
  if (!data) return null;
  return { accessToken: data.access_token, itemId: data.item_id };
}

export interface PlaidAccountInfo {
  name: string | null;
  mask: string | null;
  institutionName: string | null;
}

/** Best-effort account display info right after exchange — `institutionName`
 *  requires a second call (`/institutions/get_by_id`) keyed off the item's
 *  `institution_id`, so a failure on either half still returns whatever
 *  succeeded rather than failing the whole connect flow. */
export async function fetchAccountInfo(accessToken: string): Promise<PlaidAccountInfo> {
  const accountsData = await plaidPost<{ accounts: { name: string; mask: string }[]; item: { institution_id: string | null } }>("/accounts/get", { access_token: accessToken });
  if (!accountsData) return { name: null, mask: null, institutionName: null };
  const account = accountsData.accounts?.[0];
  let institutionName: string | null = null;
  const institutionId = accountsData.item?.institution_id;
  if (institutionId) {
    const instData = await plaidPost<{ institution: { name: string } }>("/institutions/get_by_id", { institution_id: institutionId, country_codes: ["US"] });
    institutionName = instData?.institution?.name || null;
  }
  return { name: account?.name || null, mask: account?.mask || null, institutionName };
}

export interface PlaidSyncedTransaction {
  transactionId: string;
  date: string;
  amountCents: number;
  name: string;
  merchantName: string | null;
  pending: boolean;
}

export interface PlaidSyncResult {
  added: PlaidSyncedTransaction[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** One page of Plaid's `/transactions/sync` — the webhook calls this in a
 *  loop (following `hasMore`) to pull everything new since `cursor`. Plaid
 *  amounts are dollars with the outflow-positive convention; stored here as
 *  integer cents, sign preserved (a negative amount — a deposit/refund —
 *  stays negative, so `books-store.ts` can tell income-like bank activity
 *  from spend when a human reviews the match). */
export async function syncTransactions(accessToken: string, cursor: string | null): Promise<PlaidSyncResult | null> {
  const data = await plaidPost<{
    added: { transaction_id: string; date: string; amount: number; name: string; merchant_name: string | null; pending: boolean }[];
    next_cursor: string;
    has_more: boolean;
  }>("/transactions/sync", { access_token: accessToken, ...(cursor ? { cursor } : {}) });
  if (!data) return null;
  return {
    added: data.added.map((t) => ({
      transactionId: t.transaction_id,
      date: t.date,
      amountCents: Math.round(t.amount * 100),
      name: t.name,
      merchantName: t.merchant_name || null,
      pending: !!t.pending,
    })),
    nextCursor: data.next_cursor || null,
    hasMore: !!data.has_more,
  };
}
