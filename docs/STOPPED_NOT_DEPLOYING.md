# Stopped. Nothing deployed. One bug found and it is mine.

**No PR. No merge. `main` untouched.** You said do not deploy until I have confirmed all three in my own hands, and I have not, so I have not.

---

## 1. Bug 2 — found it, and it is a regression I introduced

I found this by reading, and it is certain enough that I can show you the two lines.

`.cv-shell` is offset to make room for the app sidebar:

```css
@media (min-width: 981px) { .cv-shell { left: 240px; } }
```

When I made the picker the front door last round, I hid the app sidebar:

```css
body.wb-picker .sidebar { display: none !important; }
```

**I hid the sidebar without moving the shell.** So the sidebar disappears, the shell still starts 240px in, and you get exactly what you described: a blank strip down the left, canvas not filling it.

The existing `body.cv-wide` state gets this right — it hides the sidebar *and* sets `left: 0`. Mine did half of it.

Fixed locally with the missing half:

```css
body.wb-picker .cv-shell { left: 0 !important; }
```

**Not pushed.** It is one line and I am confident in it, but it goes out with the other two or not at all.

---

## 2. Bugs 1 and 3 — still not reproduced, and I need to say why that is a problem

My browser harness clicking a real **Use** button, at 1440px and 390px, has reported the template switching correctly every time — `wcTplId` changes, the document changes, the editor opens on it. Twice now I have reported "works locally" and twice you have come back with it broken.

That means **my harness is testing something your browser is not doing.** Continuing to run it and report green is worthless. The gap itself is now the thing to find.

The most likely difference, and I should have said this two rounds ago: my harness starts from a **fresh database with no site**, so it takes the *create* path. You have an **existing site with an existing config**, so you take the *swap* path. Those are different branches in the same function, and I have been testing the one you are not on.

I ran out of the time budget for the run that would have proved this — it timed out mid-way. That is on me, not on the evidence.

---

## 3. What I am going to do, in this order

1. **Rebuild the harness around your state, not mine.** Existing published site, existing config, then click Use. Not `pg.evaluate` calling functions directly — real clicks on real buttons, which is what you do.
2. **Confirm bug 3 by comparing render output**, not by eye: same template, same resume, dump the rendered canvas HTML before and after `fillFromResume`, and diff it. If the layout changed, the diff names what changed.
3. **Verify the collapse fix by measurement** — canvas `x` and `width` before and after, at both widths, asserting there is no gap.
4. Only then, one PR with all three confirmed.

---

## 4. Two questions that would cut this short

**Q1. When you click Use, does the toast now show the `Stage:` line?**

The diagnostic build is live on `main`. If you got the old one-line "Cannot load this template", you are on a stale deploy and Railway has not picked up `64396fc`. If you got the new multi-line one, **the `Stage:` value tells me exactly which of six places breaks** and I can stop guessing entirely.

That single line is worth more than everything I did this round.

**Q2. "The template layout is different" — different from what, exactly?**

Two readings and they lead to different work:

- **The template renders with the wrong geometry** — elements in the wrong places, overlapping, wrong sizes. That points at the renderer.
- **The template renders correctly but is not the template you picked** — you pressed Studio and got Executive. That points at the swap path, and is really Bug 1 wearing a different hat.

If you have a screenshot of a template rendering wrongly, that settles it faster than anything I can measure.

---

## 5. Straight answer on this round

I shipped a rate-limit fix for a failure you had already told me was not a rate limit, and a diagnostic build that has not yet produced a diagnosis. The one thing of value is bug 2, which I caused, and which I found by reading the CSS rather than running anything.

I am not going to push again until the three checks pass in front of me.
