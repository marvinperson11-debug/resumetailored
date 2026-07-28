# The template picker on a phone

Mobile only. **798 source assertions** and **205 browser assertions**, 0 failures.

I measured it before changing anything, and the measurements turned up a second problem you didn't mention.

---

## What it measured at 390px, before

```
columns 1  ·  rows 12  ·  grid 3282px tall  ·  page 3479px
panel left 56px  ·  panel width 390px      ← 56px WIDER THAN THE WINDOW
filter pills 72px tall
```

**The stack you saw.** The grid asks for `minmax(210px, 240px)` columns. That's right on a laptop and can only ever fit **one** column on a phone — twelve full-width cards, 3.5 screens of scrolling.

**And something else.** The panel inherited the editor's `left: 56px` — the width of the rail — while the picker's own rule made it `width: 100%`. So the gallery sat **pushed 56px right with 56px of itself off the right-hand edge**. The rail is hidden in the picker, so that offset was never wanted here at all. That's almost certainly part of what read as "looks empty": a dead gutter down the left and content running off the right.

## After

| | 390px | 768px | 1440px |
|---|---|---|---|
| Columns | 1 → **2** | 2 → **3** | **4** (unchanged) |
| Card | 240×257 → **178×196** | → **241×188** | **240×257** (unchanged) |
| Rows | 12 → **6** | 6 → **4** | **3** (unchanged) |
| Page height | 3479 → **1365px** | 1790 → **921px** | **965px** (unchanged) |
| Filter pills | 72px, wrapped → **35px, scrolls** | → **35px** | **33px, wraps** (unchanged) |
| Panel offset | 56px → **0** | 56px → **0** | **240px** (unchanged) |

**61% less scrolling on a phone.** At 768px the whole gallery now fits on one screen with no scrolling at all.

## The four changes

**1. Smaller cards.** Thumbnail 150 → 96px (104px on narrow phones), body padding 12/13 → 8/9, name 14 → 12.5px, category 11 → 9.5px. Card 257 → 196px tall.

**2. Two or three per row.** Two at ≤560px, three above it. I tried content-sized columns first and it gave *five* at 768px — more choice on screen, but a 141px tile of a whole web page is a smudge. An explicit count is the honest control: the card stays legible and the number changes once, at the width where it needs to.

**3. Compact spacing.** Gap 18 → 10px, panel padding 22/26/40 → 12/12/32.

The two buttons on a ~178px card are now equal halves and still **30px tall** — the least a thumb can reliably be asked to hit.

**4. Filter pills scroll sideways.** They wrapped into a 72px block that was taller than the first row of templates. They're a single scrollable row now, with the pills refusing to shrink — a squashed "Professional CV" isn't a filter anyone can read. The scrollbar is hidden.

## Desktop is untouched, and there's a check that says so

Every rule is inside a `max-width` media query **and** prefixed `body.wb-picker`, so nothing can reach the desktop gallery or the editor. Two assertions enforce that rather than promising it:

- Source-side: the desktop gallery rules are matched **verbatim** as they were, and every new picker rule is counted inside a phone media query.
- Browser-side at 1440px: **card geometry is unchanged** (240×257, 150px thumb) and the filter pills still wrap.

Measured at 900px too, above the breakpoint — identical to 1440px behaviour.

## On the breakpoint

You said "768px or whatever breakpoint you use". I used **820px**, which is the phone breakpoint the editor already has — with a second step at 560px for the two-column drop.

That matters for one reason beyond consistency: the 56px offset bug existed all the way up to 820px, so fixing it at 768px would have left a broken band between 768 and 820 — which is where a landscape phone and a small tablet sit.
