# E-Signatures — document uploads on both sides + signed-document delivery

Feature branch: `claude/esignatures-document-uploads-973zwc`
App: `resumetailored-platform/` (Next.js 14 · TypeScript · Supabase · Clerk · DocuSign)

This adds document uploads to **both sides** of a DocuSign envelope and delivers
the signed copies on completion — built entirely on the existing e-signature
subsystem (`lib/docusign*.ts`, `app/api/employer/docusign/*`), reusing its
service-role-key + owner-scoped RLS pattern. **No new dependencies.** `tsc`,
`next lint`, and `next build` are all green.

---

## What shipped, mapped to the brief

### A. Employer sends a document (the star)
- The E-Signatures page gets a prominent **primary "Upload & send for
  signature"** button in the header (and on the empty state). It opens the send
  modal defaulted to the **Custom** flow: pick a PDF → name it → optional
  message → signer name + email → send. Powers the existing custom-PDF path — tax
  forms, IRS letters, agreements, anything.
  - `app/employer/docusign/docusign-client.tsx`
  - `app/employer/components/send-document-modal.tsx` (opened with
    `defaultDocType="custom"`)

### B. Employer requests documents from the signer
- The send form has a new optional **"Request documents from signer"** section:
  add any number of named requests (chips, dedup, Enter-to-add). Each becomes an
  expected upload slot for the signer; a free-form **"Other documents"** slot is
  always available to them.
  - `send-document-modal.tsx` → `requestedDocs: string[]` in the send payload
  - `app/api/employer/docusign/send/route.ts` parses, dedupes (cap 20), stores.

### C. Signer side (no login — token in the link)
- Every send mints a random **`sign_token`** stored on the envelope. The
  login-less page lives at **`/sign/{envelopeId}?key={token}`**.
  - `app/sign/[id]/page.tsx` + `app/sign/[id]/sign-client.tsx` (noindex).
  - The page shows the **requested upload slots** ("Please upload: Photo ID") as
    pick-file buttons, plus a **free upload area** for anything else. Accepts
    **pdf / jpg / png / doc / docx, ≤ 10 MB each, up to 10 files**, with an
    optional note. Uploading marks the slot; the signer can return any time via
    the same link.
- Public, token-authenticated API (no Clerk session; not a protected route):
  - `GET /api/sign/[id]?key=` — signer-safe view (never a storage path, employer
    id, or other data).
  - `POST /api/sign/[id]/upload?key=` — one file per request (so one email per
    upload), validates type/size/count/PDF magic bytes, stores in the private
    bucket, appends to the envelope, marks the slot.
- **C5 — confirmation email after every upload:** `notifySignerOfUpload`
  ("We received your document: {filename}") names the request, lists what's still
  pending, and repeats the upload link. One email per upload.
- **C6 — signed copies on completion:** when the envelope completes (Connect
  webhook **or** the fallback poll), `deliverSignedDocuments` downloads the
  completed documents + certificate from DocuSign
  (`GET …/documents/combined?certificate=true`) and emails them to the signer
  ("Your signed documents", PDF attached) with the upload link for any requested
  docs. **Resilient:** fully best-effort, idempotent (guarded by
  `signed_docs_emailed_at`), and never blocks the status update; a download/email
  failure logs and degrades to a link-only email.
- **C7 — request documents after sending:** `POST
  /api/employer/docusign/envelopes/[id]/request-docs` appends requests to a
  sent/completed envelope and emails the signer a fresh upload link
  (`notifySignerOfDocRequest`). Wired into the employer detail view.

### D. Employer views attachments
- **List row:** an **attachment-count badge** (teal, with a paperclip) when files
  exist; a gold "N requested" badge when requests are still pending.
- **Expandable envelope detail** (click a row): a **requested-docs checklist**
  (received / pending), the **full attachment list** with download links, an
  **"Attach a file"** control (employer's own files, private to the team), a
  **"Request another document"** box, and a **copy-able signer upload link**.
- **Authenticated file serving (RLS pattern, never public URLs):**
  `GET /api/employer/docusign/envelopes/[id]/attachment?path=…` — owner-scoped
  two ways: the envelope must belong to the caller, and the path must be one of
  that envelope's recorded attachments.
- **Employer own uploads:**
  `POST /api/employer/docusign/envelopes/[id]/attachments` (kind `other`,
  `by: employer`) — these never appear on the signer's page.
- **D8 — employer notification:** `notifyEmployerOfUpload` emails the employer
  when a document arrives ("New document from {signer}: {filename}").

---

## Data model — migration `0023` (HAND-APPLY)

`supabase/migrations/0023_envelope_attachments.sql` — **idempotent** (`add column
if not exists` / `on conflict do nothing` / `drop policy if exists`), safe on a
fresh or existing DB and safe to re-run. **Apply it by hand against Supabase
before deploying.**

- New private Storage bucket **`envelope-attachments`** (service-role read/write;
  authenticated folder policies as defense-in-depth, `{employer_id}/…`).
- `docusign_envelopes` new columns:
  - `requested_docs jsonb not null default '[]'` — `[{ name, uploaded }]`
  - `attachments jsonb not null default '[]'` — `[{ name, url, note,
    uploaded_at, kind: 'requested'|'other', by: 'signer'|'employer' }]`
    (`url` is the private storage path, never a public URL)
  - `sign_token text` — the login-less signer link credential (+ lookup index)
  - `signed_docs_emailed_at timestamptz` — idempotency guard for the C6 email

> Beyond the two columns named in the brief, two additive columns were needed and
> added: `sign_token` (the signer link's only credential) and
> `signed_docs_emailed_at` (so the completion email fires exactly once across the
> webhook and the fallback poll). Both are `add column if not exists` — idempotent.

---

## Files

**New**
- `supabase/migrations/0023_envelope_attachments.sql`
- `lib/esign-delivery.ts` — completion delivery + all signer/employer emails
- `app/sign/[id]/page.tsx`, `app/sign/[id]/sign-client.tsx` — public signer page
- `app/api/sign/[id]/route.ts`, `app/api/sign/[id]/upload/route.ts`
- `app/api/employer/docusign/envelopes/[id]/attachment/route.ts` (download)
- `app/api/employer/docusign/envelopes/[id]/attachments/route.ts` (employer upload)
- `app/api/employer/docusign/envelopes/[id]/request-docs/route.ts` (C7)

**Changed**
- `lib/employer-ai.ts` — `RequestedDoc`, `EnvelopeAttachment`, `AttachmentKind`
  types; `DocusignEnvelope` gains `requestedDocs` / `attachments` / `signToken`.
- `lib/docusign-store.ts` — token + requested-docs on create; envelope-attachment
  bucket helpers (upload/download, allowed types, caps); `appendAttachment`,
  `addRequestedDocs`, `getEnvelopeBySignToken`, `getEnvelopeByEnvelopeId`,
  `getEnvelopeLookupOwned`, `markSignedDocsEmailed`; new columns mapped.
- `lib/docusign.ts` — `getCombinedDocuments` (completed docs + certificate);
  optional `emailNote` on `buildEnvelope`.
- `lib/email.ts` — `sendEmail` now supports `attachments` (Resend `attachments`).
- `app/api/employer/docusign/send/route.ts` — mint token, store requested docs,
  email the signer the upload link at send time when documents are requested.
- `app/api/docusign/webhook/route.ts` — deliver signed docs on completion.
- `app/api/employer/docusign/envelopes/route.ts` — deliver on poll-detected
  completion (webhook-independent).
- `app/employer/docusign/docusign-client.tsx` — primary send button, Files column
  + badge, expandable `EnvelopeDetail`.
- `app/employer/components/send-document-modal.tsx` — request-documents section.

---

## Security notes

- The signer page/API are authenticated **only** by the per-envelope
  `sign_token` matched against the DocuSign envelope id — no session, no PII
  beyond what the signer needs. Storage paths, employer id, and employer-attached
  files are never exposed to the signer.
- All files are served through **authenticated, owner-scoped** API routes (the
  path must be a recorded attachment of an envelope the caller owns) — never a
  public storage URL.
- Uploads validate extension, size (10 MB), a per-envelope count cap, and PDF
  magic bytes; empty files are rejected.

## Test / verify

```bash
cd resumetailored-platform
npx tsc --noEmit     # ✔ no errors
npx next lint        # ✔ no warnings or errors
npx next build       # ✔ compiles; /sign/[id], /api/sign/[id](/upload) present
```

Runtime paths that need live DocuSign + Supabase + Resend to exercise end to end
(cannot be run in CI here): the DocuSign send/webhook round-trip, the combined-
document download, and Resend delivery. All are best-effort and fail safe.
