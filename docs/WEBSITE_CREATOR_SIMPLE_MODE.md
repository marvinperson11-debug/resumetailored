# Website Creator — simple mode

Your spec, checked against the code. One hard blocker, four questions, then the build order.

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

## 2. Four questions

Only asking where a wrong guess means building the wrong thing.

### Q1 — "Already live" vs. the Publish button

Item 1 says the user lands on a site that's **already live**. Item 4 ends with a big green **Publish!** button. Those can't both be true, and the difference matters: a live site is a public, indexable page carrying someone's name, employer history and email.

I'm not willing to publish that on a user's behalf without them pressing something. My recommendation:

> **Generate it instantly, show it full-screen, but keep it private until they press Publish.** The top line becomes "This is your personal website — only you can see it until you publish." The experience is identical; the difference is that nothing reaches Google until they say so.

Tell me if you want true auto-publish and I'll do it, but I wanted you to make that call rather than me.

### Q2 — Photographic vibes and image licensing

Five of your ten vibes want real photos (Sunset Glow, Forest Canopy, City Lights, Ocean Breeze, Mountain Peak). I can't ship photos I don't have rights to, and I won't hotlink someone else's CDN into a product you charge for.

Three ways to do this:

| Option | What it looks like | Cost |
|---|---|---|
| **A. Source CC0 photos** (Unsplash/Pexels licence), self-host them | Genuine photographs, exactly what you described | ~5 × 200–400 KB bundled; I pick and you approve each |
| **B. Generated scenic backgrounds** — layered mesh gradients + SVG | Reads as atmospheric, not literal. "Sunset Glow" works beautifully; "Forest Canopy" less so | Zero licensing risk, ~2 KB each, instant load |
| **C. Let the user supply the photo** per vibe | Their own photo, full-bleed | Needs an upload step, which fights "under 3 minutes" |

**My recommendation: A, with B as the fallback shipped first** — so the vibes exist and work immediately, and I swap in real photos once you've okayed a specific set. Sunset/Ocean/City look genuinely good generated; Forest and Mountain really do want a photo.

Either way the readability rule you specified (automatic overlay + text shadow) is handled in the renderer, not per-vibe.

### Q3 — Do Vibes replace the 12 templates?

I just shipped 12 starter templates. Your spec says "replace themes with 10 Vibes."

Those are different axes: a **template** is the structure (what sections, in what order); a **vibe** is the look (colours, background, type). Right now they're welded together — each template hard-codes its own palette.

My reading is that you want **vibes to be the only thing a beginner sees**, with templates behind the scenes. So:

> One click on a vibe re-skins **whatever structure they already have**. The 12 templates stay as the structures that the auto-generator picks from, but a first-time user never sees the word "template."

Confirm, or tell me the templates should go away entirely.

### Q4 — Does simple mode work on phones?

Last time you were clear: *"This is a desktop feature."* That was about dragging elements on a large canvas — correct then, and the gate is still right for the advanced editor.

But **this** flow — tap a section, tap a vibe, tap Publish — is genuinely fine on a phone, and a lot of people will open their site link on their phone and want to fix one thing.

> **Recommendation: let simple mode run on phones. Keep the drag-and-drop editor desktop-only.** The gate stops being "you can't use this feature here" and becomes "the advanced editor needs a bigger screen" — shown only if they reach for it.

Say the word if you'd rather keep the whole thing desktop-only; it's less work, not more.

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
| **3** | The 10 Vibes, one-click apply, Lighten/Darken slider, readability overlay. |
| **4** | The bottom strip conversation — one question at a time, skip and back on every step, ending in Publish. |
| **5** | Auto-save with the inline **↩️ Undo** that appears where they acted and fades after 5s. (The undo engine already exists — this is surfacing it, not building it.) |
| **6** | **💬 Not sure?** helper that jumps straight to the right control. |
| **7** | Subdomain URLs behind `SITE_PUBLIC_HOST`, plus the two middleware fixes above. |
| **8** | Full 中文 across every new string. |

I'm treating your critical rules as constraints on all of it: no technical words, every button says what it does, never more than five or six choices on screen.

**Phase 1 is in progress now.** I'll come back when it's on the branch and you can click it.

---

## 5. One housekeeping item

**PR #270 is still open as a draft** — the desktop-feedback fixes and the 12 templates. This work builds on the same branch, so it'll stack on top. Merge #270 whenever you like; nothing here depends on you doing it first.
