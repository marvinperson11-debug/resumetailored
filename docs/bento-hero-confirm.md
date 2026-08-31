# Hero card — structure for your confirmation (NOT yet committed)

The file `public/index-bento.html` is saved and verified. **No commit has been made** —
per your instruction, I'll wait for you to confirm the structure below first.

## Important: the screenshot is a stale version

The chip at the top of your screenshot reads **"fixes-round-1"** — that's an older version
in the artifact's version picker, so it's showing the round-1 layout (intro headline *above*
the grid, plus the old "THE OFFICE / A private office for your ambitions." hero). The
current file on disk does **not** contain that. If you reopen the artifact it defaults to the
latest version; the version dropdown lets you pick "fixes-round-1" vs the newer ones.

- Reliable live view of the current file: the Netlify deploy preview (rebuilds from the
  branch), once I commit: https://deploy-preview-424--mellow-macaron-463353.netlify.app/index-bento.html

## Exact hero `<article>` on disk right now

```html
<!-- HERO · 6 × 2 -->
<article class="bento-card bento-card--lg c-hero reveal" aria-labelledby="bento-title">
  <!-- Decorative gold arc — low-opacity SVG, hero card only -->
  <svg class="c-hero__arc" viewBox="0 0 600 600" fill="none" aria-hidden="true" focusable="false">
    <circle cx="300" cy="300" r="252" stroke-width="1" stroke-opacity="0.5"/>
    <circle cx="300" cy="300" r="190" stroke-width="1" stroke-opacity="0.32"/>
    <circle cx="300" cy="300" r="128" stroke-width="1" stroke-opacity="0.18"/>
  </svg>
  <span class="eyebrow">Career intelligence, privately delivered</span>
  <h1 class="card-title" id="bento-title">Your next move, <em>properly considered.</em></h1>
  <p class="card-desc">A private digital office for ambitious candidates and exacting employers — combining resume intelligence, cinematic presentation, and an editorial web studio.</p>
  <div class="hero-cta">
    <a class="btn-gold" href="/dashboard">Begin — it's free <span aria-hidden="true">→</span></a>
    <a class="btn-quiet" href="/how-it-works">See how it works</a>
  </div>
  <div class="hero-meta">
    <span class="stars" aria-hidden="true">★★★★★</span>
    <span>Anthropic&nbsp;Claude</span>
    <span class="dot" aria-hidden="true">·</span>
    <span>100+ templates</span>
    <span class="dot" aria-hidden="true">·</span>
    <span>No card required</span>
  </div>
</article>
```

Order matches your spec exactly: arc SVG → label → H1 → body → CTA row (Begin + See how it
works) → meta.

## Checklist vs your request

| # | Requirement | Status |
|---|---|---|
| 1 | No headline/label element above the grid | ✅ removed (`.bento-intro` gone; grep confirms) |
| 2 | "THE OFFICE" / "A private office for your ambitions." removed from hero | ✅ gone (only other "office" strings are a CSS comment, the drawer's "Explore the office", and the CTA card's "Step inside the office.") |
| 3 | Hero contains only the 6 listed items, in order | ✅ (see article above) |
| 4 | Mobile `min-height:0 !important` | ✅ |
| 4 | Mobile `justify-content:flex-start !important` | ✅ |
| 4 | No `margin-bottom:auto` on any hero child | ✅ `.c-hero > *{margin:0!important}` neutralizes all child margins |
| 4 | Padding 22px | ✅ |
| 4 | 12px gap between elements | ✅ via `.c-hero{gap:12px}` (flex column gap) |

## Exact mobile CSS now in the file

```css
@media (max-width:680px){
  …
  .c-hero{
    min-height:0!important;
    justify-content:flex-start!important;
    padding:22px;
    gap:12px;
  }
  .c-hero > *{margin:0!important}
  .c-hero .card-title{font-size:34px}
  …
}
```

## Verification run (all pass)

```
THE OFFICE (real hero) present : false   (only "Explore the office" / CTA / comment remain)
A private office for present    : false
bento-intro present             : false
meta "100+ templates"           : true
min-height:0!important          : true
justify-content:flex-start!imp. : true
.c-hero > * margin reset        : true
gap:12px                        : true
padding:22px                    : true
```

## Waiting on you

Reply **"confirmed"** (or note any change) and I'll commit + push to PR #424. Until then the
working tree holds the change uncommitted.

### One question
Your spec keeps **"See how it works"** in the CTA row — good, it's there. Only flag if you
later want it dropped.
