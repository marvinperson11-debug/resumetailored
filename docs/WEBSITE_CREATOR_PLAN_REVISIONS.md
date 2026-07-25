# Website Creator — Responses to Plan Feedback

Answers to the five items raised before implementation. Where a decision is yours, options are laid out with numbers so you can pick. The phasing change (#3) is folded in at the end.

---

## 1. Storage quota — separate video pool vs. one raised cap

**Why the 250 MB combined cap was wrong:** a persisted resume video is far heavier than an image. Measured against the actual render settings (`remotion/render.js`: h264, 1080×1920, no CRF/bitrate override → Remotion's high-quality default ≈ CRF 18; duration ~18–25s scaling with highlight count), a single clip lands around **5–15 MB typical, ~25 MB worst case**. Two or three of those would eat most of a 250 MB budget before the user adds a single photo.

**Cost basis:** Railway volume storage is roughly **$0.15–0.25 per GB-month** (confirm current Railway pricing at build time). At the Pro price of $19.99/mo, per-user storage cost is negligible; the real exposure is *aggregate* storage from abandoned sites, which the one-site cap + unpublish already bound.

Two concrete options — **pick one:**

### Option A — single combined cap, raised to 1 GB/user
- One pool for images + audio + video.
- Simple to explain and meter (one number).
- Roomy: ~40+ videos **or** ~500 images.
- **Cost at full use:** ≈ **$0.15–0.25 / user / month**. At 1,000 Pro users each maxed = 1 TB ≈ **$150–250/mo** (worst case; realistically a fraction publish and far fewer max out).
- Downside: a few large videos can still crowd out image budget within the shared pool.

### Option B — separate pools *(recommended)*
- **Images + audio: 300 MB/user** · **Video: 300 MB/user** (independent).
- Guarantees videos never starve image budget and vice-versa.
- Video pool of 300 MB ≈ **20–30 clips** at typical size — plenty, since only one is the hero at a time.
- **Cost at full use:** combined 600 MB ≈ **$0.09–0.15 / user / month**. At 1,000 maxed users = 600 GB ≈ **$90–150/mo** worst case.
- Slightly more UI (two meters).

**Per-file limits (both options):** image 8 MB (`jpeg/png/webp`), audio 25 MB (`mpeg/mp4`), video 25 MB.

**Optional hard lever (recommend adding regardless):** cap **persisted videos at 5 per user**. Videos are the only unbounded-cost asset; a hard count caps the worst case deterministically even if a quota check is ever bypassed.

> **My recommendation:** **Option B + the 5-video cap.** It isolates the expensive asset class and makes worst-case cost predictable. Tell me if you'd rather have the simpler single 1 GB pool (Option A).

---

## 2. `RESEND_API_KEY` — treated as a blocker, not a footnote

**Status I can confirm from the code:** `RESEND_API_KEY` is **optional** in `server.js`. The email helper falls back: **Resend → SMTP (`SMTP_USER`+`SMTP_PASS`) → console.log**. So if the key is unset, "emails" (password resets, support, and any lead-capture notifications) are silently written to stdout instead of delivered.

**What I cannot confirm from here:** whether the key is actually set in the **Railway** environment. Railway dashboard secrets aren't readable from this session, and it's not externally detectable (no endpoint exposes it).

**Therefore, flagging it now as a blocker for the lead-capture feature (§4):**
- ✅ **Action for you:** verify in Railway → Variables whether `RESEND_API_KEY` (and `OWNER_EMAIL`) are set.
- If **set** → lead capture emails the owner on submit; build proceeds as planned.
- If **unset** → the "Request my resume PDF" / contact form will **store leads in the `site_leads` table but not email anyone** until the key is added. That's a degraded but non-broken state.
- **Build guarantee:** lead capture will be implemented so it **always persists to `site_leads` first**, and email is a best-effort add-on. That way an unset key never loses a lead — it just delays notification. The editor will show an "email notifications off — add RESEND_API_KEY to enable" note when the key is absent (server tells the client via a flag).

No mid-build surprise: the feature works headlessly without Resend; email is purely additive.

---

## 3. Phasing — i18n scaffolding moved up

Agreed — retrofitting translation keys onto a section-based page is rework. **Revised placement:**

- **Phase 2 now includes:** scaffold the EN/中文 dictionary **structure** for both the editor and the public-site renderer up front — every section emits `data-i18n` keys (editor) and reads from an embedded `SITE_I18N = {en, zh}` map (public site) from the very first section built. Keys are wired even where the Chinese copy is a placeholder.
- **Actual translated copy** gets filled in during the dedicated i18n pass (kept as a later step), but **no structural retrofit** is needed because the plumbing exists from Phase 2.

Full revised phasing is at the bottom.

---

## 4. Case-study extraction — real output shown first (as requested)

I prototyped `extractCaseStudies()` and ran it against three realistic resumes **before** any UI work. Two versions, to show the precision/recall tradeoff honestly.

### v1 — strict "strong metric only" (%, $, x, magnitude+unit)

| Resume | Cards produced |
|---|---|
| **Software Engineer** | **1** — "Led migration… reducing infra costs **30%** ($480k/yr)" |
| **Marketing Manager** | **4** — 3.2x traffic, $1.4M pipeline, 22% activation, $600k budget |
| **Registered Nurse** | **1** — "Reduced medication errors **45%**…" |

**Honest finding:** v1 is great for **metric-dense roles (marketing, sales)** but **undersells engineering and healthcare** — it missed strong bullets whose impact isn't a %/$: latency "from 1200ms to 240ms", "40+ engineers", "24 patients per shift", "15 new nurses trained". A 1-card "portfolio" makes the marquee feature look weak exactly where we don't want it to.

### v2 — broadened matcher (adds ms/latency, before→after "N to N", generic "N <noun>" counts)

| Resume | Cards produced |
|---|---|
| **Software Engineer** | **1 → 4** (now catches the latency delta, "6 engineers", "40+ engineers") |
| **Registered Nurse** | **1 → 3** (now catches "24 patients", "15 new nurses") |

**Tradeoff exposed:** recall jumps, but generic counts produce **weaker/awkward chips** — e.g. `[15 new]` (truncated) and `[6 engineers]` read less impressively than `[45%]` or `[$1.4M]`.

### Recommendation before we commit UI time
1. **Tiered scoring, not a flat filter.** *Tier-1* chips (`%`, `$`, `×`, time-delta) always become cards. *Tier-2* generic counts only fill up to a **minimum of 3 cards**, so metric-rich resumes stay clean and sparse ones still get a respectable portfolio.
2. **Fix chip extraction** so a Tier-2 chip is a sensible noun phrase ("15 nurses trained", not "15 new").
3. **Always user-editable + toggleable.** Generate **3–6 candidate cards** and let the user keep/drop/reorder and edit title + add detail/image. Auto-extraction is a *starting point*, never the final word — this de-risks the thin-resume case entirely.
4. **Ship the extractor behind the editor in Phase 5** only after you've eyeballed a second batch on *your own* real resumes.

Prototype is at `scratchpad/casestudy-proto.js` / `casestudy-v2.js` if you want to run more samples through it.

> **Decision needed:** OK to proceed with the **tiered v2 + editable candidates** approach? Or do you want strict-v1 (fewer, always-strong cards, sparser portfolios)?

---

## 5. Migration behavior when the `config` column lands

**No force-migration, no downtime, no re-render of existing sites.**

- The `config` column is added with `_ensureColumn('personal_sites', 'config', 'config TEXT')` — existing rows get `config = NULL`.
- `_renderPersonalSite(row)` treats **`config IS NULL` as "legacy default"**: it builds a default config in memory (single resume section, Midnight theme, no media, default section order) that reproduces **today's output** — i.e. visual parity with the current `_shareResumeHtml`-style page. Existing published sites keep working, unchanged, on the next deploy.
- Config is **populated lazily**: the first time the owner opens the new creator and hits Save, we write a real `config` JSON. Until then, the site renders from the legacy default.
- **Belt-and-suspenders:** the `/site/:name` parity test runs against both a `config IS NULL` row (legacy path) and a populated row, so we prove the null case renders and doesn't 500.

One line for the plan: *"Existing sites are not migrated on deploy; `config IS NULL` renders a legacy-default equivalent to the current output, and config is written lazily on first save in the new creator."*

---

## Revised phasing (i18n moved up per #3)

1. **Foundations** — `config` column (+ `IS NULL` legacy-default path, #5); split `_renderPersonalSite()` out of `_shareResumeHtml`; `/r/:slug` byte-identical regression check; `/site/` parity for both null and populated config.
2. **Creator tab + pop-up gate + asset auto-pull + i18n scaffolding** — "Tailor first" modal (zero saved assets only); cover-letter/video persistence tables; **EN/中文 dictionary structure wired into editor + public renderer from the first section** (placeholder copy OK).
3. **Customization** — themes, colors, drag-drop reorder, Edit/Preview toggle.
4. **Media** — uploads, quota meter(s) per the #1 decision, audio play/pause, galleries.
5. **Standout features** — video hero → **tiered/editable case-study cards (#4)** → contact/lead capture (persists first, email best-effort, #2) → themed QR → analytics.
6. **Back Office** — asset hub + bulk actions.
7. **i18n copy pass** — fill in the Chinese strings across the (already-keyed) editor + public site; EN/中文 parity check.
8. **Polish** — animated-bg degrade testing on mobile/low-power, spam guards, quota edge cases.

---

## Open decisions I need from you

1. **Quota:** Option A (single 1 GB) or **Option B (300 MB images + 300 MB video, + 5-video cap)** — my rec is B.
2. **Resend:** confirm `RESEND_API_KEY` is set in Railway (or accept lead-capture ships email-off until it is).
3. **Case studies:** proceed with **tiered v2 + editable candidates** (my rec), or strict-v1?

Once you answer these three, I'll start Phase 1.
