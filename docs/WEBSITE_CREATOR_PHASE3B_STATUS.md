# Website Creator — Phase 3b status (block editor + live preview)

Phase 3b is built on the branch (draft PR #263), using your confirmed answers: **palette = Heading/Text/Resume/Image/Video/Spacer**, **12-column grid**, **default = Heading + full-width Resume**. Phase 3 (a + b) is now feature-complete.

## What shipped

**The editor (in the Website Creator tab):**
- New **"Design your layout"** step with a **block palette** — Heading, Text, Resume, Image, Video, Spacer.
- **Drag-to-reorder** the blocks (HTML5 drag-and-drop) + a **per-block width** control: Full / Two-thirds / Half / Third (→ 12 / 8 / 6 / 4 columns). Blocks **auto-flow into rows**, so two half-width blocks sit **side by side**; on phones everything stacks. This is the approved grid-freeform model (no fragile pixel canvas).
- Per-type content editors: heading/text fields, image URL + caption, video URL + label (with preset suggestions "About Me / Why Hire Me / …"), resume block (uses your step-1 selection).
- **Default starter layout** seeded for a blank site: **Heading (your name) + full-width Resume block**, ready to rearrange.
- **Edit ⇄ Preview toggle** now shows a **true WYSIWYG preview of your current, unpublished edits** (via a new render-without-saving endpoint).
- **Publish** now saves the full layout (`config.blocks` + theme + selected assets).
- Full **EN / 中文** translations for every new string.

**Server:**
- `_renderSiteBlock` now **auto-flows** blocks (side-by-side) when no explicit column is set; explicit placement still supported.
- New **`POST /api/personal-site/preview`** (Pro) — renders the site from posted fields **without saving**, powering the live preview.

## Verified
- `server.js` syntax ✓; all inline scripts parse ✓; EN/中文 i18n parity on new keys ✓
- Render goldens **byte-identical**: `link.html`, `site.html`, `site-grid.html` ✓ (Link untouched)
- **End-to-end test** on an ephemeral port:
  - Preview endpoint renders the grid, **video has controls + no autoplay**, half-width blocks flow side by side (`grid-column:span 6`) ✓
  - Publish-with-blocks → `/site/:name` renders the grid (heading + resume fragment) ✓
  - Sites **without** blocks still render the **legacy** page (no regression) ✓

## Still branch-only (not on Railway)
Everything is on `claude/resumetailored-pricing-plan-iwy6un` / draft PR #263. Railway (production) only deploys from `main`, and Netlify previews are static-only — so the end-to-end flow runs only once you **merge to `main`**. Your call on timing; no rush.

## Where we are in the plan
- ✅ Phase 1 — renderer split + config column + regression harness
- ✅ Phase 2 — creator tab, pop-up gate, asset auto-pull, cover-letter auto-save, upgrade nudge
- ✅ Phase 3a — responsive grid/block renderer
- ✅ Phase 3b — block editor + live preview  ← just finished
- ⏭️ **Phase 4 — media uploads** (images/video files, quota meters per Option B: 300 MB images/audio + 300 MB video + 5-video cap, per-file limits, audio play/pause, slideshow captions)
- Phase 5 — video hero + labels, tiered case-study cards, lead capture, QR, analytics (5b: text-video + record/upload voiceover)
- Phase 6 — Back Office · Phase 7 — i18n copy pass · Phase 8 — polish

## Open items on you (non-blocking)
- **Q6** — Railway volume mounted at `/data`. **This becomes relevant at Phase 4** (uploaded media/video must persist across deploys). Worth confirming before I start Phase 4.
- **Q7** — `RESEND_API_KEY` in Railway (Phase 5 lead-capture emails).
- **Merge to `main`** whenever you want to test on Railway.

## Question before Phase 4
Phase 4 introduces **file uploads** (images, and later video). Per Option B the cap is **300 MB images/audio + 300 MB video + max 5 videos**, per-file **8 MB image / 25 MB audio / 25 MB video**. Uploaded files are stored under **`${DATA_DIR}/site-media/<email-hash>/`**.

- **This needs the Railway volume at `/data` to be mounted** or uploads vanish on redeploy. **Can you confirm the volume before I build Phase 4?** If it's not mounted yet, I can still build Phase 4 against `DATA_DIR` and you mount the volume before we merge — just flagging so uploads aren't lost in testing.

Say the word and I'll start **Phase 4**.
