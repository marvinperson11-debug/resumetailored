# Employee Portal Foundation — Phase 1 Report

**Repo:** `marvinperson11-debug/resumetailored` · **Project:** `resumetailored-platform/` (Next.js 14 + Supabase + Clerk + TypeScript)
**Branch:** `claude/employee-hr-platform-phases-a22afj`
**Draft PR:** [#534 — Employee Portal Foundation (Phase 1)](https://github.com/marvinperson11-debug/resumetailored/pull/534)
**Checks:** `tsc --noEmit` ✅ · `next lint` ✅ · `next build` ✅

---

## What this covers

This is **Phase 1** of the HR build order — the **Employee Portal Foundation**. The
work lives in the `resumetailored-platform/` Next.js app (the repo root is a
separate legacy Express/SQLite site; the Clerk/Supabase/Resend/DocuSign stack the
build order reuses is all in the platform folder).

### Scope decision (why one phase, one PR)

The build order is six phases, each realistically its own multi-file PR, and it
explicitly says "one PR each." Prior commits (#527–#533) had already built the
**employer-side** employee management (the `employees`/`training_docs`/
`acknowledgments` tables, the Employees directory, the Training Library). What did
**not** exist — and what Phase 1 actually asks for — is the **employee-facing
portal**: an invited workforce member signing in to *their own* `/employee` area.
That is the correct next sequential increment and the foundation every later phase
plugs into, so this PR delivers exactly Phase 1, verified and buildable, and stops
there. Phases 2–6 are scoped below.

---

## Delivered (Phase 1, items 1–4)

### 1. Employee accounts + invite → Clerk signup → linked + `/employee` shell

| Piece | File |
|---|---|
| `employees.clerk_user_id` + invite lifecycle; `employee_messages`, `announcements` | `supabase/migrations/0031_employee_portal.sql` |
| Store: invite token, token lookup, Clerk link, by-clerk-id lookup | `lib/employees-store.ts` |
| Auth model: `staff`/`employeeId` on the employee role; `isStaffEmployee()` | `lib/plan.ts` |
| Employee request context (resolve caller → their own row) | `lib/employee-auth.ts` |
| Invite API (Resend email + link) | `app/api/employer/employees/[id]/invite/route.ts` |
| Acceptance page (bind account + set metadata) | `app/employee/accept/page.tsx` |
| Portal shell (guard) + sidebar | `app/employee/layout.tsx`, `app/employee/components/employee-sidebar.tsx` |
| Protect `/employee(.*)` except `/employee/accept` | `middleware.ts` |

**Auth model — the key design choice.** The platform already had an `"employee"`
Clerk role, but it granted the **employer portal** (used for recruiters invited
via `/join`). A workforce employee must *not* see all candidates/jobs, so this PR
adds a **`staff:true` + `employeeId`** discriminator to the metadata:

- `plan:"employee"` **without** `staff` → recruiter → reaches `/employer` (unchanged).
- `plan:"employee"` **with** `staff:true` + `employeeId` → workforce employee →
  reaches the scoped `/employee` portal, and is **excluded** from the employer
  portal (`canUseEmployerPortal()` now checks `!a.staff`).

`lib/employee-auth.ts` resolves the caller to their own `employees` row by
`(employerId, clerkUserId)` — both from their own metadata — so a request can only
ever read/write its own data.

**Invite flow** mirrors the proven `/join` team-invite path: `POST
/api/employer/employees/[id]/invite` mints a one-time token on the employee row
(status → `invited`) and best-effort emails the `/employee/accept?token=…` link via
the shared Resend sender. The accept page requires sign-in (bouncing through
`/sign-in` with the token preserved), verifies the email matches the invited
address, binds `clerk_user_id`, sets the staff metadata, and lands `/employee`.

**Sidebar** (all five required items): **My documents, Messages, Time off, My
training, Library** (+ a Home entry). Time off / My training / Library are
**placeholders** (`FeaturePlaceholder`) — they belong to Phases 2 and 3, so they
ship as nav entries now and are built in their own phases.

### 2. My documents

`GET /api/employee/documents` → `app/employee/documents/*`. Lists every DocuSign
envelope where the employee is the signer (offers, agreements, write-ups, custom
documents), matched on their email + employer via new
`listEnvelopesForEmail()`. Each shows status, dates, and attachment
view/download links. These are the same envelopes the employer sees in
E-Signatures — **stored on both sides**, appearing here automatically.

### 3. Messages

`GET/POST /api/employee/messages` → `app/employee/messages/*`: a live employee ↔
employer thread with optimistic send and read-marking. **Surfaces in the
employer's Messages area** via a new **Candidates | Employees** toggle
(`messages-tabs.tsx` + `employee-threads.tsx`) — a fresh panel that leaves the
existing candidate messaging client untouched. Backed by
`lib/employee-messages-store.ts` (thread read/post/mark-read + an inbox rollup
with unread counts).

### 4. Announcements

New **Announcements** tab on the employer Employees page (create / pin / retire /
delete). `POST/GET /api/employer/announcements` + `[id]` PATCH/DELETE, backed by
`lib/announcements-store.ts`. Active + pinned announcements appear at the top of
every invited employee's portal **home** (`/employee`).

---

## Constraints honored

- ✅ Reused Clerk auth + metadata roles, the `/join` invite pattern, service-role
  `employer_id`-scoped stores with owner-only RLS, `requireEmployerId`/
  `employerContext`, `sendEmail` + the employer signature, `appUrl()`, the
  DocuSign envelope store, and `DashboardShell`.
- ✅ **No new npm dependencies.**
- ✅ **No payroll / no time clock** in this phase (Phase 2).
- ✅ **Idempotent migration** `0031`, next free number, **hand-applied** (noted in
  the PR). Everything degrades gracefully until it is applied.
- ✅ `tsc` / `lint` / `build` green.

## ⚠️ Before deploying

Run **`supabase/migrations/0031_employee_portal.sql`** against Supabase. It adds
the `employees` invite/link columns and creates `employee_messages` +
`announcements` with owner-only RLS. Safe on a fresh or existing DB; safe to
re-run.

## Verification status (honest)

- **Static checks** pass locally: `tsc --noEmit`, `next lint`, `next build` — all
  new `/employee/*` pages and API routes compile and appear in the build manifest.
- **Live end-to-end** (real Supabase + a real Clerk invite acceptance + Resend
  delivery + a DocuSign envelope round-trip) **was not exercised** — there is no
  live Supabase/Clerk/Resend/DocuSign in this sandbox. The flows reuse the same
  helpers the offer-letter e-sign and team-invite paths already use in production.

**Suggested smoke test after applying 0031:**
1. Employer → Employees → open an employee with an email → **Invite to portal**.
2. Accept the emailed link as that person → land on `/employee` → sidebar renders.
3. Employer posts an **Announcement** (pinned) → it appears on the employee home.
4. Employee sends a **Message** → it shows under employer Messages → **Employees**;
   employer replies → employee sees it.
5. Employer sends the employee a document via E-Signatures → it appears under the
   employee's **My documents**.

---

## Roadmap — Phases 2–6 (not in this PR)

Each is its own PR with its own idempotent migration (next free numbers from
0032), reusing this foundation.

| Phase | Scope | Notes / hooks already in place |
|---|---|---|
| **2 — Time (no payroll)** | Clock in/out + timestamp log; week timesheets (employee view + employer approve/decline + CSV); weekly schedule grid + publish + availability; time-off requests → approve/decline → shown on schedule. Raw hours only. | The **Time off** sidebar item and `/employee/time-off` placeholder already exist. New tables: `time_entries`, `shifts`, `availability`, `time_off_requests`. |
| **3 — Checklists, certs, training + quizzes** | Seeded onboarding `checklist_templates` (+ per-employee instances w/ progress %); `employee_certs` w/ 30/7-day expiry reminders to both sides; in-house training assign→watch/read→complete (Resend, no DocuSign); **quiz system** (`training_quizzes` jsonb, native take/retake, best score in compliance grid); Documents-tab write-ups keep DocuSign. | **My training** + **Library** placeholders + the `training_docs`/`acknowledgments` tables + `training-library-seed` already exist; `acknowledgments.score`/`attempts` + `recordQuizAttempt()` are scaffolded for the quiz. |
| **4 — Office: calculators + charts** | New **Office** sidebar item. Calculators (all tiers, client-side): labor cost, cost-per-hire, turnover, overtime, staffing. Charts (Scale+): paste/CSV/platform data → SVG bar/line/pie → PNG + insert into Documents. | Tier gating via `lib/employer-plan` (`scale`/`corporate`), verifiable with the admin plan-preview switcher. |
| **5 — Office: spreadsheet creator + report writer (Scale+)** | Describe/upload sources (CSV/PDF/docx/text, server extraction) → xlsx/CSV, with presets (hours from timesheets, candidate matrix, compliance). Report writer: pick source+range → written report opened in Documents (editable HTML, PDF). | `mammoth`/`pdf-parse` already present; server generation via the existing Anthropic client with usage logging. |
| **6 — Office: presentation builder (Scale+)** | Topic/data + slide count → themed HTML deck → present in-browser or export PDF → saves to Documents. | — |

**Global rules to carry through every phase:** Office features gate Scale+ via
`lib/employer-plan` (free tier sees upgrade prompts); all generated outputs save
into Documents (a public `office-assets` bucket only if charts need hosting);
server-only Anthropic calls with usage logged; each phase keeps tsc/lint/build
green with an idempotent, hand-applied migration noted in its PR description.

**Final verification target (once all phases land):** hire → invite → employee
signs up → sees offer letter → clocks in/out → timesheet approved → onboarding
checklist progressing → cert reminder fires → watches assigned library video +
passes quiz → grid green with score → sees schedule → time off approved. Free
employer sees Calculators only; Scale employer builds spreadsheet/chart/report/deck.
