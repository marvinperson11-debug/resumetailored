# Yes — that matches. One thing in it needs a decision from you first.

Your spec is exactly what I have been building toward. Every line of it is either already done or straightforward. **One item is not what it looks like, and it is the item you care most about: "delete the bottom-strip editor completely."**

---

## 1. Your spec, checked against the code

| You want | Status |
|---|---|
| Left rail: Templates, Elements, Text, Brand, Uploads, Content | ✅ exists, unchanged |
| Panels expand one at a time | ✅ `cvPanel()` already enforces one |
| Collapse arrow on the rail | ✅ on desktop — **see §3**, I hid it on phone and will put it back |
| Centre canvas with the site | ✅ |
| Preview + Publish always visible | ✅ fixed — they were off the right edge at 390px |
| Device toggle, **kept on phone** | ✅ **done just now** — I had hidden it, you were right, it is back and measures on screen at 390px |
| Dark theme throughout | ✅ |
| Personal Website always lands here, no fallbacks | ✅ routed |

**Already merged and live:** the rail editor is what `Personal Website` opens, on desktop and phone.

---

## 2. The thing that is not what it looks like

You said: *"Delete the bottom-strip editor completely. Remove all its code, routes, and components."*

I agree with the intent. But a blind deletion by name would break your editor, and I would rather tell you now than hand you a broken build.

**The auto-save engine has a bottom-strip name.** The rail editor's own store does this:

```js
edStore.subscribe(() => { wcDoc = edStore.getDoc(); smRenderSite(); smQueueSave(); });
```

`smQueueSave` / `smSave` / `smFlushSave` are the **only** save path in the product. Everything you do in the rail editor persists through them. They are named `sm*` because they were written for the simplified view first, then reused. Delete everything matching `sm*` and the rail editor stops saving your work.

Same story for three more:

| Named `sm*` | What it actually is |
|---|---|
| `smQueueSave` / `smSave` / `smFlushSave` | the auto-save engine — the rail editor runs on it |
| `smDoneEditing` | the **✓ Done Editing** button in the rail editor's own top bar |
| `smChangeAddress` | changing your web address, reached from Back Office |
| `smPublished` / `smSiteUrl` | whether your site is live, and where |

So "delete the bottom-strip editor" has to mean **delete its interface and its flows, keep and rename the plumbing underneath**. That is what I plan to do:

**Deleted outright**
- the white full-screen view (`#smView`) and all its markup
- the bottom strip — "Looks good? → Pick your vibe → Add a photo?" — and its seven steps
- the 10 Vibes flow and its picker
- the 💬 Not sure? help button and panel
- the inline tap-to-edit layer and its undo chips
- the "Customize My Site" button
- the resume-sync prompt that rode on inline editing
- every `.sm-*` stylesheet rule for the above

**Kept, renamed off the `sm` prefix so this confusion cannot happen again**
- auto-save (`smQueueSave` → `wcQueueSave`, etc.)
- publish state and the live URL
- the change-address flow
- Done Editing

That is roughly 1,500 lines removed and about 40 call sites renamed.

---

## 3. Two things I got wrong that you should know about

**The device toggle.** You asked for it on phone; I had hidden it, reasoning that "a device toggle on a phone is a question that answers itself." That was wrong — you build on a phone and need to check the desktop view, which is the one thing you otherwise cannot see. Fixed and measured.

**The collapse arrow.** I hid it on phone because it was sitting on top of the "Uploads" button. Your spec asks for it. I will put it back and move it somewhere it does not overlap, rather than removing it to solve the overlap.

---

## 4. One question before I cut

### Does the resume-sync feature go with the bottom-strip editor?

It is the popup that appeared after you edited a field on the site: *"You changed your headline on your website. Update it on your saved resume too?"* You specified it in detail a while back and it was merged.

It only exists inside the **inline tap-to-edit layer**, which is part of the editor being deleted. The rail editor edits through the inspector instead, so there is no moment where that question could be asked.

- **Delete it too** — it goes with the layer it lives in. Simplest, and matches "delete completely".
- **Keep the write-back, drop the prompt** — `resume-writeback.js` and `/api/resume-sync` stay, wired to a button in the rail editor's inspector later. Nothing is lost, but it is a loose end until then.

**My recommendation: delete it now, keep `resume-writeback.js` on disk.** It is tested and self-contained, so re-wiring it to the inspector later is an afternoon rather than a rebuild. Deleting the prompt while leaving the tested engine costs nothing.

---

## 5. What happens next

1. You answer §4.
2. I do the deletion and the two fixes in §3.
3. **One PR**, rail editor as the only editor, bottom-strip editor gone.
4. You test it on your phone.
5. Nothing new gets built until you are happy with it.

I have not opened the PR yet, because deleting 1,500 lines the wrong way is worse than waiting for one answer.
