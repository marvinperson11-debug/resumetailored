# E-Signatures cleanup + sender identity (profile photo & branded email signature)

Feature branch: `claude/esignatures-document-uploads-973zwc`
App: `resumetailored-platform/` (Next.js 14 · TypeScript · Supabase · Clerk · Resend)

Two features in one PR. **No new dependencies.** `tsc`, `next lint`, and `next build`
are all green.

> ⚠️ **Hand-apply the migration before deploying:**
> `resumetailored-platform/supabase/migrations/0024_employer_email_signature.sql`
> (idempotent — safe on a fresh or existing DB, and safe to re-run).

---

## Part 1 — E-Signatures UI cleanup

`app/employer/docusign/docusign-client.tsx`

1. **Removed the "New write-up" button** (header) and its modal. Write-ups are no
   longer a first-class action on the page. (The `writeup` doc type itself is
   untouched — it can still be sent from a candidate's profile; only this
   entry point is gone.)
2. **Removed the "Templates" tab** and the whole in-page template editor
   (`TemplatesTab`). The page is now a single Documents view.
   - **Kept intact:** the `esign_templates` table, the `/api/employer/docusign/templates`
     route, and all default-template logic used by the send flow — only the
     tab/editing UI was removed, as requested. A new Documents section will
     replace it later.

Net effect: the header now shows just **Upload & send for signature** + **Refresh**,
and there is no tab switcher.

---

## Part 2 — Sender identity

### 3. "Upload photo" in the user menu → Clerk account-profile

`components/profile-button.tsx`

The **Upload photo** item in the avatar dropdown is now a simple menu action that
opens **Clerk's native account-profile page** (`openUserProfile()`), where photo
upload is built in — replacing the previous inline file-input upload. Simpler,
and it reuses Clerk's own cropping/validation UI. (Applies to both the candidate
and employer shells, which share this component.)

### 4. Email-signature settings (employer Settings page)

`app/employer/settings/settings-client.tsx`

A new **Email signature** panel under Company profile:

- **Logo/photo upload** with inline preview + Replace / Remove.
- Fields: **display name, title, phone, address**, and an optional **footer line**.
- A **live preview** rendered on a white card, matching how it appears in an inbox.
- Owner-only editing (mirrors the company-profile section); others see a read-only note.

**Storage** — new **PUBLIC** bucket **`employer-email-assets`**, path
`{employer_id}/{filename}`. Public read is deliberate and correct: email clients
fetch the logo over an unauthenticated URL, so a private bucket would render as a
broken image. Folder-scoped RLS policies confine any direct write to the
employer's own folder (defense-in-depth; the server uploads with the service-role
key). jpeg/png/webp, ≤ 2 MB.

**Data** — `employer_profiles.email_signature jsonb` (null = not configured),
shape `{ displayName, title, phone, address, footer, logoUrl }`.

**API**
- `GET/POST /api/employer/email-signature` — read / save (or clear) the signature JSON (owner-only).
- `POST /api/employer/email-signature/asset` — multipart logo upload → returns the public `{ url }` (owner-only).

### 5. Signature applied to all outgoing employer emails

`lib/employer-signature.ts` (new) + `lib/email.ts`

- `renderSignatureHtml(sig)` — pure renderer for the signature block (logo +
  name/title/phone/address, optional footer line). Returns `""` when there's no
  meaningful content.
- `employerSignatureHtml(employerId)` — resolves the saved signature and renders
  it; **returns `""` on anything missing or any error**, so a signature-build
  failure can never block a send.
- `emailShell(body, signatureHtml?)` now renders the signature block just above
  the default footer. When no signature is configured, **today's default footer
  is kept unchanged.**

Wired into every employer-triggered send:
- **Interview** invites / reschedules / cancellations, candidate messages, and the
  interviewer confirmation — `lib/employer-notify.ts`.
- **E-signature** sends/completion notices, upload confirmations, employer
  upload notifications, and document requests — `lib/esign-delivery.ts`.
- **Team invites** — `app/api/employer/team/route.ts`.

Candidate-triggered mail (e.g. the public job-apply notification) is intentionally
**not** signed.

---

## Data model — migration `0024` (HAND-APPLY)

`supabase/migrations/0024_employer_email_signature.sql` — **idempotent**
(`add column if not exists` / `on conflict do nothing` / `drop policy if exists`).

- `employer_profiles.email_signature jsonb` (nullable; null = not configured).
- New **public** Storage bucket `employer-email-assets` + folder-scoped
  insert/update/delete policies (`{employer_id}/…`).

---

## Files

**New**
- `supabase/migrations/0024_employer_email_signature.sql`
- `lib/employer-signature.ts`
- `app/api/employer/email-signature/route.ts`
- `app/api/employer/email-signature/asset/route.ts`

**Changed**
- `app/employer/docusign/docusign-client.tsx` — removed write-up button + Templates tab.
- `components/profile-button.tsx` — Upload photo opens Clerk account-profile.
- `app/employer/settings/settings-client.tsx` — email-signature panel + preview.
- `lib/employer-ai.ts` — `EmailSignature` type; `EmployerProfile.emailSignature`.
- `lib/employer-store.ts` — map/save signature; public-bucket logo upload helpers.
- `lib/email.ts` — `emailShell` accepts an optional signature block.
- `lib/employer-notify.ts` / `lib/esign-delivery.ts` / `app/api/employer/team/route.ts`
  — resolve + append the signature on every employer-triggered send.

---

## Verify

```bash
cd resumetailored-platform
npx tsc --noEmit   # ✔ no errors
npx next lint      # ✔ no warnings or errors
npx next build     # ✔ compiles; /api/employer/email-signature(/asset) present
```

Runtime paths that need live Supabase + Resend + Clerk to exercise end to end
(cannot be run in CI here): the logo upload to the public bucket, saving/loading
the signature, and the signature actually appearing in delivered emails. The
signature path is fully best-effort and fail-safe.
