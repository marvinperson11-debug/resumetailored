# Employee Hub — Build Report (PR 1 of 2)

**Repo:** `marvinperson11-debug/resumetailored` · **Project:** `resumetailored-platform/` (Next.js 14 + Supabase + Clerk + TypeScript)
**Branch:** `claude/employee-hub-feature-xlm48r`
**Draft PR:** [#527 — Employee Hub (PR 1 of 2): Employees + Training & Acknowledgments](https://github.com/marvinperson11-debug/resumetailored/pull/527)
**Status checks:** `tsc --noEmit` ✅ · `next lint` ✅ · `next build` ✅

---

## Scope note (why one PR, not five)

The Employee Hub is a large feature and your brief explicitly allowed splitting it
into sequential PRs (**"A+B first, then C/D/E"**). This PR delivers **A + B** as a
complete, deployable slice. **C (Team Feed), D (Skills Matrix), E (Quizzes)** are the
planned PR 2 — the groundwork for E is already in place (see below).

The feature lives in the **`resumetailored-platform/`** Next.js app — the platform
that already has the employer portal, Documents creator, E-Signatures/DocuSign, and
Resend notifications the brief said to reuse. (The repo root is a *separate* legacy
Express/SQLite app; the Supabase/RLS/`requireEmployerId`/`appUrl` stack referenced in
the brief only exists in the platform folder, so that's where this was built.)

---

## What shipped

### Part A — Employees
| Piece | File |
|---|---|
| Table `employees` (RLS `employer_id = auth.uid()::text`) | `supabase/migrations/0029_employee_hub.sql` |
| Service-role store (CRUD + distinct-roles) | `lib/employees-store.ts` |
| Types, statuses, validators | `lib/employee-hub.ts` |
| CRUD API | `app/api/employer/employees/route.ts`, `app/api/employer/employees/[id]/route.ts` |
| Sidebar item **Employees** | `app/employer/components/employer-sidebar.tsx` |
| Page + Directory tab (list, add, detail drawer) | `app/employer/employees/page.tsx`, `app/employer/employees/employees-client.tsx` |
| **Lifecycle hook**: "Add as employee" on a hired candidate | `app/employer/candidates/candidates-client.tsx` |

- Employee statuses: `active` / `on_leave` / `offboarded`.
- Detail drawer shows employee info **plus their acknowledgment checklist** (each
  training item + compliance state + quiz score if any).
- The **lifecycle hook** is exactly per the brief: when an applicant becomes `hired`
  (the existing offer-completion status sync already sets this), a one-click
  **Add as employee** prompt appears on the candidate profile, prefilled with the
  applicant's name / email / role.

### Part B — Training & Acknowledgments
| Piece | File |
|---|---|
| Tables `training_docs`, `acknowledgments` | `supabase/migrations/0029_employee_hub.sql` |
| Store (docs CRUD, assignment, compliance grid, quiz-attempt hook) | `lib/training-store.ts` |
| Resend reminder emails (reusing the employer email shell) | `lib/training-notify.ts` |
| Create + assign + optional e-sign send | `app/api/employer/training/route.ts` |
| Per-doc compliance grid + delete | `app/api/employer/training/[id]/route.ts` |
| Reminders (bulk or per-employee) | `app/api/employer/training/[id]/remind/route.ts` |
| Manual sign/waive override | `app/api/employer/acknowledgments/[id]/route.ts` |
| Webhook + poll flip acknowledgment → signed | `app/api/docusign/webhook/route.ts`, `lib/docusign-store.ts` |
| Dashboard activity events (`training_signed`, `training_overdue`) | `lib/employer-store.ts` |
| Training tab UI (rollup + compliance grid) | `app/employer/employees/employees-client.tsx` |

Behavior, matching the brief:
- **Create**: author in the **Documents creator** ("Use in training" →
  `source_document_id`, snapshotted so later document edits don't silently mutate
  already-assigned training), **or** paste inline content, **or** a PDF-URL upload
  fallback. Pick a kind (`sop`/`safety`/`policy`/`training`), assign to **all** or a
  **role**, optional due date, `require_signature` toggle.
- **Signature required →** each assignee is sent a signing request through the existing
  DocuSign path (`doc_type: custom`, signer = the employee). The DocuSign **webhook**
  (with a poll-path fallback) flips the matching `acknowledgment` to **signed** on
  envelope completion.
- **Compliance view (Training tab)**: per-doc rollup and a per-doc grid coloured
  **signed = green / pending = amber / overdue = red (past `due_at`) / waived = grey**.
  Per-employee **Remind** and bulk **Send reminders** (pending/overdue only) via Resend;
  manual **Mark signed** / **Waive**.
- **Per-employee checklist** on the employee's own detail drawer.
- **Activity feed**: `training_signed` and `training_overdue` entries flow into the
  existing employer dashboard activity list.

---

## Constraints honored
- ✅ Reused `requireEmployerId`/`employerContext`, service-role stores, RLS
  `employer_id = auth.uid()::text`, `appUrl()`-style helpers, Resend + the employer
  email shell, the Documents creator, and the E-Signatures flow.
- ✅ **Idempotent migration** `0029_employee_hub.sql` — **hand-applied** (noted in the
  PR description); safe to re-run.
- ✅ **No new npm dependencies.**
- ✅ **No time clock / payroll** — out of scope.
- ✅ `tsc` / `lint` / `build` green.

---

## ⚠️ Before deploying
Run **`supabase/migrations/0029_employee_hub.sql`** against the Supabase project. It
creates `employees`, `training_docs`, `acknowledgments`, their indexes, and owner-only
RLS policies. Idempotent and safe on an existing DB. Everything degrades gracefully if
it hasn't been applied yet (empty reads, no crashes), but the Hub is inert until it is.

---

## Verification status (honest)
- **Static checks** (`tsc --noEmit`, `next lint`, `next build`) all pass locally.
- **Live end-to-end** (real Supabase + DocuSign envelope round-trip + Resend delivery)
  **could not be exercised in this sandbox** — there's no live Supabase/DocuSign/Resend
  here. The flows are wired to the same proven helpers the offer-letter e-sign path
  already uses, but a reviewer should smoke-test after applying 0029:
  1. Add an employee (and try the "Add as employee" hook from a hired candidate).
  2. Author a safety doc in Documents → "Use in training", assign to a role, signature
     required, due date set.
  3. Assignee receives the DocuSign signing email → signs → grid cell flips to **signed**.
  4. Let a due date pass → cell turns **red overdue** → "Send reminders" emails go out.

---

## PR 2 plan (C / D / E)
- **C — Team Feed**: `feed_posts` + `feed_comments`; a **Feed** tab (composer for
  post/issue/win, comments, resolve on issues, pin). Text-only v1.
- **D — Skills Matrix**: `skills` + `employee_skills` (unique per pair); editable
  employees × skills grid (tap a cell for level 1–5) + add-skill input.
- **E — Quizzes**: `training_quizzes` (jsonb questions, pass threshold); a builder in
  the training create/edit form and an employee quiz flow that completes the
  acknowledgment on pass. **Already scaffolded:** `acknowledgments.score`/`attempts`
  exist and `training-store.ts` exports `recordQuizAttempt(...)`, so E needs only the
  quiz table + builder/player UI — no change to the acknowledgment schema.

These land as migration `0030` + a second draft PR, each independently deployable.
