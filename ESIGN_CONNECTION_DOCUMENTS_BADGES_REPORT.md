# E-Signatures — three changes

Feature branch: `claude/esignatures-document-uploads-973zwc`
App: `resumetailored-platform/` (Next.js 14 · TypeScript)

Small PR. **No migration. No new dependencies.** `tsc`, `next lint`, `next build` all green.

---

## 1. DocuSign connection box — admin only

The connection panel (Connected / Connect / **Disconnect**, account + usage) now renders **only for
the platform admin**. Regular employers send through the platform's DocuSign account and never
connect their own — and a stray "Disconnect" would break signing for everyone — so they now just see
the E-Signatures header and content.

- `app/employer/docusign/page.tsx` — now resolves `getAccess()` and passes `isAdmin` to the client.
- `app/employer/docusign/docusign-client.tsx` — the connection `<Panel>` is gated behind
  `{isAdmin && view === "list"}`.

## 2. "View documents" button + Documents view

A new **"View documents"** button in the header (next to *Upload & send*) opens a flat, one-click
list of everything received/done across **all** envelopes:

- every **completed/signed** envelope's **signed PDF (with certificate)** — downloads via the
  existing `…/[id]/documents` route, and
- every **signer-uploaded** and **employer-attached** file — downloads via the existing
  `…/[id]/attachment` route.

Each row shows the **document/file name**, the **related envelope + signer**, the **date**, a
**status** (the envelope's status pill for signed PDFs; a "received"/"attached" tag for files), and a
**Download** button. Rows are sorted newest-first. **"Back to sent list"** returns to the table.

This is aggregated **client-side from the already-loaded envelopes** — existing data only, no new
endpoint, no new tables. (Report brief said "server-side aggregation over existing data"; building it
from the same envelope payload the page already fetches is the simplest form of that and needs no new
API surface.)

## 3. Status-colored type badges

The type badge (Offer letter / NDA / Agreement / Custom) was a fixed color per type. It's now tinted
by envelope status, matching the status pill's meaning:
- **amber/gold** while waiting — `sent` / `delivered` / `viewed`
- **green (teal)** once `signed` / `completed`
- **red** when `declined` / `voided`

Implemented as `typeBadgeTone(status)` and applied to the list rows' Type badge (the only place the
type badge renders). The old fixed `DOC_TYPE_TONE` map was removed.

---

## Files
- `app/employer/docusign/page.tsx` — pass `isAdmin` from `getAccess()`.
- `app/employer/docusign/docusign-client.tsx` — admin-gated connection panel; `View documents`
  header toggle + `DocumentsView` (flat aggregated, downloadable list); status-colored type badge.

## Verify
```bash
cd resumetailored-platform
npx tsc --noEmit   # ✔ no errors
npx next lint      # ✔ no warnings or errors
npx next build     # ✔ compiles
```
In-browser: as a regular employer the DocuSign connection box is gone; **View documents** lists every
signed PDF + uploaded/attached file with working Download buttons; the type badge turns green when an
envelope completes and red if it's declined/voided.
