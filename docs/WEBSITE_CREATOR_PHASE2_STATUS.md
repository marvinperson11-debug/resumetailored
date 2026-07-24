# Website Creator — Phase 2 status & preview note

## Deploy preview built successfully — no action needed

The Netlify deploy preview for PR #263 (`f0293a1`) came back **ready**. It's just the preview build; nothing to fix.

## Heads-up if you click the preview link

The Netlify deploy preview serves the **static frontend only** — there is **no Node backend** on Netlify (production runs on **Railway**). So on the preview:

- The Website Creator tab will **render** (you can see the UI, the pop-up gate, the layout).
- Its **API calls will not work** there — `/api/assets/summary`, publish, cover-letter auto-save, etc. all need the backend.

To actually exercise Phase 2 **end-to-end**, it needs to run on **Railway**, which means merging this branch to `main`. That's your call on timing, since it's still WIP.

## Where things stand

- **Phase 1 + Phase 2** are committed and pushed on `claude/resumetailored-pricing-plan-iwy6un` (draft PR #263).
- Backend + frontend for the creator, pop-up gate, asset auto-pull, cover-letter auto-save, upgrade nudge, and config persistence are built and verified (integration test passed; Link/Site render goldens still byte-identical).

## Blocked / awaiting you

- **Phase 3** is blocked on the **grid-based freeform vs. pixel-canvas** decision (I recommend **grid-based**). I can proceed to **Phase 3a** (grid/block foundation) on that recommendation whenever you give the word.
- **Non-blocking reminders:** confirm the Railway volume at `/data` (Q6, for video storage in Phase 4/5) and `RESEND_API_KEY` in Railway (Q7, for lead-capture emails).
