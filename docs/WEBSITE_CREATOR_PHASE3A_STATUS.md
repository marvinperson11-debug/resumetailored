# Website Creator — "nothing on Railway" explained + Phase 3a status

## Why Railway still shows nothing (this is expected, not a bug)

Your Railway screenshot shows the **ACTIVE** deployment is still *"Resume builder: drop 'in' from LinkedIn import button; keep 'How to'…"* from ~2 hours ago. That's correct:

- **Railway production only deploys from `main`.**
- All the Website Creator work (Phase 1, 2, and now 3a) lives on the branch **`claude/resumetailored-pricing-plan-iwy6un`** / **draft PR #263** — which has **not** been merged to `main`.
- So production is unchanged by design. Nothing is broken or stuck.

**To see it on Railway**, PR #263 needs to merge into `main`, which triggers a Railway build. You said that's your call and there's no rush — so I'm leaving it unmerged and continuing to stack the phases on the branch. Whenever you're ready for the end-to-end Railway test, merge it (or tell me to) and it'll deploy.

(The Netlify deploy previews you've been seeing are **static-only** — frontend files with no backend — so they can't exercise the creator's API calls either. Railway is the only place it runs end-to-end.)

---

## Phase 3a — SHIPPED on the branch ✅ (grid/block foundation, grid-based per your call)

This is the **foundation** half of Phase 3: the block data model + the responsive grid **renderer**. The drag/resize **editor** is Phase 3b (next). Built and verified with no change to any existing surface.

**What landed:**
- **Block model** in `config.blocks[]` — each block: `{ id, type, col, colSpan, ...content }` on a **12-column grid**. Types implemented: `heading`, `text`, `resume`, `image`, `video`, `spacer`.
- **Responsive grid renderer** (`_renderSiteGrid`): desktop honors `grid-column: <col> / span <colSpan>`; **mobile (<760px) collapses to a single column in source order** — the "place things anywhere, still safe on phones" model you approved, no second layout to maintain.
- **`resume` block** renders via a **new standalone fragment** (`_renderResumeFragment`) built from the existing `_dxParseResume`/`_shareLinesHtml` helpers — so it never touches `_shareResumeHtml` (the Link renderer stays byte-identical).
- **Video blocks are safe:** `controls`, `preload="metadata"`, **no `autoplay`** — no autoplay-with-sound, exactly as scoped. Optional preset/custom label renders above the video.
- **Security:** block URLs (image/video/poster) are validated (`http(s)://`, root-relative, or `data:image/...`) — a `javascript:` src is rejected; text is escaped and length-capped.
- **Public-site i18n scaffold:** the grid page embeds a `SITE_I18N {en, zh}` dictionary + a `[data-si]` toggle (mirrors the `zh/index.html` pattern). Chrome-only; copy fills out in the dedicated i18n phase — but the plumbing is now in the first new render path, so no retrofit later.
- **Legacy safety:** the grid path activates **only** when `config.blocks` is a non-empty array. `config IS NULL` and Phase 2 configs (asset ids, no blocks) still render the legacy resume page — **byte-identical** (goldens confirm).

**Verified:**
- `server.js` syntax ✓
- Render goldens: `link.html`, `site.html` **byte-identical**; new `site-grid.html` golden captured + passes ✓
- Smoke test of all block types, mobile reflow, `javascript:` rejection, grid placement, and the i18n toggle ✓

---

## What Phase 3a does *not* yet include (that's 3b)

- The **drag/resize canvas editor** in the app (`app.html`) to create/arrange blocks visually. Until 3b, blocks are only settable via the config API — so this phase is verifiable by tests but not yet user-facing in the editor. That's the intended 3a/3b split.

---

## Questions / decisions for Phase 3b (the editor)

1. **Block palette for v1 editor** — I plan to ship the editor with these add-able blocks: **Heading, Text, Resume, Image, Video, Spacer**. Case-study cards, contact form, and QR are their own later phases (4/5). **OK to start 3b with that palette**, or do you want a different initial set?
2. **Grid granularity in the editor** — drag/resize on the **12-column grid** with snap-to-column, min 1 / max 12 span. Rows flow by source order (no free vertical pixels). **Confirm 12-col snap** is the right granularity, or do you want finer (e.g., 24-col)?
3. **Default starter layout** — when a user first enters the (blank-site) creator, seed a sensible default: **Heading (name) + Resume block full-width**, which they then rearrange. **Good default?**

None of these block me from starting 3b — I can proceed on the recommendations above. Just flag any changes.

---

## Non-blocking reminders (still open)

- **Q6** — Railway volume mounted at `/data` for video storage (Phase 4/5).
- **Q7** — `RESEND_API_KEY` in Railway (lead-capture emails, Phase 5).
- **Merge to `main`** whenever you want the Railway end-to-end test — your call.
