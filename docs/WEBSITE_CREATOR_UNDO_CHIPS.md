# Phase 5 — inline undo/redo chips

Built. On PR #271, all suites green. Delete now has a visible safety net.

---

## 1. What happens

Every inline action puts a chip where the action happened:

| Action | Where the chips appear |
|---|---|
| Delete a section | in the gap it left behind |
| Move a section | travelling with the section that moved |
| Edit text | just below the field |
| Change a photo | just below the photo |

- **Undo** reverts and flips the pair to show **Redo**, resetting the 5-second countdown.
- **Redo** re-applies and flips back.
- Both fade on a CSS transition after 5s.
- **Hovering pauses the countdown**; leaving resumes with the time that was left, floored at 1.2s so it never vanishes under the cursor.
- **Only one set on screen.** A second action before the first fades simply moves the chips.
- **Non-blocking.** The wrapper is `pointer-events: none`, so the page underneath stays clickable while they fade — only the pills themselves catch clicks.
- Larger tap targets below 820px.

---

## 2. Two decisions

**The chips live inside the iframe**, like the edit layer. A pill in the corner of the screen doesn't read as *"undo **that**"* — it reads as a notification. Local means local.

The page re-renders after every change, which destroys anything in the iframe. So the anchor is held in the parent and re-sent when each new render reports itself ready. That's also why a deleted section can still be anchored: the parent captures the section's **index** before deleting, and the chips land on whatever now occupies that spot.

**They're clamped into the visible viewport.** Anchoring below a restored section put them at `y: 1040` on an 848px screen. An undo chip you have to scroll to find is not a safety net.

**And I removed the "Undone" toast** from this path. The chip is the feedback, and it's already where the user is looking — a corner toast is exactly the pattern these replace.

---

## 3. The bug this turned up, and a mistake I made

`.sm-frame` was positioned with `top` and `bottom` offsets and **no explicit height**.

An `<iframe>` is a *replaced* element. With `height: auto`, an absolutely positioned replaced element falls back to its **intrinsic 150px** and ignores `bottom` entirely.

**The site has been rendering into a 150px sliver, with the rest of the screen blank, ever since the slim bar landed.**

I need to own how long that took to find. I saw it repeatedly in screenshots across several rounds and wrote it off as a paint-timing artifact — because every time I probed the DOM, the content was there. The content *was* there. It just wasn't on screen. My probes measured `innerText` and computed styles of elements; none of them measured **the frame's own box**.

The fix is one line (`height: calc(100% - 52px)`). The lesson is that "the DOM has it" and "the user can see it" are different claims, and I kept verifying the first while asserting the second.

---

## 4. Also fixed

A character class in the chip's anchor lookup collapsed into an invalid regex — the same generated-JavaScript escaping trap as last round. **The test I added last time caught it immediately**, before it reached a browser.

The anchor now whitelists (`[^A-Za-z0-9_-]`) rather than escaping, which is both immune to that trap and closes an attribute-selector injection route.

---

## 5. Verification

```
doc-store        30/30   PASS
page-ops         51/51   PASS
element-library  35/35   PASS
preview-parity   91/91   PASS
site-publish     42/42   PASS
vibes           105/105  PASS
inline-edit      64/64   PASS
render-snapshot  link.html + site-doc.html byte-identical
```

418 assertions. The chip layer ships **only** in editable mode — asserted absent from the published page, along with both render snapshots staying byte-identical.

Driven in a browser: delete removes the section and the chip appears in the gap; undo restores it and offers redo; redo re-deletes; the pair fades after five seconds; moving a section anchors the chips to it.

---

## 6. Two things I decided rather than asked

**Undo shows both chips, not just Redo.** Your spec says clicking Undo "flips the chip to show Redo". In practice there's usually more history behind it, so I show **↩️ Undo ↪️ Redo** side by side — which your item 4 explicitly allows for. Flipping to Redo *only* would strand someone who wanted to undo twice.

**Section delete stays immediate — no confirm dialog.** That was my recommendation last round and the chips are what made it safe. A dialog on every delete is the kind of interruption you've been cutting.

---

## 7. Questions

One, and it doesn't block anything.

### The chips are visual-only

They're clickable, but there's no keyboard equivalent in simple mode — **Ctrl+Z does nothing** unless the advanced editor is open, where it's already bound.

**My recommendation: bind Ctrl+Z / Ctrl+Shift+Z in simple mode too**, driving the same store. It's a small change and it's what anyone who has used a computer will try first. I didn't add it because your spec described chips specifically, and I'd rather ask than quietly widen the surface.

---

## 8. Where the phases stand

| Phase | |
|---|---|
| 1 | ✅ Full-screen site as the default |
| 2 | ✅ Inline editing, edit-detaches / reset-re-syncs |
| 3 | ✅ Ten Vibes, CC0 photography |
| 4 | ✅ Seven-step guided strip |
| 5 | ✅ **Inline undo/redo chips** |
| 6 | ⏭️ 💬 Not sure? — jumps straight to the right control |

That's the last one on your list. After it, the remaining work is whatever clicking through turns up.

**Still yours:** the wildcard DNS + TLS for `*.resumetailored.com`. Everything code-side waits behind `SITE_PUBLIC_HOST`; don't set it before those exist or every site link breaks.
