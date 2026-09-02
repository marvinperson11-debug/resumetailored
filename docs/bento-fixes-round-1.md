# Bento homepage — fixes round 1

All six requested changes applied to `public/index-bento.html`, committed and pushed to
`claude/resumetailored-bento-redesign-xzkv9z` on **PR #424**.

- **Commit:** `fix(bento): hover delay, scroll lock, svg stroke, copy tweaks` (`b4a5725`)
- **Updated live preview:** https://claude.ai/code/artifact/1b3546a1-3cd2-438f-a876-4056cc8b146b
- **Netlify deploy preview:** https://deploy-preview-424--mellow-macaron-463353.netlify.app/index-bento.html

---

## 1. Hover delay — fixed via `--reveal-delay` custom property ✅

**Root cause was deeper than the inline style alone.** Setting `el.style.transitionDelay`
inline applied the stagger delay (up to 480ms) to *every* transition on the element — and
because the cards are the reveal targets, that included the hover `transform`, so hovering a
just-revealed card lagged. Simply moving the number into a custom property isn't enough on
its own, because the entrance and the hover both animate `transform`, so any delay on a
shared `transform` transition still bleeds into hover.

So the fix does two things:

- **Entrance now uses the independent `translate` property + `opacity`** — never
  `transform`. Hover keeps `transform: translateY(-2px)`. They're separate CSS properties,
  so they no longer collide.
- **The stagger delay rides a `--reveal-delay` custom property that only the entrance
  transition legs read.** Hover (`transform`/`border-color`/`background`) carries no delay.

```css
/* entrance state (independent translate + opacity) */
.reveal   { opacity:0; translate:0 16px }
.reveal.in{ opacity:1; translate:0 0 }

/* non-card reveals (grid intro) */
.reveal:not(.bento-card){
  transition:opacity .6s ease-out var(--reveal-delay,0ms),
             translate .6s ease-out var(--reveal-delay,0ms);
}

/* cards fold the same entrance legs into their own transition, so hover
   (transform/border/background) is never delayed */
.bento-card{
  transition:border-color .2s ease-out, background .2s ease-out, transform .2s ease-out,
             opacity .6s ease-out var(--reveal-delay,0ms),
             translate .6s ease-out var(--reveal-delay,0ms);
}
```

```js
// was: el.style.transitionDelay = Math.min(i,8)*60 + 'ms';
el.style.setProperty('--reveal-delay', Math.min(i,8)*60 + 'ms');
```

The reduced-motion block was updated to reset `translate:none` (was `transform:none`).

> Note: the independent `translate` property is supported in all current browsers
> (Chrome 104+, Firefox 72+, Safari 14.1+). Older browsers simply skip the fade-up and show
> the card in place — hover still works.

## 2 & 6. Drawer scroll-lock + focus management ✅

The drawer function (`mMenu(open)` — the page's `openDrawer`/`closeDrawer` equivalent, and
what the markup's `onclick` handlers already call) now:

- **Locks body scroll** on open and restores it on close — the same
  `document.body.style.overflow = open ? 'hidden' : ''` pattern the login modal uses.
- **Moves focus to the close button on open**, and **returns focus to the hamburger on
  close** — but only when a drawer was actually open (guarded with `wasOpen`), so the global
  Escape handler can't yank focus to the hamburger when nothing is open.

```js
function mMenu(open){
  var m=document.getElementById('mMenu');
  var burger=document.querySelector('.hamburger');
  var wasOpen=m.classList.contains('open');
  m.classList.toggle('open',open);
  m.setAttribute('aria-hidden',open?'false':'true');
  if(burger)burger.setAttribute('aria-expanded',open?'true':'false');
  document.body.style.overflow=open?'hidden':'';
  if(open){ var close=m.querySelector('.m-menu__close'); if(close)close.focus(); }
  else if(wasOpen && burger){ burger.focus(); }
}
```

## 3. Hero arc stroke → `var(--gold)` ✅

The three `<circle>` strokes were hardcoded `#c9a227`. A `var()` **cannot** resolve inside an
SVG presentation attribute (`stroke="var(--gold)"` would silently render black), so the color
is driven from the token via a CSS rule instead, and the per-ring `stroke-opacity` /
`stroke-width` stay as attributes:

```css
.c-hero__arc circle{ stroke:var(--gold) }
```
```html
<circle cx="300" cy="300" r="252" stroke-width="1" stroke-opacity="0.5"/>
<!-- …no more hardcoded stroke="#c9a227" -->
```

## 4. Employer card copy ✅

`Portal · from $49/mo` → **`Portal · From $49/mo`**.

## 5. Pricing card — `Pro` wrapped in `<h3>` ✅

The pricing line is now a semantic heading (was a `<p>`), consistent with the `card-title`
`<h3>`s on the other cards. Existing `.price-sub b` styling (gold "Pro $19.00") is unchanged:

```html
<div class="price-big">Free to begin</div>
<h3 class="price-sub"><b>Pro $19.00</b> / month · Lifetime $129</h3>
```

---

## Verification

- Tag balance intact (div 33/33 · a 24/24 · article 3/3 · h3 8/8).
- No `transitionDelay` left in the JS; 7 `--reveal-delay` references present.
- No hardcoded `#c9a227` on the arc circles; CSS stroke rule present.
- CI on the branch was green before this push; PR #424 is being watched, so I'll surface any
  new CI or review activity here.

## Open question

Still happy to produce the **full drop-in `index.html`** (this bento body merged with the
current homepage's complete SEO/JSON-LD `<head>`) so it can replace the live page directly —
say the word and I'll add it to the PR.
