# Books (bookkeeping) — V1

Lightweight bookkeeping inside the Employer Portal — a cheaper, simpler
alternative to Xero/QuickBooks for the kind of small business already using
this app to hire. No separate bookkeeping seat system: access rides the
portal's existing team seats (Portal 3, Scale 10, Corporate unlimited).

## Plan matrix

| | Portal ($49) | Scale ($99) | Corporate ($299) |
|---|---|---|---|
| Manual income/expense entries | ✅ | ✅ | ✅ |
| CSV import (+ template, import-result summary) | ✅ | ✅ | ✅ |
| Receipt/photo attachments | ✅ | ✅ | ✅ |
| Taylor category suggestions | ✅ | ✅ | ✅ |
| Simple invoicing (create/send/mark paid/remind) | ✅ | ✅ | ✅ |
| Basic reports (P&L, expenses by category, income by month) | ✅ | ✅ | ✅ |
| Taylor Q&A (spend this month / unpaid / monthly summary) | ✅ | ✅ | ✅ |
| Plaid bank feeds + transaction matching | ❌ | 🔒 taste (locked preview) | ✅ |
| Tax-ready exports (Schedule C, IRS mapping, quarterly estimate) | ❌ | 🔒 taste (locked preview) | ✅ |
| Hiring tie-in (payroll cost rollup, cost-per-hire) | ❌ | 🔒 taste (locked preview) | ✅ |

Gating lives in `lib/employer-plan.ts`: `canUseBooks(access)` (Portal+, the
whole feature) and `canUseFullBooks(access)` (Corporate only, the three
"full Books" surfaces above). Scale renders those three surfaces visible
but locked (`TierUpgradeNote`, same component Office's Scale+ tools use) —
the spec's own wording, "taste of the fuller version" — rather than hiding
them. The nav item (`EMPLOYER_NAV` in `app/employer/components/employer-sidebar.tsx`)
is always visible; `app/employer/layout.tsx`'s `lockedHrefs` adds a lock
badge for any tier below Portal (never for Free, per the existing "Free
gets zero lock badges" rule — a Free employer instead sees the page's own
`LockedModuleBanner`, same pattern as Employees Hub/Time Suite/Office).

## What's built

- **Data model** (`supabase/migrations/0092`–`0095`): `books_entries`,
  `books_invoices`, `books_bank_accounts` + `books_bank_transactions`, and
  one new column, `employees.hourly_wage_cents` (optional — no wage field
  existed anywhere in the schema before this). All four migrations are
  HAND-APPLIED SQL, idempotent, service-role-only (RLS on, no policies,
  explicit grants) — the post-2026-10-30 style used by the newest existing
  tables (`background_check_orders`).
- **Pure core** (`lib/books-hub.ts`): categories + a deterministic keyword
  category-suggester, the CSV template/parser, invoice numbering/line-item
  math, every report calculation (P&L, expenses by category, income by
  month, Schedule C mapping, the quarterly-estimate worksheet), and the
  three Taylor Q&A answers. No DB, no network — mirrors `office-hub.ts`.
- **DB/service-role layer** (`lib/books-store.ts`): CRUD for entries/
  invoices/bank accounts/transactions, the private-Storage receipt flow
  (`books-receipts` bucket, signed URLs), the Plaid sync loop, and the two
  hiring-tie-in gatherers (`jobCostSummary`, `monthlyPayrollCostCents`).
- **Plaid client** (`lib/books-plaid.ts`): raw `fetch` against Plaid's REST
  API — no `plaid` npm SDK (none was a dependency here, and `npm install`
  is blocked in this environment; this follows the same no-SDK convention
  `lib/email.ts`→Resend and the Checkr client already use). Every function
  degrades to `null`/`[]` when `PLAID_CLIENT_ID`/`PLAID_SECRET` are unset —
  see "Plaid env vars" below.
- **API routes** (`app/api/employer/books/**`): `entries` (CRUD, receipt
  upload, CSV import + template download, category suggestion), `invoices`
  (CRUD, send, remind), `reports` (JSON or CSV, for every report above),
  `bank/*` (status, connect, exchange, accounts, webhook, transactions +
  per-transaction match/ignore/create-entry action), `job-cost` (cost-per-
  hire for one job), `employees-wage` (the one place `hourly_wage_cents`
  is read/written), and `taylor` (the three Q&A answers).
- **UI** (`app/employer/books/`): `books-client.tsx` (shell + tabs),
  `entries-tab.tsx`, `invoices-tab.tsx`, `bank-tab.tsx` (loads Plaid Link
  from Plaid's own CDN script at runtime — see above), `reports-tab.tsx`
  (reuses `lib/office-hub.ts`'s hand-rolled SVG chart builder for the
  expenses-by-category pie and income-by-month bar chart — no new charting
  library), `taylor-widget.tsx`. `app/employer/jobs/books-cost-panel.tsx`
  mounts cost-per-hire inside the job edit modal, next to the existing
  `DistributionPanel` (same pattern, same modal).
- **Landing/how-to page**: `app/employer/books/about/page.tsx` — what Books
  is, the plan matrix, and how to use each part. Not gated (any tier can
  read what upgrading unlocks), not in the main nav — reached from the
  "How Books works →" link in the Books toolbar, the same contextual-link
  convention Attribution uses. There is no separate in-app marketing-page
  layout to reuse in this codebase (confirmed by survey before building);
  this page uses the ordinary employer-portal shell like every other
  `/employer/*` route.

## Taylor — read-only, and why it's not a new chat tool

The spec's three questions ("how much did we spend this month?", "what's
unpaid?", a monthly summary) are answered by `POST /api/employer/books/taylor`,
a **deterministic lookup** (`lib/books-hub.ts` `answerTaylorBooksQuestion`),
not a turn through the Employer Portal Assistant's own chat loop
(`lib/assistant-chat.ts`/`lib/assistant-tools.ts`). Two reasons:

1. That assistant's system prompt is explicitly scoped to hiring only, with
   a hard refusal for anything else ("Stay inside hiring... nothing
   else"). Widening it to cover bookkeeping would be a second, unrelated
   change to an already-built, carefully-scoped feature — not "answer
   three fixed questions Books already has the numbers for."
2. `lib/assistant-tools.ts`'s tool registry is pinned by an **exact-contents
   test** (`scripts/test-employer-assistant.cjs`, "tool registry: contains
   exactly the seven read-only + twenty-six Scale-gated tools, nothing
   else"). Adding a tool there means editing that test too — a larger,
   separate change than this V1 needs.

Every Taylor ask is still logged to the **existing** assistant audit log
(`lib/assistant-audit.ts` `logAction`, action `books_taylor_<intent>`) —
read-only, but the spec asks for every Taylor action to leave a trail.
Nothing here is money-facing in the mutating sense (Taylor never sends,
pays, or changes a money record — V1 has no Taylor-driven mutation at
all), so there is no confirmation-card flow to build for it.

**Category suggestion** (`suggestCategory` in `lib/books-hub.ts`) is the
same deliberate choice, for a different reason: it's a per-keystroke
hint on a free-text field, which doesn't fit a confirmation-card tool-use
loop anyway, and avoids adding any new reference to an Anthropic API key
to this codebase. It's a deterministic keyword→category lookup, branded as
"Taylor suggests" in the UI (same assistant, same voice) — a suggestion
only, the employer always confirms by picking the category themselves.

## Hiring tie-in — the judgment call

The spec says "payroll/time costs... flow into Books" and "cost-per-hire
shown next to the job." Two independent pieces, since nothing in the
existing schema ties an employee to a job posting:

- **Cost-per-hire** (`jobCostSummary` in `lib/books-store.ts`): expenses
  tagged to a job (`books_entries.job_id`, settable when creating an entry,
  Corporate only) divided by that job's own hire count (applicants with
  status `"hired"`, read straight from the existing pipeline — never a
  parallel count).
- **Payroll cost** (`monthlyPayrollCostCents`): a general-ledger line, not
  attributable to one job — each waged employee's logged Timesheets hours
  (no new time-tracking; walks the existing per-employee-per-week read
  path) × their `hourly_wage_cents`, shown as a line under the P&L.

## Plaid env vars

```
PLAID_CLIENT_ID     # required to enable bank feeds
PLAID_SECRET        # required to enable bank feeds
PLAID_ENV           # optional — sandbox (default) | development | production
```

Unset ⇒ `plaidConfigured()` is false ⇒ `bank/connect`/`bank/exchange`
answer `503` with a clear message and the Bank Feeds tab shows "Bank feeds
aren't set up yet" instead of a broken Connect button — the rest of Books
(entries, invoices, basic reports) is completely unaffected. This is
independent of plan tier: a Corporate employer with no Plaid credentials
configured sees the "not set up yet" message, not the Scale upsell note.

## Enable / disable

Books has no feature flag of its own (unlike `ATTRIBUTION_REPORT_ENABLED`-
style dark launches) — it ships gated purely by plan tier, consistent with
every other tier-locked module (Employees Hub, Time Suite, Office). To
pull it from the nav entirely, remove the `books` entry from `EMPLOYER_NAV`
in `app/employer/components/employer-sidebar.tsx`; the routes and data
model are otherwise inert for an employer who never opens the tab.

## Explicitly out of scope (V1)

Tax filing (the exports above are informational only, clearly disclaimed
in both the UI and the CSV/JSON response — never a filing or tax advice),
full payroll processing (payroll/time data is read-only input from
Timesheets, never written to), multi-currency, accountant seats beyond the
existing team seats, and any audit trail beyond the existing assistant
audit log. Invoices are records + reminders only — no payment processing,
no Stripe, no money movement anywhere in Books.

## Tests

No new automated test file was added for Books in this pass — the pure
core (`lib/books-hub.ts`) is written in the same no-DB/no-network style as
`office-hub.ts`, which is unit-tested, so a follow-up `test/books.js` (or
`scripts/test-books.cjs`, matching this platform's own convention) covering
`computeProfitAndLoss`, `expensesByCategory`, `incomeByMonth`,
`scheduleCSummary`, `quarterlyEstimateWorksheet`, `parseEntriesCsv`, and
`answerTaylorBooksQuestion` would be the natural next step. Verified
instead via `tsc --noEmit`, ESLint on every changed file, and `next build`
(see the PR/commit description for exact results).
