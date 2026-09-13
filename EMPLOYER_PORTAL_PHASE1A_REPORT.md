# Employer Portal — Phase 1A: Messages, Shortlists & Interview Scheduler

**Branch:** `claude/employer-portal-messages-k46ypn`
**Scope:** the 3 most critical missing recruiting features, built into the Next.js
`resumetailored-platform/` app (Supabase + Clerk), matching the existing employer-portal patterns.

---

## ⚠️ One manual step before this works in production

The new tables ship as a migration file but Supabase migrations in this repo are **applied by
hand** (there's no runner in `package.json`). Run this once against the database:

```
resumetailored-platform/supabase/migrations/0016_employer_messages_shortlists_interviews.sql
```

Until then the features are inert-but-safe: every store call fails open to empty reads / no-op
writes (same "best-effort" contract as `employer-store.ts`), so nothing crashes — the screens
just show their empty states.

---

## What was built

### 1. Messages (`/employer/messages`)
In-app, two-sided messaging between an employer and a candidate (applicant).

- **Inbox (left):** one row per candidate — name, last-message preview (`You:` prefix on
  outbound), relative date, and a **blue unread dot**. Opening a thread clears the dot and
  PATCHes it read on the server.
- **Thread (right):** chat bubbles — **employer right (violet), candidate left**. Renders
  text + attachments; ⌘/Ctrl+Enter sends.
- **Composer:** textarea + Send, **message-templates dropdown** (the 4 requested canned
  messages, prefixed with `Hi <first name>,`), and an **attachment button (PDF + images)**.
- **Filter tabs:** All / Unread / Sent. **Search** by candidate name.
- **Empty state:** "No messages yet. Start a conversation from the Candidates page."
- Mobile: inbox and thread swap (back arrow), never side-by-side on a phone.

**Starting a conversation:** the Candidates drawer now has a **Message** button →
`/employer/messages?applicantId=…`, which opens an empty thread for a candidate who has no
messages yet (fetches their info from the candidates API).

### 2. Shortlists (`/employer/shortlists`)
**Named** candidate collections (e.g. "Frontend — final round"), independent of the single
per-applicant `status` — a candidate can sit in several shortlists at once.

- Grid of shortlist cards (name, description, member count) + create/edit/delete (with an
  inline delete-confirm).
- **Detail drawer:** lists members (name, match score, job, status) with per-row Message /
  Email / Remove; **Add candidate** modal picks from all applicants with search.

### 3. Interview Scheduler (`/employer/scheduler`)
Plan and track interviews.

- Upcoming / Past / All views; each interview is a card with a date block, candidate + role,
  **type** (video / phone / on-site with icons), meeting link (clickable) or address,
  interviewer, duration, status badge, and notes.
- **Schedule modal:** candidate picker, title, date-time, duration, type, link/address (label
  adapts to type), interviewer, notes. Job is auto-linked from the candidate's application.
- Actions: mark **completed**, **cancel**, **reopen**, edit/reschedule, delete.
- The Candidates drawer's **Schedule** button deep-links here with the candidate pre-selected.

### Navigation
Added **Messages**, **Shortlists**, and **Scheduler** to the employer top-nav (desktop + mobile
sheet) between Candidates and Team. Access is already gated at the layout level
(`canUseEmployerPortal`), so no extra per-feature gating was added — consistent with Candidates
and Team.

---

## Files

**New**
- `supabase/migrations/0016_employer_messages_shortlists_interviews.sql` — `messages`,
  `shortlists`, `shortlist_members`, `interviews` (+ indexes, RLS enabled, no public policies —
  same pattern as `0012_employer.sql`).
- `lib/employer-collab-store.ts` — service-role persistence for all three, every query scoped by
  `employer_id` with an ownership check that the applicant's job belongs to the employer.
- `app/api/employer/messages/route.ts` (GET inbox/thread, POST send)
- `app/api/employer/messages/read/route.ts` (PATCH mark read)
- `app/api/employer/shortlists/route.ts` (GET/POST) + `[id]/route.ts` (PATCH/DELETE) +
  `[id]/members/route.ts` (GET/POST/DELETE)
- `app/api/employer/interviews/route.ts` (GET/POST) + `[id]/route.ts` (PATCH/DELETE)
- `app/employer/messages/{page,messages-client}.tsx`
- `app/employer/shortlists/{page,shortlists-client}.tsx`
- `app/employer/scheduler/{page,scheduler-client}.tsx`

**Edited**
- `lib/employer-ai.ts` — added `Message`/`Conversation`/`Shortlist`/`Interview` types,
  `MESSAGE_TEMPLATES`, and mode/status enums + guards.
- `app/employer/components/employer-top-nav.tsx` — 3 new nav items.
- `app/employer/candidates/candidates-client.tsx` — in-app Message + Schedule deep links.

---

## API surface

| Method | Route | Body / Query |
|---|---|---|
| GET | `/api/employer/messages` | `?applicantId=` → thread; none → inbox |
| POST | `/api/employer/messages` | `{ applicantId, content, attachments? }` |
| PATCH | `/api/employer/messages/read` | `{ applicantId }` |
| GET / POST | `/api/employer/shortlists` | `{ name, description? }` |
| PATCH / DELETE | `/api/employer/shortlists/:id` | `{ name?, description? }` |
| GET / POST / DELETE | `/api/employer/shortlists/:id/members` | `{ applicantId }` |
| GET | `/api/employer/interviews` | `?status=&applicantId=` |
| POST | `/api/employer/interviews` | `{ applicantId, title, scheduledAt, durationMin, mode, location?, interviewer?, notes?, jobId? }` |
| PATCH / DELETE | `/api/employer/interviews/:id` | any of the above + `status` |

Every route returns `403 forbidden` if the caller isn't an employer/employee, and validates
enums server-side (`isInterviewMode`, `isInterviewStatus`).

---

## Verification
- `tsc --noEmit` — **clean**
- `next lint --max-warnings=0` — **clean**
- `next build` — **succeeds**; all 3 pages + API routes compile.

No unit tests were added — the platform has no test harness (`package.json` has only
`dev/build/start/lint`, and there's no `test/` dir here, unlike the root Express app).

---

## Notes, decisions & follow-ups

- **Attachments are stored inline** as `data:` URLs in the `messages.attachments` jsonb column,
  capped client-side at ~1.5 MB per file (PDF + images only). This makes the feature work with
  **no object-storage backend**, which none of the employer portal currently has. Follow-up:
  move to Supabase Storage / S3 and store URLs instead, once large files matter.
- **Candidate-side replies:** the schema supports `sender = 'candidate'`, but there's no
  candidate-facing messages UI yet (candidates aren't the same Clerk accounts as applicants in
  this data model). Inbound messages will light up correctly the moment a candidate surface or
  an inbound email→message webhook is added. This is the natural Phase 1B.
- **Shortlists vs. status:** kept as separate named lists rather than overloading the existing
  `shortlisted` applicant status, because recruiters group candidates into multiple lists.
- The `/employer/[...slug]` placeholder still lists `messages`/`shortlists`/`scheduler` labels;
  they're now dead entries (real pages take precedence) — left untouched to minimize churn.

## Open questions for you
1. **Attachment storage** — happy with inline data-URLs for now, or should I wire Supabase
   Storage in this PR?
2. **Candidate replies** — is a candidate-facing inbox in scope for Phase 1B, or will messages
   stay employer-outbound + email for now?
3. **Notifications** — should a new inbound message / an upcoming interview trigger an email
   (Resend is already used elsewhere)?
