import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BooksEntry, BooksEntryType, BooksEntrySource, BooksInvoice, InvoiceLineItem, InvoiceStatus } from "./books-hub";
import { invoiceTotalCents, nextInvoiceNumber } from "./books-hub";
import { getJob, listApplicants } from "./employer-store";
import { listEmployees } from "./employees-store";
import { listEntriesForWeek } from "./time-store";
import { sumHours, weekStartISO, addDaysISO } from "./time-hub";
import { syncTransactions } from "./books-plaid";

/**
 * Books persistence — service-role Supabase access, same `db()` convention
 * repeated in every `*-store.ts` module (office-store.ts, employees-store.ts,
 * docusign-store.ts, …) rather than a shared import. Best-effort: an
 * unconfigured/unreachable Supabase resolves to empty reads / null writes,
 * never a throw — every public function here follows that rule so a route
 * can treat "Books misconfigured" the same as "Books empty" rather than a
 * 500.
 */
let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

// ── Entries ──────────────────────────────────────────────────────────────────

const ENTRY_COLS = "id, employer_id, type, entry_date, amount_cents, description, category, job_id, receipt_path, source, bank_transaction_id, created_by, created_at, updated_at";

function mapEntry(r: Record<string, unknown>): BooksEntry {
  return {
    id: r.id as string,
    employerId: r.employer_id as string,
    type: r.type as BooksEntryType,
    entryDate: r.entry_date as string,
    amountCents: r.amount_cents as number,
    description: (r.description as string) || "",
    category: (r.category as string) || "uncategorized",
    jobId: (r.job_id as number) ?? null,
    receiptPath: (r.receipt_path as string) || null,
    source: (r.source as BooksEntrySource) || "manual",
    bankTransactionId: (r.bank_transaction_id as string) || null,
    createdBy: (r.created_by as string) || "",
    createdAt: (r.created_at as string) || "",
    updatedAt: (r.updated_at as string) || "",
  };
}

export interface EntryFilters {
  from?: string;
  to?: string;
  type?: BooksEntryType;
  jobId?: number;
}

export async function listEntries(employerId: string, filters: EntryFilters = {}): Promise<BooksEntry[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    let q = c.from("books_entries").select(ENTRY_COLS).eq("employer_id", employerId).order("entry_date", { ascending: false }).limit(5000);
    if (filters.from) q = q.gte("entry_date", filters.from);
    if (filters.to) q = q.lte("entry_date", filters.to);
    if (filters.type) q = q.eq("type", filters.type);
    if (filters.jobId !== undefined) q = q.eq("job_id", filters.jobId);
    const { data, error } = await q;
    if (error || !data) return [];
    return data.map(mapEntry);
  } catch {
    return [];
  }
}

export async function getEntry(employerId: string, id: string): Promise<BooksEntry | null> {
  const c = db();
  if (!c || !employerId || !id) return null;
  try {
    const { data } = await c.from("books_entries").select(ENTRY_COLS).eq("employer_id", employerId).eq("id", id).maybeSingle();
    return data ? mapEntry(data) : null;
  } catch {
    return null;
  }
}

export interface EntryInput {
  type: BooksEntryType;
  entryDate: string;
  amountCents: number;
  description: string;
  category: string;
  jobId?: number | null;
  source?: BooksEntrySource;
}

export async function createEntry(employerId: string, createdBy: string, input: EntryInput): Promise<BooksEntry | null> {
  const c = db();
  if (!c || !employerId) return null;
  try {
    const { data, error } = await c
      .from("books_entries")
      .insert({
        employer_id: employerId,
        type: input.type,
        entry_date: input.entryDate,
        amount_cents: input.amountCents,
        description: input.description,
        category: input.category,
        job_id: input.jobId ?? null,
        source: input.source || "manual",
        created_by: createdBy,
      })
      .select(ENTRY_COLS)
      .single();
    if (error || !data) {
      console.error("[createEntry]", error);
      return null;
    }
    return mapEntry(data);
  } catch (e) {
    console.error("[createEntry]", e);
    return null;
  }
}

export async function createEntriesBulk(employerId: string, createdBy: string, inputs: EntryInput[]): Promise<number> {
  const c = db();
  if (!c || !employerId || !inputs.length) return 0;
  try {
    const rows = inputs.map((input) => ({
      employer_id: employerId,
      type: input.type,
      entry_date: input.entryDate,
      amount_cents: input.amountCents,
      description: input.description,
      category: input.category,
      job_id: input.jobId ?? null,
      source: input.source || "csv",
      created_by: createdBy,
    }));
    const { data, error } = await c.from("books_entries").insert(rows).select("id");
    if (error) {
      console.error("[createEntriesBulk]", error);
      return 0;
    }
    return data?.length || 0;
  } catch (e) {
    console.error("[createEntriesBulk]", e);
    return 0;
  }
}

export interface EntryUpdate {
  entryDate?: string;
  amountCents?: number;
  description?: string;
  category?: string;
  jobId?: number | null;
}

export async function updateEntry(employerId: string, id: string, patch: EntryUpdate): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !id) return false;
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.entryDate !== undefined) update.entry_date = patch.entryDate;
  if (patch.amountCents !== undefined) update.amount_cents = patch.amountCents;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.category !== undefined) update.category = patch.category;
  if (patch.jobId !== undefined) update.job_id = patch.jobId;
  try {
    const { error } = await c.from("books_entries").update(update).eq("employer_id", employerId).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

export async function deleteEntry(employerId: string, id: string): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !id) return false;
  try {
    const { error } = await c.from("books_entries").delete().eq("employer_id", employerId).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

// ── Receipts (private Storage bucket) ───────────────────────────────────────
const RECEIPTS_BUCKET = "books-receipts";
export const MAX_RECEIPT_BYTES = 8 * 1024 * 1024; // 8 MB, same ceiling as the office-assets image cap

export async function uploadReceipt(employerId: string, entryId: string, file: { data: Uint8Array; contentType: string }, ext: string): Promise<string | null> {
  const c = db();
  if (!c || !employerId || !entryId) return null;
  const path = `${employerId}/${entryId}-${Date.now()}.${ext}`;
  try {
    const { error } = await c.storage.from(RECEIPTS_BUCKET).upload(path, file.data, { contentType: file.contentType, upsert: false });
    if (error) {
      console.error("[uploadReceipt]", error);
      return null;
    }
    const { error: updateError } = await c.from("books_entries").update({ receipt_path: path, updated_at: new Date().toISOString() }).eq("employer_id", employerId).eq("id", entryId);
    if (updateError) {
      console.error("[uploadReceipt:link]", updateError);
      return null;
    }
    return path;
  } catch (e) {
    console.error("[uploadReceipt]", e);
    return null;
  }
}

/** A short-lived signed URL for a receipt — `path` must be owned by this
 *  employer (its own id prefix), same ownership check every other private
 *  Storage signer in this codebase uses (see e.g. employer-collab-store.ts
 *  `signInterviewMedia`). */
export async function signReceiptUrl(employerId: string, path: string, seconds = 300): Promise<string | null> {
  const c = db();
  if (!c || !employerId || !path || !path.startsWith(`${employerId}/`)) return null;
  try {
    const { data, error } = await c.storage.from(RECEIPTS_BUCKET).createSignedUrl(path, seconds);
    return error || !data ? null : data.signedUrl;
  } catch {
    return null;
  }
}

// ── Invoices ─────────────────────────────────────────────────────────────────

const INVOICE_COLS =
  "id, employer_id, invoice_number, client_name, client_email, issue_date, due_date, line_items_json, amount_cents, status, sent_at, paid_at, last_reminder_at, created_by, created_at, updated_at";

function mapInvoice(r: Record<string, unknown>): BooksInvoice {
  return {
    id: r.id as string,
    employerId: r.employer_id as string,
    invoiceNumber: r.invoice_number as string,
    clientName: (r.client_name as string) || "",
    clientEmail: (r.client_email as string) || null,
    issueDate: r.issue_date as string,
    dueDate: r.due_date as string,
    lineItems: (r.line_items_json as InvoiceLineItem[]) || [],
    amountCents: r.amount_cents as number,
    status: r.status as InvoiceStatus,
    sentAt: (r.sent_at as string) || null,
    paidAt: (r.paid_at as string) || null,
    lastReminderAt: (r.last_reminder_at as string) || null,
    createdBy: (r.created_by as string) || "",
    createdAt: (r.created_at as string) || "",
    updatedAt: (r.updated_at as string) || "",
  };
}

export async function listInvoices(employerId: string): Promise<BooksInvoice[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data, error } = await c.from("books_invoices").select(INVOICE_COLS).eq("employer_id", employerId).order("created_at", { ascending: false }).limit(2000);
    if (error || !data) return [];
    return data.map(mapInvoice);
  } catch {
    return [];
  }
}

export async function getInvoice(employerId: string, id: string): Promise<BooksInvoice | null> {
  const c = db();
  if (!c || !employerId || !id) return null;
  try {
    const { data } = await c.from("books_invoices").select(INVOICE_COLS).eq("employer_id", employerId).eq("id", id).maybeSingle();
    return data ? mapInvoice(data) : null;
  } catch {
    return null;
  }
}

export interface InvoiceInput {
  clientName: string;
  clientEmail?: string | null;
  issueDate: string;
  dueDate: string;
  lineItems: InvoiceLineItem[];
}

export async function createInvoice(employerId: string, createdBy: string, input: InvoiceInput): Promise<BooksInvoice | null> {
  const c = db();
  if (!c || !employerId) return null;
  try {
    const year = new Date(input.issueDate).getUTCFullYear() || new Date().getUTCFullYear();
    const { count } = await c.from("books_invoices").select("id", { count: "exact", head: true }).eq("employer_id", employerId).gte("issue_date", `${year}-01-01`).lte("issue_date", `${year}-12-31`);
    const invoiceNumber = nextInvoiceNumber(count || 0, year);
    const { data, error } = await c
      .from("books_invoices")
      .insert({
        employer_id: employerId,
        invoice_number: invoiceNumber,
        client_name: input.clientName,
        client_email: input.clientEmail || null,
        issue_date: input.issueDate,
        due_date: input.dueDate,
        line_items_json: input.lineItems,
        amount_cents: invoiceTotalCents(input.lineItems),
        status: "draft",
        created_by: createdBy,
      })
      .select(INVOICE_COLS)
      .single();
    if (error || !data) {
      console.error("[createInvoice]", error);
      return null;
    }
    return mapInvoice(data);
  } catch (e) {
    console.error("[createInvoice]", e);
    return null;
  }
}

export async function setInvoiceStatus(employerId: string, id: string, status: InvoiceStatus, extra: Partial<Pick<BooksInvoice, "sentAt" | "paidAt" | "lastReminderAt">> = {}): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !id) return false;
  const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (extra.sentAt !== undefined) update.sent_at = extra.sentAt;
  if (extra.paidAt !== undefined) update.paid_at = extra.paidAt;
  if (extra.lastReminderAt !== undefined) update.last_reminder_at = extra.lastReminderAt;
  try {
    const { error } = await c.from("books_invoices").update(update).eq("employer_id", employerId).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

// ── Bank feeds (Plaid, Corporate "full Books") ───────────────────────────────

export interface BooksBankAccount {
  id: string;
  employerId: string;
  plaidItemId: string;
  institutionName: string | null;
  accountName: string | null;
  accountMask: string | null;
  status: "active" | "error" | "disconnected";
  createdAt: string;
}

const BANK_ACCOUNT_COLS = "id, employer_id, plaid_item_id, institution_name, account_name, account_mask, status, created_at";

function mapBankAccount(r: Record<string, unknown>): BooksBankAccount {
  return {
    id: r.id as string,
    employerId: r.employer_id as string,
    plaidItemId: r.plaid_item_id as string,
    institutionName: (r.institution_name as string) || null,
    accountName: (r.account_name as string) || null,
    accountMask: (r.account_mask as string) || null,
    status: (r.status as BooksBankAccount["status"]) || "active",
    createdAt: (r.created_at as string) || "",
  };
}

export async function listBankAccounts(employerId: string): Promise<BooksBankAccount[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data, error } = await c.from("books_bank_accounts").select(BANK_ACCOUNT_COLS).eq("employer_id", employerId).order("created_at", { ascending: false });
    if (error || !data) return [];
    return data.map(mapBankAccount);
  } catch {
    return [];
  }
}

export async function saveBankAccount(
  employerId: string,
  input: { plaidItemId: string; plaidAccessToken: string; institutionName?: string | null; accountName?: string | null; accountMask?: string | null }
): Promise<BooksBankAccount | null> {
  const c = db();
  if (!c || !employerId) return null;
  try {
    const { data, error } = await c
      .from("books_bank_accounts")
      .upsert(
        {
          employer_id: employerId,
          plaid_item_id: input.plaidItemId,
          plaid_access_token: input.plaidAccessToken,
          institution_name: input.institutionName || null,
          account_name: input.accountName || null,
          account_mask: input.accountMask || null,
          status: "active",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "plaid_item_id" }
      )
      .select(BANK_ACCOUNT_COLS)
      .single();
    if (error || !data) {
      console.error("[saveBankAccount]", error);
      return null;
    }
    return mapBankAccount(data);
  } catch (e) {
    console.error("[saveBankAccount]", e);
    return null;
  }
}

export async function getBankAccountSyncCursor(bankAccountId: string): Promise<string | null> {
  const c = db();
  if (!c || !bankAccountId) return null;
  try {
    const { data } = await c.from("books_bank_accounts").select("sync_cursor").eq("id", bankAccountId).maybeSingle();
    return (data?.sync_cursor as string) || null;
  } catch {
    return null;
  }
}

export async function setBankAccountSyncCursor(bankAccountId: string, cursor: string | null): Promise<void> {
  const c = db();
  if (!c || !bankAccountId) return;
  try {
    await c.from("books_bank_accounts").update({ sync_cursor: cursor, updated_at: new Date().toISOString() }).eq("id", bankAccountId);
  } catch {
    /* best-effort */
  }
}

export async function getBankAccountAccessToken(employerId: string, bankAccountId: string): Promise<string | null> {
  const c = db();
  if (!c || !employerId || !bankAccountId) return null;
  try {
    const { data } = await c.from("books_bank_accounts").select("plaid_access_token").eq("employer_id", employerId).eq("id", bankAccountId).maybeSingle();
    return (data?.plaid_access_token as string) || null;
  } catch {
    return null;
  }
}

/** Looked up by Plaid's own item id — the webhook carries only that, never
 *  our row id. */
export async function getBankAccountByItemId(plaidItemId: string): Promise<(BooksBankAccount & { plaidAccessToken: string }) | null> {
  const c = db();
  if (!c || !plaidItemId) return null;
  try {
    const { data } = await c.from("books_bank_accounts").select(`${BANK_ACCOUNT_COLS}, plaid_access_token`).eq("plaid_item_id", plaidItemId).maybeSingle();
    if (!data) return null;
    return { ...mapBankAccount(data), plaidAccessToken: data.plaid_access_token as string };
  } catch {
    return null;
  }
}

export async function disconnectBankAccount(employerId: string, id: string): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !id) return false;
  try {
    const { error } = await c.from("books_bank_accounts").update({ status: "disconnected", updated_at: new Date().toISOString() }).eq("employer_id", employerId).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

export interface BooksBankTransaction {
  id: string;
  employerId: string;
  bankAccountId: string;
  plaidTransactionId: string;
  txnDate: string;
  amountCents: number;
  name: string;
  merchantName: string | null;
  pending: boolean;
  matchStatus: "unmatched" | "matched" | "ignored";
  matchedEntryId: string | null;
  matchedInvoiceId: string | null;
  createdAt: string;
}

const BANK_TXN_COLS =
  "id, employer_id, bank_account_id, plaid_transaction_id, txn_date, amount_cents, name, merchant_name, pending, match_status, matched_entry_id, matched_invoice_id, created_at";

function mapBankTxn(r: Record<string, unknown>): BooksBankTransaction {
  return {
    id: r.id as string,
    employerId: r.employer_id as string,
    bankAccountId: r.bank_account_id as string,
    plaidTransactionId: r.plaid_transaction_id as string,
    txnDate: r.txn_date as string,
    amountCents: r.amount_cents as number,
    name: (r.name as string) || "",
    merchantName: (r.merchant_name as string) || null,
    pending: !!r.pending,
    matchStatus: (r.match_status as BooksBankTransaction["matchStatus"]) || "unmatched",
    matchedEntryId: (r.matched_entry_id as string) || null,
    matchedInvoiceId: (r.matched_invoice_id as string) || null,
    createdAt: (r.created_at as string) || "",
  };
}

export interface PlaidTransactionLike {
  transactionId: string;
  date: string;
  amountCents: number;
  name: string;
  merchantName?: string | null;
  pending: boolean;
}

/** Upsert a batch of Plaid transactions for one bank account — called from
 *  the webhook/sync route. Never overwrites a transaction's `match_status`
 *  once a human has reviewed it (only the Plaid-sourced columns are
 *  touched on conflict), so a re-sync can't silently un-confirm a match. */
export async function upsertBankTransactions(employerId: string, bankAccountId: string, txns: PlaidTransactionLike[]): Promise<number> {
  const c = db();
  if (!c || !employerId || !bankAccountId || !txns.length) return 0;
  try {
    const rows = txns.map((t) => ({
      employer_id: employerId,
      bank_account_id: bankAccountId,
      plaid_transaction_id: t.transactionId,
      txn_date: t.date,
      amount_cents: t.amountCents,
      name: t.name,
      merchant_name: t.merchantName || null,
      pending: t.pending,
    }));
    const { data, error } = await c.from("books_bank_transactions").upsert(rows, { onConflict: "plaid_transaction_id", ignoreDuplicates: false }).select("id");
    if (error) {
      console.error("[upsertBankTransactions]", error);
      return 0;
    }
    return data?.length || 0;
  } catch (e) {
    console.error("[upsertBankTransactions]", e);
    return 0;
  }
}

export async function listUnmatchedTransactions(employerId: string): Promise<BooksBankTransaction[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data, error } = await c
      .from("books_bank_transactions")
      .select(BANK_TXN_COLS)
      .eq("employer_id", employerId)
      .eq("match_status", "unmatched")
      .order("txn_date", { ascending: false })
      .limit(500);
    if (error || !data) return [];
    return data.map(mapBankTxn);
  } catch {
    return [];
  }
}

export async function getBankTransaction(employerId: string, id: string): Promise<BooksBankTransaction | null> {
  const c = db();
  if (!c || !employerId || !id) return null;
  try {
    const { data } = await c.from("books_bank_transactions").select(BANK_TXN_COLS).eq("employer_id", employerId).eq("id", id).maybeSingle();
    return data ? mapBankTxn(data) : null;
  } catch {
    return null;
  }
}

/** Confirm a match (to an existing entry and/or invoice — at least one) or
 *  decline it (back to unmatched, never silently ignored — "ignored" is a
 *  distinct, explicit outcome for "not a business transaction"). */
export async function setTransactionMatch(
  employerId: string,
  id: string,
  outcome: { matchStatus: "matched" | "unmatched" | "ignored"; matchedEntryId?: string | null; matchedInvoiceId?: string | null }
): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !id) return false;
  try {
    const { error } = await c
      .from("books_bank_transactions")
      .update({ match_status: outcome.matchStatus, matched_entry_id: outcome.matchedEntryId ?? null, matched_invoice_id: outcome.matchedInvoiceId ?? null })
      .eq("employer_id", employerId)
      .eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

// ── Hiring tie-in (Corporate — cost-per-hire) ────────────────────────────────

export interface JobCostSummary {
  jobId: number;
  jobTitle: string;
  taggedExpenseCents: number;
  hires: number;
  costPerHireCents: number | null;
}

/** Cost-per-hire for one job: expenses tagged to it (books_entries.job_id)
 *  divided by the number of applicants on that job whose status is
 *  "hired" — read straight from the existing hiring pipeline
 *  (employer-store.ts listApplicants), never a parallel "hires" count. No
 *  payroll cost is folded in here: payroll is a general ledger expense
 *  (see `monthlyPayrollCostCents` below), not something attributable to one
 *  job posting in this schema. */
export async function jobCostSummary(employerId: string, jobId: number): Promise<JobCostSummary | null> {
  const job = await getJob(employerId, jobId);
  if (!job) return null;
  const [entries, applicants] = await Promise.all([listEntries(employerId, { jobId }), listApplicants(employerId, { jobId })]);
  const taggedExpenseCents = entries.filter((e) => e.type === "expense").reduce((sum, e) => sum + e.amountCents, 0);
  const hires = applicants.filter((a) => a.status === "hired").length;
  return { jobId, jobTitle: job.title, taggedExpenseCents, hires, costPerHireCents: hires > 0 ? taggedExpenseCents / hires : null };
}

/** Total payroll cost for the employer's workforce over a date range, from
 *  the EXISTING Timesheets data (no new time-tracking) × each employee's
 *  own hourly_wage_cents (migration 0095) — an employee with no wage set
 *  contributes 0 rather than a guessed figure. Timesheets has no
 *  range-query of its own (lib/time-store.ts is per-employee-per-week), so
 *  this walks every ISO week that overlaps [from, to] for every employee —
 *  bounded and cheap for the month/quarter ranges reports actually use. */
export async function monthlyPayrollCostCents(employerId: string, from: string, to: string): Promise<number> {
  const employees = await listEmployees(employerId);
  const waged = employees.filter((e) => typeof e.hourlyWageCents === "number");
  if (!waged.length) return 0;

  const weekStarts: string[] = [];
  let cursor = weekStartISO(from);
  const toTime = new Date(to).getTime();
  // 104 weeks (~2 years) is a generous ceiling for a single report range —
  // guards against an unbounded loop on a malformed/huge date range.
  for (let i = 0; i < 104 && new Date(cursor).getTime() <= toTime; i++) {
    weekStarts.push(cursor);
    cursor = addDaysISO(cursor, 7);
  }

  let totalCents = 0;
  for (const employee of waged) {
    const wageCents = employee.hourlyWageCents as number;
    for (const weekStart of weekStarts) {
      const entries = await listEntriesForWeek(employerId, employee.id, weekStart);
      const hours = sumHours(entries);
      totalCents += Math.round(hours * wageCents);
    }
  }
  return totalCents;
}

/** Pull every new/updated transaction for one bank account since its last
 *  sync (following Plaid's `has_more` pagination), upsert them, and save the
 *  new cursor. Called right after a Connect, and from the webhook on every
 *  `SYNC_UPDATES_AVAILABLE` notification. Best-effort: a mid-loop failure
 *  still saves whatever cursor it reached, so the next sync picks up from
 *  there rather than re-pulling everything. */
export async function syncBankAccountTransactions(employerId: string, bankAccountId: string, accessToken: string): Promise<number> {
  let cursor = await getBankAccountSyncCursor(bankAccountId);
  let total = 0;
  for (let page = 0; page < 50; page++) {
    const result = await syncTransactions(accessToken, cursor);
    if (!result) break;
    if (result.added.length) total += await upsertBankTransactions(employerId, bankAccountId, result.added);
    cursor = result.nextCursor;
    await setBankAccountSyncCursor(bankAccountId, cursor);
    if (!result.hasMore) break;
  }
  return total;
}

/** Set (or clear, with `null`) one employee's hourly wage — the one write
 *  path for migration 0095's column, scoped to Books (the Employees hub
 *  itself has no wage field to edit). Direct update via this module's own
 *  `db()`, not a new employees-store.ts CRUD function, since this is the
 *  only feature that ever touches this column. */
export async function setEmployeeHourlyWage(employerId: string, employeeId: number, hourlyWageCents: number | null): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !employeeId) return false;
  try {
    const { error } = await c.from("employees").update({ hourly_wage_cents: hourlyWageCents, updated_at: new Date().toISOString() }).eq("employer_id", employerId).eq("id", employeeId);
    return !error;
  } catch {
    return false;
  }
}
