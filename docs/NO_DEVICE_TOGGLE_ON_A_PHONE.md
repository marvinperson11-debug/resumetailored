# No device toggle on a phone, and all twelve templates checked

Built. **891 source assertions** and **264 browser assertions** at 1440px and 390px, 0 failures.

---

## 1. The toggle

| | Editor Preview | Template card Preview |
|---|---|---|
| **≤820px** | toggle gone; **← Back to editing** and **Publish** stay | toggle gone; **Close** and **Use this template →** stay |
| **>820px** | unchanged | unchanged |

Measured by asking the browser what is on screen:

```
              editor toggle    template toggle
390px         display:none     display:none      ← and not occupying any space
1440px        display:flex     display:flex      ← and still switching 1126 ↔ 390
```

### Hidden *and* pinned, not just hidden

Below 820px the device is now forced to **desktop**, not merely left wherever it was. Two reasons, both of which bite:

- **A control you cannot see cannot undo the state it left behind.** Set Mobile on a laptop, narrow the window, and the toggle disappears with the preview stuck on a setting you now have no way to change.
- **"Mobile" on a phone was never the right render anyway.** It lays the page out at 390px inside a frame that is itself ~334px wide — the site scales itself to 390, then the preview scales that again. What you actually want, and what a visitor gets, is the published layout: laid out at 1000 and scaled once.

So there's one function, `_pvDeviceLocked()`, and everything that reads the device reads it: the editor preview, the template preview, and the editor canvas. There's also a resize handler that snaps the device back when a window is dragged below the breakpoint — the state leaves with the buttons.

The tests confirm the pin holds by **pressing the hidden button anyway** and asserting nothing moves.

### It also removes the canvas toggle on a phone — confirmed as wanted

The same two buttons drove the **editor canvas** device view, not just the preview. Hiding them on a phone removes that too, so the canvas is always the desktop view there.

Keeping the canvas toggle while hiding the preview one would let someone set Mobile in the editor, switch to Preview, and meet the double-scaled render with no visible control explaining it. The same reasoning applies to the canvas anyway: the layout is preserved now, so its phone view showed the same design at a smaller size.

**Decided: it stays removed.** No device toggle anywhere on mobile — not in Preview, not in the canvas. A phone always shows the desktop layout scaled to fit.

## 2. All twelve templates at phone width

Every template rendered at 390px and compared against **its own** desktop render, not against a constant:

```
id             els(p/d)  secs  side-by-side  clipped-R  clipped-B  h-scroll
executive      17/17      4       3/3            0          0        no
minimal        10/10      3       0/0            0          0        no
graduate       19/19      5       3/3            0          0        no
academic       14/14      4       3/3            0          0        no
grid-portfolio 14/14      4       2/2            0          0        no
studio         13/13      4       1/1            0          0        no
bold           13/13      4       2/2            0          0        no
showreel       16/16      4       3/3            0          0        no
developer      21/21      5       4/4            0          0        no
consultant     22/22      4       4/4            0          0        no
coach          22/22      4       5/5            0          0        no
freelance      27/27      4       5/5            0          0        no
```

**Identical element counts and identical side-by-side row counts at both widths, in all twelve.** Nothing clipped past a section's edge, nothing scrolling sideways, and the scaled box matching its content to within a pixel everywhere (so no cut-off bottom and no dead space below the footer).

`minimal` shows 0 side-by-side rows at both widths because it is a single-column design by hand — that's the template, not the phone.

### The check found one real thing

`minimal` has a horizontal rule between the name and the intro. A `1px` border scaled to 0.39 is **0.39px** — drawn faintly on some screens and not at all on others. Hairlines don't survive being scaled, so the divider now divides the scale back out of its own thickness and stays a hairline on the glass.

That is the only defect the sweep turned up.

### And it is now a permanent test

`test/templates-mobile.js` runs in the normal loop (no browser needed) and, for **every** template, asserts: every section is inside the scaling wrapper; nothing is hidden on a phone that shows on a desktop; every element is positioned proportionally rather than in fixed pixels; and no rule survives that could restack it. Add a thirteenth template and it gets checked automatically.

## What I changed

- `public/app.html` — `.cv-seg--device` / `.wc-tplhead-dev` hidden below 820px; `_pvDeviceLocked()`; the lock read by both previews *and* the canvas; the resize handler that snaps the device back.
- `server.js` — hairline dividers keep their thickness through the scale.
- `test/templates-mobile.js` — new, all templates, in the dependency-free loop.
- `test/browser/editor.js` — the toggle checks now branch on width: above 820 it must switch and be on screen; at or below, it must be absent, pressing it must change nothing, and Back/Publish and Close/Use must still be reachable.
- `test/site-publish.js` — source assertions for the hide, the pin, every surface reading the lock, and the resize snap-back.

## Three of my own checks were wrong first

Recording them because they were mine: the wrapper check sliced to the first `</div></div>` and landed inside the first element on the page, reporting "1 section of 4" for documents that were wrapped correctly; the hidden-element check matched the stylesheet's own `.sd-el--mhide` rule and called it a hidden element; and the zero-size check treated "under one pixel" as missing, which flagged that 0.39px divider as absent. The first two were pure noise. **The third one was how I found the divider**, so it earned its keep before I corrected it.

## No open questions

The one decision that was open — whether the editor canvas should keep its phone toggle — is settled above: removed, on purpose, everywhere below 820px.
