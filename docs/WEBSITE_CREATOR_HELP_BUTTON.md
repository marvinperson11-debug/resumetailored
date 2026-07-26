# Phase 6 — the 💬 Not sure? helper

Built. On PR #271, 423 assertions green. **Simple mode is feature-complete.**

---

## 1. What happens

A floating **💬 Not sure?** pill sits bottom-right — **only while editing**. The public view stays completely clean.

It opens four plain-English wants, each wired straight to the control that satisfies it:

| They say | They get |
|---|---|
| I want to change my photo | the file picker |
| I want to move something | every move control at once, pulsing |
| I want a different look | the vibe picker |
| I want to add my voice | the voice recorder |

The panel **closes itself the moment the control opens** — asking someone to dismiss a helper after it's helped them is one step too many. A quiet **Never mind** dismisses without choosing, and clicking anywhere on the page does the same.

Nothing steals focus. Nothing blocks the page underneath.

---

## 2. Two options that needed more than a jump

**"I want to move something"** puts a bar on *every* section at once, pulsing, and scrolls the first into view. Just opening a menu would have left the user still not knowing that sections are clickable — the point of the question is that they don't know where the control is. The bars clean themselves up after seven seconds.

**"I want to change my photo"** adds a photo to the top of the page when the current design has no photo slot. Three of the twelve templates don't have one, and *silently doing nothing* is the worst possible answer to "I want to change my photo."

That was the open question from the Phase 2 write-up, and your spec answered it in passing — you described this as "same behavior as the guided strip." The strip **didn't** actually do that yet, so I fixed it there too. It had the same gap.

---

## 3. Two bugs found by driving it

**Clicking away didn't close the panel.** A click on an `<iframe>` never reaches the parent document, and the iframe is most of the screen — so the most natural dismiss gesture did nothing at all. The edit layer now reports page clicks outward.

This is the same root cause as the 150px iframe from last round: **the iframe boundary is where my assumptions keep breaking.** Worth me remembering.

**Toasts collided with the button.** Both default to the bottom-right. Toasts are now centred while the Website Creator is open.

---

## 4. Plain language, checked rather than assumed

The button, panel and every option are asserted in the browser against a list of words that should never appear: *canvas, asset, layout, properties, section, grid, element, artboard*.

Note one consequence: the user-facing copy says "move something", never "section" — even though the thing being moved is internally a section. That's deliberate.

---

## 5. Verification

```
doc-store        30/30   PASS
page-ops         51/51   PASS
element-library  35/35   PASS
preview-parity   91/91   PASS
site-publish     42/42   PASS
vibes           105/105  PASS
inline-edit      69/69   PASS
render-snapshot  link.html + site-doc.html byte-identical
```

Driven in a browser: hidden in public view, visible while editing, all four options reach their control, the panel self-closes, clicking away dismisses it, and none of the help wiring reaches visitors.

---

## 6. Where everything stands

| Phase | |
|---|---|
| 1 | ✅ Full-screen finished site as the default state |
| 2 | ✅ Inline editing — edit detaches, reset re-syncs |
| 3 | ✅ Ten Vibes, CC0 photography, lighten/darken |
| 4 | ✅ Seven-step guided strip, no music |
| 5 | ✅ Inline undo/redo chips |
| 6 | ✅ **💬 Not sure? helper** |

Your original ten-item spec is done, with two deliberate exceptions worth naming:

- **Item 9, custom subdomains** — code complete, waiting on DNS/TLS (below).
- **Item 10, Chinese** — every new string has EN and 中文. I have *not* had a native speaker check the tone; the translations are mine.

---

## 7. Questions

Two, neither blocking.

### Q1 — Ctrl+Z in simple mode? *(still open from last round)*

The chips work, but **Ctrl+Z does nothing** unless the advanced editor is open. My recommendation is still to bind it — it's what anyone will try first — but your spec described chips specifically and I'd rather ask than widen the surface unasked.

### Q2 — What should I do next?

The feature list is finished, so the honest answer is: **I don't think more features is the right next move.** What would be worth more:

1. **You clicking through it on Railway.** Nine PRs of this has been built against my reading of your spec plus a headless browser. The 150px iframe bug sat there for several rounds precisely because nobody looked at it with human eyes.
2. **A native-speaker pass on the Chinese**, if you have one available.
3. **The DNS/TLS**, which unblocks the subdomain URLs you called critical.

If you'd rather I keep building, say what and I will — but my recommendation is to merge, click, and tell me what's wrong.

---

## 8. Still yours

Wildcard DNS + TLS for `*.resumetailored.com`. Everything code-side waits behind `SITE_PUBLIC_HOST`.

**Don't set that variable before the DNS and certificate exist** — every site link would break.
