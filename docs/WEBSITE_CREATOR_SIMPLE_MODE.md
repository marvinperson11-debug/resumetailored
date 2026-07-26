# Website Creator — simple mode

Your spec, checked against the code. One hard blocker (still yours), four questions (all answered), then the build order.

---

## 1. The blocker: custom subdomains (your item 9)

I need to be straight with you here, because this one isn't a code fix.

**What the code already does.** `PERSONAL_SITE_HOST_RE` in `server.js:330` is a middleware that maps `alice.resumetailored.com` → that user's site. It's written, it's correct, and it runs before everything else. I tested the logic.

**Why your links don't use it.** Every link the app generates is built as `window.location.origin + '/site/' + subdomain` — nine places in `app.html` (lines 6411, 6442, 6712, 7048, 7702, 7705, 7770 …). None of them ever produces a subdomain URL.

**But changing that alone would break every link.** The middleware is inert, and will stay inert, until two things exist that I cannot create from here:

1. A wildcard DNS record `*.resumetailored.com` pointing at the Railway app.
2. `*.resumetailored.com` added as a custom domain in Railway, so it issues a **wildcard TLS certificate**.

Without #1, `alice.resumetailored.com` doesn't resolve — the browser fails before it reaches us. Without #2, it resolves but throws a certificate warning, which on a page you're sending to recruiters is worse than an ugly URL.

This is documented in `docs/RAILWAY_SETUP.md` §9, and it's a dashboard/DNS task on your side. Ten minutes, but it's yours.

**What I'll do about it.** I'll make the app read its public-URL shape from one env var:

```
SITE_PUBLIC_HOST=resumetailored.com   # unset → keep /site/:name links
```

The server becomes the single source of truth for a site's public URL and hands it to the client, replacing all nine hand-built strings. Set the var once DNS and TLS are live and every link, QR code, share sheet and canonical tag switches over at once. Leave it unset and nothing changes.

I'll also fix two things I found in the host middleware while reading it:

- It only handles `req.path === '/'`, so a **multi-page site's nav links break out of the subdomain** — page two lands on `alice.resumetailored.com/site/alice/work`. It works, but the URL is nonsense.
- It doesn't pass `baseUrl`, so links inside the page are built against the wrong origin.

Both are worth fixing now so the switch is clean when you flip it.

---

## 2. Four questions — all answered

All four are settled and built. Kept here as the record of what was decided and why.

### Q1 — "Already live" vs. the Publish button — **ANSWERED: private until they press publish**

Item 1 said the user lands on a site that's **already live**; item 4 ended with a **Publish!** button. You've settled it: **private until they press publish.** Built and shipped.

What that means concretely:

- The auto-generated site is created as a draft. `/site/<name>` returns **404** until they publish — not a hidden-but-guessable page, genuinely not served.
- Simple mode shows a **PRIVATE** badge and reads *"Only you can see it until you publish."*
- One green **Publish my website** button. Once live it's replaced by the link itself.

The part worth knowing: I made this **structural rather than conventional**. `POST /api/personal-site` used to default to publishing when no flag was sent, so a single forgetful call site would have exposed a private site. Now:

| Request | Result |
|---|---|
| No `publish` flag, existing site | **Preserves** whatever it already is |
| `publish: true` | Goes live |
| `publish: false` | Comes down |

Auto-save sends no flag. So it can neither expose a private site nor take a live one down — going public is only ever something the user asked for. Three tests hold that in place.

**Auto-save came with it** (your item 5, brought forward). There's no Save button: edits persist about a second after you stop, and flush on Done Editing and on leaving the page. Without it, "private until publish" would have meant every draft edit was silently lost.

### Q2 — Photo licensing — **ANSWERED: source CC0**

Done. Five photographs, all **CC0 or public domain**, sourced from Wikimedia Commons where the licence is stated on the file page and can be checked:

| Vibe | Licence | Source |
|---|---|---|
| Sunset Glow | CC0 | *Sunset sky water* |
| Forest Canopy | Public domain | *A view up at an old growth canopy trees* (US Fish & Wildlife) |
| City Lights | CC0 | *City Lights at Night* |
| Ocean Breeze | CC0 | *Sky Clouds Sea* |
| Mountain Peak | CC0 | *Imposing mountain under snow* |

Every one is recorded in **`public/vibes/CREDITS.md`** with its licence, source link and author — none of these require attribution, but provenance for anything shipped on a paying customer's site shouldn't be a matter of memory.

They're **self-hosted, not hotlinked**, at 1200px wide. One image loads per published site: 104–478 KB. A test asserts each file exists, is under 600 KB, and is actually served — a missing one would render as a blank band on someone's live page.

**Readability is structural, not per-vibe.** Every photo hero gets a darkening scrim in the renderer plus a text shadow, and the lighten/darken control moves the scrim within a range that never goes light enough to lose contrast.

### Q3 — Vibes vs templates — **ANSWERED: re-skin**

`applyVibe` changes colour, background and text contrast on **whatever the user already has**. Sections, wording and uploaded photos are untouched. The 12 templates stay as the structures the generator picks from; a beginner never sees the word "template".

Two things that guarantee it's safe to click:

- **It loses nothing.** Tests assert every word, every section, every element id and every uploaded image survives all ten vibes.
- **It's repeatable, not cumulative.** Clicking through all ten and landing on the last gives byte-identical output to clicking that one first. Someone *will* try them all.

One deliberate exception: an element carrying `lockColor` keeps its colour, so a deliberate brand choice isn't overwritten.

The failure mode I built around: a `#ffffff` heading left over from a dark vibe becomes invisible on a light one. Contrast is recomputed per section from measured luminance, not guessed.

### Q4 — Phones — **ANSWERED: simple mode works on phones; pop-up removed**

The desktop gate is gone — markup, styles, strings and all call sites.

On a phone, **Customize My Site** opens the vibe picker rather than a drag canvas: ten large targets, two per row, thumbnails showing the real photo. Verified end to end at 390×844 — lands on the site, opens the picker, applies Sunset Glow with its overlay.

**This turned up an app-wide bug.** `.toast` is `position:fixed`, `z-index:9999`, and on phones spans the full width at `bottom:70px` — with no `pointer-events:none`. While invisible it was swallowing taps on anything beneath it, **anywhere in the dashboard**, not just here. Any bottom-anchored button on a phone was dead. One line to fix.

The drag-and-drop editor still opens only on a wider screen — but that's now a consequence of which control you reach for, not a wall in front of the feature.

---

## 3. Two things I want to flag, not ask about

**The three-panel editor isn't going away, it's being demoted.** Everything I built over the last few rounds — drag-and-drop, pages, mobile overrides, the element library — stays. It just stops being the front door. A beginner never sees it; someone who wants it clicks past the simple flow. I'm not deleting work, and I'm not going to argue for keeping it in the user's face.

**"Add Music" is in your bottom strip and I'd push back on one detail.** Auto-playing audio on a page a recruiter opens at their desk is the single fastest way to get a tab closed. I'll build it, but muted by default with a visible play control, and I'll label it "Add background music (visitors press play)" so nobody is surprised. Tell me if you want true autoplay and I'll do it.

---

## 4. Build order

Starting with item 1 as you asked and working outward. Each phase ships independently.

| Phase | What lands |
|---|---|
| **1** | Full-screen public view as the default state. Auto-generate a site from the most recent saved resume + cover letter on first open. One floating **✏️ Customize My Site** button, one subtle top line. Zero chrome. |
| **2** | Edit mode: click-it-to-change-it inline editing (name, photo, section move/delete with floating controls), slim top bar with **Done Editing**. Sidebar and right panel start collapsed. |
| **3** | ~~The 10 Vibes~~ **done** — one-click apply, lighten/darken, readability overlay, CC0 photography. |
| **4** | The bottom strip conversation — one question at a time, skip and back on every step, ending in Publish. |
| **5** | ~~Auto-save~~ **done** — shipped alongside the publish decision. Still to add: the inline **↩️ Undo** that appears where they acted and fades after 5s. (The undo engine already exists — this is surfacing it, not building it.) |
| **6** | **💬 Not sure?** helper that jumps straight to the right control. |
| **7** | Subdomain URLs behind `SITE_PUBLIC_HOST`, plus the two middleware fixes above. |
| **8** | Full 中文 across every new string. |

I'm treating your critical rules as constraints on all of it: no technical words, every button says what it does, never more than five or six choices on screen.

**Phase 1 is done and pushed**, along with auto-save and publishing. I'll come back when it's on the branch and you can click it.

---

## 5. One housekeeping item

**PR #270 is still open as a draft** — the desktop-feedback fixes and the 12 templates. This work builds on the same branch, so it'll stack on top. Merge #270 whenever you like; nothing here depends on you doing it first.
