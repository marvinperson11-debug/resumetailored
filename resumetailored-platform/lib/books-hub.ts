/**
 * Books — shared types and pure helpers (no DB, no network). Mirrors the
 * `office-hub.ts`/`career-hub` convention: this file holds the category
 * list + heuristic suggester, the CSV template/parser, invoice numbering,
 * and every report calculation (P&L, expenses by category, income by
 * month, the tax-ready exports) as plain functions over plain data —
 * `books-store.ts` is the DB/service-role counterpart (CRUD, Storage,
 * Plaid wiring, the Timesheets/Employees cost gatherer).
 *
 * Money is always integer cents end to end (`amountCents`) — never a float
 * dollar amount — the same convention `lib/plan-config.ts`'s `PRICES_USD`
 * and the e-sig/document quotas use for anything that touches a real number.
 */
import { parseCsv } from "./linkedin-import";

// ── Entries ──────────────────────────────────────────────────────────────────

export type BooksEntryType = "income" | "expense";
export const BOOKS_ENTRY_TYPES: BooksEntryType[] = ["income", "expense"];
export const isBooksEntryType = (v: unknown): v is BooksEntryType => v === "income" || v === "expense";

export type BooksEntrySource = "manual" | "csv" | "plaid";

export interface BooksEntry {
  id: string;
  employerId: string;
  type: BooksEntryType;
  entryDate: string; // YYYY-MM-DD
  amountCents: number;
  description: string;
  category: string;
  jobId: number | null;
  receiptPath: string | null;
  source: BooksEntrySource;
  bankTransactionId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Default category list offered in the entry form and used by the category
 *  suggester below. Free text on the DB column (not an enum), so an
 *  employer can still type something else — these are just the common
 *  cases a small business actually hits. Split by entry type since
 *  "Payroll" is never an income category and "Sales" is never an expense
 *  one; `BOOKS_CATEGORIES.expense` doubles as the keys the Schedule-C /
 *  IRS-mapping report below groups by. */
export const BOOKS_CATEGORIES: Record<BooksEntryType, string[]> = {
  income: ["Sales", "Services", "Consulting", "Interest", "Reimbursement", "Other income"],
  expense: [
    "Advertising & marketing",
    "Bank & payment fees",
    "Contract labor",
    "Insurance",
    "Legal & professional",
    "Office supplies",
    "Payroll",
    "Rent",
    "Software & subscriptions",
    "Travel",
    "Utilities",
    "Vehicle & mileage",
    "Other expense",
  ],
};
export const UNCATEGORIZED = "uncategorized";

/** Keyword → category heuristic for the "Taylor suggests a category" entry-form
 *  hint. Deliberately a deterministic lookup, not a model call: the Employer
 *  Portal's assistant (Taylor) only ever runs through the registered
 *  tool-use loop in lib/assistant-chat.ts, and a per-keystroke suggestion on a
 *  free-text field is a poor fit for that confirmation-card pipeline anyway
 *  — this is instant, free, and the user confirms either way (never applied
 *  silently), so a deterministic rule serves the spec ("suggestion only,
 *  user confirms") exactly as well as a model call would. */
const CATEGORY_KEYWORDS: { category: string; type: BooksEntryType; words: string[] }[] = [
  { category: "Software & subscriptions", type: "expense", words: ["subscription", "software", "saas", "license", "zoom", "adobe", "microsoft", "google workspace", "aws", "hosting", "domain"] },
  { category: "Advertising & marketing", type: "expense", words: ["ad", "ads", "advertising", "marketing", "facebook ads", "google ads", "sponsorship", "promo"] },
  { category: "Office supplies", type: "expense", words: ["office supply", "supplies", "paper", "printer", "stationery", "staples"] },
  { category: "Rent", type: "expense", words: ["rent", "lease", "office space", "warehouse"] },
  { category: "Utilities", type: "expense", words: ["electric", "electricity", "water bill", "gas bill", "internet bill", "utility", "utilities"] },
  { category: "Travel", type: "expense", words: ["flight", "airfare", "hotel", "uber", "lyft", "taxi", "travel"] },
  { category: "Vehicle & mileage", type: "expense", words: ["gas station", "fuel", "mileage", "vehicle", "car repair", "parking"] },
  { category: "Insurance", type: "expense", words: ["insurance", "premium"] },
  { category: "Legal & professional", type: "expense", words: ["lawyer", "attorney", "legal fee", "accountant", "bookkeeping fee", "consultant fee"] },
  { category: "Bank & payment fees", type: "expense", words: ["bank fee", "wire fee", "stripe fee", "processing fee", "overdraft", "interest charge"] },
  { category: "Contract labor", type: "expense", words: ["contractor", "freelancer", "1099", "contract labor"] },
  { category: "Payroll", type: "expense", words: ["payroll", "salary", "wages", "paycheck"] },
  { category: "Sales", type: "income", words: ["sale", "sold", "order payment", "invoice payment", "customer payment"] },
  { category: "Consulting", type: "income", words: ["consulting fee", "retainer"] },
  { category: "Services", type: "income", words: ["service fee", "service income"] },
  { category: "Interest", type: "income", words: ["interest earned", "interest income"] },
];

/** Suggest a category for a free-text description — first keyword match
 *  wins, scoped to the entry's own type so an expense description never
 *  suggests an income-only category or vice versa. Returns null (never a
 *  guess) when nothing matches, so the form simply leaves the field for the
 *  employer to pick. */
export function suggestCategory(description: string, type: BooksEntryType): string | null {
  const text = (description || "").toLowerCase();
  if (!text.trim()) return null;
  for (const rule of CATEGORY_KEYWORDS) {
    if (rule.type !== type) continue;
    if (rule.words.some((w) => text.includes(w))) return rule.category;
  }
  return null;
}

// ── CSV import/export ───────────────────────────────────────────────────────

export const BOOKS_CSV_TEMPLATE_HEADERS = ["date", "type", "amount", "description", "category"] as const;

/** The downloadable blank CSV template — header row + one example row, same
 *  shape `parseEntriesCsv` below expects back. */
export function buildEntriesCsvTemplate(): string {
  return [BOOKS_CSV_TEMPLATE_HEADERS.join(","), "2026-01-15,expense,42.50,Office supplies from Staples,Office supplies"].join("\n");
}

export interface ParsedCsvEntry {
  type: BooksEntryType;
  entryDate: string;
  amountCents: number;
  description: string;
  category: string;
}

export interface EntriesCsvImportResult {
  imported: ParsedCsvEntry[];
  skipped: { row: number; reason: string }[];
}

function normalizeCsvDate(raw: string): string | null {
  const s = (raw || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    const [, mm, dd, yyyy] = m;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

function parseAmountToCents(raw: string): number | null {
  const cleaned = (raw || "").replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.abs(n) * 100);
}

const MAX_CSV_ROWS = 2000;

/** Parse an uploaded income/expense CSV (reusing the generic RFC-4180-ish
 *  parser from lib/linkedin-import.ts, same convention as the Office Charts
 *  tab's own CSV path) into entries ready to insert, plus a per-row skip
 *  reason for anything malformed — never throws on a bad row, so one typo
 *  doesn't abort the whole file. Rows beyond `MAX_CSV_ROWS` are skipped with
 *  a single summary reason rather than silently dropped. */
export function parseEntriesCsv(text: string): EntriesCsvImportResult {
  const rows = parseCsv(text);
  const imported: ParsedCsvEntry[] = [];
  const skipped: { row: number; reason: string }[] = [];

  rows.slice(0, MAX_CSV_ROWS).forEach((row, i) => {
    const rowNum = i + 2; // header is row 1
    const typeRaw = (row.type || row.Type || "").trim().toLowerCase();
    const type: BooksEntryType | null = typeRaw === "income" ? "income" : typeRaw === "expense" ? "expense" : null;
    if (!type) {
      skipped.push({ row: rowNum, reason: `type must be "income" or "expense" (got "${row.type || ""}")` });
      return;
    }
    const entryDate = normalizeCsvDate(row.date || row.Date || "");
    if (!entryDate) {
      skipped.push({ row: rowNum, reason: `unreadable date ("${row.date || ""}")` });
      return;
    }
    const amountCents = parseAmountToCents(row.amount || row.Amount || "");
    if (amountCents === null || amountCents <= 0) {
      skipped.push({ row: rowNum, reason: `unreadable or zero amount ("${row.amount || ""}")` });
      return;
    }
    const description = (row.description || row.Description || "").trim().slice(0, 500);
    const categoryRaw = (row.category || row.Category || "").trim().slice(0, 80);
    const category = categoryRaw || UNCATEGORIZED;
    imported.push({ type, entryDate, amountCents, description, category });
  });

  if (rows.length > MAX_CSV_ROWS) {
    skipped.push({ row: MAX_CSV_ROWS + 2, reason: `file has more than ${MAX_CSV_ROWS} rows — the rest were not read` });
  }
  return { imported, skipped };
}

// ── Invoices ─────────────────────────────────────────────────────────────────

export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "void";

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPriceCents: number;
}

export interface BooksInvoice {
  id: string;
  employerId: string;
  invoiceNumber: string;
  clientName: string;
  clientEmail: string | null;
  issueDate: string;
  dueDate: string;
  lineItems: InvoiceLineItem[];
  amountCents: number;
  status: InvoiceStatus;
  sentAt: string | null;
  paidAt: string | null;
  lastReminderAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Total of a line-item list, in cents — the one place this math happens, so
 *  the stored `amountCents` and any preview total can never disagree. */
export function invoiceTotalCents(items: InvoiceLineItem[]): number {
  return items.reduce((sum, li) => sum + Math.round(li.quantity * li.unitPriceCents), 0);
}

/** Clamp+coerce a loosely-typed line-item array (a request body) into valid
 *  `InvoiceLineItem[]` — never trusts the shape, same approach
 *  `office-hub.ts`'s `sanitizeGrid` uses for its own request bodies. */
export function sanitizeLineItems(v: unknown): InvoiceLineItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((raw) => {
      if (!raw || typeof raw !== "object") return null;
      const r = raw as Record<string, unknown>;
      const description = String(r.description ?? "").slice(0, 300);
      const quantity = Number(r.quantity);
      const unitPriceCents = Number(r.unitPriceCents);
      if (!description || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPriceCents) || unitPriceCents < 0) return null;
      return { description, quantity, unitPriceCents: Math.round(unitPriceCents) };
    })
    .filter((li): li is InvoiceLineItem => li !== null)
    .slice(0, 50);
}

/** "INV-2026-0001"-style number, the next one for this employer given the
 *  count of invoices already created this calendar year. Sequential per
 *  employer, not globally — two employers' invoice numbers are independent. */
export function nextInvoiceNumber(existingCountThisYear: number, year: number = new Date().getUTCFullYear()): string {
  return `INV-${year}-${String(existingCountThisYear + 1).padStart(4, "0")}`;
}

/** Whether a sent (not yet paid/void) invoice is now overdue, given today's
 *  date — pure so the reports/list views and the nightly reminder sweep
 *  (if one is ever added) always agree on the definition. */
export function isInvoiceOverdue(invoice: Pick<BooksInvoice, "status" | "dueDate">, today: string = new Date().toISOString().slice(0, 10)): boolean {
  return invoice.status === "sent" && invoice.dueDate < today;
}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Reports ──────────────────────────────────────────────────────────────────

export interface ReportEntryLike {
  type: BooksEntryType;
  entryDate: string;
  amountCents: number;
  category: string;
}

export interface ProfitAndLoss {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
}

/** Profit & loss over whatever entries are handed in — the caller filters by
 *  date range before calling this, so the function itself has no notion of
 *  "this month" vs "this year". */
export function computeProfitAndLoss(entries: ReportEntryLike[]): ProfitAndLoss {
  let incomeCents = 0;
  let expenseCents = 0;
  for (const e of entries) {
    if (e.type === "income") incomeCents += e.amountCents;
    else expenseCents += e.amountCents;
  }
  return { incomeCents, expenseCents, netCents: incomeCents - expenseCents };
}

export interface CategoryBreakdown {
  category: string;
  amountCents: number;
}

/** Expenses grouped by category, largest first — the "expenses by category"
 *  report and the pie-chart data behind it (via office-hub's ChartPoint). */
export function expensesByCategory(entries: ReportEntryLike[]): CategoryBreakdown[] {
  const byCategory = new Map<string, number>();
  for (const e of entries) {
    if (e.type !== "expense") continue;
    byCategory.set(e.category, (byCategory.get(e.category) || 0) + e.amountCents);
  }
  return Array.from(byCategory.entries())
    .map(([category, amountCents]) => ({ category, amountCents }))
    .sort((a, b) => b.amountCents - a.amountCents);
}

export interface MonthlyBreakdown {
  month: string; // YYYY-MM
  incomeCents: number;
  expenseCents: number;
}

/** Income (and expense, for context) by calendar month, in date order —
 *  "income by month". Months with zero entries are not synthesized; the
 *  caller decides whether to fill gaps for a chart's x-axis. */
export function incomeByMonth(entries: ReportEntryLike[]): MonthlyBreakdown[] {
  const byMonth = new Map<string, MonthlyBreakdown>();
  for (const e of entries) {
    const month = e.entryDate.slice(0, 7);
    const bucket = byMonth.get(month) || { month, incomeCents: 0, expenseCents: 0 };
    if (e.type === "income") bucket.incomeCents += e.amountCents;
    else bucket.expenseCents += e.amountCents;
    byMonth.set(month, bucket);
  }
  return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
}

// ── Tax-ready exports (reports only — not filing; see CLAUDE.md/BOOKS.md) ───

/** Schedule C (Form 1040) expense line categories this maps to, keyed by our
 *  own category labels above. "Other expense" and anything unmapped falls
 *  under Schedule C's own "Other expenses" line (line 27a) — the mapping is
 *  informational, never submitted anywhere, and is NOT tax advice. */
export const SCHEDULE_C_MAPPING: Record<string, string> = {
  "Advertising & marketing": "Line 8 — Advertising",
  "Bank & payment fees": "Line 27a — Other expenses",
  "Contract labor": "Line 11 — Contract labor",
  Insurance: "Line 15 — Insurance (other than health)",
  "Legal & professional": "Line 17 — Legal and professional services",
  "Office supplies": "Line 22 — Supplies",
  Payroll: "Line 26 — Wages",
  Rent: "Line 20b — Rent (other business property)",
  "Software & subscriptions": "Line 27a — Other expenses",
  Travel: "Line 24a — Travel",
  Utilities: "Line 25 — Utilities",
  "Vehicle & mileage": "Line 9 — Car and truck expenses",
  "Other expense": "Line 27a — Other expenses",
};

export interface ScheduleCRow {
  category: string;
  scheduleCLine: string;
  amountCents: number;
}

/** Expenses grouped by category and mapped to a Schedule C line — a
 *  convenience export for the employer's own accountant, not a filing. An
 *  expense in a category with no mapping entry (a custom/free-text
 *  category the employer typed themselves) still appears, under "Line 27a
 *  — Other expenses", same as "Other expense" itself — never dropped
 *  silently just because it has no dedicated line. */
export function scheduleCSummary(entries: ReportEntryLike[]): ScheduleCRow[] {
  const rows = expensesByCategory(entries);
  return rows.map((r) => ({ category: r.category, scheduleCLine: SCHEDULE_C_MAPPING[r.category] || SCHEDULE_C_MAPPING["Other expense"], amountCents: r.amountCents }));
}

export interface QuarterlyEstimateWorksheet {
  /** Net profit for the period the entries cover. */
  netProfitCents: number;
  /** Simplified self-employment-tax estimate: 15.3% of 92.35% of net profit
   *  (the standard SE-tax base reduction), floored at 0 for a loss quarter.
   *  A rough planning number for the employer's own accountant to refine —
   *  not a filing, and deliberately simplified (no SE tax deduction
   *  loop-back, no income-tax bracket layered on top). */
  estimatedSelfEmploymentTaxCents: number;
  /** A suggested quarterly set-aside: SE tax plus a flat 20% of net profit
   *  as a rough income-tax placeholder, floored at 0. Clearly labeled as an
   *  estimate everywhere it's shown — see BOOKS.md for the exact disclaimer
   *  this is paired with in the UI/export. */
  suggestedSetAsideCents: number;
}

const SE_TAX_RATE = 0.153;
const SE_TAX_BASE = 0.9235;
const INCOME_TAX_PLACEHOLDER_RATE = 0.2;

/** A deliberately simple quarterly-estimate worksheet — net profit for the
 *  quarter, a standard self-employment-tax estimate, and a suggested
 *  set-aside. This is a planning aid, not a tax calculation: it ignores
 *  deductions, credits, prior-quarter overpayments, and bracket effects on
 *  purpose, matching the spec's "tax-ready reports... out of scope for
 *  filing." */
export function quarterlyEstimateWorksheet(entries: ReportEntryLike[]): QuarterlyEstimateWorksheet {
  const { netCents } = computeProfitAndLoss(entries);
  const netProfitCents = Math.max(0, netCents);
  const estimatedSelfEmploymentTaxCents = Math.round(netProfitCents * SE_TAX_BASE * SE_TAX_RATE);
  const suggestedSetAsideCents = estimatedSelfEmploymentTaxCents + Math.round(netProfitCents * INCOME_TAX_PLACEHOLDER_RATE);
  return { netProfitCents, estimatedSelfEmploymentTaxCents, suggestedSetAsideCents };
}

// ── Hiring tie-in (Corporate — cost-per-hire) ────────────────────────────────

/** Cost per hire for one job: total spend tagged to that job divided by the
 *  number of hires it produced. Mirrors `office-hub.ts`'s `costPerHire`
 *  exactly (same formula, same zero-hires guard) — kept as its own export
 *  here rather than importing across modules, since the two call sites
 *  (Office's manual calculator vs. Books' real job-tagged data) are
 *  independent inputs that happen to share one formula. */
export function jobCostPerHire(totalSpendCents: number, hires: number): number {
  return hires > 0 ? totalSpendCents / hires : 0;
}

// ── Taylor (read-only Books Q&A) ─────────────────────────────────────────────

/** The three fixed questions Books' V1 spec asks Taylor to answer — a
 *  deterministic lookup, not a generative chat turn: the Employer Portal
 *  Assistant's own tool-use loop (lib/assistant-chat.ts) is scoped to
 *  hiring only (its system prompt refuses anything else), and its tool
 *  registry (lib/assistant-tools.ts) is pinned by an exact-contents test —
 *  widening either to cover bookkeeping would be a second, unrelated
 *  change, not "answer three fixed questions about numbers Books already
 *  has." This intent lookup gives the spec's exact three answers (named
 *  "Taylor" in the UI, same brand) without touching that assistant at all.
 *  Every call is logged by the API route via the existing
 *  lib/assistant-audit.ts `logAction` — read-only, but still an audited
 *  "Taylor did something" event, per the spec's guardrail. */
export type TaylorBooksIntent = "spend_this_month" | "unpaid_invoices" | "monthly_summary";
export const TAYLOR_BOOKS_INTENTS: TaylorBooksIntent[] = ["spend_this_month", "unpaid_invoices", "monthly_summary"];
export const isTaylorBooksIntent = (v: unknown): v is TaylorBooksIntent => (TAYLOR_BOOKS_INTENTS as readonly string[]).includes(String(v));

export interface TaylorBooksAnswerInput {
  intent: TaylorBooksIntent;
  /** This calendar month's entries (already filtered by the caller). */
  monthEntries: ReportEntryLike[];
  /** Invoices whose status is "sent" or "overdue" — unpaid, by definition. */
  unpaidInvoices: Pick<BooksInvoice, "invoiceNumber" | "clientName" | "amountCents" | "dueDate">[];
  monthLabel: string; // e.g. "November 2026", for the answer text
}

/** Plain-language answer text for one of the three intents — grounded
 *  strictly in the numbers passed in, never a model paraphrase that could
 *  drift from them. */
export function answerTaylorBooksQuestion(input: TaylorBooksAnswerInput): string {
  if (input.intent === "spend_this_month") {
    const { expenseCents } = computeProfitAndLoss(input.monthEntries);
    return expenseCents > 0
      ? `You've spent ${formatMoney(expenseCents)} so far in ${input.monthLabel}.`
      : `No expenses recorded yet in ${input.monthLabel}.`;
  }
  if (input.intent === "unpaid_invoices") {
    if (!input.unpaidInvoices.length) return "Nothing's unpaid right now — every sent invoice has been marked paid.";
    const totalCents = input.unpaidInvoices.reduce((sum, i) => sum + i.amountCents, 0);
    const lines = input.unpaidInvoices.map((i) => `${i.invoiceNumber} — ${i.clientName}, ${formatMoney(i.amountCents)}, due ${i.dueDate}`);
    return `${input.unpaidInvoices.length} unpaid invoice${input.unpaidInvoices.length === 1 ? "" : "s"} totaling ${formatMoney(totalCents)}:\n${lines.join("\n")}`;
  }
  const { incomeCents, expenseCents, netCents } = computeProfitAndLoss(input.monthEntries);
  return `${input.monthLabel} summary — income ${formatMoney(incomeCents)}, expenses ${formatMoney(expenseCents)}, net ${netCents >= 0 ? "+" : ""}${formatMoney(netCents)}.`;
}

/** Payroll cost for a stretch of logged hours at a known hourly wage —
 *  `lib/books-store.ts` sums an employee's hours across the report's weeks
 *  (via `time-store.ts listEntriesForWeek` + `time-hub.ts sumHours`, the
 *  existing Timesheets read path — no new time-tracking) and calls this
 *  once per employee who has `hourlyWageCents` set. An employee with no
 *  wage recorded contributes 0, not a guess. */
export function payrollCostCents(hours: number, hourlyWageCents: number): number {
  return Math.round(hours * hourlyWageCents);
}
