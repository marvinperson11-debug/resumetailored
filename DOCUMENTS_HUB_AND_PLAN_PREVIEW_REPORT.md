# Documents Hub + Plan Preview — combined PR

Feature branch: `claude/esignatures-document-uploads-973zwc`
App: `resumetailored-platform/` (Next.js 14 · TypeScript · Supabase · Clerk · DocuSign)

**No new npm dependencies.** `tsc`, `next lint`, `next build` all green.

> ⚠️ **Hand-apply before deploying:** `resumetailored-platform/supabase/migrations/0027_documents.sql` — idempotent (`create table if not exists` / `drop policy if exists`), owner RLS like `esign_templates`.

---

## A. Plan preview switcher (admin testing tool)
- **Where:** bottom of the sidebar, right under the Candidate/Employer toggle — **admin only** (employer & candidate shells). Employer options **Free / Portal / Scale / Corporate**; candidate options **Free / Pro**.
- **How:** the switcher sets a `rt_plan_preview` cookie (`side:plan`). `getAccess()` reads it **only inside the `isAdminId` branch**, *after* the admin id check, and returns the previewed plan — so a non-admin forging the cookie gets nothing (no elevation possible). While previewing, `isAdmin` is **not** set, so every plan gate (feature visibility, limits, upgrade prompts) evaluates the previewed plan honestly; a separate `realAdmin` flag keeps the admin-only UI visible so you can switch/exit. Default = your real plan.
- **Banner:** a persistent amber top banner — "Previewing as {Plan} {Side} — Exit preview" — mounted in the root layout so it shows on every page (including a locked page reached while previewing a lower plan), giving a reliable Exit everywhere. Exit clears the cookie.

## B. Documents sidebar section
1. New **Documents** sidebar item (under E-Signatures).
2. **Removed** the "View documents" button from the E-Signatures page — the aggregated documents list (signed PDFs + attachments, with **View / Download / Send copy**) now lives under **Documents → Received & signed**.
3. **Removed** the "Signer upload link" block (link + Copy) from the envelope detail entirely.

## C. Document Creator
- **New document** opens an in-app, Word-like composer: title + a plain `contenteditable` with a toolbar (H1/H2/paragraph, bold/italic/underline, bullet & numbered lists, left/center align, links) — **no editor libraries** (uses `document.execCommand`).
- **Storage:** new `documents` table (id, employer_id, title, body_html, created_at, updated_at) with owner RLS (migration 0027); `lib/documents-store.ts` CRUD (+ a light HTML sanitizer); `GET/POST /api/employer/documents` and `GET/PUT/DELETE /api/employer/documents/[id]` (owner-or-admin for writes).
- **Templates:** "New document" offers **Blank** + the four defaults — **Offer letter / Employment agreement / NDA / Employee write-up** — as editable starting points (`lib/document-templates.ts`). This replaces the removed Templates tab.
- **Send for signature:** from a saved document → the existing Send modal (`document` prop). The send route (`documentId` path) renders the document's HTML through the existing **HTML→PDF envelope path** with the signature block appended (so DocuSign gets a `/sig1/` anchor) — **no new DocuSign plumbing**.

---

## Files
**New:** `supabase/migrations/0027_documents.sql`, `lib/document-templates.ts`, `lib/documents-store.ts`, `app/api/employer/documents/route.ts`, `app/api/employer/documents/[id]/route.ts`, `app/employer/documents/{page,documents-client}.tsx`, `app/employer/components/send-copy-control.tsx` (extracted for reuse), `components/plan-preview-switcher.tsx`, `components/plan-preview-banner.tsx`.
**Changed:** `lib/plan.ts` (preview override + `realAdmin`/`preview`), `lib/employer-ai.ts` (`EmployerDocument`), `app/layout.tsx` (banner), employer/candidate layouts + sidebars (switcher + `realAdmin`), `app/employer/docusign/docusign-client.tsx` (removed View-documents view + signer link; SendCopyControl now imported), `app/employer/components/send-document-modal.tsx` (`document` send), send route + `.../documents/route.ts` (`documentId`, `?download=1`).

## Decisions / notes (worth a look)
1. **Seeded templates use readable bracket placeholders** ("[Candidate Name]", "[Position]", …), not `{{merge_tokens}}` — the creator is free-form prose you edit before sending, so tokens would otherwise appear literally. The signature line is appended automatically at send, so the bodies don't include one.
2. **Send-for-signature stores the row as type "custom"** with the document's title as its name (reusing the custom/HTML envelope path). It shows under E-Signatures like any other send.
3. **Editor scope:** headings, bold/italic/underline, lists, align, links — as specified. No images/tables (not requested; keeps it dependency-free).
4. **Documents visibility:** any user who can reach the employer portal sees Documents; **creating/editing/deleting** is owner-or-admin (`isEmployer`), matching the profile/signature gates. Say the word if you want viewing itself gated by plan.

## Verify
```bash
cd resumetailored-platform
npx tsc --noEmit && npx next lint && npx next build
```
Runtime paths needing live Supabase/DocuSign/Clerk (document CRUD, sending a composed doc, the plan-preview cookie round-trip) can't run in CI here.
