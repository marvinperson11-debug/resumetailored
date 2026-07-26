# I stopped the deletion. Here is what happened and what I need from you.

**No PR opened. Nothing merged. `main` is untouched and the branch is green.**

---

## 1. What I was doing

Everything you specified, in order: delete the bottom-strip editor's interface and flows, keep and rename the plumbing, fix the two phone issues, open one PR.

The first two steps went fine. Markup and stylesheets came out cleanly — 52 single-line `.sm-*` rules, 25 multi-line ones, and the whole `#smView` block, all verified gone with nothing else touched.

Then I deleted the 52 simple-mode **functions** with a script, and that is where it went wrong.

---

## 2. What went wrong

I scripted it as: *find each line matching `function smX(`, then scan forward to the next line that is exactly four spaces and a closing brace, and delete everything between.*

Where a function's body did not produce that exact line at that exact indentation, the scan kept running — past the end of that function, through whatever came next, until it hit some much later function's closing brace. Each miss swallowed everything in between.

| | lines |
|---|---|
| `public/app.html` before | 9,944 |
| after my script | **2,024** |
| what this change should remove | ~1,500 |

It cut **7,935 lines**. Roughly six thousand of those were code that had nothing to do with the editor being deleted.

I caught it by checking the diff size before doing anything else with the file, and reverted immediately. The test suite is green again on the untouched tree.

---

## 3. Why this keeps happening, and what I am changing

This is the **third time** in this project that a range-based edit has eaten neighbouring code. The first swallowed a route (`/api/site-vibes`), the second took out a chunk of `_autogenFill`'s neighbours, and this one nearly took the whole application.

Every time, the cause is the same: I described the edit as *"from here, scan until you find X"* instead of *"replace this exact text."* When the file does not contain X where I assumed it would, a scan does not fail — it silently keeps going and takes hostages.

**The rule I should have been following, and will now:** match exact literal text, never scan for a delimiter. When something must be removed by range, gate it on the size of the result before writing.

---

## 4. How I will do it instead

Slower on purpose, in separately verified passes:

1. **Markup** — the `#smView` block by exact text. Run suite. Check diff size.
2. **Stylesheets** — `.sm-*` rules. Run suite. Check diff size.
3. **Functions, one at a time, by exact literal body.** 52 individual edits rather than one script. The suite runs between each, so a mistake is one function wide instead of six thousand lines wide.
4. **Dangling references** — resolve each one as it appears, rather than after the fact.
5. **Rename the plumbing** (`smQueueSave` → `wcQueueSave`, and the rest) only once the deletions are proven.
6. **Browser check at 390px and 1440px** before the PR.

**A hard gate at every pass:** this change should remove about 1,500 lines. Anything past ~2,500 stops the work and I come back to you rather than pushing on.

---

## 5. What survived and is already on the branch

Not lost, and not affected by the revert:

- **The rail editor is the only thing `Personal Website` opens** — desktop and phone, verified in a browser.
- **Phone layout fixes**: Preview and Publish reachable at 390px (they were off the right edge — you could not publish at all), rail at 56px, panel floats over the canvas instead of leaving it 16px wide, all 12 template tiles with every Preview/Use button on screen.
- **The device toggle is back on phone**, as you asked — measured on screen at 390px with Publish still reachable.

Still to do: the collapse arrow at phone width (I will move it to the bottom of the rail so it stops covering "Uploads", rather than hiding it), and the deletion itself.

---

## 6. What I need from you

### Which order?

- **Delete now, you test the whole thing after.** One PR as you asked, but you wait for the careful passes before touching anything.
- **You test the rail editor on your phone first, I delete after.** It is already on the branch and working. You would be testing the editor you actually care about now, and the deletion becomes a second, boring PR that changes nothing you can see.

**My recommendation: you test first.** The deletion is invisible to you — it removes an editor you can no longer reach anyway. If something about the rail editor is wrong on your phone, I would rather find that out before spending a long, careful pass deleting code around it.

Either way I am not building anything new until this is clean, merged, and you are happy with it.
