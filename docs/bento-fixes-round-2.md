# Bento homepage — fixes round 2 (dense mobile hero)

All hero changes applied to `public/index-bento.html`, committed and pushed to
`claude/resumetailored-bento-redesign-xzkv9z` on **PR #424**.

- **Commit:** `fix(bento): dense mobile hero — content-driven height, consolidated headline` (`2b87a38`)
- **Updated live preview:** https://claude.ai/code/artifact/1b3546a1-3cd2-438f-a876-4056cc8b146b
- **Netlify deploy preview:** https://deploy-preview-424--mellow-macaron-463353.netlify.app/index-bento.html

---

## What was actually causing the empty box

The void wasn't just a min-height. Two things stacked up:

1. **`.c-hero { justify-content: flex-end }`** — right for the tall 2-row desktop hero
   (content sits at the bottom), wrong on mobile.
2. **`.bento-card .eyebrow { margin-bottom: auto }`** — this is my code's equivalent of the
   `.hero__body` margin you flagged. On a flex column it shoves everything below the label to
   the bottom, opening a gap between the label and the rest.

And the hero card only held a *short* heading (`A private office for your ambitions.`) plus a
one-line desc — so even with the height fixed it would have read thin. Your directive #3
fixed that too: the hero now carries the real headline.

## 1. Mobile min-height → content-driven ✅

```css
@media (max-width:680px){
  .c-hero{ min-height:0; padding:22px; justify-content:flex-start }
  …
}
```
`min-height:0` + `flex-start` = the card is exactly as tall as its content.

## 2. `margin-bottom:auto` removed on mobile ✅

```css
.c-hero .eyebrow{ margin-bottom:0 }   /* was auto — the basement-void culprit */
```
With `justify-content:flex-start`, the label → H1 → body → CTA → meta now stack top-down with
normal gaps, no void.

## 3. Hero content consolidated ✅ (a small structural decision)

`Your next move, properly considered.` already lived in a **separate `.bento-intro` block
above the grid**, while the hero card held a *different* heading (`The Office` /
`A private office for your ambitions.`). Putting your requested content into the hero would
have duplicated the headline. So I **removed the standalone intro** and folded it into the
hero — the hero card is now the single, dominant headline. The hero now contains exactly:

```html
<article class="bento-card bento-card--lg c-hero reveal" aria-labelledby="bento-title">
  … gold arc svg …
  <span class="eyebrow">Career intelligence, privately delivered</span>
  <h1 class="card-title" id="bento-title">Your next move, <em>properly considered.</em></h1>
  <p class="card-desc">A private digital office for ambitious candidates and exacting
     employers — combining resume intelligence, cinematic presentation, and an editorial
     web studio.</p>
  <div class="hero-cta"> Begin — it's free →  ·  See how it works </div>
  <div class="hero-meta"> ★★★★★ · Anthropic Claude · 100+ ATS-ready templates · No card required </div>
</article>
```

- `properly considered.` is italic **gold** (`.c-hero .card-title em{color:var(--gold)}`),
  matching the accent treatment the old intro used.
- The `<section>`'s `aria-labelledby="bento-title"` now points at the hero `<h1>` (the page's
  single h1), so the accessible label still resolves.
- I kept the secondary **"See how it works"** quiet link — it lives inside the CTA row you
  specified and adds density rather than emptiness. Say the word if you'd rather it be
  gone and I'll drop it.
- Removed the now-orphaned `.bento-intro` CSS as well.

## 4. Tighter mobile padding + headline→body gap ✅

```css
.c-hero{ padding:22px }                 /* was 32px 26px */
.c-hero .card-title{ font-size:34px; margin:12px 0 12px }   /* 12px gap above & below */
.c-hero .card-desc{ margin-bottom:18px }                    /* compact gap before CTA */
```

---

## Verification

- Tags balanced (div 32/32 · a 24/24 · article 3/3 · **h1 1/1**). The single remaining
  `<h2>` is the login-modal heading — correct.
- `The Office` / `A private office for your ambitions.` fully removed; no orphan `hero-h`
  id or `.bento-intro` markup/CSS remain.
- Desktop hero is unchanged in feel (still `justify-content:flex-end`, content resting at the
  bottom of the tall 2-row card) — the fixes are scoped to `@media (max-width:680px)`, except
  the content consolidation which improves both.

## Note

There's a subtle desktop consequence worth a glance: with the intro removed, the grid now
starts right below the nav (the hero card is the first thing). That reads well in the preview,
but if you preferred the old page-title-above-the-grid on **desktop**, I can restore a slim
intro for ≥1000px only while keeping the hero self-contained on mobile — just let me know.

## Open question (still standing)

Happy to produce the **full drop-in `index.html`** (this bento body + the current homepage's
complete SEO/JSON-LD `<head>`) so it can replace the live page directly — say the word.
