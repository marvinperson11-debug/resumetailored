# Schedule grid — post-publish editability + add/edit affordance fix

Follow-up to the Phase 2 (Time) work. The employer shift grid felt **locked
after publishing**: a user published an empty week and couldn't add shifts, and
existing shifts had no real way to be changed. This fixes the affordance and
makes published weeks fully editable.

File: `resumetailored-platform/app/employer/schedule/schedule-grid-client.tsx`
(client-only; no API, schema, or migration changes).

## Root cause

Nothing in the data model locks a published week — the cells were **never
gated** on publish state. The problem was entirely UI affordance:

1. **The only "add" target was a tiny top-right `+`** (~14px). On a phone it's
   nearly unhittable, so an empty published week read as "nothing responds."
2. **Existing shifts could only be deleted on hover** (`opacity-0
   group-hover:opacity-100`) — invisible and unusable on touch.
3. **There was no edit at all** — you couldn't change a shift's times or note,
   only (on desktop) delete it. So a published week genuinely had no editing
   path on mobile.

## The fix

- **Whole-cell add target.** Each day cell now ends in a full-width, dashed
  **"Add shift"** button that fills the remaining cell height (`flex-1`,
  `min-h-[36px]`) — a large target that behaves identically on desktop and
  touch. The old tiny `+` is gone.
- **Shifts are tappable to edit.** A shift chip is now a button (with a pencil
  hint) that opens the editor pre-filled with its start/end/note. Delete lives
  **inside** that editor (always visible, full-size), not a hover-only icon.
- **Published weeks stay editable.**
  - Editing or deleting a **live (published)** shift applies **immediately**
    (`PATCH`/`DELETE` don't touch `published`), and the modal says so.
  - A **new** shift is a draft and goes live on the next publish. The button
    now reads **"Publish updates"** once a week already has live shifts (vs.
    "Publish week" for a first publish, "Published" when nothing is pending),
    so re-publishing after an edit is an obvious, light action.
- **Copy.** The page subtitle now states that published weeks stay editable and
  how changes reach employees.

No unpublish toggle was needed — direct editing + "Publish updates" covers the
requested behavior (the user's stated alternative).

## Reuses existing API

- New shift → `POST /api/employer/schedule` (draft).
- Edit shift → `PATCH /api/employer/schedule/[id]` (stays published if it was →
  live immediately).
- Delete shift → `DELETE /api/employer/schedule/[id]`.
- Publish drafts → `POST /api/employer/schedule/publish`.

All four already existed from Phase 2; this change only rewires the grid UI.

## Verification

- `npx tsc --noEmit` — clean
- `npx next lint --max-warnings=0` — clean
- `npx next build` — success (`/employer/schedule` compiled)
