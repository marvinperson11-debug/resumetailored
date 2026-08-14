# Employer Portal v2.0 — Build Plan & Open Questions

> My response to the "build the complete Employer Portal v2.0" request. There is one
> hard blocker (a tech-stack mismatch) that must be resolved before any code is written.
> This document captures the analysis, the options, and the questions I need answered.

_Author: Claude Code · Date: 2026-08-14_

---

## 1. TL;DR — the blocker

The spec says "TECH STACK (use existing)" and lists **Next.js 14 App Router, TypeScript,
Prisma + PostgreSQL, NextAuth.js, Upstash Redis, shadcn/ui**. None of that is the existing
stack of this repository. Building the feature as literally specified would mean standing up
an entirely new application alongside the current one — not extending "the existing" app.

I stopped before writing code to confirm the direction, because this choice changes 100% of
the implementation (schema DDL, auth, routing, UI, deploy).

## 2. Actual vs. requested stack

| Concern | Spec ("use existing") | What this repo actually is |
|---|---|---|
| Framework | Next.js 14 (App Router) | **Express 4**, no framework |
| Frontend | React + shadcn/ui | **Vanilla HTML/CSS/JS** in `public/`, no build step (React only in `remotion/`) |
| Language | TypeScript | JavaScript (TS only for the Remotion video project) |
| ORM / DB | Prisma + PostgreSQL | **better-sqlite3 / SQLite**, raw prepared statements |
| Auth | NextAuth.js | Custom UUID session tokens (`sessions` table), bcrypt |
| Rate limit / cache | Upstash Redis | In-process `express-rate-limit` |
| Email | Resend | `nodemailer` + a `sendEmail()` helper (Resend via HTTP) |
| Billing | Stripe | ✅ Stripe (already integrated) |
| AI | Anthropic Claude | ✅ Anthropic (already integrated, `claude-sonnet-4-6` / `claude-haiku-4-5`) |

Only **Stripe** and **Anthropic** match.

## 3. The decision (pick one)

**Option A — Adapt the spec to the real stack (recommended).**
Build the Employer Portal inside the current Express + SQLite + vanilla-JS app. Reuse the
existing auth, Stripe, Anthropic, email, and rate-limiting that already power the product.
Translate the Prisma models into `CREATE TABLE` statements and the App Router pages into
Express routes + `public/` pages. Highest reuse, ships on the current Railway/Dockerfile
deploy, no new infra to provision or pay for.

**Option B — Stand up a new Next.js + Prisma + Postgres app.**
Matches the spec verbatim but is effectively a second product: new repo/app, new database
(Postgres), new auth (NextAuth), new hosting, and a data/identity bridge back to the SQLite
app so employers and candidates/résumés are shared. Largest effort by far; two stacks to
maintain.

**Option C — Pause and revise the spec.** The spec may have been written for a different
project. If so, let's correct it before building.

My recommendation is **Option A**. It delivers the same product capability while reusing
everything that already works, and it's the only reading of "use existing" that is literally true.

## 4. If Option A — how the spec maps onto this stack

- **Schema:** the 11 Prisma models become 11 SQLite tables created with
  `CREATE TABLE IF NOT EXISTS` in `server.js` (same pattern as the current tables).
  - `@db.Text` → `TEXT`; `Json` → `TEXT` holding JSON (parse on read).
  - `String[]` (e.g. `matchedKeywords`) → JSON-encoded `TEXT` (SQLite has no array type).
  - `cuid()` → the existing `uuid` dependency.
  - `@@index` / `@@unique` → `CREATE INDEX` / `CREATE UNIQUE INDEX`.
  - `onDelete: Cascade` → `ON DELETE CASCADE` (with `PRAGMA foreign_keys=ON`) or explicit
    cascade in delete routes, matching how the repo already handles site/media deletes.
- **Auth & roles:** reuse `getSessionEmail(req)`; add company/`TeamMember` role checks
  (`admin` / `recruiter` / `viewer`) as Express middleware.
- **Billing:** extend the current Stripe integration with the three employer tiers
  (`starter` / `pro` / `scale`) → `EmployerPlan`; enforce `seatsLimit` / `jobsLimit` /
  `contactsLimit` server-side (same shape as the existing `isSubscriber` / quota gating).
- **AI features:** `AiMatch`, résumé↔job scoring, AI-drafted messages, screener scoring —
  built on the existing Anthropic helper (`callClaudeJSON`-style, cached cross-user by
  content hash like the Career Hub does).
- **Rate limiting:** existing `express-rate-limit` (no Upstash needed at current scale).
- **Email:** existing `sendEmail()` (invites, candidate contact, stage-change notifications).
- **UI:** new `public/employer/*` pages in the same vanilla-JS SPA style as `app.html`
  (pipeline board, job editor, applicant drawer, AI-match list), not shadcn/React.

## 5. Reality check on "build it all now"

This is a genuinely large feature (11 tables, billing tiers, a Kanban applicant pipeline,
AI matching + outreach, team seats/roles, public company pages, candidate search). Doing it
*all* in a single pass would produce a lot of unreviewed, untested surface area at once.
I'd rather ship it in reviewable phases, each a working PR:

1. **Data + companies + team/roles** — tables, company CRUD, seats/roles, invites.
2. **Jobs** — job CRUD, screener questions, public job pages, view/apply counts.
3. **Applicants pipeline** — apply flow, Kanban stages, notes, activity log, starring.
4. **AI layer** — match scoring, matched/missing keywords, AI-drafted messages, shortlists.
5. **Billing + limits** — employer tiers, Stripe, server-side seat/job/contact enforcement.

I can start Phase 1 immediately on your go, or compress phases if you want fewer, larger PRs.

## 6. Open product questions

1. **Candidate pool.** AI matching / "database search" / `candidateId` imply searching
   existing users' résumés. Do you intend to expose job-seekers' résumés to employers? That's
   a significant privacy/ToS change and needs candidate opt-in. What's the intended consent model?
2. **Billing model.** Is the Employer Portal a **separate** paid product (its own tiers), or
   bundled into the existing $19.99 Pro? The `EmployerPlan` tiers suggest separate — confirm
   prices for `starter` / `pro` / `scale` and the seat/job/contact limits per tier.
3. **This vs. "Teams".** Earlier we drafted a "ResumeTailored for Teams" outplacement/B2B
   offer. Is the Employer Portal the same initiative or a distinct hiring-side product?
4. **Auth for employers.** Same account system as job-seekers (one `users` table, company
   membership on top), or a separate employer login?

## 7. What I'll do once you answer

- **Option A + phased:** I start Phase 1 (schema + companies + team/roles) as a draft PR
  off `main`, in Express/SQLite/vanilla-JS, and iterate through the phases.
- **Option B:** I'll scope the new Next.js/Prisma/Postgres app and the bridge to the current
  app as its own plan before writing code (new infra needs your sign-off).
- **Option C:** tell me the correct target and I'll re-plan.
