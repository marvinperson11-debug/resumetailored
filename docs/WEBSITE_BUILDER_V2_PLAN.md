# Website Builder v2 — Wix-style rebuild plan

**Status: plan only, no code written.** Full replacement of the current block/grid Website Creator.

---

## 0. You're right about the core problem — I reproduced it

I ran the current default site through the renderer. A newly created site is literally **two things**: a heading and a `.sg-resume` **resume-document card** on a colored background. That is structurally the share-link output with a theme behind it. Preview shows it faithfully — so Preview isn't lying, **the thing it's previewing is the problem**. Color swatches on one generic layout was never going to read as "a real website," and template-first is the right correction.

So: the layout engine, the editor, and the renderer get replaced. Below is what replaces them.

---

## 1. What gets thrown away vs. kept

**Replaced (the whole page model):**
- `_renderSiteGrid` / `_renderSiteBlock` (12-col stacked grid renderer)
- The block-list editor in `app.html` (~33 `wc*` functions), the background-swatch picker, `config.blocks`

**Kept — real infrastructure, already built and tested (this is why v2 is far less than a from-scratch build):**
- **Media library + quotas** (`site_media`, `/api/site-media`, `/media/:id`, 300 MB image/audio + 300 MB video + 5-video cap)
- **Lead capture** (`site_leads`, persist-first + honeypot + rate limit) → becomes the Contact Form element
- **Analytics** (`site_visits`, views + top referrer), **themed QR**, **Back Office** (asset hub, publish/unpublish, bulk actions)
- **Publish plumbing**: `personal_sites`, subdomain validation/reservation, `/site/:name`, host-based routing, Pro gating, one-site-per-account
- **Text-video generator + voiceover**, resume/cover-letter asset pull, EN/中文 i18n scaffolding
- **The regression harness** — `/r/:slug` (Create-a-Link) stays byte-identical throughout; that guarantee does not change.

---

## 2. Page model — how "drag anywhere" actually works

**Recommendation: sections + absolutely-positioned elements inside them.** This is what Wix's editor actually does today, and it's the difference between a builder that survives phones and one that doesn't.

```
site document
└── pages[]            { id, name, slug, isHome }
    └── sections[]     { id, height, background{color|gradient|image|video}, fullBleed }
        └── elements[] { id, type, x, y, w, h, z, props, mobile{x,y,w,h,hidden} }
```

- **Desktop canvas: fixed 1200px content width.** Elements carry absolute `x/y/w/h` **within their section** — so you can place anything anywhere, overlap it, and layer it (`z`). That satisfies "moved anywhere on the canvas, not just reordered in a stack."
- **Sections stack vertically** and own their own background (color, gradient, image, or video). This is what makes a template feel like a designed multi-section page instead of one flat canvas.
- **Mobile is auto-derived, then tweakable** (exactly Wix's approach): per section, elements sort by `y` then `x`, go full-width, and stack. The user can then nudge order, resize, or **hide-on-mobile** per element via `element.mobile`. Auto-derivation means a template is never broken on a phone by default.

**Why not whole-page pixel-absolute:** it's the model I flagged earlier as a mobile trap, and it's *not* what Wix does anymore. Sections give us deterministic mobile reflow for free while keeping true freeform placement inside each section. **This is the one architectural decision I most want your explicit sign-off on.**

---

## 3. Template gallery (opens the builder)

A browsable gallery — **category tabs, hover preview, desktop/mobile toggle before you pick** — matching how Wix opens.

Each template is a **complete site document**: multiple sections, real sample copy, placeholder imagery, and a themed palette already applied. Not a color variant of one layout — genuinely different structures.

**8 templates across 4 categories (v1):**

| Category | Template | What makes it structurally distinct |
|---|---|---|
| **Professional CV** | **Executive** | Dark full-bleed hero + headshot, credential strip, experience timeline, contact band |
| | **Minimal CV** | Light, typographic, generous whitespace, offset accent rules, single strong column |
| **Portfolio** | **Grid Portfolio** | Masonry gallery hero, project cards with hover captions, tight 3-col work grid |
| | **Showcase** | Full-bleed image hero, slider gallery, expandable case studies, big pull-quote |
| **Creative** | **Bold** | Oversized type, overlapping color blocks, video hero, asymmetric offsets |
| | **Studio** | Split-screen sections, image boxes with overlay captions, marquee strip |
| **Business** | **Consultant** | Services 3-up, testimonial band, contact form + QR, stats row |
| | **Freelancer** | Services/pricing cards, portfolio strip, lead-capture form, availability badge |

**Branding:** all templates ship on our palette — indigo `#6366F1` → violet `#8B5CF6`, ink `#030712`, with light variants — so they read as ResumeTailored, not generic Wix. Each template still exposes a palette swap.

**Placeholder imagery:** generated **inline SVG/gradient art**, not binary assets. No repo bloat, no external image hosts, nothing to 404 — and every placeholder is one click away from being replaced by a real upload from the media library. *(Flagging this as a choice you may want to override — real stock photography would look richer but needs licensing + hosting.)*

---

## 4. The editor

**Canvas (center):** renders the site with **the exact same renderer the public page uses**, inside an iframe, with an editing overlay on top. This is the structural fix for your point 4 — see §5.

**Add Elements panel (`+` button, left):** drag an element from the panel straight onto the canvas.

| Group | Elements |
|---|---|
| Text | Heading, Subheading, Paragraph |
| Media | Image, Image Box (overlay caption), Video, Audio |
| **Gallery** | **Grid, Masonry, Slider/Carousel, Album** — see §6 |
| Interactive | Button, Contact Form, Social Icons, Nav Menu |
| Layout | Section, Divider, Box/Shape, Spacer |
| ResumeTailored | Resume Block, Case-Study Cards, QR Code |

*(The last row is our moat — nobody else's builder can drop in an ATS-tailored résumé, auto-extracted case studies, or a themed résumé QR.)*

**Interactions:** drag to move, handles to resize, snap-to-guides + alignment hints, arrow-key nudge, layer order (bring forward/back), duplicate, delete, undo/redo.

**Inspector (right):** per-element properties — text/font/size/color, image source (opens **media library**), link target (URL / page / anchor), gallery layout + spacing + animation, form fields, background, visibility.

**Top bar:** page switcher · **Desktop / Mobile** toggle · **Edit / Preview** · Save · Publish.

---

## 5. Preview — the fix, done structurally

The current split (editor shows one thing, preview renders another path) is what let them drift. v2 removes the possibility:

- **One renderer, `_renderSiteDoc(doc)`**, produces the public page HTML from the site document.
- **The editor canvas renders through that same function** into an iframe, plus an absolutely-positioned editing overlay (selection outlines, handles, guides).
- **Preview = hide the overlay.** Nothing re-renders through a different path, so preview is byte-identical to what a visitor gets, by construction.
- **Mobile preview** = the same render at mobile width using the derived mobile layout — the same thing the published site serves.

I'll assert this with a test: render a document via the public route and via the preview endpoint and **diff the HTML** — they must match. That's the Preview guarantee in CI, not a promise.

---

## 6. Real portfolio / gallery elements

A first-class **Gallery element**, not resume text on a background:

- **Layouts:** Grid · Masonry · Slider/Carousel · Album (cover → opens a set)
- **Per-item:** image or video, title, caption, optional link
- **Options:** columns, spacing, corner radius, crop mode, hover effect (zoom / fade / caption-reveal), lightbox on click, autoplay for sliders (**muted**, respects reduced-motion)
- **Sources:** the existing media library, the text-video/résumé-video outputs, or per-item upload
- Mobile: columns collapse; sliders become swipeable — inherits the media quotas already enforced.

---

## 7. Multiple pages

- Page manager: add / rename / reorder / duplicate / delete / set home.
- **Nav Menu element** auto-lists pages; links can target a page, an anchor, or an external URL.
- URLs: `/site/:name` (home) and `/site/:name/:page`; host-based `name.resumetailored.com/:page` continues to work.
- Per-page SEO title/description; sitemap-friendly; unpublished pages 404.

---

## 8. Data & migration

- New: `config.pages` (site document, JSON in the existing `personal_sites.config`), plus `site_templates` seeded in code (not a DB table — templates are versioned with the app).
- **Legacy sites keep working.** `_renderPersonalSite` already branches on config shape; it gains a third case: `config.pages` → `_renderSiteDoc`; `config.blocks` → existing grid renderer; `NULL` → legacy default. Nobody's live site breaks, and the existing snapshot tests stay green.
- Offer existing users a one-click **"Rebuild with a template"** (their résumé/assets carry over into the chosen template's slots).

---

## 9. Phasing

| Phase | Deliverable |
|---|---|
| **V1** | Site-document model + `_renderSiteDoc` + **preview==public HTML diff test** + legacy fallback |
| **V2** | Template gallery + all 8 templates + desktop/mobile hover preview + "start from template" |
| **V3** | Editor shell: iframe canvas + overlay, select/drag/resize/snap, inspector, undo/redo |
| **V4** | Add Elements panel + full element library (incl. galleries) |
| **V5** | Multi-page + nav menu + per-page SEO |
| **V6** | Mobile layout derivation + per-element mobile overrides/hide |
| **V7** | Migration path, EN/中文 i18n, polish, cross-browser/device pass |

**Scale, honestly:** V3+V4 are the heavy ones — a canvas editor is the biggest single thing in this codebase to date. This is several sessions of work, not one.

**Build strategy I recommend:** build v2 as a **separate tab alongside the current creator**, and cut over (removing the old one) at V6/V7 when it's genuinely better. Rationale: the current creator is **live for paying subscribers right now** — ripping it out on day one leaves Pro users with a half-built builder for the duration. Same end state you asked for, no broken window in between. *Say the word if you'd rather I delete the old one immediately and accept the gap.*

---

## 10. Decisions I need before writing code

1. **Page model (most important):** **sections + absolute elements inside them** (my recommendation, and what Wix actually does — gives freeform placement *and* reliable mobile), or hard whole-page pixel-absolute?
2. **Templates:** 8 as listed, or start with 4–6 to get it in your hands sooner?
3. **Placeholder imagery:** inline SVG/gradient art (my recommendation — self-contained), or do you want real photography (needs licensing + hosting)?
4. **Cutover:** build alongside and switch at V6/V7 (my recommendation), or replace immediately?
5. **Multi-page URLs:** confirm `/site/:name/:page`.

Answer those five and I'll start **V1** (document model + single renderer + the preview-parity test), since that's the piece that structurally fixes the Preview problem you called out as "fix that first."
