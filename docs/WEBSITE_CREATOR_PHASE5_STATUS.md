# Website Creator — Phase 5 status (the "pop" features)

Phase 5 is built on the branch (draft PR #263). These are the features meant to justify the Pro price.

## What shipped

**Case-study cards (tiered + editable)** — the headline feature
- `_extractCaseStudies` uses the **tiered v2** heuristic we agreed on: Tier-1 bullets (strong metric — %, $, ×, time-delta) always become cards; Tier-2 generic "N noun" counts only fill up to a **3-card minimum**, so metric-rich resumes stay clean and sparse ones still get a set.
- **`POST /api/case-studies`** returns editable candidates from the selected resume.
- Editor: a **Case Studies** block with **"✨ Auto-generate from résumé"** + per-card editing (title, metric chip, detail) and "+ Add card".
- Public render: **expandable `<details>` cards** with a metric chip (and optional image).

**Lead capture (persist-first)**
- **Contact** block with two modes: a plain **contact form** or a **"Request my resume (PDF)"** gate.
- **`POST /api/site-lead`** — **stores the lead in `site_leads` FIRST**, then best-effort emails the owner. So a missing `RESEND_API_KEY` never loses a lead. Includes a **honeypot** + rate limit.
- **`GET /api/site-leads`** (owner) returns leads + an `emailEnabled` flag; the editor shows an "email off — add RESEND_API_KEY" note when relevant.

**Themed QR code**
- **`GET /api/site-qr`** (via the new `qrcode` dependency) returns an **SVG tinted to your site color**, pointing at your `/site/:name`.
- Editor: QR preview + **Download QR** (for resume footers, business cards, LinkedIn).

**Simple analytics (cookieless)**
- `site_visits` records each view with the **referrer host only** (no PII, no cookies — no consent banner needed).
- **`GET /api/site-analytics`** (owner) → total **views** + **top referrer sources**.
- Editor shows **Views · Top source · Leads** once the site is published.

## Verified
- `server.js` syntax ✓; inline scripts parse ✓; EN/中文 i18n parity ✓
- Goldens: `link.html` + `site.html` **byte-identical**; `site-grid.html` **re-baselined** (new case-study/contact CSS — reviewed) ✓
- **Backend E2E:** case-study tiered output (3 cards, first chip `30%`), lead persist + honeypot (no store) + owner list, analytics (2 views, top referrer `linkedin.com` + `direct`), QR SVG ✓
- **Render E2E:** case-study cards with chips + expandable details, contact form on `/site` ✓

## New dependency
- **`qrcode` ^1.5.4** (production). The Dockerfile's `npm install --omit=dev` picks it up on the Railway build — no Dockerfile change needed.

## Not in this phase (flagged)
- **5b — plain-text video generation + record/upload voiceover.** This is a distinct sub-phase (reuses Remotion for a text composition + a browser `MediaRecorder` flow). The **video block already serves as a video hero** (full-width video + label), so the core "video hero" is covered; 5b is the extra text-video generator. I can do it as its own pass — tell me if you want it before or after Phase 6.

## Where we are
- ✅ Phases 1, 2, 3a, 3b, 4, **5** (5b pending)
- ⏭️ **Phase 6 — Back Office**: a Pro asset hub for resumes, cover letters, videos, websites + bulk duplicate/delete and publish/unpublish. (Analytics + leads + QR already have API endpoints it can reuse.)
- Phase 7 — i18n copy pass · Phase 8 — polish

## Open items on you
- **Q6 — Railway `/data` volume: the merge blocker.** Media (Phase 4) and any future persisted files need it. You're mounting it before merge — thanks.
- **Q7 — `RESEND_API_KEY`:** now materially useful (lead emails). Non-blocking — leads persist and are listed in the editor regardless; email is the only thing gated on it.

Say the word for **Phase 6 (Back Office)**, or **5b** if you'd rather do the text-video generator next.
