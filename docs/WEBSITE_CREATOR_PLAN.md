# Website Creator — Implementation Plan

**Goal:** Turn the Pro-only "Create a Website" from a clone of "Create a Link" into a real, customizable personal website builder that clearly justifies the Pro price. **"Create a Link" is left exactly as-is** (`/api/share` → `/r/:slug`, still rendered by `_shareResumeHtml`, plain and basic).

This document is a plan only — no feature code has been changed yet.

---

## 0. Current state (what the code does today)

| Piece | Location | Notes |
|---|---|---|
| Share Link | `POST /api/share` → `/r/:slug`, table `shared_resumes` | noindex, watermark footer. **Leave alone.** |
| Personal Website | `POST/GET/DELETE /api/personal-site` → `/site/:sub`, table `personal_sites` | **Currently renders the identical `_shareResumeHtml` output** as the link — this is the problem. |
| Shared renderer | `_shareResumeHtml(row, origin, opts)` in `server.js` | Single function both routes call. |
| Saved assets | `saved_resumes` table (`/api/resumes`) | Resumes only, latest 20. **Cover letters + videos are NOT persisted.** |
| Resume video | `POST /api/resume-video` + `videoJobs` Map + tmp mp4 | **Ephemeral** — rendered to `os.tmpdir()`, streamed, deleted. Not saved per user. |
| Website launch (UI) | `publishPersonalSite()` in `app.html` (sidebar `#tab-website`) | Fires immediately, `window.prompt` for the address. No editor. |
| Gating | `isSubscriber(email)` (server), `isSubscriberFlag`/`startPro()` (client) | Already in place. |
| i18n | `APP_I18N {en,zh}` + `applyLangApp()` | Editor can reuse this. **Public `/site/` output has no i18n today.** |
| One-site guardrail | `POST /api/personal-site` deletes any existing row for the email before insert | Already one-per-account. **Keep.** |

---

## 7. Value Justification — why "Website" ≠ "Link" (do this first)

Three concrete differentiators, so the paid tier is buying something distinct:

1. **Interactive, multi-section site vs. a static resume snapshot.** The Link is one auto-rendered resume page at a throwaway `/r/<slug>`. The Website is a branded, reorderable multi-section site (hero, About, case studies, video, contact) at a claimed `/site/<name>` the user controls, edits, and re-publishes.
2. **Rich media the Link can't hold.** Embedded **resume video hero**, image galleries/slideshows, optional ambient audio, and a **theme-matched QR code** — none of which exist on the Link.
3. **Lead capture + analytics.** The Website has a visitor **contact / "Request my resume PDF" form** and **owner-visible analytics** (views + top referrer). The Link stays a fire-and-forget URL with only a raw view counter.

These three are the headline bullets for the Pro upsell copy.

---

## Architecture overview

- **New editor tab** `showTab('website')` in `app.html` — the "Website Creator" (SPA tab, same pattern as `tailor`/`ats`). Replaces the immediate `publishPersonalSite()` prompt.
- **Config-driven sites.** Extend `personal_sites` with a `config` JSON blob (theme, section order, selected asset IDs, media refs, feature toggles). The renderer becomes `_renderPersonalSite(row)` — a **new, separate** renderer from `_shareResumeHtml` so the Link renderer is untouched.
- **Persistent media + video** under `DATA_DIR` (the Railway volume) so uploads and embedded videos survive deploys.
- **New tables:** `site_media`, `site_visits`, `site_leads`, `saved_cover_letters`, `saved_videos` (details below).

---

## 1. Navigation & Pop-Up Logic

**Behavior:** clicking "Personal Website" should gate on whether the user has any saved assets.

- Add `GET /api/assets/summary` → `{ resumes: N, coverLetters: N, videos: N }` for the signed-in email.
- New client flow `openWebsiteCreator()` (replaces the direct `publishPersonalSite()` on `#tab-website`):
  1. If not `isSubscriberFlag` → `startPro()` (unchanged Pro gate).
  2. Fetch the summary. **If `resumes + coverLetters === 0`** → show the **"Tailor a resume first" modal** (new small modal, with a "Go to Tailor" button → `showTab('tailor')`).
  3. Otherwise → `showTab('website')` and load the creator.
- **Asset auto-pull:** the creator calls `/api/resumes` (+ new cover-letter/video lists) and renders a selector panel. The user picks which resume and which cover letter the site displays and can switch at any time; selection is stored in `config.assets = { resumeId, coverLetterId, videoId }`.

**Persistence gap to close:** cover letters and videos aren't saved today. Add:
- `saved_cover_letters` (mirror of `saved_resumes`): auto-save on cover-letter generation in `/api/tailor` (client `POST /api/cover-letters` after a `cover_letter`/`both` run).
- `saved_videos` (see §4) so a rendered video can be selected as the hero.

---

## 2. Internationalization

- **Editor UI:** every new string gets a `data-i18n` key added to **both** `APP_I18N.en` and `APP_I18N.zh`; `applyLangApp()` already handles it. No new mechanism.
- **Public generated site:** the new `_renderPersonalSite()` must emit a bilingual page (the requirement explicitly includes the *public* site).
  - Store the owner's current language in `config.lang` **and** embed a small inline JS toggle + a `data-i18n`-style dictionary in the generated HTML (mirroring the `zh/index.html` pattern) so visitors can switch. Section chrome ("About Me", "Projects", "Contact", "Request my resume", play/pause labels, form labels, submit/success text) all come from that dictionary.
  - Resume/cover-letter body text is user content — shown as-authored, not machine-translated (same policy as the app). Only site **chrome** is translated.
- The QR code, analytics labels (owner-only view), and contact-form emails also read from the dictionary.

---

## 3. Customization Features

Stored in `personal_sites.config` (JSON). Editor writes it; `_renderPersonalSite()` reads it.

- **Default styling:** default theme mirrors the homepage — `background:#030712` with the indigo→violet gradient accents (`#6366F1`/`#8B5CF6`). Users keep it and adjust primary/accent colors via existing color inputs.
- **Alternative backgrounds — 5 presets** (each declared static vs. animated; animated must degrade gracefully):
  1. **Midnight** (default) — static dark `#030712` + subtle radial gradient. *Static.*
  2. **Aurora** — animated slow-drifting gradient (CSS `@keyframes`, GPU transform only). *Animated → falls back to a static gradient under `prefers-reduced-motion` and on coarse-pointer/low-DPR devices.*
  3. **Paper** — light, clean (`#f8fafc`) for a traditional look. *Static.*
  4. **Mesh** — static multi-stop mesh gradient (pure CSS, no JS). *Static.*
  5. **Particles** — animated lightweight canvas particle field. *Animated → disabled (static Midnight) when `prefers-reduced-motion`, `navigator.hardwareConcurrency <= 4`, or viewport width < 768px; capped particle count + `requestAnimationFrame` paused when tab hidden.*
  - Gating helper `shouldAnimate()` in the generated page centralizes the degrade rules.
- **Layout — drag-and-drop section reordering:** editor uses the native HTML5 Drag-and-Drop API (no build step; optionally the tiny **SortableJS** via CDN — `app.html` is static-served, not a CSP-locked artifact, so a CDN is acceptable, but vanilla DnD keeps it dependency-free — recommend **vanilla**). Order persists to `config.sectionOrder`.
- **Media uploads:**
  - New `POST /api/site-media` (multer, Pro-only) → stores under `${DATA_DIR}/site-media/<email-hash>/`, row in `site_media`.
  - **Quota (proposed):** **250 MB per user**, **max 25 images**, **per-file 8 MB image / 25 MB audio**, types `image/jpeg|png|webp`, `audio/mpeg|mp4`, plus the embedded resume video. Enforced server-side before write; editor shows a usage meter.
  - **Voiceover/ambient audio:** never autoplay with sound — the generated site renders a visible **play/pause control** (audio starts paused, `muted`/no autoplay). Owner picks the track in the editor.
  - **Images/slideshows:** a gallery section; slideshow advances on a timer but pauses on hover/`prefers-reduced-motion`.
- **Editor/Public View toggle:** a prominent, always-visible segmented switch pinned at the top of the creator tab — **Edit | Preview**. Preview renders the exact `_renderPersonalSite()` output inside an `<iframe srcdoc>` so it's WYSIWYG without publishing.

---

## 4. Standout Content Features (the "pop")

- **Resume video hero.** Persist rendered videos: on successful `/api/resume-video` render, if the user opts in, copy the mp4 from tmp to `${DATA_DIR}/site-media/<hash>/video-<id>.mp4` and insert a `saved_videos` row. The creator lets the user set a saved video as the **hero / "About Me"** section — the public site embeds a real `<video>` (poster + play/pause, no sound autoplay), not a link.
- **Auto-generated case-study cards.** New helper `extractCaseStudies(resumeText)` server-side: parse resume bullets, prefer **quantified** ones (reuse the existing quantified-bullet heuristic from `remotion/parseResume.js`), and turn e.g. *"Led migration reducing costs 30%"* into an expandable **project card** (headline = the bullet, metric chip = the number). The user can edit each card's detail text and attach an image from their media library. Stored in `config.caseStudies[]`.
- **Visitor contact form / "Request my resume PDF" gate.** Optional section; `POST /api/site-lead` stores name/email/message in `site_leads` and (if `RESEND_API_KEY`) emails the owner. The "Request PDF" variant reveals a download link (or emails the PDF) only after the visitor submits their email — captured as a lead. Basic honeypot + rate-limit to curb spam.
- **Themed QR code.** `GET /api/site-qr?sub=<name>` generates an SVG QR (via the `qrcode` npm package) tinted with the site's primary/accent colors. Downloadable for resume footers, business cards, LinkedIn. Rendered in the editor and offered as PNG/SVG.
- **Simple analytics.** New `site_visits` table (one row per view: `sub`, `ts`, `referrer` host). `_renderPersonalSite()` records a visit (respecting the existing view counter). Owner sees **total views** and **top referrer source** in the creator + Back Office. Keep it privacy-light (store referrer host only, no PII, no cookies) so no consent banner is needed.

---

## 5. Guardrails

- **One live site per account** — already enforced (`/api/personal-site` deletes the prior row on publish). Keep it; the Back Office publish/unpublish toggles the single site's `published` flag rather than creating new rows.
- Media quota (§3) caps storage cost. Video persistence is opt-in and counts against the same quota.

---

## 6. Back Office / Asset Hub

- New **Pro-only** sidebar button `#tab-backoffice` → `showTab('backoffice')` (hidden/`startPro()` for non-subscribers).
- Central dashboard aggregating: **saved resumes** (`/api/resumes`), **cover letters** (`/api/cover-letters`), **resume videos** (`/api/videos`), **personal website** (`/api/personal-site`).
- **Bulk actions:** multi-select with **duplicate / delete** for resumes, cover letters, videos; **publish / unpublish** for the website; plus per-item **view / edit** (edit opens the relevant tab pre-loaded). Wire to existing + new DELETE/duplicate endpoints.
- Backend: add `POST /api/resumes/:id/duplicate` etc., and a `PATCH /api/personal-site { published }` toggle.

---

## Data model changes (summary)

```text
personal_sites   + config TEXT           -- JSON: theme, sectionOrder, assets, caseStudies, media, features, lang
                 (+ published already exists; keep)
saved_cover_letters (id, email, title, content, created_at)     -- mirror of saved_resumes
saved_videos       (id, email, title, path, created_at)         -- persisted mp4s under DATA_DIR
site_media         (id, email, sub, kind, path, bytes, created_at)
site_visits        (id, sub, ts, referrer_host)
site_leads         (id, sub, name, email, message, created_at)
```

All via `CREATE TABLE IF NOT EXISTS` + `_ensureColumn` for `personal_sites.config` (same migration pattern already used for `shared_resumes.layout`).

## New/changed endpoints (summary)

```text
GET   /api/assets/summary          -- pop-up gate counts
GET   /api/cover-letters           POST /api/cover-letters        DELETE /api/cover-letters/:id
GET   /api/videos                  DELETE /api/videos/:id         (+ opt-in persist on render)
POST  /api/site-media (multer)     DELETE /api/site-media/:id     GET /api/site-media (list+quota)
GET   /api/site-qr
POST  /api/site-lead               GET /api/site-leads (owner)
PATCH /api/personal-site           -- publish/unpublish + config save
POST  /api/resumes/:id/duplicate   (+ cover-letter/video duplicate)
```

`_renderPersonalSite(row)` — **new** renderer (leaves `_shareResumeHtml` and the Link untouched). `/site/:sub` and the subdomain middleware switch to it.

---

## Suggested phasing

1. **Foundations:** `config` column + `_renderPersonalSite()` split from `_shareResumeHtml`; verify `/site/` still renders (parity), Link unchanged.
2. **Creator tab + pop-up gate + asset auto-pull** (§1), incl. cover-letter/video persistence tables.
3. **Customization** (§3): themes, colors, DnD reorder, Edit/Preview toggle.
4. **Media** (§3): uploads, quota meter, audio play/pause, galleries.
5. **Standout features** (§4): video hero → case-study cards → contact/lead → QR → analytics.
6. **Back Office** (§6) + bulk actions.
7. **i18n pass** (§2) across editor + public site, EN/中文 parity.
8. **Polish:** animated-background degrade testing on mobile/low-power, spam guards, quota edge cases.

---

## Risks / call-outs

- **Video persistence needs durable storage** — today videos are ephemeral. Requires `DATA_DIR` volume writes and quota accounting; without a mounted Railway volume they'd vanish on deploy (document in `RAILWAY_SETUP.md`).
- **`_shareResumeHtml` must not be touched** — splitting the renderer protects the Link's "leave exactly as-is" requirement. Add a regression check that `/r/:slug` output is byte-identical before/after.
- **Public-site i18n** is the largest net-new surface; budget for a dedicated dictionary + toggle in the generated HTML.
- **Animated backgrounds** are the main mobile-performance risk — the `shouldAnimate()` degrade gate (reduced-motion, low core count, small viewport, hidden-tab pause) is mandatory, not optional.
- **CSP/deps:** prefer vanilla DnD and the small `qrcode` npm package server-side over CDN scripts to keep the app self-contained.
- **Storage cost** scales with media + video; the 250 MB/user cap and one-site guardrail keep it predictable.
