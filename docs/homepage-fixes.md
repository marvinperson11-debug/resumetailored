# Homepage fixes (`public/index.html`)

Committed as `c02a273` on `claude/resumetailored-bento-redesign-xzkv9z` (PR #424).
Message: `fix(homepage): spacing, remove empty section, collapse samples, dedupe pricing`.
The Bento Grid file (`public/index-bento.html`) was **not** touched.

Netlify preview (rebuilds from this push, ~1 min):
https://deploy-preview-424--mellow-macaron-463353.netlify.app/

---

## 1. Headline spacing — already correct in source (no change)

The hero `<h1>` (line ~1229) already contains a real space (`&nbsp;`) between **every**
word:

```html
<span class="word-animate">Your</span>&nbsp;<span class="word-animate">resume,</span><br />
<span class="word-animate blue">perfectly</span>&nbsp;<span class="word-animate blue">tailored</span><br />
<span class="word-animate">to</span>&nbsp;<span class="word-animate">every</span>&nbsp;<span class="word-animate">job.</span>
```

A grep for `Yourresume` / `perfectlytailored` finds **nothing** — the run-together string
doesn't exist in the file. It renders as *"Your resume, perfectly tailored to every job."*

**Why I didn't "fix" it:** there's nothing to fix, and editing it would risk a regression —
the language-switcher (`RETRANSLATE` array) matches this exact markup to swap EN/中文, and
`&nbsp;` is deliberately more robust than a normal space (a plain space between
`display:inline-block` words can collapse; `&nbsp;` never does). The run-together you saw is
almost certainly a **stale/cached deploy** (this branch hasn't been deployed to production).
A hard refresh of the Netlify preview should show correct spacing. If you still see it broken
there, tell me and I'll dig into the live render.

## 2. "What's New" section — has content (kept, per your rule)

`#whats-new` is a full grid of promo cards (Employer Portal, Resume Video, Personal Website,
AutoApply, Career Hub, Offer Comparison, JD Decoder, Salary Negotiation, A/B Tracker, …).
Your instruction was *"remove … if there is no content below it. If content exists, leave
it."* → content exists, so it was **left untouched**.

## 3. Career-Levels samples — collapsed into a mobile carousel ✅

The three tier cards (Basic / Professional / Executive) stacked to ~1500px on a phone. On
`max-width: 680px` the `.tiers-grid` is now a **horizontal, scroll-snapping carousel**
(swipe through cards, ~one card tall instead of three):

```css
@media (max-width: 680px) {
  .tiers-grid {
    display: flex; grid-template-columns: none; flex-wrap: nowrap;
    overflow-x: auto; -webkit-overflow-scrolling: touch;
    scroll-snap-type: x mandatory; gap: 16px; max-width: none; margin: 0;
    padding-bottom: 6px; scrollbar-width: none;
  }
  .tiers-grid::-webkit-scrollbar { display: none; }
  .tiers-grid > .tier-card { flex: 0 0 82%; scroll-snap-align: center; }
  /* touch has no hover — show the "View Full Sample" pill without hiding the preview */
  .tier-preview-frame .tier-overlay { opacity: 1; background: transparent; align-items: flex-end; padding-bottom: 10px; }
}
```

Each card still opens its full sample on tap (`openTierModal`), and the **"👁 View Full
Sample"** pill is now visible on touch (previously hover-only). Desktop is unchanged.
(Note: `.tier-preview-frame` was already capped at `height:200px; overflow:hidden`, so the
preview mockups themselves weren't the overflow — the three stacked cards were.)

## 4. Pricing duplication — removed "Clear terms. No theatre." ✅

The `#ecosystem-pricing` section ("Clear terms. No theatre.") duplicated the
**Free / Pro $19.00 / Lifetime $129** pricing already shown in the Career-Levels section, so
it was removed. The **"How we compare to Jobscan & Rezi"** comparison table near the bottom
was **kept** (untouched).

⚠️ **One thing to confirm:** that section also carried the **employer** tiers — Employer
Portal $49, Scale $99, Corporate $299 — which don't appear elsewhere on the homepage (they
live on `/for-employers` and `/pricing`, and Portal $49 is also in the "What's New" card).
If you want the employer tiers to stay on the homepage, tell me and I'll re-add just those as
a compact strip instead of the full duplicate block.

## 5. Mobile section padding — reduced to 44px ✅

Section vertical padding on phones was reduced into your 40–50px target:

- `≤680px`: `.section { padding: 44px 0; }` (new)
- `≤480px`: `.section { padding: 56px 0; }` → `44px 0`

Desktop stays at `84px`. (The `#whats-new` section has its own inline `padding:60px 0`, which
an external rule can't override; it's already tighter than the 80–100px default, so I left it.
Say the word if you want that one reduced too.)

---

## Verification

- `<section>` tag balance unchanged by my edit (HEAD was 17/16; still 16/15 after a balanced
  removal — the pre-existing off-by-one is a `<section` substring elsewhere, not introduced
  here).
- No `class="club-price-architecture"` / `id="ecosystem-pricing"` markup remains (only an
  explanatory comment + an unused i18n dict entry).
- Comparison table intact.
- Bento file untouched.

## Open questions
1. Do you want the **employer tiers** (Portal/Scale/Corporate) re-added to the homepage as a
   compact strip? (Removed with the duplicate pricing block.)
2. Should the **"What's New"** section's own `60px` mobile padding also be reduced to ~44px?
