# E-Signatures — recipient picker (UX fix)

**Branch:** `claude/esignatures-document-uploads-973zwc`
**PR:** #514 (draft) — https://github.com/marvinperson11-debug/resumetailored/pull/514
**Status:** implemented · `tsc` / `next lint` / `next build` all green · no new deps

---

## Part 1 — done: recipient picker in the send form

In the **"Send document for signature"** modal
(`resumetailored-platform/app/employer/components/send-document-modal.tsx`), the
manual **Recipient name / email** free-text fields in the standalone
**"Upload & send"** flow are replaced with a **dropdown of the employer's
applicants**:

- **Same data source as the Schedule-interview form** — `/api/employer/candidates`
  (`{ applicants }`), rendered as **`Name — Job title`**.
- Selecting a candidate **auto-fills the signer name + email**, and also links the
  envelope to that applicant (so it shows up on the candidate's record — a small
  bonus beyond the ask).
- An explicit **"Someone else (enter manually)"** option reveals the original
  free-text name/email fields.
- **Write-ups and employee documents keep the manual path** (the signer is an
  employee, not an applicant), exactly as before.
- Sends opened **from a candidate profile or a shortlist row** are unchanged —
  they already pass an `applicantId` and show the read-only signer card.

The Send button stays disabled (and submit is blocked with "Choose a recipient.")
until a candidate is picked or manual details are entered with a valid email.

---

## Part 2 — needs your input: the "Request documents" after-send flow

The brief also says:

> Apply the same picker in the "Request documents" after-send flow **where a
> signer is chosen.**

In the current code there is **no signer choice in that flow.** The after-send
"Request documents" action lives in the expandable envelope row on the
E-Signatures page (`docusign-client.tsx` → `EnvelopeDetail`). It adds document
requests to an **existing** envelope, and requested docs are delivered to that
envelope's **already-fixed recipient** via their secure upload link. A DocuSign
envelope is bound to one signer at send time, so there is no recipient field
there to convert into a picker.

So I did **not** change that flow, to avoid inventing a feature that wasn't
clearly intended. Which of these did you mean?

1. **Nothing needed** — the recipient picker only belongs in the send form
   (Part 1), and the after-send flow correctly reuses the existing signer. ✅
   *(This is my assumption unless you say otherwise.)*
2. **A new entry point** — e.g. a standalone "Request documents from a
   candidate" action that starts a *request-only* interaction (no document to
   sign), where you'd pick the recipient with the same dropdown. This is a new
   flow (new envelope/record shape + a way to reach the signer who never signed
   anything) and a larger change than "small PR" — happy to spec and build it if
   that's the intent.
3. **Something else** you had in mind for that flow.

Let me know and I'll follow up on the same branch/PR.

### Decision (2026-09-18)

**Option 1 chosen.** The recipient picker belongs in the send form only; the
after-send "Request documents" flow correctly reuses the envelope's existing
signer, so nothing changes there. This PR ships as-is.

**Follow-up (not in this PR):** a **request-only document collection flow** — ask
a candidate or employee to upload documents *without* sending anything to sign
(HR onboarding: I-9 support docs, certifications, direct-deposit forms, etc.).
This would reuse the same applicant picker to choose the recipient, mint a
`sign_token`-style upload link, and reuse the existing signer upload page +
per-upload/employer-notification emails — but without a DocuSign envelope or
signature step. Tracked as a future enhancement; deliberately out of scope here.

---

## Verify

```bash
cd resumetailored-platform
npx tsc --noEmit   # ✔ no errors
npx next lint      # ✔ no warnings or errors
npx next build     # ✔ compiles
```
