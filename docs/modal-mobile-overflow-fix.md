# Modal Overlay — Mobile Overflow & Stuck-State Fix

**Branch:** `claude/modal-mobile-overflow-fix-gc0ept`
**File changed:** `public/css/app.css`
**Date:** 2026-08-26

---

## 1. Problem, as reproduced in the code

The affected popups are the app's overlay modals — the **Auth** modal, the
**"What's New"** promo modal, and the **"New Tools"** (Pro-plan) modal. All three
share the `.auth-overlay` backdrop class defined in `public/css/app.css`, and
each card carries its close **×** as `position:absolute; top:14px; right:16px`.

### Root cause

The overlay is a flexbox that centers its card:

```css
.auth-overlay { display:flex; align-items:center; justify-content:center; padding:24px; }
```

When a card is **taller than the viewport**, a flex child aligned with
`center` (or, on mobile, `flex-end`) has its **top edge clipped**, and — this is
the key part — **the clipped region is unreachable**, because the *overlay itself
had no scroll* (only the card scrolled internally). The card's `×` lives at the
very top of that clipped region, so it disappeared past the top of the screen
with no way to reach it. That is the "renders partially off-screen at the top /
impossible to dismiss" symptom.

Mobile made it worse in two specific ways:

1. The `@media (max-width:480px)` rule switched the overlay to
   `align-items:flex-end` (bottom-sheet), which pushes **all** overflow upward —
   straight past the top edge.
2. `#newToolsOverlay` is deliberately shortened with
   `bottom: calc(62px + env(safe-area-inset-bottom))` so the app's bottom bar
   stays tappable. That makes the overlay region *shorter than the viewport*, so
   an 88vh card overflowed its top even more readily, and nothing accounted for
   the notch/status-bar **safe-area** at the top.

The tall grid modals ("What's New" has 3 cards, "New Tools" lists 7 tools) are
exactly the ones that exceed the viewport on a phone, which is why they were the
ones reported.

---

## 2. The fix

All changes are in `public/css/app.css` — no HTML or JS changes were needed, so
the fix applies to every modal that uses `.auth-overlay`.

### 2a. Scroll-safe centering on the overlay (base rule)

```css
.auth-overlay {
  display: flex; justify-content: center;
  align-items: center;
  align-items: safe center;                 /* progressive: ignored where unsupported */
  overflow-y: auto; overscroll-behavior: contain;
  padding: 24px;                            /* fallback */
  padding: max(24px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom));
}
.auth-card { … max-height: 92vh; overflow-y: auto; margin: auto; }
```

- **`align-items: safe center`** — a card that fits is centered; a card that is
  too tall overflows toward the **bottom** and never clips its top, so the `×`
  stays reachable. Browsers that don't understand `safe center` fall back to the
  plain `center` on the line above.
- **`overflow-y: auto` on the overlay** — the whole card (its `×` included) can
  now be scrolled into view; the overlay is the scroll container, not just the
  card. This is the real "can never get stuck" guarantee.
- **`margin: auto` on `.auth-card`** — the classic flexbox technique that centers
  a scrollable child without clipping either edge, complementing `safe center`.
- **Safe-area padding** — `env(safe-area-inset-top/bottom)` keeps the header and
  close control clear of the notch / status bar, with a flat `24px` fallback.

### 2b. Phone bottom-sheets are height-capped (`@media max-width:480px`)

The bottom-sheet design is intentionally preserved, but every card is now capped
to the height **actually available**, so a `flex-end` sheet can no longer push its
top off-screen:

```css
.auth-card {
  border-radius: 16px 16px 0 0; max-width: 100%; margin: 0;
  max-height: 90vh; overflow-y: auto;                       /* fallback */
  max-height: calc(100dvh - env(safe-area-inset-top) - 8px);
}

#whatsNewOverlay > div {
  max-height: calc(100vh - 16px);                           /* fallback */
  max-height: calc(100dvh - env(safe-area-inset-top) - 12px);
  padding-top: max(26px, calc(env(safe-area-inset-top) + 8px));
}

/* The New Tools overlay is shortened by the 62px bottom bar, so subtract it too */
#newToolsOverlay > div {
  max-height: calc(100vh - 78px);                           /* fallback */
  max-height: calc(100dvh - 62px - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 12px);
  padding-top: max(26px, calc(env(safe-area-inset-top) + 8px));
}
```

- **`100dvh`** (dynamic viewport height) is used so the math is correct even while
  the mobile browser's URL bar is shown/hidden; a `100vh` line precedes each one
  as the fallback for older browsers.
- **`margin: 0`** is restored on the mobile `.auth-card` so the base rule's
  `margin:auto` doesn't fight the sheet's flush-to-bottom anchoring.

### 2c. Close control pinned while scrolling

So the `×` stays on-screen even after the user scrolls the tall list:

```css
#whatsNewOverlay > div > button[onclick],
#newToolsOverlay > div > button[onclick] {
  position: sticky !important; top: 0; float: right;
  z-index: 3; margin: -8px -8px 0 0;
}
```

`!important` is required only here because these buttons carry inline
`position:absolute` styles that would otherwise win the cascade.

### 2d. Dismissibility & stacking (already correct — verified)

- **Backdrop click**: each overlay keeps `onclick="if(event.target===this)…"`.
  With the overlay now the scroll container, the padding/backdrop area still
  reports `event.target === overlay`, so a tap outside the card reliably
  dismisses it.
- **z-index / stacking**: the overlay stays at `z-index:9999`; the sticky close
  button sits at `z-index:3` **within** the card's stacking context, so no child
  escapes its parent.

---

## 3. Requirements checklist (from the task)

| Requirement | Status | How |
|---|---|---|
| Parent modal `max-height: 90vh/dvh` + `overflow-y:auto` | ✅ | Cards capped with `dvh`-aware `max-height`; overlay also scrolls |
| Center dynamically with flexbox (`align-items/justify-content: center`) | ✅ | `justify-content:center` + `align-items: safe center` (scroll-safe) |
| Top padding/margin for `env(safe-area-inset-top)` | ✅ | Overlay padding + per-card `padding-top` use `env(safe-area-inset-top)` |
| Header/close controls stay within viewport bounds | ✅ | Height caps + `position:sticky` close button |
| Backdrop click reliably dismisses | ✅ | `event.target===this` handler intact; overlay is the click/scroll surface |
| z-index stacking keeps children inside parents | ✅ | Overlay `9999`, sticky close `z-index:3` within the card |

---

## 4. How to verify manually

1. Open the app on a phone (or Chrome DevTools device mode, e.g. iPhone 12 /
   Pixel 7, and a short **landscape** viewport where the bug was worst).
2. Tap **New Tools** in the sidebar → the sheet opens with the **×** visible at
   the top-right; scroll the 7-tool list → the **×** stays pinned and tappable.
3. Confirm the app's bottom bar remains visible/tappable below the New Tools
   sheet (that behavior is preserved).
4. Tap **What's New** and the **Auth** modal → same: top and close never clip,
   tapping the dimmed backdrop closes each one.

No automated test covers modal layout (the `test/*.js` suite targets the
Website Creator document model), so this was verified by code inspection against
the reproduced root cause plus the manual steps above.
