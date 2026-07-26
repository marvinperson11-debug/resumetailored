# Keyboard undo/redo — and simple mode is locked

Built and merged. 430 assertions green.

---

## 1. What happens

| Keys | Effect |
|---|---|
| **Ctrl+Z** / **Cmd+Z** | Undo |
| **Ctrl+Shift+Z** / **Cmd+Shift+Z** | Redo |
| **Ctrl+Y** | Redo |

All three drive the **same store the chips already use** — no second history. The chips appear exactly as they do when clicked: anchored to the action, 5-second fade, hover pauses.

**Typing keeps its own undo.** While an inline field is focused, Ctrl+Z undoes the *typing* — the browser's job — not the last site change. Site-level undo only fires when no text field has focus.

**First-use hint:** the first time you press Ctrl+Z in a session, the chips pulse once, so the shortcut and the button visibly become the same thing. Once per session, never again.

---

## 2. Two things worth knowing

### The keyboard is another iframe-boundary case

`keydown` only fires in the document that has focus. After a single click on the page, that's the **iframe** — not the app. So both documents listen, and whichever hears it produces the identical result.

That's now the third bug in this feature to come from the iframe boundary (after the 150px height and the click-away dismiss). It's the seam where my assumptions keep breaking, and I've started treating "does this cross the iframe?" as the first question rather than the last.

### A bug the verification caught

`first-use hint: false` on the first run.

Undo re-renders the page, which replaces the iframe. I was pushing the chips *immediately* after `edStore.undo()` — so the hint landed on a frame that was about to be thrown away, and the replacement got `hint: false`. The user would never have seen it.

Fixed by letting the **new** frame's "ready" signal do the push. `smDoUndo` no longer pushes at all.

Worth noting the test suite would not have caught this — it asserts the wiring exists, not that the timing works. Driving it in a browser did.

---

## 3. Verification

```
doc-store        30/30   PASS
page-ops         51/51   PASS
element-library  35/35   PASS
preview-parity   91/91   PASS
site-publish     42/42   PASS
vibes           105/105  PASS
inline-edit      76/76   PASS
render-snapshot  link.html + site-doc.html byte-identical
```

Driven in a browser, all six behaviours: Ctrl+Z undoes and the chips appear; the hint fires on first use only; Ctrl+Shift+Z redoes; Ctrl+Y redoes; typing keeps its own undo and the site order is untouched; no keyboard wiring reaches visitors.

---

## 4. Simple mode is locked

| Phase | |
|---|---|
| 1 | ✅ Full-screen finished site as the default |
| 2 | ✅ Inline editing — edit detaches, reset re-syncs |
| 3 | ✅ Ten Vibes, CC0 photography |
| 4 | ✅ Seven-step guided strip |
| 5 | ✅ Inline undo/redo chips **+ keyboard** |
| 6 | ✅ 💬 Not sure? helper |

---

## 5. Two things I want on the record

Neither is a question — you don't need to reply. But both are things I'd want to know if I were you.

**The Chinese is mine and unreviewed.** Every string has EN and 中文, but nobody who speaks Chinese has read the tone. Machine-plausible and *right* aren't the same thing, especially for copy like "算了" (Never mind) where register matters.

**Nobody has clicked this with human hands.** Everything I've built has been verified against my reading of your spec plus a headless browser. That found a lot — but the 150px iframe bug, which made the editor show a sliver of the page for several rounds, survived precisely because I kept measuring the DOM instead of looking at the screen.

I'd expect a real click-through to turn up things no test I wrote would catch.

---

## 6. Still yours

Wildcard DNS + TLS for `*.resumetailored.com`. Everything code-side waits behind `SITE_PUBLIC_HOST`.

**Don't set that variable before the DNS record and certificate exist** — every site link would break.

That's the last thing standing between the current build and the custom subdomains you called critical.
