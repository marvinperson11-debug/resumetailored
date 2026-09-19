# E-Signatures — three fixes

Feature branch: `claude/esignatures-document-uploads-973zwc`
App: `resumetailored-platform/` (Next.js 14 · TypeScript · Supabase · DocuSign)

Small PR. **No new dependencies. No migration.** `tsc`, `next lint`, and `next build` are all green.

---

## 1. Requested-slot mapping (both sides)

**Signer side** — when a signer picks a file in the free-form **"Other documents"** area *while
named requests are still unfulfilled*, they now get a one-tap prompt:
> Is "{filename}" one of the documents {company} requested?
> **[ Yes — it's my Id ]  [ No — it's something else ]  [ Cancel ]**

Tapping a slot uploads the file tagged to that request (the server marks the slot **uploaded**),
so the "I uploaded it but it still says missing" trap is gone. "Something else" keeps the old
free-upload behaviour. No API change was needed — the upload route already tags a file to a slot
when `requestName` matches an open request; the client now supplies it.
(`app/sign/[id]/sign-client.tsx`)

**Employer side** — in the expanded envelope detail, each *pending* requested doc now has a
dropdown of the envelope's uploaded files plus a **"Mark received"** button. Choosing a file marks
the slot satisfied and tags that attachment as the fulfilling `requested` file — so an employer can
clear a stuck slot when the signer uploaded to the free area by mistake.
- New: `POST /api/employer/docusign/envelopes/[id]/mark-request` `{ name, attachmentUrl? }` (owner-scoped).
- New store helper: `markRequestSatisfied()`.

## 2. Envelope-detail discovery + prominent download

- The whole row was already clickable; it's now **obviously** so: stronger hover background, an
  open-state background, the chevron turns violet on hover/expand, and the row has a
  "Show/Hide details" tooltip + `aria-expanded`.
- In the expanded detail, **completed/signed** envelopes now show a prominent banner with a primary
  **"Download signed documents"** button (the combined, signed PDF **with the certificate
  appended**) and a secondary **"Certificate"** button.
- New: `GET /api/employer/docusign/envelopes/[id]/documents` streams the combined signed documents
  (`getCombinedDocuments`, certificate included), owner-scoped — mirroring the existing certificate
  route.

## 3. Document column

The Document column no longer shows "—" for an NDA (or any non-offer type). It now shows the
employer-entered **document name** when present, then the offer **position**, and finally falls back
to the **type label** (e.g. "NDA", "Agreement") instead of a dash.
(`e.documentName || e.offer.position || DOC_TYPE_LABELS[e.docType]`)

---

## Files
**New**
- `app/api/employer/docusign/envelopes/[id]/documents/route.ts` — download combined signed docs.
- `app/api/employer/docusign/envelopes/[id]/mark-request/route.ts` — mark a request satisfied.

**Changed**
- `app/sign/[id]/sign-client.tsx` — free-upload "is this your {slot}?" chooser.
- `app/employer/docusign/docusign-client.tsx` — row affordance, download banner, per-slot
  "mark received" control, Document-column fallback.
- `lib/docusign-store.ts` — `markRequestSatisfied()`.

## Verify
```bash
cd resumetailored-platform
npx tsc --noEmit   # ✔ no errors
npx next lint      # ✔ no warnings or errors
npx next build     # ✔ compiles; new /documents and /mark-request routes present
```
Runtime paths needing live DocuSign + Supabase (combined-document download, slot tagging) can't run
in CI here; all new reads/writes are owner-scoped and fail safe.
