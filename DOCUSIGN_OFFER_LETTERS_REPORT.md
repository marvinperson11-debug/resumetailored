# DocuSign e-Signature for Offer Letters — Build Report

**Feature #10 (Employer Portal Phase 1B).** Branch `claude/docusign-offer-letters-5ylqx3` → **draft PR [#495](https://github.com/marvinperson11-debug/resumetailored/pull/495)**.

All work lives in `resumetailored-platform/` (the Next.js 14 / App Router app with Clerk auth + Supabase), **not** the root Express app — the spec's TypeScript / migrations / RLS / `auth.uid()` all point there.

## What was built

### Auth — Authorization Code Grant
- **`lib/docusign.ts`** — OAuth client (consent URL, code exchange, refresh-token rotation), raw REST v2.1 calls (**no SDK, no new npm dep**), offer-letter HTML builder with signature/date anchor tabs, Connect webhook HMAC verification, and AES-256-GCM refresh-token encryption.
- Tokens cached in DB (`docusign_connections`) to avoid per-request consent; access token refreshed on demand, rotated refresh token persisted.
- **Redirect URI:** `https://app.resumetailored.com/api/employer/docusign/callback` (override with `DOCUSIGN_REDIRECT_URI`). CSRF via an httpOnly `state` nonce cookie.
- Routes: `GET /api/employer/docusign/connect` (consent redirect) and `.../callback` (stores tokens, returns to `/employer/docusign`).
- Sidebar gains an **Offer Letters** item → `/employer/docusign` status page.

### Data — migration 0017 (idempotent)
- `supabase/migrations/0017_docusign_envelopes.sql`: `docusign_envelopes` (per spec) + `docusign_connections` (token cache). Owner RLS `employer_id = auth.uid()::text`; connections table is service-role-only with RLS and no public policy. Same pattern as `0012`/`0016`.

### Send flow
- **`lib/employer-plan.ts`** — monthly send caps (Free 3 / Portal 10 / Scale 50 / Corporate unlimited), enforced before sending, friendly upgrade message.
- **Send offer** action on the candidate drawer and each shortlist member row → modal (position prefilled from job, salary, start date, extra terms, message) → `POST /api/employer/docusign/send`.
- Envelope = server-built offer-letter HTML (DocuSign → PDF) with SignHere + DateSigned anchor tabs; signer from the applicant record (missing email → clear error).
- **Status sync:** `POST /api/docusign/webhook` (Connect, `X-DocuSign-Signature-1` HMAC, timing-safe) **plus** a fallback poll (`GET .../envelopes?refresh=1`). `completed_at` set on completion.
- Envelopes list with status badges; signed/completed → **Download certificate** (`.../envelopes/[id]/certificate`).

### Files
- New libs: `lib/docusign.ts`, `lib/docusign-store.ts`, `lib/employer-plan.ts`
- New routes: `app/api/employer/docusign/{connect,callback,status,send,envelopes,envelopes/[id]/certificate,disconnect}`, `app/api/docusign/webhook`
- New UI: `app/employer/docusign/{page,docusign-client}.tsx`, `app/employer/components/send-offer-modal.tsx`
- Edits: `employer-sidebar.tsx`, `candidates-client.tsx`, `shortlists-client.tsx`, `lib/employer-ai.ts` (types), `.env.example`
- Migration: `supabase/migrations/0017_docusign_envelopes.sql`

## Quality gates
- `npx tsc --noEmit` ✅ · `next lint` ✅ · `next build` ✅ (all 8 API routes + the page compile)
- Crypto round-trip, GCM tamper detection, HMAC verify, and webhook-parse shapes sanity-checked with a standalone script.
- `whoami` stays removed; no new npm dependencies.

## ⚠️ Manual steps for you (also in the PR description)
1. **DocuSign portal → Redirect URIs**: add `https://app.resumetailored.com/api/employer/docusign/callback` exactly.
2. **Apply migration 0017 by hand** against Supabase: run `resumetailored-platform/supabase/migrations/0017_docusign_envelopes.sql` (idempotent).
3. **Add `DOCUSIGN_WEBHOOK_SECRET` to Railway** and set up a DocuSign **Connect** listener → `https://app.resumetailored.com/api/docusign/webhook` with HMAC signing using that secret. (Optional — the fallback poll keeps statuses fresh without it.)
4. Optional `DOCUSIGN_TOKEN_ENC_KEY` (defaults to `DOCUSIGN_SECRET_KEY`). The other `DOCUSIGN_*` vars are already in Railway.

## Notes / decisions
- **HMAC vs "basic auth" wording:** the spec called `X-DocuSign-Signature-1` a "basic auth header"; that header is actually DocuSign Connect's HMAC-SHA256 signature. I implemented the correct HMAC validation against `DOCUSIGN_WEBHOOK_SECRET`. Flagging in case you specifically wanted Connect's *Basic Authentication* option instead.
- **Encryption vs RLS:** the spec offered "encrypt refresh tokens at rest **or** service-role-only table with RLS" — this does **both** (AES-256-GCM + service-role-only RLS table).
- **Per-employer connection:** tokens are stored keyed by `employer_id` (each employer connects DocuSign via consent), matching the RLS pattern. `DOCUSIGN_ACCOUNT_ID` from env is used to pick the matching account from `/oauth/userinfo`.
- The final "envelope flips to completed in staging/prod" verification needs the live demo DocuSign account + the manual setup above, so it's left as the PR verification checklist.

## Open question
- Do you want the **candidate** notified through our own Resend email as well, or is DocuSign's own signing email (sent automatically when the envelope goes to `sent`) sufficient? Current behavior relies on DocuSign's email only.
