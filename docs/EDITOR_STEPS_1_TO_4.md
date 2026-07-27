# The editor: Steps 1–4, built, verified and merged

`main` is at **`3f50900`**. Railway is deploying it.

**675 source assertions** and **88 browser assertions** at 1440px and 390px, 0 failures.

---

## 1. What shipped

### #282 — Simple mode deleted

1,443 lines out of `app.html`: the `#smView` markup, 230 lines of `.sm-*` CSS, 52 functions, 82 dead translation keys in both languages. Five load-bearing pieces stayed, renamed onto the `wc` prefix — the save path, which resume the site shows, the web address, Done Editing, and whether the site is live.

The tests now assert the **absence of the source**, not the absence of a route. Leaving the code on disk behind a closed door is what let it keep surfacing.

**Taking it out exposed a live bug: autosave was not running.** The subscription that saves your work lived inside simple mode's boot, so once the rail editor became the only way in, nothing subscribed the save path at all. Your edits survived **Publish** and nothing else — which is probably why your site kept looking wrong when you came back to it. It belongs to the editor now, with a test that fails if it is ever lost again.

### #283 — Type on the canvas

Click a text box and the caret is in the **real** text, in its real font, size, colour and alignment.

The canvas is an iframe rendered by the same renderer as your published site, and that renderer can inject an inline editor into the page — so the canvas is now rendered with it. There is no floating box to keep aligned through scroll, zoom, device switches and re-render, because it *is* the same text.

Press-and-hold-still means type. Press-and-move means drag. So you did not lose dragging to get typing.

### #284 — The gear

**⚙** on any selected element brings the property panel to the element — the same panel, floated, not a second one. It is clamped into the viewport so editing near an edge does not put half of it off screen, and it follows the canvas when that scrolls.

New controls: **size · weight · line height · letter spacing · italic · duplicate · layer order.**

Every one of these was already a property the renderer could honour or a field the element already had. The reason you could not change the size of your own name is that nothing offered to. Blank means "leave it to the template", which is not zero — storing 0 for a cleared line height would flatten the text rather than restore the default.

### #285 — Add into a box

**📷 Photo · 🎬 Video · 🎙 Voice · ✍️ Text**, from the gear on any element.

Placed inside the box when it fits and directly beneath it when it does not, then straight to the file picker. A 400px-tall box has an inside; a 40px heading does not. The element is placed *first*, so cancelling the upload leaves something real to fill in later rather than a press that did nothing.

### #286 — Docs

Including one correction: CLAUDE.md described a resume-sync prompt that no longer appears anywhere. The route, `resume-writeback.js`, the in-page offer UI and the Back Office badge all still exist — the code that asked the question went with simple mode.

---

## 2. Three phone bugs, found by measuring the screen

Each was true of the code and false of the glass, and each would have hit you first.

| | what was wrong | how it was found |
|---|---|---|
| **1** | The inspector was `display:none !important` at ≤780px while the ≤820px rules went to the trouble of floating it over the canvas. You could select something, its controls were built, and nothing appeared. | The browser pass runs at 390px as well as 1440px — it passed at desktop and failed at phone in the same run |
| **2** | Un-hiding it was not enough: at 230px pinned right it covered **59% of a 390px viewport**, landing on the element you had just tapped, so the second tap could not reach the canvas. | `elementFromPoint` at the tap location returned the inspector, not the canvas |
| **3** | The gear specified at 28px measured **7×5 physical pixels**, because the overlay sits inside the scaled canvas. The resize handle was 4px. | `getBoundingClientRect()` on the gear, rather than trusting the stylesheet |

The scale is now published as a CSS variable and the overlay chrome divides it back out, so anything hittable is the size it claims to be at every zoom level.

---

## 3. How this was verified

**`test/browser/editor.js`** — new, kept in the repo, run by hand because it needs Chromium (so it is deliberately outside the `test/*.js` loop):

```
npm i --no-save playwright-core
node test/browser/editor.js
```

It walks **gallery → Use → editor → select → type → gear → style → duplicate → add → Done** at 1440px and 390px, then reads the result back out of the database.

| | 1440px | 390px |
|---|---|---|
| No simple-mode node anywhere in the DOM | ✅ | ✅ |
| **Use** opens the editor, canvas not blank | ✅ | ✅ |
| Nothing covers the element you are trying to edit | ✅ | ✅ |
| A press opens a caret **in the iframe's own document** | ✅ | ✅ |
| What was typed is in the store, and on the canvas | ✅ | ✅ |
| Dragging a selected text element still moves it | ✅ | ✅ |
| A drag never opens a caret | ✅ | ✅ |
| The gear is ≥24×20 **on the glass**; the handle ≥12×12 | ✅ | ✅ |
| The panel is inside the viewport, within 40px of its element | ✅ | (sheet) |
| Colour, size and weight reach the **rendered page's computed style** | ✅ | ✅ |
| Duplicate makes a real second element, offset and selected | ✅ | ✅ |
| Add-into-a-box lands inside a tall box, beneath a thin one | ✅ | ✅ |
| Autosaved, then read back out of the database | ✅ | ✅ |

It measures rendered geometry, DOM presence and real network traffic — never an internal variable. That is the change I committed to after `edDevice`, after the `hidden` property, and after the clean-cache run that "passed" while the live site was broken.

Two harness fixes mattered more than they sound:

- **Third-party requests fail fast.** A pending stylesheet blocks script execution, and the canvas's inline editor is a script — so an unreachable Google Fonts left the whole edit layer un-initialised and made typing look broken for reasons unrelated to the code.
- **Each width gets its own account.** Sharing one meant the phone pass opened the site the desktop pass had just typed in and dragged around, so its failures were inherited state.

---

## 4. On the deletion method

The previous bulk deletion in this file cut 7,935 lines because a script scanned forward for a delimiter. This one asserted the **exact text of both boundary lines** of every range before cutting, wrote nothing until all four cuts matched, and would have aborted if the total removed fell outside 1,000–2,500 lines. The translation keys were removed by parsing the dictionary before and after and proving the only difference was the 82 dead keys, with no surviving value changed.

---

## 5. The commit-signature warning

A hook flagged `3f50900` as unverified. I set `user.email`/`user.name` for future commits, but did **not** amend it.

That commit is not mine to rewrite — it is GitHub's own squash-merge commit for PR #286, which is why the committer is `noreply@github.com`. The same applies to `db37321`, `902d632`, `51123ff` and `c33b185`: all five PRs were squash-merged by GitHub. My branch is currently identical to `origin/main` and the working tree is clean, so there is no unpushed work of mine to re-sign. Amending would rewrite a commit that is already `main` and force-push a divergent history, without changing `main` at all.

If you want merge commits attributed differently going forward, the fix is on the GitHub side — repo merge settings or commit signing for the merge author — not a local rebase. I can look into that if you want it.

---

## 6. When you test

**Hard-reload once.** Not for the cache bug from before — that is fixed — but the editor is substantially different and I would rather you see the new one.

Roughly in order:

1. **Personal Website** → the gallery → **Use** a template → the editor opens
2. **Click a heading, then click it again** → a caret appears in the text. Type. Press Enter.
3. **Press the ⚙** on a selected element → size, weight, colour, spacing, duplicate, layer
4. **Add into this box** → Photo / Video / Voice / Text
5. **Drag** an already-selected text element → it still moves
6. **✓ Done Editing** → the Back Office, with your work saved

---

## 7. What is not done

Beyond Steps 1–4 are the things named in passing but never scoped: **forms, maps, social embeds, animations, custom fonts.** Untouched, and deliberately so — that list is open-ended, and guessing at it is where the expensive mistakes live. Say which ones you want and I will pick them up.
