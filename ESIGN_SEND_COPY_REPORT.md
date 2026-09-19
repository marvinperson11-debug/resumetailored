# E-Signatures — correct course: drop manager countersignature, add "Send a copy"

Feature branch: `claude/esignatures-document-uploads-973zwc`
App: `resumetailored-platform/` (Next.js 14 · TypeScript · Supabase · DocuSign · Resend)

**No new dependencies.** `tsc`, `next lint`, `next build` all green.

> ⚠️ **Hand-apply before deploying** (for the copy log): `resumetailored-platform/supabase/migrations/0026_envelope_copies_sent.sql` — idempotent `add column if not exists`.
> **Do NOT apply the old manager migration** — it's gone (see below).

---

## 1. Manager countersignature — removed
The manager countersignature work (the send-form checkbox, the second signer, sequential routing, the `/sig2/` tabs, the Signers section, the `recipients` route, and **migration 0026 for `manager`**) was never merged — it lived only on this draft branch. I **reset the branch to `main`**, so all of it is gone: **one signer per envelope, exactly as before.** Nothing to apply, nothing to revert on the server.

## 2. "Send a copy" (forward) — added
On **completed/signed** envelopes, the employer can forward the finished document to anyone:

- **Where:** a **"Send copy"** control in the expanded envelope detail **and** on every signed row in **View documents**.
- **What it does:** the employer enters any **name + email** → the platform emails that person the **combined signed PDF + certificate of completion** (`documents/combined?certificate=true`) as an attachment, via **Resend**, wrapped in the employer's **email signature**. It's a plain forward — **no DocuSign step, no signature required** from the recipient.
- **Record:** each send is logged on the envelope, and the detail shows a **"Copies sent: {email} ({date}), …"** line so there's a record.

### How it works
- New route `POST /api/employer/docusign/envelopes/[id]/send-copy` `{ name, email }` (owner-scoped): validates the email, confirms the envelope is complete, downloads the combined PDF, sends it via `sendSignedCopy` (new `esign-delivery` helper — attaches the PDF, applies the employer signature), then records the entry.
- Persistence: `docusign_envelopes.copies_sent jsonb` (migration 0026); `appendCopySent` store helper; `copiesSent` mapped onto `DocusignEnvelope`.
- UI: a reusable `SendCopyControl` (toggle → name/email → Send) used in both places; the detail also renders the copies-sent log line and refreshes after a send.

---

## Files
**New**
- `supabase/migrations/0026_envelope_copies_sent.sql`
- `app/api/employer/docusign/envelopes/[id]/send-copy/route.ts`

**Changed**
- `lib/esign-delivery.ts` — `sendSignedCopy()` (forward email w/ attachment + signature).
- `lib/docusign-store.ts` — `copies_sent` column mapping + `appendCopySent()`.
- `lib/employer-ai.ts` — `DocusignEnvelope.copiesSent`.
- `app/employer/docusign/docusign-client.tsx` — `SendCopyControl`; Send-copy + copies log in the detail; Send copy on View-documents signed rows.

## Verify
```bash
cd resumetailored-platform
npx tsc --noEmit && npx next lint && npx next build
```
Runtime paths needing live DocuSign + Resend (combined-document download, the forwarded email) can't run in CI here; the route is owner-scoped and returns a clear error if the document can't be fetched or email isn't configured.
