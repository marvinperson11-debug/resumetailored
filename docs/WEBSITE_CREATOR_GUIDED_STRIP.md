# The guided strip — built, and the one question left

PR #271, two commits, still a draft. Merge whenever you want to try it on Railway.

---

## 1. The seven steps

"Customize My Site" now opens a conversation, not a toolbar. One question on screen at a time, skip and back on every step.

| | Step | Answers |
|---|---|---|
| 1 | Looks good? | Yes, I'm done / Let me tweak it |
| 2 | Pick your vibe | ten tiles, lighten / darken |
| 3 | Add a photo? | Upload / Skip |
| 4 | Add a voice intro? | Record 30s / Skip |
| 5 | Which resume? | dropdown |
| 6 | Which cover letter? | dropdown → download button |
| 7 | Publish! | one green button |

Verified end to end in a browser at 390×844: all seven in order, back works from the last step, ten vibe tiles visible and applying, and the word "music" appears nowhere in the flow.

---

## 2. Music — cut, but not deleted

Your call, and the right one. There is no music step.

**Ambient sound is still there** for anyone who goes looking: it stays available as an `audio` element in the advanced editor. It simply never interrupts the three-minute path — which was your point.

**Voice intro is a different thing** and keeps its step. It's the person speaking for themselves, and visitors see **▶ Play my introduction** — they choose whether to press it. Nothing starts on its own.

---

## 3. The cover letter is a download

A cover letter is addressed to one company. Printed on the page, every *other* recruiter reads a letter written to someone else.

So step 6 attaches it as a download button — `/site/:sub/cover-letter`, served as a file attachment. The letter's text is stored in the site config rather than looked up by id, because the published page is served with no session behind it.

Three things the tests hold down:

- An **unpublished draft does not leak it** — the download 404s until you publish, same as the page itself.
- Choosing **no cover letter leaves no dead button**.
- The letter is **never rendered into the page body**.

---

## 4. Two bugs I found — and one I caused

Both were caught by **measuring geometry**, not by looking at screenshots. The screenshots looked plausibly fine in both cases, which is the part worth knowing.

### Duplicate element id — my own regression

The old vibe sheet and the new strip both carried `id="smVibeGrid"`. `getElementById` returns the first match, so it was filling the *hidden* sheet while the strip's grid stayed empty.

The ten tiles rendered perfectly — at `y: 936`, off the bottom of an 844px screen.

This is the **same bug class I fixed in the templates two commits ago**, and I reintroduced it by leaving the old sheet in place when the strip superseded it. The sheet is now removed.

### Flex-wrap with a grid child

The strip body laid the grid out at the correct size but overflowed its container instead of growing it. Block flow is the right tool for a stack of full-width rows.

---

## 5. Verification

```
doc-store        30/30   PASS
page-ops         51/51   PASS
element-library  29/29   PASS
preview-parity   91/91   PASS
site-publish     42/42   PASS
vibes           105/105  PASS
render-snapshot  link.html + site-doc.html byte-identical
```

354 assertions. `link.html` — what Create-a-Link visitors are served — has stayed byte-identical through every one of these changes.

---

## 6. Housekeeping

I opened #271 as a docs-only PR and then pushed the strip into it, so its title and description had drifted from the diff. Both are corrected now. If you'd rather the strip lived in its own PR, say so and I'll split it.

---

## 7. The one question left

**When someone edits their name on the site, does their resume change?**

This is the only thing blocking inline editing (Phase 2). It's a fork, not a detail.

Your spec says two things that can't both hold:

- Item 1: the site *"updates automatically when you update your resume"* — resume is the source of truth
- Item 2: *"click name → edit name"* — edit directly on the site

If both are true, the next resume update silently overwrites whatever they typed on the site.

| | Behaviour | Cost |
|---|---|---|
| **A. Resume wins** | Fields from the resume are read-only; clicking one offers "Edit in Resume Tailor" | Honest, but "click it to change it" stops being literally true |
| **B. Site wins once touched** | Editing a field on the site detaches it; resume updates stop touching that field | Matches your spec exactly. Needs a quiet "reconnect to my resume" escape |
| **C. Free-form copy** | Generated once, never resynced | Simplest. Loses "updates automatically" entirely |

**My recommendation: B.** It's what your spec literally describes, and the detach is invisible until it matters.

---

## 8. What's left after that

| Phase | |
|---|---|
| **2** | Click-it-to-change-it inline editing — **gated on the question above** |
| **5** | The inline ↩️ Undo that appears where you acted and fades after 5s (the engine exists; this is surfacing it) |
| **6** | 💬 Not sure? — jumps straight to the right control |

And still yours, unchanged: the wildcard DNS + TLS for `*.resumetailored.com`. Everything code-side waits behind `SITE_PUBLIC_HOST`; don't set it before those exist or every site link breaks.
