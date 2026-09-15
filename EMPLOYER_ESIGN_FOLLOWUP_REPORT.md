# Employer E-Signatures Follow-up — Build Report

Branch `claude/employer-esign-followup` → **draft PR [#497](https://github.com/marvinperson11-debug/resumetailored/pull/497)** (base `main`). All changes under `resumetailored-platform/`. `tsc` / `next lint` / `next build` all green; **no new npm dependencies**.

## What shipped (all 5 items)

### 1. Rename + generalize → E-Signatures
- Sidebar + page title "Offer Letters" → **E-Signatures**; route `/employer/docusign` unchanged.
- Document types: **Offer letter · Employment agreement · NDA · Custom**.
  - offer/agreement/NDA generated server-side as HTML with invisible signature/date anchors (`renderAgreementHtml`, `renderNdaHtml`, `buildDocumentDefinition` in `lib/docusign.ts`).
  - **Custom** = upload any PDF, name it, optional message; auto-placed signature + date field (fixed-position tabs). New `POST /api/employer/docusign/upload` → private `esign-documents` bucket; send route fetches it back server-side.
  - Envelopes list gained a **type badge** + Document column.

### 2. Add-applicant form: upload / paste / AI
- `[Paste text] | [Upload file]` toggle for **resume AND cover letter** (PDF/DOCX/TXT ≤ 5 MB → private `applicant-resumes` bucket + server-side extraction into the editable field). New `POST /api/employer/candidates/extract` (reuses `pdf-parse` + `mammoth`).
- **Generate with AI** for each → new `POST /api/employer/candidates/generate` (shared Anthropic client).

### 3. Candidate panel
- Action row **pinned to the top** (Send document / Shortlist / Reject / Message / Schedule).
- "Send offer letter" → **Send document** with a type selector (`SendDocumentModal`, reused on candidate drawer + shortlist rows).

### 4. Status sync
- Offer **sent** → applicant "offer extended"; **completed** → "hired". Both statuses added; manual override intact (sync only fires on send/complete).

### 5. Interview-scheduling bug (manually-added applicants)
- **Root cause:** the real Postgres error was swallowed and surfaced as the generic *"Could not schedule (is this candidate yours?)"*. Because `applicants` has **no `employer_id`** and `job_id` is **NOT NULL**, the ownership chain was sound — the failure was a **column mismatch** on a live `interviews` table missing a column.
- **Fix:** `console.error` tracing added to `ownsApplicant` + `createInterview` (real cause now logged; friendly client message unchanged) + idempotent `alter table interviews add column if not exists …` heal in migration 0016.

## Files
- **New routes:** `api/employer/docusign/upload`, `api/employer/candidates/extract`, `api/employer/candidates/generate`
- **New component:** `app/employer/components/send-document-modal.tsx` (replaces `send-offer-modal.tsx`)
- **Libs:** `docusign.ts` (doc builders), `docusign-store.ts` (doc_type, status sync, esign storage), `employer-store.ts` (applicant-file upload), `employer-collab-store.ts` (scheduling logging), `employer-ai.ts` (types/statuses)
- **UI:** `employer-sidebar.tsx`, `candidates-client.tsx`, `shortlists-client.tsx`, `docusign/docusign-client.tsx`
- **Migrations:** `0016_*.sql`, `0017_docusign_envelopes.sql` (both edited, idempotent)

## Quality gates
- `npx tsc --noEmit` ✅ · `next lint` ✅ · `next build` ✅ (all 11 API routes + page compile)
- No new npm dependencies; `whoami` stays removed.

## ⚠️ Manual steps for you (in the PR description too)
Both idempotent — safe to re-run:
1. **Re-run `0016_employer_messages_shortlists_interviews.sql`** — heals `interviews` columns, adds `'offer extended'` to the `applicants` status CHECK, creates the private `applicant-resumes` bucket + policies.
2. **Re-run `0017_docusign_envelopes.sql`** — adds `doc_type`/`document_name`, creates the private `esign-documents` bucket + policies.

No new environment variables.

## Notes / decisions
- **Custom-PDF anchor placement:** an uploaded PDF has no anchor text, so signature/date use fixed-position tabs (page 1, bottom-left). There's no drag-to-place UI in this pass — it's a sensible auto-placement. Flagging in case you want a positioning step later.
- **AI "Generate" for the employer add form:** drafts from the selected job's context + candidate name, with placeholders like `[Company]`/`[Year]` rather than fabricated specifics. Confirm that's the intended behavior (vs. generating only from pasted notes).
- **Status sync scope:** only `offer`-type documents drive applicant status (an NDA completing does not mark "hired"). Say if agreements should also advance status.
- I could not run the SQL against the live DB, so item 5's "column mismatch" is inferred (the swallowed-error logging + idempotent heal is the belt-and-suspenders fix). Once deployed, the server logs will name the exact column if anything is still off.

## Open question
- Want me to mark #497 ready and merge once CI is green (same as #495/#496), or hold for your review?
