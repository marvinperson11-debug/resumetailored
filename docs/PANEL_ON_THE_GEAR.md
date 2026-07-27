# The panel opens on the gear and on nothing else

All six rules built and verified. **743 source assertions** and **130 browser assertions** at 1440px and 390px, 0 failures.

---

## 1. Your six rules, and what each one is now

| | rule | what happens |
|---|---|---|
| 1 | Click any element → select only | The outline appears. Nothing else. `_edGearOpen` is the entire condition for the panel being on screen, so there is no path that can accidentally reopen it |
| 2 | Text: click and type | Unchanged — press an already-selected text box and release without moving, and the caret is in the real text |
| 3 | Photo/video slots: click to upload | The **same gesture** as text, but there is no text to type into, so it opens the file picker filtered to what the slot can hold. Image → images, video → videos, audio → audio |
| 4 | Gear → panel opens | Floats beside the element on desktop, bottom sheet on a phone. Rendered before it is measured, so it can't get pinned to the top of the screen by a height of zero |
| 5 | Click outside → closes | A press anywhere on the canvas, a click anywhere outside the panel, and a click **reported from inside the canvas iframe** all close it. Selecting another element closes the old panel and opens no new one |
| 6 | Never auto-opens | The `hidden` check is now `!edStore \|\| !edSel \|\| !_edGearOpen` |

Clicking **inside** the panel does not close it — it is where the controls are, and a panel that shut on its own controls would be unusable. The gear is the other exception, or opening it would immediately close it again.

Everything goes through **one function**, `edSetGear`. Six different things want the panel shut; without a single door, "closed" ends up meaning different things depending on which path got there.

## 2. One real bug found while building this

**A press could be posted into a canvas that had not finished loading, and it was silently lost.**

Every edit re-renders the canvas, which replaces `srcdoc` and reloads the document. The inline editor inside only starts listening once its script has run, and that waits on the page's stylesheets. So there is a window — right after any edit — where pressing a text box posted `beginEdit` into a document with no listener. The message vanished. The overlay had already handed its clicks away, and the watchdog took them back 2.5 seconds later.

From your side that is: type something, press Enter, immediately press another text box, and nothing happens.

The request is now **held and sent the moment the page reports itself ready**. The watchdog stays as the backstop.

## 3. Three harness bugs, and why I am listing them

Because in each case the first thing I saw was a product failure, and it wasn't one. Writing them down is the only thing that stops me reporting the next one as a fix.

**The gear only exists on the selected box.** A helper assumed the element from twenty lines earlier was still selected; a test in between had moved the selection, and Playwright waited thirty seconds for a button that was never going to be rendered.

**One test standing on another.** A map added two tests earlier was sitting on top of the heading's gear — `intercepts pointer events`. The panel checks now build two elements of their own, in clear space below everything.

**Template elements overlap.** Pressing the geometric midpoint of a heading selected a *photo* whose box covered that strip, and every typing assertion after it failed for reasons that had nothing to do with typing. The harness now asks the browser what is actually at each candidate point and takes the first that answers with the element it meant.

I also replaced a fixed 500ms sleep with a wait on the caret itself. That sleep passed for weeks and started failing the moment the canvas got heavier — sleeping a guess is how a test tells you about my machine instead of your code.

## 4. What the browser pass now covers

130 assertions at 1440px and 390px, all judged on whether the panel is **on the glass** — not on `_edGearOpen`, which has been true of a variable and false of the screen more than once in this feature:

```
selecting an element does NOT open the panel
the selected box carries a gear
the gear is the thing that opens it
a press on the canvas closes the panel
a click outside the panel closes it
clicking inside the panel keeps it open
selecting another element closes the panel and opens none
pressing a photo slot opens the image picker, not a caret
pressing a video slot asks for a video
and both still carry a gear for everything else
```

Both widths, both passes green, and I ran the whole thing twice to check it was not luck.

## 5. When you test

- **Tap anything** → outline only, no panel
- **Tap a text box again** → caret, type
- **Tap a photo or video box again** → the file picker
- **Tap the ⚙** → the panel, beside the element
- **Tap anywhere else** → gone

One thing I'd flag: on a phone the panel is a bottom sheet, so "click outside" means anywhere on the canvas above it. That is unchanged from before, but it is now much more noticeable, because the sheet no longer appears unless you asked for it.
