# Website Creator — Phase 6 status (Back Office)

Phase 6 is built on the branch (draft PR #263). The Back Office is the day-to-day management hub for existing subscribers.

## What shipped

**A new Pro-only "Back Office" tab** (🗂️ in the sidebar) with four sections:

- **Resumes** — every saved resume, each with **Use** (loads it into the Tailor tab), **Duplicate**, and **Delete**; plus **bulk select → Duplicate selected / Delete selected**.
- **Cover letters** — same actions (Use / Duplicate / Delete + bulk).
- **Resume videos** — list + Delete. (Populates once video persistence lands; empty for now with a helpful hint.)
- **Personal website** — **Edit** (opens the Website Creator), **View live**, a **Publish / Unpublish** toggle, and **Delete**. Shows live/hidden status + view count.

Destructive actions confirm first. Full **EN / 中文** i18n.

**Backend:**
- `POST /api/resumes/:id/duplicate` and `POST /api/cover-letters/:id/duplicate` — copy with a " (copy)" title, honoring the keep-latest-20 cap.
- `PATCH /api/personal-site { published }` — **publish/unpublish without deleting**. The row and its `config` are preserved so the owner can flip it back on; while unpublished the public `/site/:name` returns 404.

## Verified
- `server.js` syntax ✓; inline scripts parse ✓; EN/中文 i18n parity ✓
- Render goldens **byte-identical** (`link`, `site`, `site-grid`) — Back Office is app-only, no public-render change ✓
- **Back Office E2E:** duplicate creates a titled copy (count 1→2); the publish/unpublish PATCH flips `/site/:name` **200 → 404 → 200** correctly ✓

## Where we are
- ✅ Phases 1, 2, 3a, 3b, 4, 5, **6 (Back Office)**
- ⏭️ **5b** — plain-text video generator + record/upload voiceover (the deferred nice-to-have; video hero already works via the video block). You asked for this **after** Phase 6 — so it's next unless you'd rather jump to polish.
- Phase 7 — **i18n copy pass** (fill/QA Chinese across the whole creator + public site; the keys are all wired) · Phase 8 — polish (animated-bg degrade testing, quota edge cases)

## Open items on you
- **Q6 — Railway `/data` volume: the merge blocker.** You're mounting it before merge — thanks. Everything else is ready to go once it's up.
- **Q7 — `RESEND_API_KEY`:** enables lead-notification emails (leads persist and list without it).

## Question
With the core build essentially complete (Phases 1–6), how would you like to sequence the rest?
1. **5b (text-video + voiceover)** next, then the i18n copy pass + polish, or
2. **Skip 5b for now**, do the **i18n copy pass + polish**, and get this **merged** (once `/data` is mounted) so subscribers can actually use it — then circle back to 5b as a follow-up.

My lean is **(2)** — the feature set is already strong and Pro-worthy; shipping it to real users sooner beats adding the one remaining nice-to-have first. But it's your call. Tell me which and I'll proceed.
