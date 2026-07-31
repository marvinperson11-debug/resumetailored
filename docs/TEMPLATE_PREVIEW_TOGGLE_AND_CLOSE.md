# The template Preview: a dead toggle and a blank Close

Both fixed. **809 source assertions** and **241 browser assertions** at 1440px and 390px, 0 failures.

Both reproduced on the first measurement. Bug 2 turned out **not** to be mobile-only — it was blank at 1440px too, and I'd never have found that by trusting the DOM.

---

## First: which "Preview" this was

There are two in the Website builder, and I fixed the wrong one last round.

- **The editor's Preview** — the `Preview` button in the editor's top bar. That's what I fixed in #295.
- **The template card's Preview** — the `Preview` button on each card in the template gallery, which opens a modal with 🖥 Desktop / 📱 Mobile and a **Close** button.

You said *"instead of going back to the template picker"* and *"the X / Close button"*. That's the second one — the picker's own modal, which the last fix never touched. That's on me: I read "Preview page", fixed the preview I'd been working in, and didn't check there was another.

---

## Bug 1 — the device toggle. Same mistake, second modal.

Measured at 390px by tapping the real buttons:

```
                     frame width    page laid out at
opened                   326              326
tapped 📱 Mobile         326              326      ← identical
tapped 🖥 Desktop        326              326      ← identical
```

The cause is the same shape as last round's, in different code:

```js
f.style.maxWidth = mobile ? '390px' : '980px';   // frame is width:100%
```

Inside a phone-sized modal the container is about **326px**. Both caps — 390 and 980 — sit *above* 326, so **neither one binds**. The frame is 326px either way and the page inside it is the same page. Only the highlight moved.

At 1440px the caps do bind (980 ↔ 390), which is why it only ever looked broken on a phone.

**Fixed the same way:** the page is laid out at the device's real width and scaled to fit — 390 for the phone, at least 1000 for desktop so your site's own `max-width: 820px` rules can't be what's in force in both views.

```
390px phone, modal stage 326px

                  laid out at   drawn at   scale
🖥  Desktop           1000         326      0.326
📱  Mobile             390         326      0.836
```

Two genuinely different documents. On your phone, Desktop now shows the wide hero and the three-column stats row shrunk down; Mobile shows the stacked phone layout at readable size.

## Bug 2 — Close showing a blank page. Not mobile-only.

Reproduced exactly: tap Close, get an empty dark screen.

And here is the part worth recording. At the moment the screen was blank, the page reported:

```
modal:       none          ← closed correctly
tiles:       12            ← all twelve templates present
panelActive: true          ← the website panel is the active tab
url:         /dashboard    ← no navigation, nothing crashed
```

Every internal signal said "the gallery is fine". So I asked what was actually under the middle of the screen:

```
elementFromPoint(centre) → wcEdStage        ← the empty editor canvas
#cvPanel                 → display: none    ← the gallery, hidden
```

**The gallery had been hidden while the modal was open.** This did it:

```js
// Clicking the page itself retracts whatever is open.
document.addEventListener('click', (ev) => {
  if (!cvOpenPanel) return;
  const t = ev.target;
  if (t.closest && (t.closest('.cv-panel') || t.closest('.cv-rail'))) return;
  cvClosePanel();
});
```

In the picker, the gallery **is** `#cvPanel`. The template preview modal is a sibling of the editor shell, not a descendant of `.cv-panel` — so **every tap inside that modal counted as "clicked the page"**. Tapping the device toggle retracted the gallery. Tapping Close retracted it and then closed the modal, revealing a shell whose panel was now hidden, whose rail and canvas are hidden by `wb-picker`, and nothing else.

A completely blank webpage — assembled entirely out of things that were individually behaving correctly.

**Two fixes, because there are two separate reasons:**

1. **In the picker the gallery is not a drawer**, it's the page. It is never retracted there.
2. **A click inside anything floating above the editor is not a click on the editor.** Rather than a list of modal ids that the next modal falls off, this walks up looking for a `position: fixed` ancestor stacked above the shell (z-index 200). Every modal in the app is covered, including ones added later.

## Two things I checked and ruled out

- **A stale copy on your phone.** `app.html` is served `Cache-Control: no-cache`, so it revalidates on every load. Your phone was running the new code; the toggle you were tapping was a different one.
- **Bug 2 being about phones.** It isn't. `#cvPanel` was `display: none` after Close at **1440px** as well. You found it on a phone; it was broken everywhere.

## The checks that now exist

Both are in the browser suite, at 1440px **and** 390px, and both press the real controls:

- The template preview's toggle is measured on **the layout width of the page inside the frame** — the frame is 326px either way, so its own width proves nothing. Desktop must also be over 820px, so it can't quietly become a phone preview again.
- After Close, the gallery must be **what is under the middle of the screen** (`elementFromPoint`), with a card of non-zero size. Asserting "the panel is not hidden" would have passed while the screen was blank, because that is exactly the state the bug produced everywhere except on screen.

## What I changed

- `public/app.html` — `wcTplDevice` lays out at the device width and scales to fit; `#wcTplBox` added to carry the scaled size; the modal is shown before it is measured (a stage inside `display:none` measures 0); the click-outside handler exits in the picker and inside any overlay.
- `test/browser/editor.js` — the four toggle checks and the two Close checks above.
- `test/site-publish.js` — source assertions pin the new sizing, the show-then-fit order, and both click-outside guards.

## One question

The modal's header wraps onto three rows on a phone — title, then the toggle and Close, then **Use this template →** — which leaves roughly the bottom half of the screen for the actual preview. It works, and it wasn't what you reported, so I left it alone.

**Want me to tighten that header on phones** so more of the screen is the template you're looking at? It'd be a small, contained change.
