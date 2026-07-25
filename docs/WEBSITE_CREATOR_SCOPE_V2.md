# Website Creator — Scope v2 (decisions locked, new scope, Phase 1 status)

Complete response to the approval + additions. Covers: locked decisions, the eight scope additions and where each lands, the **freeform-placement plan** requested before Phase 3, the **Create-a-Link download button** impact on the regression check, and **what Phase 1 shipped in this pass**.

---

## Locked decisions

| # | Decision | Applied |
|---|---|---|
| 1 | **Option B** — 300 MB images/audio + **300 MB video** (separate pools) + **5-video hard cap** | Quota model + cap; the video pool and 5-cap now cover **both** generated *and* user-uploaded videos combined. |
| 2 | **`RESEND_API_KEY`** — verify status before/during Phase 1; proceed regardless | Lead capture will **persist to `site_leads` first**, email best-effort. See "Resend status" below. |
| 3 | **Tiered v2 + editable candidates** for case studies | Phase 5. Tier-1 chips (%/$/×/time-delta) always; Tier-2 counts fill to a 3-card minimum; 3–6 editable candidates. |

---

## Resend status (checked)

- In **this build environment** `RESEND_API_KEY` is **not set** and `OWNER_EMAIL` is unset (verified: `node -e` on the process env).
- I **cannot** read the **Railway production** secret from here. You noted nothing has deployed in the last hour — so please confirm in Railway → Variables when convenient.
- **No blocker either way:** lead capture writes to `site_leads` first; email notification is an additive best-effort. If the key is absent, leads are still captured and the editor shows an "email notifications off — add RESEND_API_KEY to enable" note (server passes a flag to the client).

---

## The eight scope additions — where each lands

1. **Shared Link download button (`/r/:slug`, no login).** A change to Create-a-Link. **Regression-check impact flagged below.** Lands as a small dedicated change in **Phase 2** (after the Phase 1 split is proven inert). Download UX options — see "Link download button" section; recommend **print-to-PDF + plain-text** (no login, no watermark entanglement). *Needs your pick.*
2. **Website download toggle (Pro).** Optional customization setting `config.features.downloadResume` → renders a themed download button on the published site pointing at the selected resume asset. **Phase 3** (setting) / **Phase 5** (public render).
3. **Video labeling.** Each video block gets `config.block.label` — a dropdown of presets ("Meet Me", "About Me", "Why Hire Me", "My Story", "Elevator Pitch") **plus** a free-text custom field. **Phase 5.**
4. **Surface the existing resume-video generator on the dashboard.** No new tool. The creator shows two entry points side by side — **"🎬 Generate from my résumé"** (existing `/api/resume-video`) and **"⬆ Upload your own video"** — user picks one or both. **Phase 2** (surfacing) / **Phase 5** (embed as hero).
5. **User-uploaded videos.** Upload pre-recorded files (mp4) usable in any video block, as an alternative to the generator. Counts against the **300 MB video pool + 5-video cap**; per-file 25 MB. **Phase 4** (media) / **Phase 5** (placement).
6. **Plain-text video + voiceover.** A new lightweight generation mode (text-on-screen + audio). Voiceover supports **both** record-live (browser `MediaRecorder`/`getUserMedia`) **and** upload a pre-recorded audio file. This is the meatiest addition — see the flag below. **Phase 5b** (its own sub-phase).
7. **Slideshow image captions.** Each gallery image gets `config.block.images[].caption`. **Phase 4.**
8. **Free-form placement (not just section reordering).** The big one — full plan and phasing impact below.

---

## FLAG 1 — Free-form placement is a page-builder, not a reorder list

You're right that this is materially bigger than drag-and-drop **section reordering**. Here's how I'd actually build it and what it costs.

### The two models

- **What we scoped originally (stacked + reorder):** sections are full-width blocks stacked top-to-bottom; you drag to reorder vertically. Simple, inherently responsive, cheap.
- **What you're now asking for (freeform):** place text / image / video blocks *anywhere* → a Wix/Squarespace-style page builder.

### The hard part: responsive

Raw **pixel-absolute** placement (`x/y/width/height` in px) is what makes naive page builders a **mobile nightmare** — a layout dialed in on desktop overlaps and overflows on a phone. Real builders solve this either by storing **separate positions per breakpoint** (huge editor surface) or by using a **responsive grid** that reflows.

### Recommendation: grid-based freeform (not pixel canvas)

- Model each block as `{ type, col, row, colSpan, rowSpan, content }` on a **12-column grid**.
- **Desktop:** CSS Grid honors the col/row/span → true side-by-side, offset, 2-column, mixed arrangements ("place things where you want").
- **Mobile:** the grid **collapses to one column in row order** automatically — no second layout to maintain, nothing overlaps.
- Editor: drag + resize on the grid with snap-to-cell and alignment guides. Vendor **GridStack.js** (MIT, mature drag/resize grid) locally to stay self-contained, or hand-roll CSS-grid + pointer drag.
- Auto-generated pieces (hero, case-study cards, contact form) become **blocks you can place**, not fixed regions.
- **Explicitly not recommended:** raw pixel-absolute canvas — high build cost, poor mobile behavior, ongoing support burden.

### Phasing / timeline impact

This roughly **doubles Phase 3** and splits it:

- **Phase 3a — block/grid foundation:** the block model in `config`, the public-site grid renderer (desktop grid + mobile reflow), and a **simple stacked default** so sites can ship before the fancy editor exists.
- **Phase 3b — the canvas editor:** drag/resize/snap, add/delete blocks, per-block toolbar, alignment guides.

Net: Phase 3 goes from ~1 unit of work to ~2. I'd ship **3a** (renders correctly, minimal editing) first so momentum isn't blocked on the full editor, then **3b**.

> **Decision needed before Phase 3:** confirm **grid-based freeform** (my strong rec) vs. true **pixel-canvas**. I won't start Phase 3 until you pick.

---

## FLAG 2 — Plain-text-video + live voiceover recording

Two non-trivial pieces bundled here:

- **Text-on-screen video generation** — best reuses the existing **Remotion** pipeline as a new simple composition (text + background + audio track), server-rendered like the résumé video. That means it inherits Remotion's render cost and the one-at-a-time lock. Non-trivial but reuses infra.
- **Live voiceover recording** — browser `getUserMedia` + `MediaRecorder` to capture audio, plus the upload alternative. Straightforward on the client, but needs a mic-permission UX and an upload path into the media pool.

I've scoped this as **Phase 5b** (its own sub-phase after the core video hero works) so it doesn't hold up the simpler "generate or upload a video" flow. Flagging now so the extra render/permission surface isn't a surprise.

---

## FLAG 3 — Create-a-Link download button vs. the byte-identical check

**Yes, it affects the regression check — and I built the check to absorb it rather than drop it.**

- Phase 1 (this pass) captured **golden snapshots** of the exact `/r/:slug` and `/site/:name` HTML (`test/golden/link.html`, `site.html`) and a runner (`test/render-snapshot.js`) that fails on any drift.
- Right now the split is proven **inert**: `/r/` output is byte-identical to before, `/site/` is byte-identical and now flows through the new `_renderPersonalSite()`.
- When the **download button** lands (Phase 2), it is an **intentional** change to the Link. The workflow:
  1. Add the button.
  2. Run `node test/render-snapshot.js` → it **fails** (output changed) — proving the check is live.
  3. Review the diff, then `node test/render-snapshot.js --update` to **re-baseline** the golden to the new, button-inclusive output.
  4. Commit the updated golden. The check now guards *that* baseline going forward.
- So the check is **adjusted, never dropped** — exactly as requested.

**Download UX — needs your pick** (no login, so keep it simple):
- **(a) Print-to-PDF** — button calls `window.print()`; the page already has print-color CSS. Zero server, gives a clean PDF. *Recommended, plus:*
- **(b) Plain-text** — downloads the resume text as `.txt` via a client-side Blob. *Recommended alongside (a).*
- **(c) Server PDF/DOCX** — reuses `/api/download-docx`, but that carries template-gating/watermark logic meant for logged-in users; heavier and entangled. *Not recommended for the no-login Link.*

My rec: **(a) + (b).** Confirm and I'll wire it in Phase 2.

---

## Phase 1 — SHIPPED in this pass ✅

Foundations are done and verified (no behavior change to either surface):

- **`config` column** added to `personal_sites` via `_ensureColumn` (NULL on existing rows).
- **Renderer split:** new **`_renderPersonalSite(row, origin, opts)`** — a separate function from `_shareResumeHtml`. For `config IS NULL` (all existing sites) it delegates to the shared resume-document renderer, so output is unchanged; later phases branch on parsed `config` **here**, never touching the Link renderer.
- **Both site callers switched** to `_renderPersonalSite`: the host-based `*.resumetailored.com` middleware and `GET /site/:sub`. `GET /r/:slug` still calls `_shareResumeHtml` directly.
- **Migration behavior confirmed in code:** `config IS NULL` → legacy default (today's output); populated lazily on first save later. No force-migration, no deploy downtime.
- **Regression harness:** `test/render-snapshot.js` + `test/golden/{link,site}.html`. Verified: both render **byte-identical** across two runs; Link stays `noindex` + brand footer; Site stays `index,follow` + watermark-free + correct canonical.

Run it anytime with `node test/render-snapshot.js` (add `--update` after an intentional Link change).

---

## Revised phasing (with additions slotted in)

1. **Foundations** ✅ *(done this pass)* — config column, renderer split, regression harness.
2. **Creator tab + pop-up gate + asset auto-pull + i18n scaffolding** — "Tailor first" modal (zero saved assets only); cover-letter/video persistence; EN/中文 dictionary structure wired from the first section; **surface the résumé-video generator + "upload your own video" entry points**; **Link download button** (re-baseline snapshot).
3. **Customization** — themes, colors, Edit/Preview toggle, **website download toggle**, **and the freeform grid** → **3a** block/grid foundation + mobile reflow, **3b** canvas editor *(pending your grid-vs-pixel decision)*.
4. **Media** — uploads + quota meters (Option B pools), audio play/pause, galleries **with per-image captions**, **user-uploaded videos** (video pool + 5-cap).
5. **Standout features** — **video hero with preset/custom labels**, tiered/editable case-study cards, contact/"Request PDF" lead capture (persist-first), themed QR, analytics. **5b:** plain-text-video generation + live/upload voiceover.
6. **Back Office** — asset hub + bulk actions.
7. **i18n copy pass** — fill Chinese strings across the (already-keyed) editor + public site.
8. **Polish** — animated-bg degrade testing, spam guards, quota edge cases.

---

## Decisions I need before proceeding past Phase 2

1. **Freeform layout:** grid-based (rec) vs. pixel-canvas — **blocks Phase 3.**
2. **Link download UX:** print-to-PDF + .txt (rec) vs. server PDF — **blocks the Phase 2 Link button.**
3. **Resend:** confirm `RESEND_API_KEY` in Railway (or accept email-off until set) — **non-blocking.**

Phase 1 is committed and pushed. I'll proceed into Phase 2 unless you want to weigh in first.
